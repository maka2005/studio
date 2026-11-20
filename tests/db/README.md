# DB-backed cross-tenant tests

`isolation.sql` is a pgTAP suite (T1–T7) for the security boundaries that cannot be
verified with TypeScript contract tests: RPC grants, inactive platform admins,
schedule helpers, RLS between tenants, owner RPC tenant checks, subscription
`nonrenew_at`, and media upload prefixes.

**Never run these tests against production.** Use a disposable Supabase branch
with the full migration history applied. The suite rolls back its own fixtures,
but it still executes `SET ROLE`/`RESET ROLE` and installs `pgtap`, so treat the
target as throwaway. If `pgtap` is not available on the branch, enable that
extension in the Dashboard before running the file.

## 1. Create a disposable branch

Authenticate and link the parent project first:

```bash
npx supabase login
npx supabase link --project-ref <parent-project-ref>
```

Create a branch **without production data**:

```bash
npx supabase branch create db-isolation-tests
# Supabase CLI 2.x uses the plural form:
# npx supabase branches create db-isolation-tests
```

Do **not** pass `--with-data`: copying production rows into a test branch is not
necessary for these fixtures and increases exposure. Note the branch ref printed
by the CLI.

## 2. Link the branch and apply migrations

```bash
npx supabase link --project-ref <branch-ref>
npx supabase db push --linked
```

CI does **not** run migrations; it only performs the read-only drift check below.

## 3. Run the SQL

The runner requires an explicit target and a confirmation that the target is a
test branch. It reads the SQL file and passes it to `npx supabase db query --linked`
(or `npx supabase db query --project-ref <ref>`):

```bash
# bash / macOS / Linux
DB_TESTS_ALLOW=1 node scripts/run-db-tests.mjs --linked
DB_TESTS_ALLOW=1 node scripts/run-db-tests.mjs --project-ref <branch-ref>

# PowerShell
$env:DB_TESTS_ALLOW = '1'; node scripts/run-db-tests.mjs --linked
$env:DB_TESTS_ALLOW = '1'; node scripts/run-db-tests.mjs --project-ref <branch-ref>
```

Optional: `--file tests/db/isolation.sql` (this is the default).

To run the file manually in the Supabase SQL editor, first opt in and use the
exact query syntax (there is **no** `--sql` flag and no `db execute` command):

```sql
set app.db_test_branch = '1';
```

then paste the contents of `isolation.sql`. The SQL guard refuses to continue
without that setting.

### Supported query syntax

```bash
# correct
npx supabase db query --linked "select 1"
npx supabase db query --project-ref <branch-ref> "select 1"

# wrong
npx supabase db query --linked --sql "select 1"
npx supabase db execute --linked "select 1"
```

The CLI returns a JSON envelope such as
`{"boundary":"...","rows":[...],"warning":null}`. The runner flattens `rows`,
prints every TAP line as `[ok]` / `[FAIL]`, surfaces `warning`, and exits `1` if
any assertion fails, no TAP rows were returned, or the CLI itself failed.
A passing run ends with 30 `[ok]` lines and exit code `0`.

## 4. Interpreting refunds

- `payments.kind = 'refund'` stores a **positive** `amount_cents`; the net for a
  booking is `sum(payment) - sum(refund)`. A negative amount is rejected by the
  `amount_cents <> 0` / `kind` checks and by `owner_add_payment`.
- `refund_exceeds` from `owner_add_payment` means the requested refund is larger
  than the net already received. That is an expected business-rule failure, not
  an RLS regression.
- `platform_refund_payment` is idempotent: calling it again for an already
  refunded payment returns `{"status":"refunded","replayed":true}` and must not
  create a second refund. A replayed refund is therefore a pass, not a duplicate.
- When a refund-related assertion fails, check the `tenant_id` of the payment
  first: a cross-tenant refund is the exact regression T4/T5 are designed to catch.

## Schema drift check

`npm run check:drift` queries `pg_proc` on the linked project and compares
`proacl` (grantees), `prosecdef`, and critical `prosrc` markers for
security-sensitive functions. It exits `1` with a per-function diff when a grant
or source marker drifts. CI runs it in the optional `db-drift` job only when
`SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` are configured.
