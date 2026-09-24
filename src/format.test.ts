import assert from "node:assert/strict"
import test from "node:test"
import { renderIssue } from "./format.js"

test("renders the five-line compiler-style snippet", () => {
  const input = "Server=localhost;TrustServerCertificate;Database=mydb"
  const output = renderIssue(
    input,
    "error",
    'missing "=" after key "TrustServerCertificate"',
    { line: 1, column: 18 },
    22,
  )
  const gutter = " "
  assert.deepEqual(output.split("\n"), [
    'error: missing "=" after key "TrustServerCertificate"',
    `${gutter}--> line 1, column 18`,
    `${gutter} |`,
    "1 | Server=localhost;TrustServerCertificate;Database=mydb",
    `${gutter} | ${" ".repeat(17)}${"^".repeat(22)}`,
  ])
})

test("pads the gutter to match a multi-digit line number", () => {
  const input = Array.from({ length: 9 }, (_, i) => `k${i}=v`).join("\n") + "\nBadKey"
  const output = renderIssue(input, "error", "bad key", { line: 10, column: 1 }, 6)
  const gutter = "  "
  const lines = output.split("\n")
  assert.equal(lines[1], `${gutter}--> line 10, column 1`)
  assert.equal(lines[2], `${gutter} |`)
  assert.equal(lines[3], "10 | BadKey")
  assert.equal(lines[4], `${gutter} | ${"^".repeat(6)}`)
})

test("picks the right line out of a multi-line input", () => {
  const input = "Server=localhost\nDatabase=mydb"
  const output = renderIssue(input, "warning", "duplicate key", { line: 2, column: 1 }, 8)
  assert.ok(output.includes("2 | Database=mydb"))
  assert.ok(!output.includes("Server=localhost"))
})

test("clamps the caret so it never runs past the end of the line", () => {
  const input = "Server=localhost"
  const output = renderIssue(input, "error", "trailing garbage", { line: 1, column: 8 }, 50)
  // sourceLine.length (17) - column (8) + 1 = 10 characters remain from the
  // caret's start, so a requested length of 50 gets clamped down to that.
  const caretLine = output.split("\n")[4]
  assert.equal(caretLine, `  | ${" ".repeat(7)}${"^".repeat(10)}`)
})

test("always draws at least one caret even when length is zero", () => {
  const input = "Server=localhost"
  const output = renderIssue(input, "error", "unexpected end of input", { line: 1, column: 18 }, 0)
  const caretLine = output.split("\n")[4]
  assert.equal(caretLine, `  | ${" ".repeat(17)}^`)
})

test("falls back to an empty source line when the position is out of range", () => {
  const input = "Server=localhost"
  const output = renderIssue(input, "error", "phantom issue", { line: 5, column: 1 }, 3)
  const lines = output.split("\n")
  assert.equal(lines[3], "5 | ")
  assert.equal(lines[4], "  | ^")
})
