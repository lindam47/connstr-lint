import assert from "node:assert/strict"
import test from "node:test"
import { checkKeySpellings, suggestKeyCorrection } from "./key-spellcheck.js"

test("does not flag real driver keywords used across the README examples", () => {
  const realKeywords = [
    "Server",
    "Database",
    "User Id",
    "Password",
    "Encrypt",
    "Trusted_Connection",
    "TrustServerCertificate",
  ]
  for (const key of realKeywords) {
    assert.equal(suggestKeyCorrection(key), undefined, `expected "${key}" to be recognized`)
  }
})

test("matches known keywords case-insensitively", () => {
  assert.equal(suggestKeyCorrection("PASSWORD"), undefined)
  assert.equal(suggestKeyCorrection("server"), undefined)
})

test("suggests a single correction when every driver agrees on the spelling", () => {
  const suggestions = suggestKeyCorrection("Passwrd")
  assert.deepEqual(suggestions, ["Password"])
})

test("hedges with more than one suggestion when drivers disagree", () => {
  const suggestions = suggestKeyCorrection("Databse")
  assert.ok(suggestions)
  assert.deepEqual([...suggestions].sort(), ["Database", "Initial Catalog"])
})

test("does not guess at a key with no close match", () => {
  assert.equal(suggestKeyCorrection("Zzqx"), undefined)
})

test("does not guess at an unrelated custom key", () => {
  assert.equal(suggestKeyCorrection("MyCustomSetting"), undefined)
})

test("checkKeySpellings turns a typo into a warning at the key's position", () => {
  const issues = checkKeySpellings([
    { key: "Passwrd", value: "hunter2", position: { line: 1, column: 19 } },
  ])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, "warning")
  assert.match(issues[0].message, /possibly misspelled key "Passwrd" \(did you mean "Password"\?\)/)
  assert.deepEqual(issues[0].position, { line: 1, column: 19 })
  assert.equal(issues[0].length, "Passwrd".length)
})

test("checkKeySpellings phrases a hedge when the correct spelling depends on the driver", () => {
  const issues = checkKeySpellings([
    { key: "Databse", value: "mydb", position: { line: 1, column: 1 } },
  ])
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /did you mean one of .+ - the right spelling depends on which driver/)
})

test("checkKeySpellings has nothing to say about recognized keys", () => {
  const issues = checkKeySpellings([
    { key: "Server", value: "localhost", position: { line: 1, column: 1 } },
    { key: "Database", value: "mydb", position: { line: 1, column: 18 } },
  ])
  assert.equal(issues.length, 0)
})
