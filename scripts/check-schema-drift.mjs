import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Security-sensitive RPCs whose grants / bodies must not drift silently.
const FUNCTIONS = [
  {
    signature: 'public.platform_notification_delivery(text,text,integer,integer)',
    serviceRole: true,
    markers: ['notification_jobs'],
  },
  {
    signature: 'public.platform_notification_bounces(integer,integer)',
    serviceRole: true,
    markers: ['bounce_suppressions'],
  },
  {
    signature: 'public.platform_notifications(uuid,integer,integer)',
    serviceRole: true,
    markers: ['platform_assert', 'platform_audit_logs'],
  },
  {
    signature: 'public.platform_mark_notifications_read(uuid,uuid[])',
    serviceRole: true,
    markers: ['platform_assert', 'platform_notification_reads'],
  },
  {
    signature: 'public.platform_list_subscriptions(uuid,text,integer,integer)',
    serviceRole: true,
    markers: ['platform_assert'],
  },
  {
    signature: 'public.is_platform_admin(uuid)',
    serviceRole: true,
    markers: ['is_active'],
  },
  {
    signature: 'public.effective_day_hours(uuid,date)',
    serviceRole: true,
    markers: ['schedule_exceptions'],
  },
  {
    signature: 'public.slot_in_break(uuid,timestamp with time zone,integer)',
    serviceRole: true,
    markers: ['breaks'],
  },
  {
    signature: 'public.owner_tenant_owner(text)',
    serviceRole: false,
    markers: ['member_role'],
  },
  {
    signature: 'public.consume_webhook_event(text,text)',
    serviceRole: true,
    markers: ['processed_webhook_events'],
  },
  {
    signature: 'public.record_email_bounce(text,jsonb)',
    serviceRole: true,
    markers: ['bounce_suppressions'],
  },
  {
    signature: 'public.tenant_access_state(uuid)',
    serviceRole: true,
    markers: ['nonrenew_at'],
  },
].map((fn) => ({
  ...fn,
  expectedGrants: fn.serviceRole ? ['postgres', 'service_role'] : ['postgres'],
}));

function fail(message) {
  console.error(`[check:drift] ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { mode: 'linked', projectRef: null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--linked') {
      opts.mode = 'linked';
    } else if (arg === '--project-ref') {
      opts.projectRef = argv[++i];
      if (!opts.projectRef) fail('--project-ref requires a value');
      opts.mode = 'project-ref';
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlArray = (values) => `array[${values.map(sqlString).join(', ')}]::text[]`;

function buildQuery() {
  const rows = FUNCTIONS.map(
    (fn) =>
      `    (${sqlString(fn.signature)}, ${sqlArray(fn.expectedGrants)}, ${sqlArray(fn.markers)})`,
  ).join(',\n');

  return `with expected(signature, allowed_grantees, source_markers) as (
  values
${rows}
)
select
  e.signature,
  e.allowed_grantees,
  e.source_markers,
  coalesce(g.grantees, '[]'::jsonb) as grantees,
  p.prosecdef,
  coalesce(p.prosrc, '') as prosrc
from expected e
left join pg_proc p on p.oid = to_regprocedure(e.signature)
left join lateral (
  select jsonb_agg(
    distinct case when x.grantee = 0 then 'PUBLIC' else r.rolname end
    order by case when x.grantee = 0 then 'PUBLIC' else r.rolname end
  ) as grantees
  from aclexplode(p.proacl) x
  left join pg_roles r on r.oid = x.grantee
) g on true
order by e.signature`;
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
    if (Object.hasOwn(value, 'signature')) out.push(value);
    return out;
  }
  return out;
}

function asArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Plain text values are handled below.
    }
    if (/^\{.*\}$/.test(value)) {
      return value
        .slice(1, -1)
        .split(',')
        .filter(Boolean)
        .map((item) => item.replace(/^"|"$/g, ''));
    }
    return value ? [value] : [];
  }
  return [];
}

function asBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['t', 'true', '1', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

const sameSet = (left, right) =>
  left.length === right.length &&
  [...left].sort().every((item, index) => item === [...right].sort()[index]);

function checkRow(row) {
  const signature = String(row.signature ?? '(unknown)');
  const expected = asArray(row.allowed_grantees);
  const actual = asArray(row.grantees);
  const markers = asArray(row.source_markers);
  const source = String(row.prosrc ?? '');
  const issues = [];

  if (!source) {
    issues.push('function is missing');
  } else {
    if (!sameSet(actual, expected)) {
      issues.push(
        `grants [${actual.join(', ') || 'none'}] != expected [${expected.join(', ') || 'none'}]`,
      );
    }
    if (!asBool(row.prosecdef)) issues.push('not SECURITY DEFINER');
    const missing = markers.filter((marker) => !source.includes(marker));
    if (missing.length > 0) issues.push(`prosrc missing: ${missing.join(', ')}`);
  }

  return { signature, issues };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cliArgs = ['db', 'query', '--output-format', 'json'];
  if (opts.mode === 'linked') {
    cliArgs.push('--linked', buildQuery());
  } else {
    cliArgs.push('--project-ref', opts.projectRef, buildQuery());
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
    console.warn(`[check:drift] warning: ${String(payload.warning)}`);
  }

  const rows = collectRows(payload);
  if (rows.length === 0) {
    fail(`no rows returned by the drift query: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  const problems = rows.map(checkRow);
  const seen = new Set(rows.map((row) => String(row.signature)));
  for (const fn of FUNCTIONS) {
    if (!seen.has(fn.signature)) {
      problems.push({ signature: fn.signature, issues: ['function is missing from query result'] });
    }
  }

  for (const problem of problems) {
    if (problem.issues.length === 0) {
      console.log(`[ok] ${problem.signature}`);
    } else {
      console.log(`[DRIFT] ${problem.signature}`);
      for (const issue of problem.issues) console.log(`       - ${issue}`);
    }
  }

  const drifted = problems.filter((problem) => problem.issues.length > 0);
  if (drifted.length > 0) {
    fail(`${drifted.length} security-sensitive function(s) drifted`);
  }

  console.log(`[check:drift] ${problems.length} functions match the expected grants and source`);
}

await main();
