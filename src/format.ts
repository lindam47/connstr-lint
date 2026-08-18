import type { IssueSeverity, Position } from "./parser.js"

// Renders one issue as a compiler-style snippet:
//
//   error: missing "=" after key "TrustServerCertificate"
//    --> line 1, column 18
//     |
//   1 | Server=localhost;TrustServerCertificate;Database=mydb
//     |                  ^^^^^^^^^^^^^^^^^^^^^^
export function renderIssue(
  input: string,
  severity: IssueSeverity,
  message: string,
  position: Position,
  length: number,
): string {
  const lines = input.split("\n")
  const sourceLine = lines[position.line - 1] ?? ""
  const lineLabel = String(position.line)
  const gutter = " ".repeat(lineLabel.length)
  const caretPad = " ".repeat(Math.max(position.column - 1, 0))
  const maxCaretLen = Math.max(sourceLine.length - position.column + 1, 1)
  const caret = "^".repeat(Math.max(Math.min(length, maxCaretLen), 1))

  return [
    `${severity}: ${message}`,
    `${gutter}--> line ${position.line}, column ${position.column}`,
    `${gutter} |`,
    `${lineLabel} | ${sourceLine}`,
    `${gutter} | ${caretPad}${caret}`,
  ].join("\n")
}
