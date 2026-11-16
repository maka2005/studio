import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), 'supabase/migrations');
let files = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
} catch (e) {
  console.error(JSON.stringify({ level: 'error', event: 'migrations_dir_missing', error: String(e?.message || e) }));
  process.exit(1);
}

const errors = [];
const warnings = [];
const seen = new Set();
const preferredNameRe = /^(?:\d{4,14}|[0-9]{14})[a-z0-9_-]*\.sql$/i;

for (const f of files) {
  if (!preferredNameRe.test(f)) warnings.push(`non-standard migration name: ${f}`);
  const key = f.toLowerCase();
  if (seen.has(key)) errors.push(`duplicate migration name: ${f}`);
  seen.add(key);
  const full = resolve(dir, f);
  try {
    const st = statSync(full);
    if (!st.isFile()) errors.push(`not a file: ${f}`);
    if (st.size === 0) errors.push(`empty migration: ${f}`);
    const text = readFileSync(full, 'utf8');
    if (!/\S/.test(text)) errors.push(`blank migration: ${f}`);
  } catch (e) {
    errors.push(`cannot read migration ${f}: ${String(e?.message || e)}`);
  }
}

// basic ordering sanity for prefixed migrations (lexicographic sort of filenames in dir listing)
const prefixed = files.filter((f) => /^\d+/.test(f)).sort();
for (let i = 1; i < prefixed.length; i++) {
  const a = prefixed[i - 1].match(/^(\d+)/)[1];
  const b = prefixed[i].match(/^(\d+)/)[1];
  if (b < a) errors.push(`migration ordering issue: ${prefixed[i - 1]} -> ${prefixed[i]}`);
}

if (errors.length) {
  console.error(JSON.stringify({ level: 'error', event: 'migration_check_failed', errors, warnings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ level: 'info', event: 'migration_check_ok', count: files.length, warnings }));
