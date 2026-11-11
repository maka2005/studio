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
  bad_limits: 'Проверьте значения лимитов тарифов.', bad_features: 'Проверьте доступ к функциям тарифа.',
  trial_already_used: 'Пробный период уже использовался для этого email, телефона или БИН/ИИН.', trial_identity_required:'Для пробного периода укажите email владельца.',
  deletion_requested: 'Удаление уже запрошено.',
  plan_limit_employees: 'Достигнут лимит сотрудников по тарифу.', plan_limit_services: 'Достигнут лимит услуг по тарифу. Для начального набора выберите тариф с большим лимитом.', plan_limit_bookings_per_month: 'Достигнут месячный лимит записей.',
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
const isoEnd = (d:string) => { if(!d)return '';const end=new Date(`${d}T00:00:00`);end.setDate(end.getDate()+1);return end.toISOString(); };
const PHASE: Record<string, string> = { trial: 'Пробный период', active: 'Активна', grace: 'Льготный период', scheduled: 'Запланирована', suspended: 'Приостановлена', expired: 'Истекла', cancelled: 'Отменена', none: 'Нет подписки' };
const PAY: Record<string, string> = { pending: 'Ожидает', paid: 'Оплачен', failed: 'Не прошёл', refunded: 'Возврат' };
const METHODS: Record<string, string> = { kaspi: 'Kaspi', transfer: 'Перевод', cash: 'Наличные', card: 'Карта', other: 'Другое' };
const Badge = ({ phase }: { phase: string }) => <span className={`pf-badge pf-${phase}`}>{PHASE[phase] ?? PAY[phase] ?? 'Статус не распознан'}</span>;

/* ----------------------------------------------------------------------------------- вход, MFA */
type Step = 'loading' | 'login' | 'mfa' | 'enroll' | 'denied' | 'ready';

