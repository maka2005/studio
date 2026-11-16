# Tests and quality

## Commands

- `npm run lint` / `npm run lint:fix` — ESLint (flat config).
- `npm run format` / `npm run format:check` — Prettier (scoped by `.prettierignore`; expand coverage incrementally).
- `npm run typecheck` — TypeScript (`tsc --noEmit`).
- `npm run test` — Vitest unit + integration + contract tests (`src/**/*.{test,spec}.*`, `tests/**/*.{test,spec}.*`, excluding e2e).
- `npm run test:unit` / `npm run test:integration` / `npm run test:contract` — focused runs.
- `npm run test:e2e` — Playwright smoke tests (`tests/e2e`). Requires build/preview or `PLAYWRIGHT_BASE_URL`.

## Structure

- `src/lib/__tests__/**` — unit tests for pure/shared logic.
- `tests/integration/**` — API/handler contract-integration tests (mocked dependencies where needed).
- `tests/contract/**` — config/schema, migration, API/Edge/RPC surface contracts.
- `tests/e2e/**` — Playwright smoke scenarios.

## CI

`.github/workflows/ci.yml` runs lint, format check, typecheck, Vitest, build, then Playwright smoke on Ubuntu with Node 22.

## Notes

- With 69+ Supabase migrations and Edge/RPC logic, prefer adding contract tests alongside schema/function changes (expected RPC names, table/columns/policies in migrations, handler response shapes).
- For DB-backed integration tests, run against a dedicated Supabase test project/branch with migrations applied; keep secrets out of the repo and use CI secrets/env.
