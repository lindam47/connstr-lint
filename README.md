# connstr-lint

A command-line tool that parses connection strings and tells you exactly
where they're broken - line and column, with a caret pointing at the
offending text, the way a compiler does.

## the problem

Connection strings (`Server=localhost;Database=mydb;Password="hunter2";`)
are hand-edited far more often than they should be: pasted from a wiki page,
patched by hand in a Kubernetes secret, assembled by string concatenation in
a deploy script. When one is wrong, the failure you get back is almost never
useful - drivers tend to either throw a generic "invalid connection string"
exception with no position information, or silently ignore the malformed
part and connect with a default you didn't ask for.

`connstr-lint` parses the string itself, independent of any driver, and
tells you precisely what's wrong and where.

## supported dialects

The semicolon-delimited `key=value` format used by ADO.NET, ODBC, OLE DB,
and most database client libraries (SQL Server, Npgsql, MySqlConnector, and
so on):

```
Server=localhost;Database=mydb;User Id=sa;Password="hunter2";Encrypt=true
```

Rules it understands:

- Pairs are separated by `;`. Repeated or trailing `;` is tolerated.
- A value is quoted only if its first character is `'` or `"`.
- Inside a quoted value, doubling the quote character escapes a literal
  quote: `Password="it""s a secret"` means the value `it"s a secret`.
- A doubled `==` inside a key escapes a literal `=` in the key name.
- Keys are matched case-insensitively for duplicate detection.

URI-style connection strings are also understood, using whichever scheme
the string starts with to pick the grammar:

```
postgres://user:pass@host:5432/dbname?sslmode=require
mongodb://host1,host2,host3/dbname
mysql://user@127.0.0.1:3306/dbname
```

Rules it understands for this dialect:

- `scheme://[user[:password]@]host[:port][/database][?key=value&...]`
- The userinfo segment splits on the *last* `@` before the next `/`, `?`
  or `#`, so a literal `@` inside a password doesn't get mistaken for the
  boundary.
- `user`, `password`, `database`, and query keys/values are percent-decoded;
  a malformed `%` escape is reported.
- Query parameter keys are checked for duplicates the same way ADO.NET keys
  are, and an empty parameter name is an error.
- A missing host is a warning rather than an error, since some drivers
  (`postgres:///dbname?host=/var/run/postgresql`) use an empty host
  deliberately to mean "connect over a Unix socket".

## usage

```
$ connstr-lint 'Server=localhost;TrustServerCertificate;Database=mydb;Password="hunter2;Encrypt=true'
error: missing "=" after key "TrustServerCertificate"
 --> line 1, column 18
  |
1 | Server=localhost;TrustServerCertificate;Database=mydb;Password="hunter2;Encrypt=true
  |                  ^^^^^^^^^^^^^^^^^^^^^^

error: unterminated quoted value (missing closing ")
 --> line 1, column 64
  |
1 | Server=localhost;TrustServerCertificate;Database=mydb;Password="hunter2;Encrypt=true
  |                                                               ^

2 error(s) found
```

That one string has two independent bugs: `TrustServerCertificate` is
missing its `=true`, and the `Password` value's closing quote was never
typed. Both are reported at once, at their real position in the string, so
you fix them together instead of one failed connection attempt at a time.

A clean string just gets confirmed:

```
$ connstr-lint 'Server=localhost;Database=mydb;Trusted_Connection=true'
ok: 3 key(s) parsed (Server, Database, Trusted_Connection)
```

You can also pipe a string in, which is the more common case in scripts:

```
$ echo "$DATABASE_URL" | connstr-lint
```

Pass `--json` to get structured output instead of the human-readable
snippet, for use in other tooling:

```
$ connstr-lint --json 'Server=localhost;Server=other;Database=mydb'
{
  "pairs": [...],
  "issues": [
    {
      "severity": "warning",
      "message": "duplicate key \"Server\" (first set at line 1, column 1); this value overwrites it",
      "position": { "line": 1, "column": 18 },
      "length": 6
    }
  ],
  "ok": true
}
```

Exit codes: `0` on success (warnings are still printed but don't fail the
run), `1` if any error-level issue was found, `2` if no input was given.

## building

No third-party runtime dependencies - the parser and CLI use only Node's
standard library. TypeScript is a dev-only build dependency.

```
npm install
npm run build
node dist/cli.js 'Server=localhost;Database=mydb'
```

## roadmap

- `--file` mode to batch-check one connection string per line
- unit tests covering the parser's edge cases
- detect common misspelled keys (`Timeout` vs `Connection Timeout`)
- warn when a string passed directly as a CLI arg looks like it contains a
  real secret, since that's visible in shell history and `ps`
- publish to npm
