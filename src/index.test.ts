import assert from "node:assert/strict"
import test from "node:test"
import { isUriConnectionString, lint } from "./index.js"

test("lint picks the key=value grammar and includes spellcheck warnings", () => {
  const { pairs, issues } = lint("Server=localhost;Passwrd=hunter2")
  assert.deepEqual(
    pairs.map((p) => p.key),
    ["Server", "Passwrd"],
  )
  assert.ok(issues.some((issue) => issue.message.includes('did you mean "Password"?')))
})

test("lint picks the URI grammar for a scheme:// string and skips spellcheck", () => {
  const { pairs, issues } = lint("postgres://user@localhost/mydb")
  assert.deepEqual(
    pairs.map((p) => p.key),
    ["scheme", "user", "host", "database"],
  )
  assert.equal(issues.length, 0)
})

test("lint surfaces parse errors from the underlying dialect parser", () => {
  const { issues } = lint("Server=localhost;TrustServerCertificate;Database=mydb")
  assert.ok(issues.some((issue) => issue.severity === "error"))
})

test("isUriConnectionString distinguishes the two dialects", () => {
  assert.equal(isUriConnectionString("postgres://localhost/mydb"), true)
  assert.equal(isUriConnectionString("Server=localhost;Database=mydb"), false)
})
