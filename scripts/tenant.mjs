import fs from 'node:fs'; import path from 'node:path';
const [cmd, slug] = process.argv.slice(2); const dir = path.join('tenants', slug ?? '');
const fail = (m) => { console.error('✗ ' + m); process.exit(1); };
if (cmd === 'new') {
  if (!/^[a-z0-9-]{2,40}$/.test(slug ?? '')) fail('slug: a-z, 0-9, - (2–40)');
  if (fs.existsSync(dir)) fail('уже существует: ' + dir);
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  const t = JSON.parse(fs.readFileSync('tenants/graphite/business.json', 'utf8'));
  fs.writeFileSync(path.join(dir, 'business.json'), JSON.stringify({ ...t, slug, name: slug, demo: true }, null, 2));
  console.log('✓ создано', dir);
} else if (cmd === 'validate') {
  let c; try { c = JSON.parse(fs.readFileSync(path.join(dir, 'business.json'), 'utf8')); } catch (e) { fail('business.json: ' + e.message); }
  const err = [];
  if (c.slug !== slug) err.push('slug не совпадает с папкой');
  if (!/^#[0-9a-fA-F]{6}$/.test(c.accent ?? '')) err.push('accent: нужен #RRGGBB');
  try { new Intl.DateTimeFormat('en', { timeZone: c.timezone }); } catch { err.push('timezone неверный'); }
  if (!c.name || !c.phone || !c.address) err.push('name/phone/address обязательны');
  if (!c.resources?.length) err.push('нужен минимум один пост');
  if (!c.services?.length) err.push('нужна минимум одна услуга');
  for (const s of c.services ?? []) if (!(s.price >= 0) || !(s.duration_minutes > 0)) err.push('услуга: ' + s.name);
  for (const [d, h] of Object.entries(c.hours ?? {})) if (h && h[0] >= h[1]) err.push('часы ' + d);
  if (!c.demo) for (const k of ['logo', 'hero']) if (!fs.existsSync(path.join(dir, c.images?.[k] ?? '')))
    err.push('нет файла изображения: ' + k);
  if (err.length) fail(err.join('\n✗ '));
  console.log('✓ валидно:', slug, c.demo ? '(demo/preview)' : '(live-ready)');
} else if (cmd === 'build') {
  fs.mkdirSync('public/tenants', { recursive: true });
  for (const d of fs.readdirSync('tenants')) {
    const f = path.join('tenants', d, 'business.json'); if (!fs.existsSync(f)) continue;
    fs.copyFileSync(f, `public/tenants/${d}.json`);
    const img = path.join('tenants', d, 'images');
    if (fs.existsSync(img)) fs.cpSync(img, `public/tenants/${d}`, { recursive: true });
    const c = JSON.parse(fs.readFileSync(f, 'utf8')); const u = `/s/${d}/`;
    const icons = [192, 512].filter((n) => fs.existsSync(path.join('tenants', d, 'images', `icon-${n}.png`)))
      .map((n) => ({ src: `/tenants/${d}/icon-${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any' }));
    fs.writeFileSync(`public/tenants/${d}.webmanifest`, JSON.stringify({ id: u, name: c.name, short_name: c.short_name ?? c.name,
      start_url: u, scope: u, display: 'standalone', background_color: '#000000', theme_color: '#000000', icons }));
    console.log('✓', d, icons.length ? '' : '(нет icon-192.png/icon-512.png: установка на экран может быть недоступна)');
  }
} else if (cmd === 'sql') {
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'business.json'), 'utf8')); const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const out = [`-- seed ${slug}: сгенерировано tenant:sql, повторный запуск обновляет настройки`,
   `insert into tenants(slug,status,timezone,buffer_minutes,config) values(${q(c.slug)},${c.demo ? "'preview'" : "'live'"},${q(c.timezone)},${c.buffer_minutes ?? 15},${q(JSON.stringify(c))}::jsonb)`,
   `on conflict(slug) do update set timezone=excluded.timezone,buffer_minutes=excluded.buffer_minutes,config=excluded.config;`];
  for (const r of c.resources) out.push(`insert into resources(tenant_id,name) select id,${q(r)} from tenants where slug=${q(c.slug)} and not exists(select 1 from resources x where x.tenant_id=tenants.id and x.name=${q(r)});`);
  for (const s of c.services) out.push(`insert into services(tenant_id,name,price_cents,duration_minutes) select id,${q(s.name)},${Math.round(s.price * 100)},${s.duration_minutes} from tenants where slug=${q(c.slug)} and not exists(select 1 from services x where x.tenant_id=tenants.id and x.name=${q(s.name)});`);
  for (const s of c.services) out.push(`update services set price_cents=${Math.round(s.price * 100)},duration_minutes=${s.duration_minutes} where tenant_id=(select id from tenants where slug=${q(c.slug)}) and name=${q(s.name)};`);
  fs.mkdirSync('supabase/seed', { recursive: true }); fs.writeFileSync(`supabase/seed/${slug}.sql`, out.join('\n') + '\n'); console.log('✓ supabase/seed/' + slug + '.sql');
} else fail('tenant new|validate|build|sql <slug>');
