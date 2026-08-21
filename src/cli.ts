#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { parseConnectionString } from "./parser.js"
import { parseUriConnectionString } from "./uri-parser.js"
import { renderIssue } from "./format.js"

const USAGE =
  "usage: connstr-lint <connection-string>\n" +
  '       echo "$CONN" | connstr-lint\n' +
  "       connstr-lint --json <connection-string>\n"

const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

function readInput(argv: string[]): string | undefined {
  const positional = argv.find((arg) => !arg.startsWith("-"))
  if (positional !== undefined) return positional

  if (process.stdin.isTTY) return undefined

  return readFileSync(0, "utf8")
}

function main(): number {
  const argv = process.argv.slice(2)
  const asJson = argv.includes("--json")
  const input = readInput(argv)

  if (input === undefined) {
    process.stderr.write(USAGE)
    return 2
  }

  const isUri = URI_SCHEME.test(input)
  const { pairs, issues } = isUri ? parseUriConnectionString(input) : parseConnectionString(input)
  const errorCount = issues.filter((issue) => issue.severity === "error").length

  if (asJson) {
    process.stdout.write(JSON.stringify({ pairs, issues, ok: errorCount === 0 }, null, 2) + "\n")
    return errorCount === 0 ? 0 : 1
  }

  for (const issue of issues) {
    process.stdout.write(
      renderIssue(input, issue.severity, issue.message, issue.position, issue.length) + "\n\n",
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
