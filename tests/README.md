# Tests and quality

## Commands

- `npm run lint` / `npm run lint:fix` — ESLint (flat config).
- `npm run format` / `npm run format:check` — Prettier (scoped by `.prettierignore`; expand coverage incrementally).
- `npm run typecheck` — TypeScript (`tsc --noEmit`).
- `npm run test` — Vitest unit + integration + contract tests (`src/**/*.{test,spec}.*`, `tests/**/*.{test,spec}.*`, excluding e2e).
- `npm run test:unit` / `npm run test:integration` / `npm run test:contract` — focused runs.
- `npm run test:e2e` — Playwright smoke tests (`tests/e2e`). Requires build/preview or `PLAYWRIGHT_BASE_URL`.
- `npm run check:drift` — compares `pg_proc` grants/body markers for security-sensitive RPCs on the linked Supabase project.
- `node scripts/run-db-tests.mjs --linked` — pgTAP cross-tenant isolation suite (see `tests/db/README.md`; requires `DB_TESTS_ALLOW=1`).

## Structure

- `src/lib/__tests__/**` — unit tests for pure/shared logic.
- `tests/integration/**` — API/handler contract-integration tests (mocked dependencies where needed).
- `tests/contract/**` — config/schema, migration, API/Edge/RPC surface contracts.
- `tests/e2e/**` — Playwright smoke scenarios.
- `tests/db/**` — pgTAP isolation suite and its dedicated instructions.

## CI

`.github/workflows/ci.yml` has two jobs on Ubuntu with Node 22:

- `checks`: `npm ci` → lint → format check → typecheck → Vitest → build → migration checks.
- `db-drift`: only when `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` are configured; links the project and runs `npm run check:drift`. No migrations are applied in CI.

## Notes

- With 69+ Supabase migrations and Edge/RPC logic, prefer adding contract tests alongside schema/function changes (expected RPC names, table/columns/policies in migrations, handler response shapes).
- For DB-backed integration tests, run against a dedicated Supabase test project/branch with migrations applied; keep secrets out of the repo and use CI secrets/env. Never point `run-db-tests.mjs` at production.
