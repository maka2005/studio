import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import './platform.css';

// Админка платформы. Все данные приходят из Edge Function platform-admin, которая на сервере
// проверяет JWT, запись в platform_admins и (если включено) MFA. Проверки здесь — только удобство интерфейса.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const ERR: Record<string, string> = {
  forbidden: 'Нет доступа.', unauthorized: 'Войдите заново.', mfa_required: 'Нужно подтверждение MFA.', rate_limited: 'Слишком много запросов. Подождите.',
  slug_taken: 'Такой slug уже занят.', bad_slug: 'Slug: 2–40 символов a–z, 0–9, дефис.', bad_name: 'Название: 2–80 символов.', bad_request: 'Проверьте поля формы.',
  bad_timezone: 'Неизвестный часовой пояс.', plan_not_found: 'Тариф не найден или выключен.', subscription_exists: 'У организации уже есть действующая подписка.',
  no_paid_payment: 'Нет подтверждённого платежа. Подтвердите платёж или возобновите без оплаты.', bad_status: 'Действие недоступно в текущем статусе.',
  unlimited_subscription: 'Бессрочная подписка не продлевается.', bad_duration: 'Проверьте длительность.', bad_dates: 'Проверьте даты.',
  reason_required: 'Укажите причину (от 3 символов).', owner_create_failed: 'Не удалось создать владельца.', operation_failed: 'Операция не выполнена.',
  temporarily_unavailable: 'Сервис временно недоступен.', idempotency_conflict: 'Ключ операции уже использован для другой организации.',
};
const errText = (e: unknown) => { const m = (e as Error)?.message ?? ''; return ERR[m] ?? 'Ошибка: ' + (m || 'неизвестно'); };

async function call<T = Row>(action: string, body: Row = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('platform-admin', { body: { action, ...body } });
  if (error) {
    const payload = await (error as { context?: Response }).context?.clone().json().catch(() => null);
    throw new Error(String(payload?.error ?? error.message));
  }
  if (data?.error) throw new Error(String(data.error));
  return (data && 'data' in data ? data.data : data) as T;
}

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('ru-RU') : '—');
const fmtDateTime = (v?: string | null) => (v ? new Date(v).toLocaleString('ru-RU') : '—');
const kzt = (n?: number | null) => `${(n ?? 0).toLocaleString('ru-RU')} ₸`;
const iso = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : '');
const PHASE: Record<string, string> = { trial: 'Пробный', active: 'Активна', grace: 'Grace', scheduled: 'Запланирована', suspended: 'Приостановлена', expired: 'Истекла', cancelled: 'Отменена', none: 'Нет подписки' };
const PAY: Record<string, string> = { pending: 'Ожидает', paid: 'Оплачен', failed: 'Не прошёл', refunded: 'Возврат' };
const METHODS: Record<string, string> = { kaspi: 'Kaspi', transfer: 'Перевод', cash: 'Наличные', card: 'Карта', other: 'Другое' };
const Badge = ({ phase }: { phase: string }) => <span className={`pf-badge pf-${phase}`}>{PHASE[phase] ?? PAY[phase] ?? phase}</span>;

/* ----------------------------------------------------------------------------------- вход, MFA */
type Step = 'loading' | 'login' | 'mfa' | 'enroll' | 'denied' | 'ready';

