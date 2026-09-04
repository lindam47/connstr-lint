#!/usr/bin/env node
import { readFileSync } from "node:fs"
import type { ConnectionPair, ParseIssue } from "./parser.js"
import { parseConnectionString } from "./parser.js"
import { parseUriConnectionString } from "./uri-parser.js"
import { renderIssue } from "./format.js"
import { findLikelySecrets, indexToPosition } from "./secret-scan.js"
import { checkKeySpellings } from "./key-spellcheck.js"

const USAGE =
  "usage: connstr-lint <connection-string>\n" +
  '       echo "$CONN" | connstr-lint\n' +
  "       connstr-lint --json <connection-string>\n" +
  "       connstr-lint --file <path>\n"

const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

interface LineResult {
  lineNumber: number
  isUri: boolean
  pairs: ConnectionPair[]
  issues: ParseIssue[]
}

interface Input {
  text: string
  // Only a bare positional argument sits in shell history and shows up to
  // other users via `ps` for as long as the process runs - stdin doesn't.
  fromArgv: boolean
}

function readInput(argv: string[]): Input | undefined {
  const positional = argv.find((arg) => !arg.startsWith("-"))
  if (positional !== undefined) return { text: positional, fromArgv: true }

  if (process.stdin.isTTY) return undefined

  return { text: readFileSync(0, "utf8"), fromArgv: false }
}

// Turns matches from findLikelySecrets into ordinary warning-level issues so
// they render and get counted the same way every other issue does.
function secretExposureIssues(text: string): ParseIssue[] {
  return findLikelySecrets(text).map((match) => ({
    severity: "warning",
    message:
      `possible ${match.label} passed as a command-line argument - arguments are ` +
      'visible to other users on this machine (via "ps") and commonly end up saved ' +
      "in shell history; pipe the connection string on stdin or pass it with --file instead",
    position: indexToPosition(text, match.index),
    length: match.length,
  }))
}

// Runs one line of a --file batch through the right parser, then rewrites
// every position onto the real file line so renderIssue can point at it in
// the original file text instead of "line 1" for every entry.
function lintLine(raw: string, lineNumber: number): LineResult {
  const isUri = URI_SCHEME.test(raw)
  const { pairs, issues } = isUri ? parseUriConnectionString(raw) : parseConnectionString(raw)
  const allIssues = isUri ? issues : [...issues, ...checkKeySpellings(pairs)]
  const onRealLine = <T extends { position: { line: number; column: number } }>(item: T): T => ({
    ...item,
    position: { line: lineNumber, column: item.position.column },
  })
  return {
    lineNumber,
    isUri,
    pairs: pairs.map(onRealLine),
    issues: allIssues.map(onRealLine),
  }
}

function runFileMode(filePath: string, asJson: boolean): number {
  let fileText: string
  try {
    fileText = readFileSync(filePath, "utf8")
  } catch (err) {
    process.stderr.write(`error: cannot read file "${filePath}": ${(err as Error).message}\n`)
    return 2
  }

  const results = fileText
    .split("\n")
    .map((raw, index) => ({ raw, lineNumber: index + 1 }))
    .filter(({ raw }) => raw.trim().length > 0)
    .map(({ raw, lineNumber }) => lintLine(raw, lineNumber))

  const totalErrors = results.reduce(
    (sum, result) => sum + result.issues.filter((issue) => issue.severity === "error").length,
    0,
  )

  if (asJson) {
    const payload = results.map((result) => ({
      line: result.lineNumber,
      pairs: result.pairs,
      issues: result.issues,
      ok: result.issues.every((issue) => issue.severity !== "error"),
    }))
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n")
    return totalErrors === 0 ? 0 : 1
  }

  if (results.length === 0) {
    process.stdout.write("ok: no connection strings found\n")
    return 0
  }

  for (const result of results) {
    for (const issue of result.issues) {
      process.stdout.write(
        renderIssue(fileText, issue.severity, issue.message, issue.position, issue.length) +
          "\n\n",
      )
    }

    const lineErrors = result.issues.filter((issue) => issue.severity === "error").length
    if (lineErrors === 0) {
      const noun = result.isUri ? "component" : "key"
      const keys = result.pairs.map((pair) => pair.key).join(", ")
      process.stdout.write(
        result.pairs.length > 0
          ? `line ${result.lineNumber}: ok, ${result.pairs.length} ${noun}(s) parsed (${keys})\n`
          : `line ${result.lineNumber}: ok, no ${noun}s found\n`,
      )
    } else {
      process.stdout.write(`line ${result.lineNumber}: ${lineErrors} error(s) found\n`)
    }
  }

  process.stdout.write(`\n${results.length} line(s) checked, ${totalErrors} error(s) found\n`)

  return totalErrors === 0 ? 0 : 1
}

function main(): number {
  const argv = process.argv.slice(2)
  const asJson = argv.includes("--json")

  const fileFlagIndex = argv.indexOf("--file")
  if (fileFlagIndex !== -1) {
    const filePath = argv[fileFlagIndex + 1]
    if (filePath === undefined) {
      process.stderr.write('error: --file requires a path argument\n')
      return 2
    }
    return runFileMode(filePath, asJson)
  }

  const input = readInput(argv)

  if (input === undefined) {
    process.stderr.write(USAGE)
    return 2
  }

  const isUri = URI_SCHEME.test(input.text)
  const { pairs, issues } = isUri
    ? parseUriConnectionString(input.text)
    : parseConnectionString(input.text)
  if (!isUri) issues.push(...checkKeySpellings(pairs))
  if (input.fromArgv) issues.push(...secretExposureIssues(input.text))
  const errorCount = issues.filter((issue) => issue.severity === "error").length

  if (asJson) {
    process.stdout.write(JSON.stringify({ pairs, issues, ok: errorCount === 0 }, null, 2) + "\n")
    return errorCount === 0 ? 0 : 1
  }

  for (const issue of issues) {
    process.stdout.write(
      renderIssue(input.text, issue.severity, issue.message, issue.position, issue.length) +
        "\n\n",
    )
  }

  if (errorCount === 0) {
    const keys = pairs.map((pair) => pair.key).join(", ")
    const noun = isUri ? "component" : "key"
    process.stdout.write(
      pairs.length > 0
        ? `ok: ${pairs.length} ${noun}(s) parsed (${keys})\n`
        : `ok: no ${noun}s found\n`,
    )
  } else {
    process.stdout.write(`${errorCount} error(s) found\n`)
  }

  return errorCount === 0 ? 0 : 1
}

process.exit(main())
