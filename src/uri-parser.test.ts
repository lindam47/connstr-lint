import assert from "node:assert/strict"
import test from "node:test"
import { parseUriConnectionString } from "./uri-parser.js"

function byKey(pairs: { key: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(pairs.map((p) => [p.key, p.value]))
}

test("parses a full postgres-style URI", () => {
  const { pairs, issues } = parseUriConnectionString(
    "postgres://alice:s3cret@db.example.com:5432/orders?sslmode=require",
  )
  assert.equal(issues.length, 0)
  const fields = byKey(pairs)
  assert.equal(fields.scheme, "postgres")
  assert.equal(fields.user, "alice")
  assert.equal(fields.password, "s3cret")
  assert.equal(fields.host, "db.example.com")
  assert.equal(fields.port, "5432")
  assert.equal(fields.database, "orders")
  assert.equal(fields.sslmode, "require")
})

test("reports a missing scheme", () => {
  const { issues } = parseUriConnectionString("not-a-uri-at-all")
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /missing scheme/)
})

test("reports a missing '//' after the scheme", () => {
  const { issues } = parseUriConnectionString("postgres:/host/db")
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /expected "\/\/" after scheme "postgres:"/)
})

test("splits userinfo on the last '@' before the authority ends", () => {
  const { pairs, issues } = parseUriConnectionString("mysql://user:pa@ss@127.0.0.1/db")
  assert.equal(issues.length, 0)
  const fields = byKey(pairs)
  assert.equal(fields.user, "user")
  assert.equal(fields.password, "pa@ss")
  assert.equal(fields.host, "127.0.0.1")
})

test("parses a bracketed IPv6 host literal", () => {
  const { pairs, issues } = parseUriConnectionString("mongodb://[::1]:27017/db")
  assert.equal(issues.length, 0)
  const fields = byKey(pairs)
  assert.equal(fields.host, "[::1]")
  assert.equal(fields.port, "27017")
})

test("reports an unterminated IPv6 host literal", () => {
  const { issues } = parseUriConnectionString("mongodb://[::1/db")
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /unterminated IPv6 host literal/)
})

test("warns rather than errors on an empty authority host", () => {
  const { pairs, issues } = parseUriConnectionString(
    "postgres:///dbname?host=/var/run/postgresql",
  )
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, "warning")
  assert.match(issues[0].message, /empty host/)
  assert.equal(pairs.find((p) => p.key === "database")?.value, "dbname")
  assert.equal(pairs.find((p) => p.key === "host")?.value, "/var/run/postgresql")
})

test("reports a missing port number after ':'", () => {
  const { issues } = parseUriConnectionString("mysql://host:/db")
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /missing port number/)
})

test("reports a non-numeric port", () => {
  const { issues } = parseUriConnectionString("mysql://host:abc/db")
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /invalid port "abc"/)
})

test("warns on a duplicate query parameter", () => {
  const { issues } = parseUriConnectionString(
    "postgres://host/db?sslmode=require&sslmode=disable",
  )
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, "warning")
  assert.match(issues[0].message, /duplicate query parameter "sslmode"/)
})

test("reports an empty query parameter name", () => {
  const { issues } = parseUriConnectionString("postgres://host/db?=value")
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /empty query parameter name/)
})

test("percent-decodes user, password, database and query values", () => {
  const { pairs, issues } = parseUriConnectionString(
    "postgres://us%40er:pa%25ss@host/my%20db?note=a%2Bb",
  )
  assert.equal(issues.length, 0)
  const fields = byKey(pairs)
  assert.equal(fields.user, "us@er")
  assert.equal(fields.password, "pa%ss")
  assert.equal(fields.database, "my db")
  assert.equal(fields.note, "a+b")
})

test("reports a malformed percent-escape", () => {
  const { issues } = parseUriConnectionString("postgres://host/db%zz")
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /invalid percent-encoding in database name/)
})

test("ignores everything after a fragment marker", () => {
  const { pairs, issues } = parseUriConnectionString("postgres://host/db?a=1#ignored@stuff")
  assert.equal(issues.length, 0)
  assert.equal(pairs.find((p) => p.key === "a")?.value, "1")
})
