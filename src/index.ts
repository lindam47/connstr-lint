// Programmatic entry point for using this as a library instead of a CLI -
// `import { lint } from "connstr-lint"` rather than shelling out to the
// binary. Re-exports the pieces each module owns plus `lint`, which is the
// one function most callers actually want: it picks the right grammar for
// the input and folds in the key-spellcheck warnings, the same way the CLI
// does for its own default (non---file, non-secret-scan) case.

export type { Position, IssueSeverity, ParseIssue, ConnectionPair, ParseResult } from "./parser.js"
export { parseConnectionString, Cursor } from "./parser.js"
export { parseUriConnectionString } from "./uri-parser.js"
export { renderIssue } from "./format.js"
export { checkKeySpellings, suggestKeyCorrection } from "./key-spellcheck.js"
export type { SecretMatch } from "./secret-scan.js"
export { findLikelySecrets, indexToPosition } from "./secret-scan.js"

import type { ParseResult } from "./parser.js"
import { parseConnectionString } from "./parser.js"
import { parseUriConnectionString } from "./uri-parser.js"
import { checkKeySpellings } from "./key-spellcheck.js"

const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

// True for a URI-style string (postgres://...), false for the ADO.NET/ODBC
// key=value dialect. Exported so callers who need to branch on dialect
// themselves - to choose a different noun for "pairs", say - don't have to
// duplicate the sniff.
export function isUriConnectionString(input: string): boolean {
  return URI_SCHEME.test(input)
}

// Parses either dialect, picking the grammar from the string's shape the
// same way the CLI does, and adds key-spellcheck warnings for the key=value
// dialect (the URI dialect has no fixed keyword table to check against).
// Does not run the secret-exposure scan in secret-scan.ts - that check only
// makes sense against a bare command-line argument, which a library caller
// may not have.
export function lint(input: string): ParseResult {
  if (isUriConnectionString(input)) {
    return parseUriConnectionString(input)
  }
  const { pairs, issues } = parseConnectionString(input)
  return { pairs, issues: [...issues, ...checkKeySpellings(pairs)] }
}