export function PlatformAdmin() {
  const [step, setStep] = useState<Step>('loading');
  const [msg, setMsg] = useState('');
  const [role, setRole] = useState('read_only');
  const [accountEmail, setAccountEmail] = useState('');

  const check = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { setStep('login'); return; }
    try {
      const me = await call<Row>('whoami');
      setRole(String(me.role ?? 'read_only'));
      setAccountEmail(String(me.email ?? ''));
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
  return <Console role={role} accountEmail={accountEmail} onLogout={async () => { await supabase.auth.signOut(); setStep('login'); }} onMfa={() => setStep('mfa')} />;
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
const TABS = ['Дашборд', 'Организации', 'Новая организация', 'Подписки', 'Тарифы', 'Платежи', 'Документы', 'Уведомления', 'Журнал', 'Администраторы', 'Настройки'] as const;
type Tab = (typeof TABS)[number];

const PLATFORM_ROLE_LABEL: Record<string, string> = { owner: 'Владелец', support: 'Поддержка', finance: 'Финансы', read_only: 'Только чтение' };
function Console({ onLogout, role, accountEmail }: { onLogout: () => void; onMfa: () => void; role: string; accountEmail: string }) {
  const [tab, setTab] = useState<Tab>(role === 'support' ? 'Организации' : 'Дашборд');
  const [openTenant, setOpenTenant] = useState<string | null>(null);
  const platformNotices=useLoad<Row[]>('notifications',{limit:200})
  // A new response is surfaced even when the administrator stays on another section.
  useEffect(()=>{const timer=window.setInterval(()=>void platformNotices.reload(),30_000);return()=>window.clearInterval(timer)},[platformNotices.reload])
  const visibleTabs = TABS.filter((t) => {
    if (role === 'owner') return true;
    if (t === 'Администраторы') return false;
    if (t === 'Новая организация' || t === 'Настройки') return false;
    if (role === 'finance') return !['Организации','Уведомления','Администраторы','Настройки'].includes(t);
    if (role === 'read_only') return !['Уведомления','Документы'].includes(t);
    return !['Дашборд','Подписки','Тарифы','Платежи','Настройки'].includes(t);
  });
  useEffect(() => { if (!visibleTabs.includes(tab)) setTab(role === 'support' ? 'Организации' : 'Дашборд'); }, [role]);
  return (
    <main className="page pf-wide">
      <header className="pf-app-header"><div className="pf-brand"><span className="pf-brand-mark">S</span><div><b>Servio</b><span>Platform console</span></div></div><div className="pf-header-actions"><span className="pf-header-user">{PLATFORM_ROLE_LABEL[role] ?? 'Нет доступа'}{accountEmail && <><br/><small>{accountEmail}</small></>}</span><button className="pf-logout" onClick={onLogout}>Выйти</button></div></header>
      <div className="pf-console-layout"><nav className="pf-tabs" aria-label="Разделы платформы">{visibleTabs.map((t) => <button key={t} className={tab === t && !openTenant ? 'is-current' : ''} onClick={() => { setOpenTenant(null); setTab(t); if(t==='Уведомления'){const ids=platformNotices.data?.filter(x=>!x.is_read).map(x=>String(x.id))??[];if(ids.length)void call('notifications_read',{ids}).then(()=>platformNotices.reload())} }}>{t}{t==='Уведомления'&&platformNotices.data?.some(x=>!x.is_read)&&<i className="admin-unread-dot" aria-label="Есть непрочитанные уведомления"/>}</button>)}</nav>
      <section className="pf-console-content">{openTenant ? <TenantCard id={openTenant} role={role} onBack={() => setOpenTenant(null)} />
        : tab === 'Дашборд' ? <Dashboard onOpen={setOpenTenant} onNavigate={setTab} />
        : tab === 'Организации' ? <Tenants onOpen={setOpenTenant} />
        : tab === 'Новая организация' ? <CreateTenant onCreated={(id) => setOpenTenant(id)} />
        : tab === 'Подписки' ? <Subscriptions onOpen={setOpenTenant} />
        : tab === 'Тарифы' ? <Plans />
        : tab === 'Платежи' ? <Payments />
        : tab === 'Документы' ? <BillingDocuments />
        : tab === 'Уведомления' ? <PlatformNotifications />
        : tab === 'Журнал' ? <Audit />
        : tab === 'Администраторы' ? <Admins />
        : <Settings />}</section></div>
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
  const revenueMonths: Row[] = d.revenue_by_month ?? []; const maxRevenue = Math.max(1, ...revenueMonths.map((m) => Number(m.amount_kzt)));
  const cards: [string, string | number, string][] = [
    ['MRR', kzt(d.mrr_kzt), 'Регулярная выручка в месяц'],
    ['ARR', kzt(d.arr_kzt), 'MRR × 12'],
    ['Churn за месяц', `${Number(d.churn_rate_pct ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`, `${d.churned_this_month ?? 0} ушедших · платящие сейчас + ушедшие`],
    ['Trial → Paid', `${Number(d.trial_conversion_pct ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`, 'Конверсия пробных подписок за 12 мес.'],
    ['ARPU', kzt(d.arpu_kzt), 'MRR на платящую организацию'],
    ['Выручка за месяц', kzt(d.revenue_month_kzt), 'Подтверждённые платежи'],
  ];
  return (<>
    <div className="pf-dashboard-heading">
      <div><span className="pf-kicker">ОБЗОР ПЛАТФОРМЫ</span><h2>Добро пожаловать</h2><p className="muted">Состояние организаций, подписок и платежей в одном месте.</p></div>
      <div className="pf-dashboard-actions"><button className="pf-action-secondary" onClick={() => void reload()} disabled={loading}>{loading ? 'Обновляем…' : '↻ Обновить'}</button><button className="pf-action-primary" onClick={() => onNavigate('Новая организация')}>＋ Новая организация</button></div>
    </div>
    <div className="pf-cards">{cards.map(([k, v, hint], index) => <div className={`card pf-metric pf-metric-${index}`} key={k}><span className="muted small">{k}</span><b className="big">{v}</b><span className="pf-metric-hint">{hint}</span></div>)}</div>
    <section className="card pf-panel"><div className="pf-panel-heading"><div><span className="pf-kicker">ВЫРУЧКА</span><h2>Платежи по месяцам</h2></div><span className="muted small">Последние 12 месяцев · ₸</span></div>
      {revenueMonths.length === 0 ? <p className="muted">Подтверждённых платежей пока нет.</p> : <div className="pf-revenue-chart" role="img" aria-label="Выручка по месяцам за последние 12 месяцев">{revenueMonths.map((m) => <div className="pf-revenue-column" key={m.month} title={`${m.month}: ${kzt(Number(m.amount_kzt))}`}><span>{kzt(Number(m.amount_kzt))}</span><i style={{ height: `${Math.max(3, Number(m.amount_kzt) / maxRevenue * 100)}%` }} /><small>{m.month}</small></div>)}</div>}</section>
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

function subscriptionEventTitle(type:string){return ({created:'Подписка создана',suspended:'Подписка приостановлена',resumed:'Подписка возобновлена',extended:'Срок подписки продлён',dates_changed:'Изменён срок подписки',plan_changed:'Изменён тариф',cancelled:'Подписка отменена',expired:'Срок подписки закончился',grace_started:'Начался льготный период',payment_confirmed:'Платёж подтверждён',payment_failed:'Платёж не прошёл',payment_refunded:'Выполнен возврат',price_change_accepted:'Новая цена принята',price_change_declined:'Новая цена отклонена'} as Record<string,string>)[type]??'Обновление подписки'}
function subscriptionEventDetail(e:Row){
  const p=(e.payload&&typeof e.payload==='object'?e.payload:{}) as Row;
  const date=(v:unknown)=>v?fmtDateTime(String(v)):'—';
  switch(String(e.type)){
    case 'suspended':return p.reason?`Причина: ${String(p.reason)}`:'Подписка остановлена администратором.';
    case 'resumed':return `${p.forced?'Возобновлена администратором':'Доступ восстановлен'}${p.ends_at?` · действует до ${date(p.ends_at)}`:''}`;
    case 'dates_changed':return `Окончание: ${date(p.was_ends_at)} → ${date(p.ends_at)}${p.starts_at?` · начало: ${date(p.starts_at)}`:''}`;
    case 'extended':return `Срок продлён на ${Number(p.months??0)||'несколько'} мес.${p.to?` · новая дата окончания: ${date(p.to)}`:''}`;
    case 'plan_changed':return p.to?`Новый тариф: ${String(p.to)}`:'Тариф организации обновлён.';
    case 'created':return `${p.trial?'Пробный период':'Тариф'}${p.plan?`: ${String(p.plan)}`:''}${p.ends_at?` · до ${date(p.ends_at)}`:''}`;
    case 'cancelled':return p.reason?`Причина: ${String(p.reason)}`:'Подписка отменена администратором.';
    case 'payment_confirmed':return `Подтверждена оплата ${kzt(Number(p.amount_kzt??0))}.`;
    case 'payment_refunded':return p.reason?`Причина возврата: ${String(p.reason)}`:'Платёж возвращён.';
    case 'payment_failed':return p.reason?`Платёж не прошёл: ${String(p.reason)}`:'Платёж не удалось подтвердить. Проверьте перевод или обратитесь в поддержку.';
    case 'price_change_accepted':return 'Владелец организации согласился с новой ценой.';
    case 'price_change_declined':return 'Владелец организации отклонил новую цену.';
    case 'grace_started':return p.grace_ends_at?`Продлите подписку до ${date(p.grace_ends_at)}.`:'Подписка ожидает продления.';
    default:return 'Обновлены условия подписки.';
  }
}

function TenantPlanOverrides({tenantId,access,usage,onSaved}:{tenantId:string;access:Row;usage:Row;onSaved:()=>void}){
  const limitFields:[string,string][]=[['employees','Сотрудники'],['services','Услуги'],['branches','Филиалы'],['bookings_per_month','Записи в месяц']];
  const featureFields:[string,string][]=[['telegram','Telegram'],['export','Экспорт ZIP'],['reviews','Отзывы']];
  const [limits,setLimits]=useState<Row>({}); const [unlimited,setUnlimited]=useState<Row>({}); const [features,setFeatures]=useState<Row>({}); const [reason,setReason]=useState(''); const [msg,setMsg]=useState(''); const [busy,setBusy]=useState(false);
  useEffect(()=>{const overrides=access?.override??{};const rawLimits=overrides.limits??{};setLimits(Object.fromEntries(limitFields.map(([key])=>[key,rawLimits[key]==null?'':String(rawLimits[key])])));setUnlimited(Object.fromEntries(limitFields.map(([key])=>[key,key in rawLimits&&rawLimits[key]===null])));setFeatures(Object.fromEntries(featureFields.map(([key])=>[key,typeof overrides.features?.[key]==='boolean'?String(overrides.features[key]):'inherit'])));setReason('')},[access]);
  const save=async(reset=false)=>{if(reason.trim().length<5){setMsg('Укажите причину (не менее 5 символов).');return}setBusy(true);setMsg('');try{const lim=reset?{}:Object.fromEntries(limitFields.filter(([key])=>unlimited[key]||String(limits[key]??'').trim()!=='').map(([key])=>[key,unlimited[key]?null:Number(limits[key])]));const flags=reset?{}:Object.fromEntries(featureFields.filter(([key])=>features[key]&&features[key]!=='inherit').map(([key])=>[key,features[key]==='true']));await call('tenant_limits_set',{tenant_id:tenantId,limits:lim,features:flags,reason:reason.trim()});setMsg(reset?'Исключения сброшены.':'Индивидуальные лимиты сохранены.');setReason('');onSaved()}catch(e){setMsg(errText(e))}finally{setBusy(false)}};
  const displayLimit=(key:string)=>access?.limits?.[key]==null?'без ограничений':Number(access.limits[key]).toLocaleString('ru-RU');
  const usageValue=(key:string)=>usage?.[key]==null?'не учитывается':Number(usage[key]).toLocaleString('ru-RU');
  return <section className="card col"><div><h3>Лимиты и функции организации</h3><p className="muted small">Тариф {access?.plan_code??'—'}. Текущие данные остаются доступными; превышение блокирует только новые добавления.</p></div>
    <div className="pf-plan-limits">{limitFields.map(([key,label])=><label key={key} className="pf-label">{label}<span className="muted small">По тарифу: {displayLimit(key)} · Сейчас: {usageValue(key)}</span><input className="field" type="number" min={1} step={1} value={limits[key]??''} disabled={!!unlimited[key]} onChange={e=>setLimits((prev:Row)=>({...prev,[key]:e.target.value}))} placeholder="Наследовать лимит тарифа"/><span className="pf-check"><input type="checkbox" checked={!!unlimited[key]} onChange={e=>setUnlimited((prev:Row)=>({...prev,[key]:e.target.checked}))}/> Без лимита</span></label>)}</div>
    <p className="muted small">Сейчас считается один основной филиал на организацию. Управление несколькими филиалами в приложении пока не подключено.</p>
    <div className="col"><b>Исключения по функциям</b><div className="row wrap">{featureFields.map(([key,label])=><label className="pf-label" key={key}>{label}<select className="field" value={features[key]??'inherit'} onChange={e=>setFeatures((prev:Row)=>({...prev,[key]:e.target.value}))}><option value="inherit">Как в тарифе ({access?.features?.[key]===false?'выключено':'включено'})</option><option value="true">Включить</option><option value="false">Выключить</option></select></label>)}</div></div>
    <label className="pf-label">Причина изменения<textarea className="field" rows={2} maxLength={500} minLength={5} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Например: согласовано индивидуальное расширение тарифа"/></label>
    {msg&&<p className="muted small" role="status">{msg}</p>}<div className="row wrap"><button className="btn" disabled={busy||reason.trim().length<5} onClick={()=>void save()}>{busy?'Сохраняем…':'Сохранить исключения'}</button><button className="btn ghost" disabled={busy||reason.trim().length<5} onClick={()=>void save(true)}>Сбросить к тарифу</button></div>{access?.override?.reason&&<p className="muted small">Последняя причина: {String(access.override.reason)}</p>}
  </section>
}

function TenantCard({ id, role, onBack }: { id: string; role: string; onBack: () => void }) {
  const { data: d, err, loading, reload } = useLoad<Row>('tenant', { tenant_id: id });
  const [eventPage,setEventPage]=useState(0);
  const events=useLoad<Row>('tenant_events',{tenant_id:id,limit:50,offset:eventPage*50},[id,eventPage]);
  useEffect(()=>setEventPage(0),[id]);
  const [msg, setMsg] = useState(''); const [reason,setReason]=useState(''); const [impBusy,setImpBusy]=useState(false);
  const [lifeReason,setLifeReason]=useState('');
  if (!d) return <><button className="back" onClick={onBack}>← Назад</button><State err={err} loading={loading} /></>;
  const t = d.tenant as Row; const subs: Row[] = d.subscriptions; const cur = subs.find((s) => ['trial', 'active', 'grace', 'suspended'].includes(s.status)) ?? subs[0];
  const exportData = async () => {
    setMsg('');
    const { data, error } = await supabase.functions.invoke('tenant-export', { body: { tenant_id: id } });
    if (error || !(data instanceof Blob)) { setMsg('Не удалось выгрузить данные.'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = `${t.slug}-export.zip`; a.click(); URL.revokeObjectURL(a.href);
  };
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  const startImpersonation = async (e: FormEvent) => {
    e.preventDefault(); setMsg(''); setImpBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('unauthorized');
      const response = await fetch('/api/owner?action=impersonate_start',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({tenant_id:id,reason:reason.trim()})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(String(payload.error??'operation_failed'));
      window.location.assign(`/s/${payload.tenant_slug}/owner`);
    } catch(e2) { setMsg(errText(e2)); } finally { setImpBusy(false); }
  };
  return (<>
    <button className="back" onClick={onBack}>← Назад</button>
    <section className="card"><div className="row between wrap"><div><h2>{t.config?.name ?? t.slug}</h2><p className="muted small">{t.slug} · {t.timezone} · создана {fmtDate(t.created_at)} · доступ: {d.access_state}</p>{t.archived_at&&<p className="err small">В архиве с {fmtDate(t.archived_at)}{t.deletion_requested_at?` · удаление запрошено, хранение до ${fmtDate(new Date(new Date(t.deletion_requested_at).getTime()+30*86400000).toISOString())}`:''}</p>}</div>
      <div className="row wrap"><a className="btn ghost inline" href={`/s/${t.slug}/`} target="_blank" rel="noreferrer">Публичная страница</a><button className="btn ghost inline" onClick={exportData}>Экспорт данных</button></div></div>
      {msg && <p className="err">{msg}</p>}
      {role==='owner'&&<div className="col"><label className="pf-label">Причина действия с организацией<input className="field" minLength={5} maxLength={500} value={lifeReason} onChange={e=>setLifeReason(e.target.value)} placeholder="Обязательная причина (не менее 5 символов)"/></label><div className="row wrap"><button className="btn ghost" disabled={lifeReason.trim().length<5} onClick={()=>void act(()=>call('tenant_lifecycle',{tenant_id:id,lifecycle_action:t.archived_at?'restore':'archive',reason:lifeReason.trim()}))}>{t.archived_at?'Восстановить':'В архив'}</button><button className="btn danger" disabled={lifeReason.trim().length<5||!!t.deletion_requested_at} onClick={()=>{if(window.confirm('Удаление будет запрошено с 30-дневным сроком хранения. Данные сейчас не стираются. Продолжить?'))void act(()=>call('tenant_lifecycle',{tenant_id:id,lifecycle_action:'delete_request',reason:lifeReason.trim()}))}}>Запросить удаление (30 дней)</button></div></div>}
      <p className="muted small">Сотрудники: {d.counters.staff} · Услуги: {d.counters.services} · Записи за 30 дней: {d.counters.bookings_30d}</p></section>
    {['owner','support'].includes(role) && <form className="card col" onSubmit={(e)=>void startImpersonation(e)}><h3>Режим поддержки</h3><p className="muted small">Вход в кабинет владельца на 30 минут. Причина обязательна; действия будут записаны в журнал.</p><label className="pf-label">Причина доступа<textarea className="field" minLength={5} maxLength={500} rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Например: воспроизведение ошибки при создании записи" required /></label><button className="pf-action-primary" disabled={impBusy||reason.trim().length<5}>{impBusy?'Открываем кабинет…':'Войти в кабинет организации'}</button></form>}
      <section className="card"><h3>Текущая подписка</h3>
      {cur ? <><p><Badge phase={cur.phase} /> {cur.plan_code} · {fmtDate(cur.starts_at)} — {cur.ends_at ? fmtDate(cur.ends_at) : 'бессрочно'}{cur.grace_ends_at ? ` (grace до ${fmtDate(cur.grace_ends_at)})` : ''}</p>
        <div className="pf-actions">
          {cur.ends_at && <button onClick={() => act(() => runSubAction(cur.id, 'extend', { months: 1 }))}>Продлить на 1 мес.</button>}
          {['trial', 'active', 'grace'].includes(cur.phase) && <button onClick={() => {const why=window.prompt('Причина приостановки (обязательно):');if(why?.trim())void act(() => runSubAction(cur.id, 'suspend', { reason: why.trim() }))}}>Приостановить</button>}
          {['suspended', 'expired'].includes(cur.phase) && <button onClick={() => act(() => resumeFlow(cur.id))}>Возобновить</button>}
          <button onClick={() => { const code = window.prompt('Код тарифа (START / PRO):'); if (code) void act(() => runSubAction(cur.id, 'change_plan', { plan_code: code.trim().toUpperCase() })); }}>Сменить тариф</button>
          {['trial','active','grace','suspended'].includes(cur.status)&&<button className="danger" onClick={()=>{const why=window.prompt('Причина отмены подписки (обязательно):');if(why?.trim())void act(()=>runSubAction(cur.id,'cancel',{reason:why.trim()}))}}>Отменить подписку</button>}
        </div></> : <p className="muted">Подписки нет.</p>}</section>
    {role==='owner'&&<TenantPlanOverrides tenantId={id} access={d.plan_access??{}} usage={d.plan_usage??{}} onSaved={()=>void reload()}/>}
    <section className="card"><h3>Владельцы и сотрудники</h3><Table head={['Email', 'Роль', 'Последний вход']}>{(d.members as Row[]).map((m) => <tr key={m.user_id}><td>{m.email}</td><td>{m.role}</td><td>{fmtDateTime(m.last_sign_in_at)}</td></tr>)}</Table></section>
    <section className="card"><h3>История подписок</h3><Table head={['Тариф', 'Статус', 'Начало', 'Окончание']}>{subs.map((s) => <tr key={s.id}><td>{s.plan_code}</td><td><Badge phase={s.phase} /></td><td>{fmtDate(s.starts_at)}</td><td>{s.ends_at ? fmtDate(s.ends_at) : '—'}</td></tr>)}</Table></section>
    <section className="card"><h3>Платежи</h3><Table head={['Дата', 'Сумма', 'Период', 'Способ', 'Статус']}>{(d.payments as Row[]).map((p) => <tr key={p.id}><td>{fmtDate(p.received_at)}</td><td>{kzt(p.amount_kzt)}</td><td>{fmtDate(p.period_start)} — {fmtDate(p.period_end)}</td><td>{METHODS[p.method] ?? p.method}</td><td><Badge phase={p.status} /></td></tr>)}</Table></section>
    <section className="card col"><div><h3>История подписки</h3><p className="muted small">Платежи, изменения тарифа и статуса организации.</p></div><State err={events.err} loading={events.loading}/>{events.data&&<>{(events.data.items as Row[]).length===0?<p className="muted">Событий пока нет.</p>:<div className="pf-event-list">{(events.data.items as Row[]).map((e)=><article className="pf-event" key={e.id}><div className="row between wrap"><b>{subscriptionEventTitle(String(e.type))}</b><time className="muted small">{fmtDateTime(e.created_at)}</time></div><p className="muted small">{subscriptionEventDetail(e)}</p></article>)}</div>}{((events.data.items as Row[]).length>0||eventPage>0)&&<nav className="admin-service-pagination" aria-label="История подписки"><button className="admin-page-button" disabled={eventPage===0||events.loading} onClick={()=>setEventPage(eventPage-1)}>Назад</button><span className="muted small">Страница <b>{eventPage+1}</b></span><button className="admin-page-button" disabled={!events.data.has_more||events.loading} onClick={()=>setEventPage(eventPage+1)}>Далее</button></nav>}</>}</section>
  </>);
}

/* ----------------------------------------------------------------------------------- создание организации */
function CreateTenant({ onCreated }: { onCreated: (id: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<Row>({ name: '', slug: '', business_type: 'autoservice', owner_name: '', owner_email: '', phone: '', bin_iin:'', address: '', timezone: 'Asia/Aqtobe', currency: '₸', plan_code: 'START', start: today, months: 1, trial: true, services: '' });
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
      {input('Имя владельца', 'owner_name')}{input('Email владельца', 'owner_email', 'email')}{input('Телефон', 'phone', 'tel')}{input('БИН/ИИН (для защиты trial)', 'bin_iin')}{input('Адрес', 'address')}
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
    {data && <Table head={['Организация', 'Тариф', 'Цена по подписке', 'Статус', 'Начало', 'Окончание', 'Действия']}>{data.map((s) => (
      <tr key={s.id}><td><button className="pf-link" onClick={() => onOpen(s.tenant_id)}>{s.name ?? s.slug}</button></td><td>{s.plan_code}</td><td>{kzt(s.price_kzt)} / {s.price_period_months} мес.</td><td><Badge phase={s.phase} /></td><td>{fmtDate(s.starts_at)}</td><td>{s.ends_at ? fmtDate(s.ends_at) : 'бессрочно'}</td>
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
    <p className="muted small">При изменении цены или периода всем владельцам организаций с активной подпиской появится предложение в кабинете. Нужно уведомить за 30 дней; новые условия начнут действовать после принятия и указанной даты. При отказе сохраняются прежние условия.</p>
    {data?.map((p) => <PlanRow key={p.id} p={p} onSave={(patch) => save(p, patch)} />)}</>);
}
function PlanRow({ p, onSave }: { p: Row; onSave: (patch: Row) => void }) {
  const [name, setName] = useState<string>(p.name); const [price, setPrice] = useState<string>(String(p.price_kzt)); const [desc, setDesc] = useState<string>(p.description ?? '');
  const [features, setFeatures] = useState<string>((p.features as string[]).join(', '));
  const [limits,setLimits]=useState<Row>(p.limits??{}); const [featureAccess,setFeatureAccess]=useState<Row>(p.feature_access??{telegram:true,export:true,reviews:true});
  const setLimit=(key:string,value:string)=>setLimits((prev:Row)=>({...prev,[key]:value===''?null:Number(value)}));
  const limitFields:[string,string][]=[['employees','Сотрудники'],['services','Услуги'],['branches','Филиалы'],['bookings_per_month','Записи в месяц']];
  const accessFields:[string,string][]=[['telegram','Telegram'],['export','Экспорт ZIP'],['reviews','Отзывы']];
  return (
    <section className="card col"><div className="row between"><b>{p.code}</b><label className="pf-check"><input type="checkbox" checked={p.is_active} onChange={(e) => onSave({ is_active: e.target.checked })} /> Активен</label></div>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название" />
      <input className="field" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Цена, ₸" />
      <textarea className="field" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Описание" />
      <input className="field" value={features} onChange={(e) => setFeatures(e.target.value)} aria-label="Возможности через запятую" />
      <b>Лимиты тарифа</b><p className="muted small">Пустое значение означает «без ограничений». Для тарифа START и PRO ограничения проверяются при добавлении.</p>
      <div className="pf-plan-limits">{limitFields.map(([key,label])=><label key={key} className="pf-label">{label}<input className="field" type="number" min={1} step={1} value={limits[key]??''} onChange={e=>setLimit(key,e.target.value)} placeholder="Без ограничений"/></label>)}</div>
      <b>Доступ к функциям</b><div className="row wrap">{accessFields.map(([key,label])=><label key={key} className="pf-check"><input type="checkbox" checked={featureAccess[key]!==false} onChange={e=>setFeatureAccess((prev:Row)=>({...prev,[key]:e.target.checked}))}/>{label}</label>)}</div>
      <button className="btn inline" onClick={() => onSave({ name, price_kzt: Number(price), description: desc, features: features.split(',').map((x) => x.trim()).filter(Boolean), limits:Object.fromEntries(limitFields.map(([key])=>[key,limits[key]===''?null:(limits[key]===undefined?(p.limits?.[key]??null):limits[key])])),feature_access:featureAccess })}>Сохранить</button></section>);
}

function BillingDocuments(){
  const {data:docs,err,loading,reload}=useLoad<Row[]>('billing_documents');
  const tenants=useLoad<Row[]>('tenants',{limit:200});
  const today=new Date().toISOString().slice(0,10);
  const [f,setF]=useState<Row>({tenant_id:'',document_type:'invoice',number:'',issue_date:today,service_from:today,service_to:today,amount_kzt:0,description:'Подписка Servio',status:'draft',esf_status:'not_issued',esf_number:''});
  const [msg,setMsg]=useState('');
  const save=async(e:FormEvent)=>{e.preventDefault();setMsg('');try{await call('billing_document_save',{document:{...f,amount_kzt:Number(f.amount_kzt),seller:{name:'Servio',country:'Казахстан'},buyer:{tenant_id:f.tenant_id}}});setMsg('Документ сохранён. Это внутренний документ, не официальная ЭСФ.');await reload()}catch(e){setMsg(errText(e))}};
  const print=(d:Row)=>{const w=window.open('','_blank');if(!w)return;w.document.write(`<meta charset="utf-8"><title>${d.document_type==='invoice'?'Счёт':'Акт'} ${d.number}</title><h1>${d.document_type==='invoice'?'Счёт на оплату':'Акт оказанных услуг'}</h1><p>№ ${d.number} от ${fmtDate(d.issue_date)}</p><p>Исполнитель: Servio, Казахстан</p><p>Заказчик: ${d.tenant_slug??d.tenant_id}</p><p>Период: ${fmtDate(d.service_from)} — ${fmtDate(d.service_to)}</p><p>${d.description}</p><h2>${kzt(d.amount_kzt)}</h2><p>ЭСФ: ${d.esf_number??'не оформлена'} · ${d.esf_status}</p><small>Печатная форма Servio не является официальной ЭСФ.</small><script>window.print()</script>`);w.document.close()};
  return <div className="col"><section className="card col"><h2>Счета и акты</h2><p className="muted small">Внутренние документы по подписке. ЭСФ оформляется отдельно в государственной ИС ЭСФ.</p><form className="col" onSubmit={save}><select className="field" required value={f.tenant_id} onChange={e=>setF({...f,tenant_id:e.target.value})}><option value="">Организация</option>{tenants.data?.map(t=><option key={t.id} value={t.id}>{t.name??t.slug}</option>)}</select><select className="field" value={f.document_type} onChange={e=>setF({...f,document_type:e.target.value})}><option value="invoice">Счёт</option><option value="act">Акт</option></select><input className="field" required placeholder="Номер документа" value={f.number} onChange={e=>setF({...f,number:e.target.value})}/><div className="row wrap">{(['issue_date','service_from','service_to'] as const).map((key)=><label className="pf-label" key={key}>{key==='issue_date'?'Дата документа':key==='service_from'?'Услуги с':'Услуги по'}<input className="field" type="date" value={f[key]} onChange={e=>setF({...f,[key]:e.target.value})}/></label>)}</div><input className="field" type="number" min="0" value={f.amount_kzt} onChange={e=>setF({...f,amount_kzt:e.target.value})}/><input className="field" placeholder="Описание услуг" value={f.description} onChange={e=>setF({...f,description:e.target.value})}/><input className="field" placeholder="Номер ЭСФ из ИС ЭСФ (если есть)" value={f.esf_number} onChange={e=>setF({...f,esf_number:e.target.value,esf_status:e.target.value?'issued':'not_issued'})}/><button className="btn">Сохранить документ</button></form>{msg&&<p className="muted small">{msg}</p>}</section><State err={err} loading={loading&&!docs}/>{docs&&<Table head={['Тип / номер','Организация','Период','Сумма','ЭСФ','Действия']}>{docs.map(d=><tr key={d.id}><td>{d.document_type==='invoice'?'Счёт':'Акт'} №{d.number}</td><td>{d.tenant_id}</td><td>{fmtDate(d.service_from)} — {fmtDate(d.service_to)}</td><td>{kzt(d.amount_kzt)}</td><td>{d.esf_number??'Нет'} · {d.esf_status}</td><td><button onClick={()=>print(d)}>Печать</button></td></tr>)}</Table>}</div>
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
const ADMIN_ROLE: Record<string, string> = { owner: 'Владелец', support: 'Поддержка', finance: 'Финансы', read_only: 'Только чтение' };
function Admins() {
  const { data, err, loading, reload } = useLoad<Row[]>('admins');
  const [email, setEmail] = useState(''); const [role, setRole] = useState('support'); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const act = async (action: string, body: Row) => {
    setBusy(true); setMsg('');
    try { const result = await call<Row>(action, body); await reload(); return result; }
    catch (e) { setMsg(errText(e)); }
    finally { setBusy(false); }
  };
  const add = async (e: FormEvent) => { e.preventDefault(); const result = await act('admin_add', { email: email.trim(), role }); if (result) { setEmail(''); setMsg(result.invite_sent ? 'Администратор добавлен, письмо для входа отправлено.' : result.created ? 'Администратор добавлен, но письмо не отправлено. Проверьте настройки почты.' : 'Существующий аккаунт добавлен как администратор.'); } };
  return <>
    <div className="pf-dashboard-heading"><div><span className="pf-kicker">ДОСТУП К ПЛАТФОРМЕ</span><h2>Администраторы</h2><p className="muted">Назначайте сотрудникам минимально необходимую роль. Для нового аккаунта отправим письмо для входа.</p></div></div>
    <form className="card row wrap" onSubmit={add}><input className="field" type="email" placeholder="Email сотрудника" value={email} onChange={(e)=>setEmail(e.target.value)} required />
      <select className="field" value={role} onChange={(e)=>setRole(e.target.value)}>{Object.entries(ADMIN_ROLE).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
      <button className="pf-action-primary" disabled={busy}>Добавить администратора</button></form>
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Администратор','Роль','Статус','Добавлен','Действия']}>{data.map((a)=><tr key={a.user_id}>
      <td>{a.email}</td><td><select className="field" value={a.role} disabled={busy || !a.is_active} onChange={(e)=>void act('admin_update',{user_id:a.user_id,role:e.target.value})}>{Object.entries(ADMIN_ROLE).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></td>
      <td><Badge phase={a.is_active?'active':'suspended'} /></td><td>{fmtDate(a.created_at)}</td>
      <td className="pf-actions">{a.is_active && <><button className="pf-action-secondary" disabled={busy} onClick={()=>{if(window.confirm(`Сбросить MFA для ${a.email}?`))void act('admin_reset_mfa',{user_id:a.user_id})}}>Сбросить MFA</button><button className="pf-action-secondary" disabled={busy} onClick={()=>{if(window.confirm(`Отключить администратора ${a.email}?`))void act('admin_disable',{user_id:a.user_id})}}>Отключить</button></>}</td>
    </tr>)}</Table>}
  </>;
}

function Audit() {
  const [tenant, setTenant] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [action, setAction] = useState(''); const [page,setPage]=useState(0); const limit=50;
  const tenants = useLoad<Row[]>('tenants', { limit: 200 });
  useEffect(()=>setPage(0),[tenant,from,to,action]);
  const { data, err, loading } = useLoad<Row[]>('audit', { tenant_id: tenant || undefined, from: from ? iso(from) : undefined, to: to ? isoEnd(to) : undefined, audit_action:action||undefined, limit:limit+1, offset:page*limit }, [tenant, from, to, action, page]);
  const rows=(data??[]).filter((a)=>!(a.action==='impersonation.action'&&!PLATFORM_MUTATIONS.has(String(a.payload?.action??''))));
  const visibleRows=rows.slice(0,limit); const hasNext=(data?.length??0)>limit;
  return (<>
    <div className="row wrap">
      <select className="field" value={tenant} onChange={(e) => setTenant(e.target.value)}><option value="">Все организации</option>{tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.slug}</option>)}</select>
      <select className="field" value={action} onChange={(e)=>setAction(e.target.value)} aria-label="Тип действия"><option value="">Все действия</option>{Object.keys(PLATFORM_ACTION_LABELS).map((key)=><option key={key} value={key}>{platformActionLabel(key)}</option>)}</select>
      <input className="field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="С даты" /><input className="field" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="По дату" /></div>
    <State err={err} loading={loading && !data} />
    {data && (visibleRows.length===0?<p className="muted">Записей по выбранным условиям нет.</p>:<Table head={['Когда','Кто','Что произошло','Организация','Подробности']}>{visibleRows.map((a)=><tr key={a.id}><td>{fmtDateTime(a.created_at)}</td><td>{a.actor_email??'—'}</td><td>{platformActionLabel(String(a.action))}</td><td>{a.slug??'—'}</td><td className="muted small">{platformAuditDetail(String(a.action),a.payload??{})}</td></tr>)}</Table>)}
    {data&&(visibleRows.length>0||page>0)&&<nav className="admin-service-pagination" aria-label="Журнал платформы"><button className="admin-page-button" disabled={page===0||loading} onClick={()=>setPage(page-1)}>Назад</button><span className="muted small">Страница <b>{page+1}</b></span><button className="admin-page-button" disabled={!hasNext||loading} onClick={()=>setPage(page+1)}>Далее</button></nav>}</>);
}

const PLATFORM_MUTATIONS=new Set(['owner_set_status','staff_set_status','owner_cancel','owner_erase_customer','owner_reschedule','owner_create_booking','owner_block','owner_add_payment','owner_upsert_service','owner_delete_service','owner_upsert_resource','owner_delete_resource','owner_update_notification_settings','owner_update_config','owner_update_legal','owner_telegram_unlink','owner_waitlist_status','owner_upsert_promo','owner_delete_promo','owner_publish_review','owner_respond_price_change']);
const PLATFORM_ACTION_LABELS:Record<string,string>={
  'impersonation.start':'Начал работу в кабинете организации','impersonation.end':'Завершил работу в кабинете организации','impersonation.expired':'Завершилось время доступа к кабинету','impersonation.action':'Изменил данные в кабинете организации',
  'admin.add':'Добавил администратора','admin.role_update':'Изменил роль администратора','admin.disable':'Отключил администратора','admin.mfa_reset':'Сбросил MFA администратора','admin.owner_recovery':'Восстановил доступ владельцу платформы',
  'owner.resend_invite':'Повторно отправил приглашение владельцу','tenant.create':'Создал организацию','plan.upsert':'Изменил тариф','settings.update':'Изменил настройки платформы',
  'subscription.create':'Подключил тариф организации','subscription.extend':'Продлил подписку','subscription.change_plan':'Изменил тариф организации','subscription.set_dates':'Изменил даты подписки','subscription.suspend':'Приостановил подписку','subscription.resume':'Возобновил подписку','subscription.cancel':'Отменил подписку',
  'payment.create':'Добавил платёж','payment.confirm':'Подтвердил оплату','payment.refund':'Оформил возврат','payment.fail':'Отметил платёж как неуспешный',
  'price_change.accepted':'Организация согласилась с новой ценой','price_change.declined':'Организация отклонила новую цену','platform.bootstrap':'Назначил первого администратора платформы','tenant.export':'Выгрузил данные организации'
};
function platformActionLabel(action:string){return PLATFORM_ACTION_LABELS[action]??'Выполнил действие в платформе'}
function platformAuditDetail(action:string,payload:Row){
  if(action==='impersonation.start')return `Причина: ${String(payload.reason??'не указана')}${payload.owner_email?` · кабинет владельца ${String(payload.owner_email)}`:''}`;
  if(action==='impersonation.action'){const names:Record<string,string>={owner_set_status:'Изменил статус записи',owner_cancel:'Отменил запись',owner_erase_customer:'Удалил данные клиента',owner_reschedule:'Перенёс запись',owner_create_booking:'Создал запись',owner_block:'Закрыл время для записи',owner_add_payment:'Добавил оплату',owner_upsert_service:'Изменил услугу',owner_delete_service:'Удалил услугу',owner_upsert_resource:'Изменил мастера или пост',owner_delete_resource:'Удалил мастера или пост',owner_update_notification_settings:'Изменил настройки уведомлений',owner_update_config:'Изменил настройки организации',owner_update_legal:'Изменил реквизиты',owner_telegram_unlink:'Отключил Telegram',owner_waitlist_status:'Изменил статус листа ожидания',owner_upsert_promo:'Изменил промокод',owner_delete_promo:'Удалил промокод',owner_publish_review:'Изменил видимость отзыва'};return `${names[String(payload.action)]??'Изменил данные'} · ${payload.succeeded===true?'успешно':'не выполнено'}`}
  if(action.startsWith('subscription.')){const data=payload.data??{};const parts:string[]=[];if(payload.plan)parts.push(`тариф: ${String(payload.plan)}`);if(data.plan_code)parts.push(`тариф: ${String(data.plan_code)}`);if(data.months)parts.push(`продление на ${Number(data.months)} мес.`);if(data.days)parts.push(`продление на ${Number(data.days)} дн.`);if(data.starts_at)parts.push(`начало: ${fmtDate(String(data.starts_at))}`);if(data.ends_at)parts.push(`окончание: ${fmtDate(String(data.ends_at))}`);if(data.reason)parts.push(`причина: ${String(data.reason)}`);if(action==='subscription.resume')parts.push(data.force===true?'возобновлена вручную':'по подтверждённой оплате');return parts.join(' · ')||'Изменены условия подписки'}
  if(action==='tenant.create')return `Организация: ${String(payload.slug??'—')} · владелец: ${String(payload.owner_email??'—')} · тариф: ${String(payload.plan??'—')}`;
  if(action==='payment.create'||action==='payment.confirm')return `${Number(payload.amount_kzt??0).toLocaleString('ru-RU')} ₸`;
  if(action==='payment.refund'||action==='payment.fail')return String(payload.reason??'Причина не указана');
  if(action==='settings.update')return `${payload.key==='trial_days'?'Пробный период':payload.key==='grace_days'?'Период ожидания оплаты':String(payload.key??'Настройка')}: ${String(payload.value??'изменено')}${payload.key==='trial_days'||payload.key==='grace_days'?' дн.':''}`;
  if(action.startsWith('price_change.'))return `${Number(payload.old_price??0).toLocaleString('ru-RU')} ₸ → ${Number(payload.new_price??0).toLocaleString('ru-RU')} ₸`;
  if(action==='admin.owner_recovery')return `Восстановлен доступ: ${String(payload.email??'владелец платформы')}`;
  if(action.startsWith('admin.')){const target=payload.target_email?`Администратор: ${String(payload.target_email)} · `:'';if(action==='admin.add'||action==='admin.role_update')return `${target}роль: ${PLATFORM_ROLE_LABEL[String(payload.role)]??String(payload.role??'—')}${payload.invite_sent===true?' · приглашение отправлено':''}`;if(action==='admin.mfa_reset')return `${target}сброшено способов MFA: ${Number(payload.factors_removed??0)}`;return `${target}доступ отключён`}
  if(action==='tenant.export'){const counts=payload.counts??{};return `Выгружены данные · записей: ${Number(counts.bookings??0)}, услуг: ${Number(counts.services??0)}`}
  if(action==='plan.upsert'){const d=payload.data??{};return `${String(d.name??'Тариф')} · ${Number(d.price_kzt??0).toLocaleString('ru-RU')} ₸ за ${Number(d.period_months??1)} мес. · ${d.is_active===false?'выключен':'активен'}`}
  if(action==='owner.resend_invite')return `Приглашение отправлено на ${String(payload.email??'адрес владельца')}`;
  if(action==='impersonation.end'||action==='impersonation.expired')return 'Служебный сеанс завершён';
  return 'Изменения сохранены';
}

function PlatformNotifications() {
  const {data,err,loading,reload}=useLoad<Row[]>('notifications',{limit:200});
  const notices=data??[];
  const marked=useRef(new Set<string>());
  useEffect(()=>{const ids=notices.filter(n=>!n.is_read&&!marked.current.has(String(n.id))).map(n=>String(n.id));if(ids.length){ids.forEach(id=>marked.current.add(id));void call('notifications_read',{ids}).then(()=>reload()).catch(()=>ids.forEach(id=>marked.current.delete(id))) }},[notices,reload]);
  const title=(action:string)=>action==='price_change.accepted'?'Организация приняла новые условия':action==='price_change.declined'?'Организация отказалась от новой цены':'Изменение цены подписки';
  return <div className="pf-notifications"><div className="pf-panel-heading"><div><span className="pf-kicker">SERVIO</span><h2>Уведомления</h2></div><button className="pf-action-secondary" onClick={()=>void reload()} disabled={loading}>{loading?'Обновляем…':'Обновить'}</button></div><State err={err} loading={loading&&!data}/>{notices.length===0&&!loading?<p className="muted">Событий по изменению цен нет.</p>:notices.map((n)=><article className="card pf-notice" key={n.id}><div className="row between wrap"><b>{title(String(n.action))}</b><span className={`pf-notice-status${n.is_read?'':' unread'}`}>{n.is_read?'Прочитано':'Новое'}</span><time className="muted small">{fmtDateTime(n.created_at)}</time></div><p>{n.slug??'Организация'} · {n.payload?.old_price??'—'} ₸ → {n.payload?.new_price??'—'} ₸</p><p className="muted small">Новые условия вступают в силу: {fmtDateTime(n.payload?.effective_at)}</p></article>)}</div>
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
