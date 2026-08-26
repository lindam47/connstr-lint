import assert from "node:assert/strict"
import test from "node:test"
import { parseConnectionString } from "./parser.js"

test("parses a simple key=value pair list", () => {
  const { pairs, issues } = parseConnectionString("Server=localhost;Database=mydb")
  assert.equal(issues.length, 0)
  assert.deepEqual(
    pairs.map((p) => [p.key, p.value]),
    [
      ["Server", "localhost"],
      ["Database", "mydb"],
    ],
  )
})

test("tolerates a trailing semicolon", () => {
  const { pairs, issues } = parseConnectionString("Server=localhost;")
  assert.equal(issues.length, 0)
  assert.equal(pairs.length, 1)
})

test("tolerates repeated separators between pairs", () => {
  const { pairs, issues } = parseConnectionString("Server=localhost;;;Database=mydb")
  assert.equal(issues.length, 0)
  assert.equal(pairs.length, 2)
})

test("keeps internal spaces in a key but trims the edges", () => {
  const { pairs } = parseConnectionString("User Id =sa;")
  assert.equal(pairs[0].key, "User Id")
})

test("skips leading value spaces and trims trailing ones from an unquoted value", () => {
  const { pairs } = parseConnectionString("Server=  localhost  ;")
  assert.equal(pairs[0].value, "localhost")
})

test("unescapes a doubled double-quote inside a quoted value", () => {
  const { pairs, issues } = parseConnectionString('Password="it""s a secret"')
  assert.equal(issues.length, 0)
  assert.equal(pairs[0].value, 'it"s a secret')
})

test("supports single-quoted values with doubled-quote escaping", () => {
  const { pairs, issues } = parseConnectionString("Password='it''s a secret'")
  assert.equal(issues.length, 0)
  assert.equal(pairs[0].value, "it's a secret")
})

test("unescapes a doubled '=' inside a key", () => {
  const { pairs, issues } = parseConnectionString("My==Key=value")
  assert.equal(issues.length, 0)
  assert.equal(pairs[0].key, "My=Key")
  assert.equal(pairs[0].value, "value")
})

test("reports a missing '=' after a key", () => {
  const { issues } = parseConnectionString(
    "Server=localhost;TrustServerCertificate;Database=mydb",
  )
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, "error")
  assert.match(issues[0].message, /missing "=" after key "TrustServerCertificate"/)
  assert.deepEqual(issues[0].position, { line: 1, column: 18 })
})

test("reports an empty key name", () => {
  const { issues } = parseConnectionString("=value")
  assert.equal(issues.length, 1)
  assert.equal(issues[0].message, "empty key name")
  assert.deepEqual(issues[0].position, { line: 1, column: 1 })
})

test("reports an unterminated quoted value and stops parsing further pairs", () => {
  const { pairs, issues } = parseConnectionString(
    'Server=localhost;Password="hunter2;Encrypt=true',
  )
  assert.equal(pairs.length, 1)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, "error")
  assert.match(issues[0].message, /unterminated quoted value \(missing closing "\)/)
})

test("reports unexpected characters after a closing quote", () => {
  const { issues } = parseConnectionString('Password="secret"extra;Next=1')
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /unexpected characters after closing quote/)
})

test("reports both a missing '=' and an unterminated quote in the same string", () => {
  const input =
    'Server=localhost;TrustServerCertificate;Database=mydb;Password="hunter2;Encrypt=true'
  const { pairs, issues } = parseConnectionString(input)
  assert.equal(pairs.length, 2)
  assert.equal(issues.length, 2)
  assert.match(issues[0].message, /missing "=" after key "TrustServerCertificate"/)
  assert.match(issues[1].message, /unterminated quoted value/)
})

test("warns on a duplicate key and points at where it was first set", () => {
  const { issues } = parseConnectionString("Server=localhost;Server=other")
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, "warning")
  assert.match(issues[0].message, /duplicate key "Server" \(first set at line 1, column 1\)/)
  assert.deepEqual(issues[0].position, { line: 1, column: 18 })
})

test("matches duplicate keys case-insensitively", () => {
  const { issues } = parseConnectionString("Server=localhost;server=other")
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, "warning")
})

test("tracks line numbers across embedded newlines", () => {
  const { issues } = parseConnectionString("Server=localhost;\nTrustServerCertificate")
  assert.equal(issues.length, 1)
  assert.deepEqual(issues[0].position, { line: 2, column: 1 })
})