export function PlatformAdmin() {
  const [step, setStep] = useState<Step>('loading');
  const [msg, setMsg] = useState('');

  const check = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { setStep('login'); return; }
    try {
      const me = await call<Row>('whoami');
      const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal.data?.nextLevel === 'aal2' && aal.data.currentLevel !== 'aal2') { setStep('mfa'); return; }
      if (me.mfa_required) { setStep('enroll'); return; }
      setStep('ready');
    } catch (e) {
      if ((e as Error).message === 'forbidden') {
        // Первый вход: сервер сам сверяет PLATFORM_SUPERADMIN_EMAIL и разрешает
        // bootstrap только пока platform_admins пустая.
        try {
          await call('bootstrap');
          setStep('loading');
          void check();
        } catch {
          setStep('denied');
        }
      }
      else { setMsg(errText(e)); setStep('login'); }
    }
  }, []);
  useEffect(() => { void check(); }, [check]);

  if (step === 'loading') return <main className="page"><p className="muted">Загрузка…</p></main>;
  if (step === 'denied') return (
    <main className="page"><section className="card col"><h1>403</h1><p className="muted">У этого аккаунта нет доступа к платформе.</p>
      <button className="btn ghost" onClick={async () => { await supabase.auth.signOut(); setStep('login'); }}>Выйти</button></section></main>);
  if (step === 'login') return <Login msg={msg} onDone={check} />;
  if (step === 'mfa') return <MfaVerify onDone={check} />;
  if (step === 'enroll') return <MfaEnroll onDone={check} />;
  return <Console onLogout={async () => { await supabase.auth.signOut(); setStep('login'); }} onMfa={() => setStep('mfa')} />;
}

function Login({ msg, onDone }: { msg: string; onDone: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(msg); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr('Неверный email или пароль.'); else onDone();
  };
  return (
    <main className="page"><form className="card col pf-narrow" onSubmit={submit}><h1>Servio · платформа</h1>
      <input className="field" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="field" type="password" autoComplete="current-password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {err && <p className="err">{err}</p>}
      <button className="btn" disabled={busy}>Войти</button></form></main>);
}

function MfaVerify({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    const factors = await supabase.auth.mfa.listFactors();
    const factor = factors.data?.totp?.[0];
    if (!factor) { setErr('Фактор не найден.'); return; }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    if (error) setErr('Неверный код.'); else onDone();
  };
  return (
    <main className="page"><form className="card col pf-narrow" onSubmit={submit}><h1>Код из приложения</h1>
      <input className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 цифр" value={code} onChange={(e) => setCode(e.target.value)} required />
      {err && <p className="err">{err}</p>}<button className="btn">Подтвердить</button></form></main>);
}

function MfaEnroll({ onDone }: { onDone: () => void }) {
  const [info, setInfo] = useState<{ id: string; qr: string; secret: string } | null>(null); const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const start = async () => {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `servio-${Date.now()}` });
    if (error || !data) { setErr('Не удалось начать настройку MFA.'); return; }
    setInfo({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault(); if (!info) return; setErr('');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: info.id, code: code.trim() });
    if (error) setErr('Неверный код.'); else onDone();
  };
  return (
    <main className="page"><section className="card col pf-narrow"><h1>Включите MFA</h1>
      <p className="muted">Для доступа к платформе нужен одноразовый код (Google Authenticator, 1Password и т. п.).</p>
      {!info ? <button className="btn" onClick={start}>Настроить</button> : (
        <form className="col" onSubmit={verify}><img src={info.qr} alt="QR-код для приложения-аутентификатора" width={200} height={200} />
          <p className="muted small">Или введите ключ вручную: <code>{info.secret}</code></p>
          <input className="field" inputMode="numeric" maxLength={6} placeholder="Код из приложения" value={code} onChange={(e) => setCode(e.target.value)} required />
          <button className="btn">Подтвердить</button></form>)}
      {err && <p className="err">{err}</p>}</section></main>);
}

/* ----------------------------------------------------------------------------------- каркас */
const TABS = ['Дашборд', 'Организации', 'Новая организация', 'Подписки', 'Тарифы', 'Платежи', 'Журнал', 'Настройки'] as const;
type Tab = (typeof TABS)[number];

