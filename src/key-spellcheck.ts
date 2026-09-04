// Flags a key=value key that looks like a typo of a real driver keyword
// (e.g. "Databse" for "Database"). The ADO.NET/ODBC dialect is shared by
// several driver libraries that don't agree on keyword names - SqlClient
// wants "Initial Catalog" where Npgsql and MySqlConnector both accept
// "Database" - so a single flat "correct spelling" list would either miss
// real typos or, worse, "correct" a value that's already right for the
// driver the string is actually meant for.
//
// Instead this keeps one keyword table per driver and only turns a typo into
// a warning once we know how confident the guess is: if every driver whose
// keyword table has a close match agrees on the same canonical spelling, say
// so plainly; if they don't agree, list all of them rather than picking one
// and risk being wrong.

import type { ConnectionPair, ParseIssue } from "./parser.js"

interface DriverKeyword {
  canonical: string
  aliases: string[]
}

// Not exhaustive - just the keywords common enough that a typo in one of
// them is a likely real mistake rather than a driver-specific setting this
// tool has never heard of.
const DRIVER_KEYWORDS: Record<string, DriverKeyword[]> = {
  "SQL Server": [
    { canonical: "Data Source", aliases: ["server", "address", "addr", "network address"] },
    { canonical: "Initial Catalog", aliases: ["database"] },
    { canonical: "Integrated Security", aliases: ["trusted_connection"] },
    { canonical: "User ID", aliases: ["user", "uid"] },
    { canonical: "Password", aliases: ["pwd"] },
    { canonical: "Connect Timeout", aliases: ["connection timeout", "timeout"] },
    { canonical: "Encrypt", aliases: [] },
    { canonical: "TrustServerCertificate", aliases: [] },
    { canonical: "MultipleActiveResultSets", aliases: ["mars"] },
    { canonical: "Application Name", aliases: ["app"] },
  ],
  PostgreSQL: [
    { canonical: "Host", aliases: ["server"] },
    { canonical: "Port", aliases: [] },
    { canonical: "Database", aliases: ["db"] },
    { canonical: "Username", aliases: ["user name", "user id", "uid", "user"] },
    { canonical: "Password", aliases: ["pwd", "psw"] },
    { canonical: "Timeout", aliases: [] },
    { canonical: "Command Timeout", aliases: [] },
    { canonical: "SSL Mode", aliases: ["sslmode"] },
    { canonical: "Application Name", aliases: [] },
  ],
  MySQL: [
    { canonical: "Server", aliases: ["host", "data source", "address", "addr"] },
    { canonical: "Port", aliases: [] },
    { canonical: "Database", aliases: ["db", "initial catalog"] },
    { canonical: "User ID", aliases: ["uid", "username", "user"] },
    { canonical: "Password", aliases: ["pwd"] },
    { canonical: "SSL Mode", aliases: ["sslmode"] },
    { canonical: "Connection Timeout", aliases: ["connect timeout"] },
    { canonical: "Application Name", aliases: [] },
  ],
}

interface Variant {
  normalized: string
  canonical: string
}

const ALL_VARIANTS: Variant[] = []
const KNOWN_KEYS = new Set<string>()

for (const keywords of Object.values(DRIVER_KEYWORDS)) {
  for (const { canonical, aliases } of keywords) {
    const canonicalNormalized = canonical.toLowerCase()
    KNOWN_KEYS.add(canonicalNormalized)
    ALL_VARIANTS.push({ normalized: canonicalNormalized, canonical })
    for (const alias of aliases) {
      KNOWN_KEYS.add(alias)
      ALL_VARIANTS.push({ normalized: alias, canonical })
    }
  }
}

function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1)
  const curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }

  return prev[b.length]
}

// A tighter tolerance for short keys keeps this from "correcting" a
// perfectly good three- or four-letter custom key into an unrelated
// driver keyword just because they happen to be close in edit distance.
function toleranceFor(length: number): number {
  if (length <= 4) return 1
  if (length <= 8) return 2
  return 3
}

// Returns the set of canonical spellings a typo could plausibly be, or
// undefined if the key is already a recognized keyword (or alias) or isn't
// close enough to any of them to guess. More than one entry means the
// drivers disagree on the right spelling for this position.
export function suggestKeyCorrection(key: string): string[] | undefined {
  const normalized = key.trim().toLowerCase()
  if (normalized.length === 0 || KNOWN_KEYS.has(normalized)) return undefined

  const tolerance = toleranceFor(normalized.length)
  let bestDistance = Infinity
  const bestCanonicals = new Set<string>()

  for (const variant of ALL_VARIANTS) {
    const distance = levenshtein(normalized, variant.normalized)
    if (distance > tolerance || distance > bestDistance) continue
    if (distance < bestDistance) {
      bestDistance = distance
      bestCanonicals.clear()
    }
    bestCanonicals.add(variant.canonical)
  }

  return bestCanonicals.size > 0 ? [...bestCanonicals] : undefined
}

export function checkKeySpellings(pairs: ConnectionPair[]): ParseIssue[] {
  const issues: ParseIssue[] = []
  for (const pair of pairs) {
    const suggestions = suggestKeyCorrection(pair.key)
    if (!suggestions) continue

    const message =
      suggestions.length === 1
        ? `possibly misspelled key "${pair.key}" (did you mean "${suggestions[0]}"?)`
        : `possibly misspelled key "${pair.key}" (did you mean one of ${suggestions
            .map((s) => `"${s}"`)
            .join(", ")}? - the right spelling depends on which driver this is for)`

    issues.push({
      severity: "warning",
      message,
      position: pair.position,
      length: pair.key.length,
    })
  }
  return issues
}
