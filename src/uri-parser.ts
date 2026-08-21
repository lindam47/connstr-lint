// Parses URI-style connection strings (postgres://, mongodb://, mysql://,
// and similar): scheme://[user[:password]@]host[:port][/database][?query].
// This is a different grammar from the ADO.NET/ODBC key=value dialect in
// parser.ts and the two don't share any parsing logic, only the Cursor and
// result shapes, so callers can render either kind of issue the same way.
//
// Grammar assumptions kept deliberately narrow (this covers real-world
// connection strings, not the full RFC 3986 URI grammar):
// - single line input (positions are computed with column arithmetic that
//   does not account for newlines inside a userinfo/host/query segment)
// - authority userinfo is split on the first ":" and the whole segment
//   before the *last* "@" ahead of the next "/", "?" or "#" - that matches
//   how real drivers resolve a literal "@" inside a password

import type { ConnectionPair, ParseIssue, ParseResult, Position } from "./parser.js"
import { Cursor } from "./parser.js"

const SCHEME_CHAR = /[a-zA-Z0-9+.-]/

function readUntil(cursor: Cursor, stop: (ch: string) => boolean): string {
  let out = ""
  while (!cursor.atEnd && !stop(cursor.peek()!)) {
    out += cursor.advance()
  }
  return out
}

function isAuthorityBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === "/" || ch === "?" || ch === "#"
}

// Looks ahead (without consuming) at the authority segment - everything up
// to the next "/", "?", "#" or end of input - so the "@" that splits
// userinfo from host can be found before committing to read either.
function peekAuthoritySegment(cursor: Cursor): string {
  let out = ""
  let offset = 0
  while (true) {
    const ch = cursor.peek(offset)
    if (isAuthorityBoundary(ch)) break
    out += ch!
    offset += 1
  }
  return out
}

function decodeOrIssue(
  raw: string,
  position: Position,
  label: string,
  issues: ParseIssue[],
): string {
  if (!raw.includes("%")) return raw
  try {
    return decodeURIComponent(raw)
  } catch {
    issues.push({
      severity: "error",
      message: `invalid percent-encoding in ${label}`,
      position,
      length: Math.max(raw.length, 1),
    })
    return raw
  }
}

export function parseUriConnectionString(input: string): ParseResult {
  const cursor = new Cursor(input)
  const pairs: ConnectionPair[] = []
  const issues: ParseIssue[] = []

  const schemeStart = cursor.position()
  let scheme = ""
  while (!cursor.atEnd && cursor.peek() !== ":" && SCHEME_CHAR.test(cursor.peek()!)) {
    scheme += cursor.advance()
  }

  if (scheme.length === 0 || cursor.peek() !== ":") {
    issues.push({
      severity: "error",
      message: 'missing scheme (expected "name://...")',
      position: schemeStart,
      length: Math.max(scheme.length, 1),
    })
    return { pairs, issues }
  }
  cursor.advance() // ':'

  if (cursor.peek() !== "/" || cursor.peek(1) !== "/") {
    issues.push({
      severity: "error",
      message: `expected "//" after scheme "${scheme}:"`,
      position: cursor.position(),
      length: 1,
    })
    return { pairs, issues }
  }
  cursor.advance()
  cursor.advance() // '//'

  pairs.push({ key: "scheme", value: scheme, position: schemeStart })

  const authoritySegment = peekAuthoritySegment(cursor)
  const atIndex = authoritySegment.lastIndexOf("@")
  if (atIndex !== -1) {
    const userinfoStart = cursor.position()
    let userinfo = ""
    for (let i = 0; i < atIndex; i++) userinfo += cursor.advance()
    cursor.advance() // '@'

    const colonIndex = userinfo.indexOf(":")
    const user = colonIndex === -1 ? userinfo : userinfo.slice(0, colonIndex)
    const password = colonIndex === -1 ? undefined : userinfo.slice(colonIndex + 1)

    if (user.length > 0) {
      pairs.push({
        key: "user",
        value: decodeOrIssue(user, userinfoStart, "user", issues),
        position: userinfoStart,
      })
    }
    if (password !== undefined && password.length > 0) {
      const passwordStart: Position = {
        line: userinfoStart.line,
        column: userinfoStart.column + colonIndex + 1,
      }
      pairs.push({
        key: "password",
        value: decodeOrIssue(password, passwordStart, "password", issues),
        position: passwordStart,
      })
    }
  }

  const hostStart = cursor.position()
  let host: string
  if (cursor.peek() === "[") {
    let literal = cursor.advance() // '['
    while (!cursor.atEnd && cursor.peek() !== "]") {
      literal += cursor.advance()
    }
    if (cursor.atEnd) {
      issues.push({
        severity: "error",
        message: "unterminated IPv6 host literal (missing closing ])",
        position: hostStart,
        length: literal.length,
      })
      return { pairs, issues }
    }
    literal += cursor.advance() // ']'
    host = literal
  } else {
    host = readUntil(cursor, (ch) => ch === ":" || isAuthorityBoundary(ch))
  }

  if (host.length === 0) {
    issues.push({
      severity: "warning",
      message: "empty host (some drivers treat this as a request for a default or Unix socket)",
      position: hostStart,
      length: 1,
    })
  } else {
    pairs.push({ key: "host", value: host, position: hostStart })
  }

  if (cursor.peek() === ":") {
    cursor.advance()
    const portStart = cursor.position()
    const port = readUntil(cursor, isAuthorityBoundary)
    if (port.length === 0) {
      issues.push({
        severity: "error",
        message: 'missing port number after ":"',
        position: portStart,
        length: 1,
      })
    } else if (!/^\d+$/.test(port)) {
      issues.push({
        severity: "error",
        message: `invalid port "${port}" (must be numeric)`,
        position: portStart,
        length: port.length,
      })
    } else {
      pairs.push({ key: "port", value: port, position: portStart })
    }
  }

  if (cursor.peek() === "/") {
    cursor.advance()
    const dbStart = cursor.position()
    const database = readUntil(cursor, (ch) => ch === "?" || ch === "#")
    if (database.length > 0) {
      pairs.push({
        key: "database",
        value: decodeOrIssue(database, dbStart, "database name", issues),
        position: dbStart,
      })
    }
  }

  if (cursor.peek() === "?") {
    cursor.advance()
    const seenParams = new Set<string>()
    while (!cursor.atEnd && cursor.peek() !== "#") {
      const paramStart = cursor.position()
      const rawKey = readUntil(cursor, (ch) => ch === "=" || ch === "&" || ch === "#")
      let rawValue = ""
      if (cursor.peek() === "=") {
        cursor.advance()
        rawValue = readUntil(cursor, (ch) => ch === "&" || ch === "#")
      }

      if (rawKey.length === 0) {
        issues.push({
          severity: "error",
          message: "empty query parameter name",
          position: paramStart,
          length: 1,
        })
      } else {
        const key = decodeOrIssue(rawKey, paramStart, "query parameter name", issues)
        const value = decodeOrIssue(rawValue, paramStart, `value of query parameter "${key}"`, issues)
        if (seenParams.has(key)) {
          issues.push({
            severity: "warning",
            message: `duplicate query parameter "${key}"`,
            position: paramStart,
            length: rawKey.length,
          })
        } else {
          seenParams.add(key)
        }
        pairs.push({ key, value, position: paramStart })
      }

      if (cursor.peek() === "&") cursor.advance()
      else break
    }
  }

  if (cursor.peek() === "#") {
    while (!cursor.atEnd) cursor.advance()
  }

  return { pairs, issues }
}