function Console({ onLogout }: { onLogout: () => void; onMfa: () => void }) {
  const [tab, setTab] = useState<Tab>('Дашборд');
  const [openTenant, setOpenTenant] = useState<string | null>(null);
  return (
    <main className="page pf-wide">
      <header className="row between"><h1>Servio · платформа</h1><button className="btn ghost inline" onClick={onLogout}>Выйти</button></header>
      <nav className="pf-tabs">{TABS.map((t) => <button key={t} className={tab === t && !openTenant ? 'is-current' : ''} onClick={() => { setOpenTenant(null); setTab(t); }}>{t}</button>)}</nav>
      {openTenant ? <TenantCard id={openTenant} onBack={() => setOpenTenant(null)} />
        : tab === 'Дашборд' ? <Dashboard onOpen={setOpenTenant} onNavigate={setTab} />
        : tab === 'Организации' ? <Tenants onOpen={setOpenTenant} />
        : tab === 'Новая организация' ? <CreateTenant onCreated={(id) => setOpenTenant(id)} />
        : tab === 'Подписки' ? <Subscriptions onOpen={setOpenTenant} />
        : tab === 'Тарифы' ? <Plans />
        : tab === 'Платежи' ? <Payments />
        : tab === 'Журнал' ? <Audit />
        : <Settings />}
    </main>);
}

function useLoad<T>(action: string, body: Row = {}, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null); const [err, setErr] = useState(''); const [loading, setLoading] = useState(true);
  const bodyRef = useRef(body); bodyRef.current = body;
  const reload = useCallback(async () => {
    setLoading(true); setErr('');
    try { setData(await call<T>(action, bodyRef.current)); } catch (e) { setErr(errText(e)); } finally { setLoading(false); }
  }, [action]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload, ...deps]);
  return { data, err, loading, reload };
}
const State = ({ err, loading }: { err: string; loading: boolean }) => (err ? <p className="err">{err}</p> : loading ? <p className="muted">Загрузка…</p> : null);
const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="pf-scroll"><table className="pf-table"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>);

/* ----------------------------------------------------------------------------------- дашборд */
function Dashboard({ onOpen, onNavigate }: { onOpen: (id: string) => void; onNavigate: (tab: Tab) => void }) {
  const { data: d, err, loading, reload } = useLoad<Row>('dashboard');
  if (!d) return <><State err={err} loading={loading} />{err && <button className="pf-action-secondary pf-retry" onClick={() => void reload()}>Повторить загрузку</button>}</>;
  const months: Row[] = d.new_by_month ?? []; const max = Math.max(1, ...months.map((m) => Number(m.count)));
  const cards: [string, string | number][] = [['Организаций', d.organizations], ['Активные', d.active], ['Пробный период', d.trial], ['Grace', d.grace], ['Приостановлены', d.suspended], ['Выручка за месяц', kzt(d.revenue_month_kzt)]];
  return (<>
    <div className="pf-dashboard-heading">
      <div><span className="pf-kicker">ОБЗОР ПЛАТФОРМЫ</span><h2>Добро пожаловать</h2><p className="muted">Состояние организаций, подписок и платежей в одном месте.</p></div>
      <div className="pf-dashboard-actions"><button className="pf-action-secondary" onClick={() => void reload()} disabled={loading}>{loading ? 'Обновляем…' : '↻ Обновить'}</button><button className="pf-action-primary" onClick={() => onNavigate('Новая организация')}>＋ Новая организация</button></div>
    </div>
    <div className="pf-cards">{cards.map(([k, v], index) => <div className={`card pf-metric pf-metric-${index}`} key={k}><span className="muted small">{k}</span><b className="big">{v}</b></div>)}</div>
    <section className="card pf-panel"><div className="pf-panel-heading"><div><span className="pf-kicker">ТРЕБУЮТ ВНИМАНИЯ</span><h2>Истекают за 7 дней</h2></div><button className="pf-link" onClick={() => onNavigate('Подписки')}>Все подписки <span aria-hidden="true">→</span></button></div>
      {(d.expiring ?? []).length === 0 ? <p className="muted">Нет.</p> : (
        <Table head={['Организация', 'Тариф', 'Статус', 'Окончание']}>{(d.expiring as Row[]).map((r) => (
          <tr key={r.tenant_id}><td><button className="pf-link" onClick={() => onOpen(r.tenant_id)}>{r.name ?? r.slug}</button></td><td>{r.plan}</td><td><Badge phase={r.phase} /></td><td>{fmtDate(r.ends_at)}</td></tr>))}</Table>)}</section>
    <section className="card pf-panel"><div className="pf-panel-heading"><div><span className="pf-kicker">РОСТ</span><h2>Новые организации по месяцам</h2></div><button className="pf-link" onClick={() => onNavigate('Организации')}>Список организаций <span aria-hidden="true">→</span></button></div>
      {months.length === 0 ? <p className="muted">Нет данных.</p> : months.map((m) => (
        <div className="pf-bar" key={m.month}><span>{m.month}</span><i style={{ width: `${(Number(m.count) / max) * 100}%` }} /><b>{m.count}</b></div>))}</section>
  </>);
}

