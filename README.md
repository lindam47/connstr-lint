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
- A key that's close to, but not exactly, a keyword from one of the common
  driver libraries (SqlClient, Npgsql, MySqlConnector) is flagged as a
  possible typo, e.g. `Databse` warns that you probably meant `Database`.
  Where the drivers disagree on the correct name for something close to
  what you typed - `Databse` is also one edit away from SqlClient's
  `Initial Catalog` - it lists every candidate instead of guessing, since
  picking the wrong one would be worse than saying nothing.

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

If you pass the string directly as an argument instead of piping it in,
`connstr-lint` also checks it for anything shaped like a real, live API
credential (an AWS access key ID, a GitHub token, a Stripe secret key, a PEM
private key header, and a few others) and prints a `warning:` pointing at it
if it finds one, since a bare command-line argument sits in your shell
history and is visible to other users on the same machine via `ps` for as
long as the process runs.

This check only runs against a bare positional argument - input piped on
stdin or read via `--file` never touches your shell history or `ps` output,
so it's skipped there. It also only recognizes a short list of well-known
credential formats by their prefix; it isn't a general secret scanner and
won't catch an arbitrary database password.

To check a whole file at once - one connection string per line, blank lines
skipped - use `--file`:

```
$ connstr-lint --file connections.txt
line 1: ok, 2 key(s) parsed (Server, Database)
error: missing "=" after key "TrustServerCertificate"
 --> line 2, column 18
  |
2 | Server=localhost;TrustServerCertificate;Database=mydb
  |                  ^^^^^^^^^^^^^^^^^^^^^^

line 2: 1 error(s) found
line 3: ok, 3 key(s) parsed (Server, Database, Encrypt)

3 line(s) checked, 1 error(s) found
```

Positions are reported against the real line number in the file, and the
exit code reflects whether *any* line had an error. With `--json`, `--file`
returns an array with one result object per line instead of a single object.

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
run), `1` if any error-level issue was found (in `--file` mode, if any line
had one), `2` if no input was given, or the file given to `--file` couldn't
be read.

## installing

```
npm install -g connstr-lint
connstr-lint 'Server=localhost;Database=mydb'
```

## building from source

No third-party runtime dependencies - the parser and CLI use only Node's
standard library. TypeScript is a dev-only build dependency.

```
npm install
npm run build
node dist/cli.js 'Server=localhost;Database=mydb'
```

## testing

Uses Node's built-in test runner, so there's nothing extra to install:

```
npm test
```

This compiles the project, then runs every `*.test.js` file under `dist`.

## roadmap

- publish the first release to npm
