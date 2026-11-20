import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_SQL_FILE = 'tests/db/isolation.sql';

function fail(message) {
  console.error(`[db-tests] ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { mode: null, projectRef: null, file: DEFAULT_SQL_FILE };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--linked') {
      if (opts.mode) fail('choose only one of --linked or --project-ref');
      opts.mode = 'linked';
    } else if (arg === '--project-ref') {
      if (opts.mode) fail('choose only one of --linked or --project-ref');
      opts.projectRef = argv[++i];
      if (!opts.projectRef) fail('--project-ref requires a value');
      opts.mode = 'project-ref';
    } else if (arg === '--file') {
      opts.file = argv[++i];
      if (!opts.file) fail('--file requires a value');
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }

  if (!opts.mode) {
    fail('choose a target explicitly: --linked or --project-ref <ref>');
  }
  return opts;
}

function cliInvocation(args) {
  // Prefer the locally installed CLI (same program as `npx supabase ...`) so
  // the SQL text is passed as an argument array and never touches a shell.
  const override = process.env.SUPABASE_CLI_PATH;
  const localCli = resolve(
    process.cwd(),
    override || 'node_modules/supabase/dist/supabase.js',
  );
  if (existsSync(localCli)) {
    return { command: process.execPath, args: [localCli, ...args], shell: false };
  }
  return {
    command: 'npx',
    args: ['supabase', ...args],
    shell: process.platform === 'win32',
  };
}

function runNpx(args) {
  const { command, args: invocationArgs, shell } = cliInvocation(args);

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, invocationArgs, { shell, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function parseJsonFromOutput(stdout) {
  const text = stdout.trim();
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function collectRows(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRows(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value.rows)) collectRows(value.rows, out);
    if (value.result !== undefined) collectRows(value.result, out);
    if (Object.hasOwn(value, 'ok') || Object.hasOwn(value, 'description')) out.push(value);
    return out;
  }
  return out;
}

function tapResult(row) {
  const raw = row.ok ?? row.success ?? row.result;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (['ok', 't', 'true', '1', 'pass'].includes(value)) return true;
    if (['not ok', 'f', 'false', '0', 'fail'].includes(value)) return false;
  }
  const description = String(row.description ?? '');
  if (/^not ok\b/i.test(description)) return false;
  if (/^ok\b/i.test(description)) return true;
  return null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (process.env.DB_TESTS_ALLOW !== '1') {
    fail('set DB_TESTS_ALLOW=1 to confirm the target is a disposable test branch');
  }

  let sql;
  try {
    sql = readFileSync(resolve(process.cwd(), opts.file), 'utf8');
  } catch (error) {
    fail(`cannot read ${opts.file}: ${String(error?.message ?? error)}`);
  }

  // The SQL file has its own guard; this opt-in is only injected by the runner
  // after the explicit branch confirmation above.
  const guardedSql = `set app.db_test_branch = '1';\n${sql}`;

  const cliArgs = ['db', 'query', '--output-format', 'json'];
  if (opts.mode === 'linked') {
    cliArgs.push('--linked', guardedSql);
  } else {
    cliArgs.push('--project-ref', opts.projectRef, guardedSql);
  }

  let result;
  try {
    result = await runNpx(cliArgs);
  } catch (error) {
    fail(`could not start the Supabase CLI: ${String(error?.message ?? error)}`);
  }

  if (result.stderr.trim()) {
    process.stderr.write(`${result.stderr.trimEnd()}\n`);
  }

  const payload = parseJsonFromOutput(result.stdout);
  if (result.code !== 0) {
    if (result.stdout.trim()) process.stdout.write(`${result.stdout.trimEnd()}\n`);
    fail(`Supabase CLI exited with code ${result.code}`);
  }

  if (!payload || typeof payload !== 'object') {
    fail(`Supabase CLI returned no JSON envelope: ${result.stdout.trim() || '(empty)'}`);
  }
  if (payload.error || payload.errors) {
    fail(`Supabase CLI reported an error: ${JSON.stringify(payload.error ?? payload.errors)}`);
  }
  if (payload.warning) {
    console.warn(`[db-tests] warning: ${String(payload.warning)}`);
  }

  const rows = collectRows(payload);
  const tapRows = rows.filter((row) => tapResult(row) !== null);

  for (const row of rows) {
    const status = tapResult(row);
    if (status === null) continue;
    const label = status ? '[ok]' : '[FAIL]';
    console.log(`${label} ${String(row.description ?? JSON.stringify(row))}`);
  }

  if (tapRows.length === 0) {
    fail(`no pgTAP results found in the CLI response: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  const failed = tapRows.filter((row) => tapResult(row) === false);
  if (failed.length > 0) {
    fail(`${failed.length} of ${tapRows.length} DB assertions failed`);
  }

  console.log(`[db-tests] ${tapRows.length} DB assertions passed`);
}

await main();