/* ----------------------------------------------------------------------------------- организации */
const newKey = () => crypto.randomUUID();

async function runSubAction(sub: string, type: string, data: Row = {}) {
  return call('subscription_action', { subscription_id: sub, type, data, idempotency_key: newKey() });
}
async function resumeFlow(sub: string): Promise<boolean> {
  try { await runSubAction(sub, 'resume'); return true; }
  catch (e) {
    if ((e as Error).message === 'no_paid_payment' && window.confirm('Нет подтверждённого платежа. Возобновить на один период без оплаты?')) { await runSubAction(sub, 'resume', { force: true }); return true; }
    throw e;
  }
}

function Tenants({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState(''); const [phase, setPhase] = useState(''); const [plan, setPlan] = useState(''); const [applied, setApplied] = useState({ search: '', phase: '', plan: '' });
  const { data, err, loading, reload } = useLoad<Row[]>('tenants', { search: applied.search, phase: applied.phase, plan: applied.plan }, [applied]);
  const [msg, setMsg] = useState('');
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  return (<>
    <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setApplied({ search, phase, plan }); }}>
      <input className="field" placeholder="Название, slug, email" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select className="field" value={phase} onChange={(e) => setPhase(e.target.value)}><option value="">Все статусы</option>{Object.entries(PHASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select className="field" value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">Все тарифы</option><option>START</option><option>PRO</option><option>LEGACY</option></select>
      <button className="btn inline">Найти</button></form>
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Организация', 'Владелец', 'Тариф', 'Статус', 'До', 'Действия']}>{data.map((r) => (
      <tr key={r.id}><td><button className="pf-link" onClick={() => onOpen(r.id)}>{r.name ?? r.slug}</button><br /><span className="muted small">{r.slug}</span></td>
        <td>{r.owner_email ?? '—'}</td><td>{r.plan_code ?? '—'}</td><td><Badge phase={r.phase} /></td><td>{r.ends_at ? fmtDate(r.ends_at) : 'бессрочно'}</td>
        <td className="pf-actions">
          <a href={`/s/${r.slug}/`} target="_blank" rel="noreferrer">Сайт</a>
          {r.subscription_id && ['trial', 'active', 'grace'].includes(r.phase) && <button onClick={() => act(() => runSubAction(r.subscription_id, 'suspend', { reason: 'Приостановлено администратором' }))}>Приостановить</button>}
          {r.subscription_id && ['suspended', 'expired'].includes(r.phase) && <button onClick={() => act(() => resumeFlow(r.subscription_id))}>Возобновить</button>}
        </td></tr>))}</Table>}
  </>);
}

