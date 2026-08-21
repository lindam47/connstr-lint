// Parses semicolon-delimited "key=value" connection strings, the dialect used
// by ADO.NET, ODBC, OLE DB and most database client libraries (Server=...;
// Database=...;Password="...";). Not the URI dialect (postgres://...) -
// that gets its own parser later, since the two grammars barely overlap.

export interface Position {
  line: number
  column: number
}

export type IssueSeverity = "error" | "warning"

export interface ParseIssue {
  severity: IssueSeverity
  message: string
  position: Position
  length: number
}

export interface ConnectionPair {
  key: string
  value: string
  position: Position
}

export interface ParseResult {
  pairs: ConnectionPair[]
  issues: ParseIssue[]
}

export class Cursor {
  private index = 0
  private line = 1
  private column = 1

  constructor(private readonly text: string) {}

  get atEnd(): boolean {
    return this.index >= this.text.length
  }

  peek(offset = 0): string | undefined {
    return this.text[this.index + offset]
  }

  position(): Position {
    return { line: this.line, column: this.column }
  }

  advance(): string {
    const ch = this.text[this.index]
    this.index += 1
    if (ch === "\n") {
      this.line += 1
      this.column = 1
    } else {
      this.column += 1
    }
    return ch
  }
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
}

// Skips whitespace and stray/empty ";;" separators between pairs.
function skipSeparators(cursor: Cursor): void {
  while (!cursor.atEnd) {
    const ch = cursor.peek()
    if (ch === ";" || isWhitespace(ch)) {
      cursor.advance()
    } else {
      break
    }
  }
}

function skipSpaces(cursor: Cursor): void {
  while (!cursor.atEnd && isWhitespace(cursor.peek())) {
    cursor.advance()
  }
}

// Consumes up to (not including) the next ';', returning what it consumed.
// Used to recover after a malformed pair so one bad entry doesn't derail
// every entry after it.
function skipToSeparator(cursor: Cursor): string {
  let out = ""
  while (!cursor.atEnd && cursor.peek() !== ";") {
    out += cursor.advance()
  }
  return out
}

// A doubled "==" inside a key is an escaped literal "=", per the ADO.NET
// keyword grammar - it's how you write a key that itself contains "=".
function readKey(cursor: Cursor): string {
  let out = ""
  while (!cursor.atEnd) {
    const ch = cursor.peek()
    if (ch === "=") {
      if (cursor.peek(1) === "=") {
        out += "="
        cursor.advance()
        cursor.advance()
        continue
      }
      break
    }
    if (ch === ";") break
    out += cursor.advance()
  }
  return out
}

function readUnquotedValue(cursor: Cursor): string {
  let out = ""
  while (!cursor.atEnd && cursor.peek() !== ";") {
    out += cursor.advance()
  }
  return out
}

// A value is quoted only if its first character is a quote character. The
// same quote character doubled inside the value is an escaped literal quote
// (matches how "" and '' behave in real ADO.NET connection strings).
function readQuotedValue(
  cursor: Cursor,
  quote: string,
): { value: string; terminated: boolean } {
  cursor.advance() // opening quote
  let out = ""
  while (!cursor.atEnd) {
    const ch = cursor.advance()
    if (ch === quote) {
      if (cursor.peek() === quote) {
        out += quote
        cursor.advance()
        continue
      }
      return { value: out, terminated: true }
    }
    out += ch
  }
  return { value: out, terminated: false }
}

export function parseConnectionString(input: string): ParseResult {
  const cursor = new Cursor(input)
  const pairs: ConnectionPair[] = []
  const issues: ParseIssue[] = []
  const seenKeys = new Map<string, Position>()

  while (true) {
    skipSeparators(cursor)
    if (cursor.atEnd) break

    const keyStart = cursor.position()
    const key = readKey(cursor)
    const trimmedKey = key.trim()

    if (trimmedKey.length === 0) {
      issues.push({
        severity: "error",
        message: "empty key name",
        position: keyStart,
        length: Math.max(key.length, 1),
      })
      skipToSeparator(cursor)
      continue
    }

    if (cursor.atEnd || cursor.peek() === ";") {
      issues.push({
        severity: "error",
        message: `missing "=" after key "${trimmedKey}"`,
        position: keyStart,
        length: key.length,
      })
      if (cursor.peek() === ";") cursor.advance()
      continue
    }

    cursor.advance() // consume '='
    skipSpaces(cursor)

    const valueStart = cursor.position()
    const quote = cursor.peek()
    let value: string

    if (quote === "'" || quote === '"') {
      const result = readQuotedValue(cursor, quote)
      if (!result.terminated) {
        issues.push({
          severity: "error",
          message: `unterminated quoted value (missing closing ${quote})`,
          position: valueStart,
          length: 1,
        })
        break
      }
      value = result.value
      skipSpaces(cursor)
      if (!cursor.atEnd && cursor.peek() !== ";") {
        const trailingStart = cursor.position()
        const trailing = skipToSeparator(cursor)
        issues.push({
          severity: "error",
          message: "unexpected characters after closing quote",
          position: trailingStart,
          length: Math.max(trailing.length, 1),
        })
      }
    } else {
      value = readUnquotedValue(cursor).trimEnd()
    }

    if (!cursor.atEnd) cursor.advance() // consume trailing ';'

    const lowerKey = trimmedKey.toLowerCase()
    const firstSeenAt = seenKeys.get(lowerKey)
    if (firstSeenAt) {
      issues.push({
        severity: "warning",
        message: `duplicate key "${trimmedKey}" (first set at line ${firstSeenAt.line}, column ${firstSeenAt.column}); this value overwrites it`,
        position: keyStart,
        length: trimmedKey.length,
      })
    } else {
      seenKeys.set(lowerKey, keyStart)
    }

    pairs.push({ key: trimmedKey, value, position: keyStart })
  }

  return { pairs, issues }
}
