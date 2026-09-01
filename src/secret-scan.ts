// Looks for substrings that match the shape of a real, live API credential -
// not just "any value in a Password field", but the handful of widely used
// key formats that are recognizable on sight (AWS access key IDs, GitHub
// tokens, Stripe secret keys, and so on). This is for the one case the
// duplicate/missing-key checks can't catch: a connection string handed to
// the CLI as a bare positional argument, which lands in shell history and
// is readable by anyone else on the box via `ps` for as long as the process
// runs. It only fires for that input path - stdin and --file don't have
// this exposure, so they're not scanned.
//
// Deliberately narrow. It will miss plenty of real secrets (anything
// without a recognizable prefix, most database passwords) and that's fine;
// it only needs to catch the common case of a cloud credential pasted
// straight onto a command line while testing a connection string.

import type { Position } from "./parser.js"

export interface SecretMatch {
  label: string
  index: number
  length: number
}

interface SecretPattern {
  label: string
  regex: RegExp
}

const PATTERNS: SecretPattern[] = [
  { label: "AWS access key ID", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "GitHub token", regex: /\bgh[a-z]_[A-Za-z0-9]{36}\b/g },
  { label: "Stripe live secret key", regex: /\bsk_live_[A-Za-z0-9]{24,}\b/g },
  { label: "Anthropic API key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { label: "Slack bot token", regex: /\bxoxb-[A-Za-z0-9-]{10,}\b/g },
  { label: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: "PEM private key", regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
]

export function findLikelySecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = []
  for (const { label, regex } of PATTERNS) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      matches.push({ label, index: match.index, length: match[0].length })
    }
  }
  return matches.sort((a, b) => a.index - b.index)
}

// Same line/column accounting Cursor does, but as a one-shot lookup against
// a raw string instead of an incremental scan - the caller already has the
// whole string in hand here and there's no parsing to interleave it with.
export function indexToPosition(text: string, index: number): Position {
  let line = 1
  let column = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}
