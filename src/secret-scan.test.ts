import assert from "node:assert/strict"
import test from "node:test"
import { findLikelySecrets, indexToPosition } from "./secret-scan.js"

// Fixtures are assembled at runtime from short pieces so no file in this
// repo ever contains a substring that itself matches one of the patterns
// being tested for.
const AWS_KEY = "AKIA" + "Q7X9M2P4K6H1J3L5N8".slice(0, 16)
const GITHUB_TOKEN = "gh" + "p" + "_" + "a".repeat(36)
const STRIPE_KEY = "sk_" + "live_" + "a".repeat(24)
const ANTHROPIC_KEY = "sk-" + "ant-" + "a".repeat(24)
const SLACK_TOKEN = "xox" + "b-" + "1".repeat(13)
const GOOGLE_KEY = "AI" + "za" + "a".repeat(35)
const PEM_HEADER = "-----" + "BEGIN RSA PRIVATE KEY" + "-----"

test("finds an AWS access key ID", () => {
  const matches = findLikelySecrets(`Server=x;Password=${AWS_KEY}`)
  assert.deepEqual(
    matches.map((m) => m.label),
    ["AWS access key ID"],
  )
})

test("finds a GitHub token", () => {
  const matches = findLikelySecrets(`token=${GITHUB_TOKEN}`)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].label, "GitHub token")
})

test("finds a Stripe live secret key", () => {
  const matches = findLikelySecrets(`apiKey=${STRIPE_KEY}`)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].label, "Stripe live secret key")
})

test("finds an Anthropic API key", () => {
  const matches = findLikelySecrets(`key=${ANTHROPIC_KEY}`)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].label, "Anthropic API key")
})

test("finds a Slack bot token", () => {
  const matches = findLikelySecrets(`slack=${SLACK_TOKEN}`)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].label, "Slack bot token")
})

test("finds a Google API key", () => {
  const matches = findLikelySecrets(`key=${GOOGLE_KEY}`)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].label, "Google API key")
})

test("finds a PEM private key header", () => {
  const matches = findLikelySecrets(`Cert=${PEM_HEADER}`)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].label, "PEM private key")
})

test("finds multiple secrets and reports them in source order", () => {
  const matches = findLikelySecrets(`a=${GITHUB_TOKEN};b=${AWS_KEY}`)
  assert.deepEqual(
    matches.map((m) => m.label),
    ["GitHub token", "AWS access key ID"],
  )
})

test("does not flag an ordinary password", () => {
  const matches = findLikelySecrets("Server=localhost;Password=hunter2;Database=mydb")
  assert.equal(matches.length, 0)
})

test("indexToPosition finds line and column, accounting for embedded newlines", () => {
  const text = "abc\ndef"
  assert.deepEqual(indexToPosition(text, 0), { line: 1, column: 1 })
  assert.deepEqual(indexToPosition(text, 4), { line: 2, column: 1 })
  assert.deepEqual(indexToPosition(text, 6), { line: 2, column: 3 })
})