function TenantCard({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: d, err, loading, reload } = useLoad<Row>('tenant', { tenant_id: id });
  const [msg, setMsg] = useState('');
  if (!d) return <><button className="back" onClick={onBack}>← Назад</button><State err={err} loading={loading} /></>;
  const t = d.tenant as Row; const subs: Row[] = d.subscriptions; const cur = subs.find((s) => ['trial', 'active', 'grace', 'suspended'].includes(s.status)) ?? subs[0];
  const exportData = async () => {
    setMsg('');
    const { data, error } = await supabase.functions.invoke('tenant-export', { body: { tenant_id: id } });
    if (error || !(data instanceof Blob)) { setMsg('Не удалось выгрузить данные.'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = `${t.slug}-export.zip`; a.click(); URL.revokeObjectURL(a.href);
  };
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  return (<>
    <button className="back" onClick={onBack}>← Назад</button>
    <section className="card"><div className="row between wrap"><div><h2>{t.config?.name ?? t.slug}</h2><p className="muted small">{t.slug} · {t.timezone} · создана {fmtDate(t.created_at)} · доступ: {d.access_state}</p></div>
      <div className="row wrap"><a className="btn ghost inline" href={`/s/${t.slug}/`} target="_blank" rel="noreferrer">Публичная страница</a><button className="btn ghost inline" onClick={exportData}>Экспорт данных</button></div></div>
      {msg && <p className="err">{msg}</p>}
      <p className="muted small">Сотрудники: {d.counters.staff} · Услуги: {d.counters.services} · Записи за 30 дней: {d.counters.bookings_30d}</p></section>
    <section className="card"><h3>Текущая подписка</h3>
      {cur ? <><p><Badge phase={cur.phase} /> {cur.plan_code} · {fmtDate(cur.starts_at)} — {cur.ends_at ? fmtDate(cur.ends_at) : 'бессрочно'}{cur.grace_ends_at ? ` (grace до ${fmtDate(cur.grace_ends_at)})` : ''}</p>
        <div className="pf-actions">
          {cur.ends_at && <button onClick={() => act(() => runSubAction(cur.id, 'extend', { months: 1 }))}>Продлить на 1 мес.</button>}
          {['trial', 'active', 'grace'].includes(cur.phase) && <button onClick={() => act(() => runSubAction(cur.id, 'suspend', { reason: 'Приостановлено администратором' }))}>Приостановить</button>}
          {['suspended', 'expired'].includes(cur.phase) && <button onClick={() => act(() => resumeFlow(cur.id))}>Возобновить</button>}
          <button onClick={() => { const code = window.prompt('Код тарифа (START / PRO):'); if (code) void act(() => runSubAction(cur.id, 'change_plan', { plan_code: code.trim().toUpperCase() })); }}>Сменить тариф</button>
        </div></> : <p className="muted">Подписки нет.</p>}</section>
    <section className="card"><h3>Владельцы и сотрудники</h3><Table head={['Email', 'Роль', 'Последний вход']}>{(d.members as Row[]).map((m) => <tr key={m.user_id}><td>{m.email}</td><td>{m.role}</td><td>{fmtDateTime(m.last_sign_in_at)}</td></tr>)}</Table></section>
    <section className="card"><h3>История подписок</h3><Table head={['Тариф', 'Статус', 'Начало', 'Окончание']}>{subs.map((s) => <tr key={s.id}><td>{s.plan_code}</td><td><Badge phase={s.phase} /></td><td>{fmtDate(s.starts_at)}</td><td>{s.ends_at ? fmtDate(s.ends_at) : '—'}</td></tr>)}</Table></section>
    <section className="card"><h3>Платежи</h3><Table head={['Дата', 'Сумма', 'Период', 'Способ', 'Статус']}>{(d.payments as Row[]).map((p) => <tr key={p.id}><td>{fmtDate(p.received_at)}</td><td>{kzt(p.amount_kzt)}</td><td>{fmtDate(p.period_start)} — {fmtDate(p.period_end)}</td><td>{METHODS[p.method] ?? p.method}</td><td><Badge phase={p.status} /></td></tr>)}</Table></section>
    <section className="card"><h3>События</h3><Table head={['Когда', 'Событие', 'Данные']}>{(d.events as Row[]).map((e) => <tr key={e.id}><td>{fmtDateTime(e.created_at)}</td><td>{e.type}</td><td className="muted small">{JSON.stringify(e.payload)}</td></tr>)}</Table></section>
  </>);
}

/* ----------------------------------------------------------------------------------- создание организации */
function CreateTenant({ onCreated }: { onCreated: (id: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<Row>({ name: '', slug: '', business_type: 'autoservice', owner_name: '', owner_email: '', phone: '', address: '', timezone: 'Asia/Aqtobe', currency: '₸', plan_code: 'START', start: today, months: 1, trial: true, services: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const key = useRef(newKey()); // один ключ на форму: повторный клик «Создать» не создаёт дубликат
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setErr(''); setOk('');
    const services = String(f.services).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, price, dur] = l.split(';').map((x) => x.trim()); return { name, price: Number(price), duration_minutes: Number(dur) }; });
    try {
      const r = await call<Row>('create_tenant', { idempotency_key: key.current, tenant: { ...f, start: iso(f.start), months: Number(f.months), services } });
      setOk(r.replayed ? 'Организация уже была создана этим запросом.' : r.invite_sent ? 'Организация создана, приглашение отправлено владельцу.' : 'Организация создана. Приглашение не отправлено — отправьте его из карточки.');
      key.current = newKey(); onCreated(r.tenant_id);
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  };
  const input = (label: string, k: string, type = 'text', ph = '') => <label className="pf-label">{label}<input className="field" type={type} placeholder={ph} value={f[k]} onChange={(e) => set(k, e.target.value)} required={['name', 'slug', 'owner_email'].includes(k)} /></label>;
  return (
    <form className="card col pf-form" onSubmit={submit}><h2>Новая организация</h2>
      {input('Название', 'name')}{input('Slug (адрес /s/slug)', 'slug', 'text', 'my-studio')}{input('Тип бизнеса', 'business_type')}
      {input('Имя владельца', 'owner_name')}{input('Email владельца', 'owner_email', 'email')}{input('Телефон', 'phone', 'tel')}{input('Адрес', 'address')}
      {input('Часовой пояс', 'timezone')}{input('Валюта', 'currency')}
      <label className="pf-label">Тариф<select className="field" value={f.plan_code} onChange={(e) => set('plan_code', e.target.value)}><option>START</option><option>PRO</option></select></label>
      <label className="pf-check"><input type="checkbox" checked={f.trial} onChange={(e) => set('trial', e.target.checked)} /> Пробный период (длительность из настроек)</label>
      {input('Дата старта подписки', 'start', 'date')}
      {!f.trial && input('Длительность, месяцев', 'months', 'number')}
      <label className="pf-label">Услуги (по строке: название; цена; минуты). Можно оставить пустым<textarea className="field" rows={4} placeholder={'Мойка; 3500; 60'} value={f.services} onChange={(e) => set('services', e.target.value)} /></label>
      {err && <p className="err">{err}</p>}{ok && <p>{ok}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Создаём…' : 'Создать'}</button></form>);
}

/* ----------------------------------------------------------------------------------- подписки */
function Subscriptions({ onOpen }: { onOpen: (id: string) => void }) {
  const [phase, setPhase] = useState('');
  const { data, err, loading, reload } = useLoad<Row[]>('subscriptions', { phase }, [phase]);
  const [msg, setMsg] = useState('');
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  return (<>
    <select className="field" value={phase} onChange={(e) => setPhase(e.target.value)}><option value="">Все статусы</option>{Object.entries(PHASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Организация', 'Тариф', 'Статус', 'Начало', 'Окончание', 'Действия']}>{data.map((s) => (
      <tr key={s.id}><td><button className="pf-link" onClick={() => onOpen(s.tenant_id)}>{s.name ?? s.slug}</button></td><td>{s.plan_code}</td><td><Badge phase={s.phase} /></td><td>{fmtDate(s.starts_at)}</td><td>{s.ends_at ? fmtDate(s.ends_at) : 'бессрочно'}</td>
        <td className="pf-actions">
          {s.ends_at && <button onClick={() => act(() => runSubAction(s.id, 'extend', { months: 1 }))}>+1 мес.</button>}
          <button onClick={() => { const c = window.prompt('Код тарифа (START / PRO):'); if (c) void act(() => runSubAction(s.id, 'change_plan', { plan_code: c.trim().toUpperCase() })); }}>Тариф</button>
          <button onClick={() => { const d = window.prompt('Новая дата окончания (ГГГГ-ММ-ДД):', s.ends_at?.slice(0, 10)); if (d) void act(() => runSubAction(s.id, 'set_dates', { ends_at: iso(d) })); }}>Даты</button>
          {['trial', 'active', 'grace'].includes(s.phase) && <button onClick={() => act(() => runSubAction(s.id, 'suspend', { reason: 'Приостановлено администратором' }))}>Приостановить</button>}
          {['suspended', 'expired'].includes(s.phase) && <button onClick={() => act(() => resumeFlow(s.id))}>Возобновить</button>}
        </td></tr>))}</Table>}</>);
}

/* ----------------------------------------------------------------------------------- тарифы */
function Plans() {
  const { data, err, loading, reload } = useLoad<Row[]>('plans');
  const [msg, setMsg] = useState('');
  const save = async (p: Row, patch: Row) => { setMsg(''); try { await call('plan_save', { plan: { id: p.id, ...patch } }); await reload(); } catch (e) { setMsg(errText(e)); } };
  return (<><State err={err} loading={loading && !data} />{msg && <p className="err">{msg}</p>}
    <p className="muted small">Тарифы нельзя удалять — только выключать.</p>
    {data?.map((p) => <PlanRow key={p.id} p={p} onSave={(patch) => save(p, patch)} />)}</>);
}
function PlanRow({ p, onSave }: { p: Row; onSave: (patch: Row) => void }) {
  const [name, setName] = useState<string>(p.name); const [price, setPrice] = useState<string>(String(p.price_kzt)); const [desc, setDesc] = useState<string>(p.description ?? '');
  const [features, setFeatures] = useState<string>((p.features as string[]).join(', '));
  return (
    <section className="card col"><div className="row between"><b>{p.code}</b><label className="pf-check"><input type="checkbox" checked={p.is_active} onChange={(e) => onSave({ is_active: e.target.checked })} /> Активен</label></div>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название" />
      <input className="field" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Цена, ₸" />
      <textarea className="field" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Описание" />
      <input className="field" value={features} onChange={(e) => setFeatures(e.target.value)} aria-label="Возможности через запятую" />
      <button className="btn inline" onClick={() => onSave({ name, price_kzt: Number(price), description: desc, features: features.split(',').map((x) => x.trim()).filter(Boolean) })}>Сохранить</button></section>);
}

/* ----------------------------------------------------------------------------------- платежи */
function Payments() {
  const { data, err, loading, reload } = useLoad<Row[]>('payments');
  const tenants = useLoad<Row[]>('tenants', { limit: 200 });
  const [msg, setMsg] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<Row>({ tenant_id: '', amount_kzt: '', period_start: today, period_end: '', method: 'kaspi', received_at: today, note: '' });
  const key = useRef(newKey()); const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setMsg('');
    try {
      await call('payment_create', { tenant_id: f.tenant_id, idempotency_key: key.current, payment: { amount_kzt: Number(f.amount_kzt), period_start: iso(f.period_start), period_end: iso(f.period_end), method: f.method, received_at: iso(f.received_at), note: f.note } });
      key.current = newKey(); await reload();
    } catch (e2) { setMsg(errText(e2)); } finally { setBusy(false); }
  };
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  return (<>
    <form className="card col pf-form" onSubmit={create}><h2>Новый платёж</h2>
      <select className="field" value={f.tenant_id} onChange={(e) => setF({ ...f, tenant_id: e.target.value })} required><option value="">Организация…</option>{tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.slug}</option>)}</select>
      <input className="field" type="number" min={1} placeholder="Сумма, ₸" value={f.amount_kzt} onChange={(e) => setF({ ...f, amount_kzt: e.target.value })} required />
      <label className="pf-label">Период с<input className="field" type="date" value={f.period_start} onChange={(e) => setF({ ...f, period_start: e.target.value })} required /></label>
      <label className="pf-label">Период по<input className="field" type="date" value={f.period_end} onChange={(e) => setF({ ...f, period_end: e.target.value })} required /></label>
      <select className="field" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <label className="pf-label">Дата получения<input className="field" type="date" value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} required /></label>
      <button className="btn" disabled={busy}>Создать (статус «Ожидает»)</button></form>
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Дата', 'Организация', 'Сумма', 'Период', 'Способ', 'Статус', 'Действия']}>{data.map((p) => (
      <tr key={p.id}><td>{fmtDate(p.received_at)}</td><td>{p.name ?? p.slug}</td><td>{kzt(p.amount_kzt)}</td><td>{fmtDate(p.period_start)} — {fmtDate(p.period_end)}</td><td>{METHODS[p.method] ?? p.method}</td>
        <td><Badge phase={p.status} />{p.refund_reason && <div className="muted small">{p.refund_reason}</div>}</td>
        <td className="pf-actions">
          {p.status === 'pending' && <button onClick={() => { if (window.confirm(`Подтвердить получение ${kzt(p.amount_kzt)}?`)) void act(() => call('payment_confirm', { payment_id: p.id })); }}>Подтвердить</button>}
          {p.status === 'pending' && <button onClick={() => act(() => call('payment_fail', { payment_id: p.id }))}>Не прошёл</button>}
          {p.status === 'paid' && <button onClick={() => { const r = window.prompt('Причина возврата:'); if (r) void act(() => call('payment_refund', { payment_id: p.id, reason: r })); }}>Возврат</button>}
        </td></tr>))}</Table>}</>);
}

/* ----------------------------------------------------------------------------------- журнал, настройки */
function Audit() {
  const [tenant, setTenant] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const tenants = useLoad<Row[]>('tenants', { limit: 200 });
  const { data, err, loading } = useLoad<Row[]>('audit', { tenant_id: tenant || undefined, from: from ? iso(from) : undefined, to: to ? iso(to) : undefined }, [tenant, from, to]);
  return (<>
    <div className="row wrap">
      <select className="field" value={tenant} onChange={(e) => setTenant(e.target.value)}><option value="">Все организации</option>{tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.slug}</option>)}</select>
      <input className="field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="С даты" /><input className="field" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="По дату" /></div>
    <State err={err} loading={loading && !data} />
    {data && <Table head={['Когда', 'Кто', 'Действие', 'Организация', 'Данные']}>{data.map((a) => <tr key={a.id}><td>{fmtDateTime(a.created_at)}</td><td>{a.actor_email ?? '—'}</td><td>{a.action}</td><td>{a.slug ?? '—'}</td><td className="muted small">{JSON.stringify(a.payload)}</td></tr>)}</Table>}</>);
}

function Settings() {
  const { data, err, loading, reload } = useLoad<Row>('settings');
  const [trial, setTrial] = useState(''); const [grace, setGrace] = useState(''); const [msg, setMsg] = useState('');
  useEffect(() => { if (data) { setTrial(String(data.trial_days ?? 14)); setGrace(String(data.grace_days ?? 5)); } }, [data]);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setMsg('');
    try { await call('settings_set', { key: 'trial_days', value: Number(trial) }); await call('settings_set', { key: 'grace_days', value: Number(grace) }); await reload(); setMsg('Сохранено. Новые значения действуют для новых подписок и продлений.'); }
    catch (e2) { setMsg(errText(e2)); }
  };
  return (<><State err={err} loading={loading && !data} />
    <form className="card col pf-form" onSubmit={save}><h2>Настройки</h2>
      <label className="pf-label">Пробный период, дней (1–90)<input className="field" type="number" min={1} max={90} value={trial} onChange={(e) => setTrial(e.target.value)} /></label>
      <label className="pf-label">Grace-период, дней (0–30)<input className="field" type="number" min={0} max={30} value={grace} onChange={(e) => setGrace(e.target.value)} /></label>
      {msg && <p>{msg}</p>}<button className="btn">Сохранить</button></form></>);
}
