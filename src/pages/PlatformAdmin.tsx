import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { recoveryLink, supabase } from '../lib/supabase';
import { PasswordInput } from '../components/PasswordInput';
import { RecoveryPassword } from '../components/RecoveryPassword';
import { Toaster, notify } from '../components/Toaster';
import '../styles.css';
import './platform.css';

// Админка платформы. Все данные приходят из Edge Function platform-admin, которая на сервере
// проверяет JWT, запись в platform_admins и (если включено) MFA. Проверки здесь — только удобство интерфейса.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const ERR: Record<string, string> = {
  last_owner: 'Нельзя удалить последнего владельца платформы.',
  forbidden: 'Нет доступа к этому разделу.', unauthorized: 'Срок входа истёк. Войдите ещё раз.', mfa_required: 'Подтвердите вход кодом из приложения.', rate_limited: 'Слишком много запросов. Попробуйте чуть позже.',
  slug_taken: 'Этот адрес организации уже занят.', bad_slug: 'Укажите адрес латинскими буквами, цифрами и дефисом.', bad_name: 'Название должно содержать от 2 до 80 символов.', bad_request: 'Проверьте заполненные поля.',
  bad_timezone: 'Неизвестный часовой пояс.', plan_not_found: 'Тариф не найден или выключен.', subscription_exists: 'У организации уже есть действующая подписка.',
  no_paid_payment: 'Нет подтверждённого платежа. Подтвердите платёж или возобновите без оплаты.', bad_status: 'Действие недоступно в текущем статусе.',
  unlimited_subscription: 'Бессрочная подписка не продлевается.', bad_duration: 'Проверьте длительность.', bad_dates: 'Проверьте даты.',
  reason_required: 'Укажите причину (от 3 символов).', owner_create_failed: 'Не удалось создать владельца.', operation_failed: 'Операция не выполнена.',
  temporarily_unavailable: 'Сервис временно недоступен.', idempotency_conflict: 'Ключ операции уже использован для другой организации.',
  invite_rate_limited: 'Почтовый сервис ограничил отправку. Подождите немного и попробуйте ещё раз.', invite_redirect_not_allowed: 'Ссылка приглашения не разрешена настройками Supabase Auth. Добавьте адрес страницы владельца в Redirect URLs.', invite_email_provider_error: 'Почтовый провайдер Supabase отклонил письмо. Проверьте SMTP и разрешённый адрес отправителя.', invite_email_failed: 'Supabase не смог отправить письмо. Проверьте настройки почты и повторите попытку.',
  bad_limits: 'Проверьте значения лимитов тарифов.', bad_features: 'Проверьте доступ к функциям тарифа.',
  trial_already_used: 'Пробный период уже использовался для этого email, телефона или БИН/ИИН.', trial_identity_required:'Для пробного периода укажите email владельца.',
  deletion_requested: 'Удаление уже запрошено.',
  plan_limit_employees: 'Достигнут лимит сотрудников по тарифу.', plan_limit_services: 'Достигнут лимит услуг по тарифу. Для начального набора выберите тариф с большим лимитом.', plan_limit_bookings_per_month: 'Достигнут месячный лимит записей.',
};
const errText = (e: unknown) => { const m = (e as Error)?.message ?? ''; return ERR[m] ?? 'Ошибка: ' + (m || 'неизвестно'); };

async function call<T = Row>(action: string, body: Row = {}): Promise<T> {
  const response=await fetch('/api/platform?action=invoke',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,body})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error)throw new Error(String(data?.error??('request_failed_'+response.status)));
  return (data&&'data' in data?data.data:data) as T;
}
async function platformAuth(action:string,body:Row={}){const isGet=action==='session'||action==='factors';const response=await fetch('/api/platform?action='+action,{method:isGet?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:isGet?undefined:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(String(data?.error??'request_failed'));return data}
async function platformFile(action:string,body:Row){const response=await fetch('/api/platform?action='+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(String(data?.error??'request_failed'))}return response.blob()}

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
  const [recovery, setRecovery] = useState(recoveryLink.active || recoveryLink.failed);

  const check = useCallback(async () => {
    try {
      let me = await platformAuth('session');
      if(!me.user){
        const legacy=(await supabase.auth.getSession()).data.session;
        if(!legacy){setStep('login');return}
        try{await platformAuth('migrate',{access_token:legacy.access_token,refresh_token:legacy.refresh_token});await supabase.auth.signOut({scope:'local'});me=await platformAuth('session')}catch{await supabase.auth.signOut({scope:'local'});setStep('login');return}
      }
      if(!me.authorized){try{await call('bootstrap');void check();return}catch{setStep('denied');return}}
      setRole(String(me.role ?? 'read_only'));
      setAccountEmail(String(me.user.email ?? ''));
      if(me.mfa_required){const factors=await platformAuth('factors');if((factors?.factors?.totp??factors?.totp??[]).length){setStep('mfa');return}setStep('enroll');return}
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
  useEffect(() => { if (!recovery) void check(); }, [check, recovery]);

  if (recovery) {
    return <RecoveryPassword failed={!recoveryLink.active} signIn={(email, password) => platformAuth('login', { email, password })} onDone={() => {
      recoveryLink.active = false; recoveryLink.failed = false;
      window.history.replaceState(null, '', window.location.pathname);
      setStep('loading'); setRecovery(false);
    }} />;
  }

  if (step === 'loading') return <main className="page"><p className="muted">Загрузка…</p></main>;
  if (step === 'denied') return (
    <main className="page"><section className="card col"><h1>403</h1><p className="muted">У этого аккаунта нет доступа к платформе.</p>
      <button className="btn ghost" onClick={async () => { await platformAuth('logout'); setStep('login'); }}>Выйти</button></section></main>);
  if (step === 'login') return <Login msg={msg} onDone={check} />;
  if (step === 'mfa') return <MfaVerify onDone={check} />;
  if (step === 'enroll') return <MfaEnroll onDone={check} />;
  return <><Toaster /><Console role={role} accountEmail={accountEmail} onLogout={async () => { await platformAuth('logout'); setStep('login'); }} onMfa={() => setStep('mfa')} /></>;
}

async function resendInvite(email: string, slug: string) {
  try {
    await call('resend_invite', { email, slug });
    notify(`Приглашение отправлено на ${email}. Письмо приходит в течение минуты, проверьте также папку «Спам».`, 'ok');
  } catch (e) {
    notify(`Не удалось отправить приглашение на ${email}. ${errText(e)}`, 'err');
    throw e;
  }
}

function Login({ msg, onDone }: { msg: string; onDone: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(msg); const [busy, setBusy] = useState(false); const [info, setInfo] = useState('');
  const forgot = async () => {
    setErr(''); setInfo('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Введите свой email в поле выше, и мы отправим ссылку для нового пароля.'); return; }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/platform/admin` });
      if (error && /rate|seconds|limit/i.test(error.message)) setErr('Слишком часто. Подождите минуту и повторите.');
      else setInfo('Если такой аккаунт есть, мы отправили на почту ссылку для установки пароля. Проверьте входящие и папку «Спам».');
    } catch { setErr('Не удалось отправить письмо. Проверьте соединение и повторите.'); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try{await platformAuth('login',{email:email.trim(),password})}catch{setBusy(false);setErr('Неверный email или пароль.');return}
    setBusy(false);
    onDone();
  };
  return (
    <main className="page pf-login-page"><form className="card col pf-narrow" onSubmit={submit}><div className="pf-login-brand"><span className="pf-brand-mark">S</span><span><b>Servio</b><small>Команда платформы</small></span></div><h1>Вход для команды</h1><p className="muted small">Здесь можно управлять организациями, оплатой и обращениями.</p>
      <input className="field" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <PasswordInput className="field" autoComplete="current-password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {err && <p className="err">{err}</p>}{info && <p className="muted small" role="status">{info}</p>}
      <button className="btn" disabled={busy}>Войти</button>
      <button type="button" className="link forgot-link" onClick={() => void forgot()}>Забыли пароль?</button></form></main>);
}

function MfaVerify({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    const factors = await platformAuth('factors');
    const factor = factors?.factors?.totp?.[0]??factors?.totp?.[0];
    if (!factor) { setErr('Не удалось найти подтверждение для этого аккаунта.'); return; }
    try{await platformAuth('mfa_verify',{factor_id:factor.id,code:code.trim()});onDone()}catch{setErr('Неверный код.')}
  };
  return (
    <main className="page pf-login-page"><form className="card col pf-narrow" onSubmit={submit}><div className="pf-login-brand"><span className="pf-brand-mark">S</span><span><b>Servio</b><small>Google Authenticator</small></span></div><h1>Подтвердите вход</h1><p className="muted small">Откройте Google Authenticator и введите шестизначный код для сервиса Servio.</p>
      <input className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 цифр" value={code} onChange={(e) => setCode(e.target.value)} required />
      {err && <p className="err">{err}</p>}<button className="btn">Подтвердить</button></form></main>);
}

function MfaEnroll({ onDone }: { onDone: () => void }) {
  const [info, setInfo] = useState<{ id: string; qr: string; secret: string } | null>(null); const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const start = async () => {
    try{const data=await platformAuth('mfa_enroll',{friendly_name:'servio-'+Date.now()});setInfo({id:data.id,qr:data.totp.qr_code,secret:data.totp.secret})}catch{setErr('Не удалось начать настройку MFA.')}
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault(); if (!info) return; setErr('');
    try{await platformAuth('mfa_verify',{factor_id:info.id,code:code.trim()});onDone()}catch{setErr('Неверный код.')}
  };
  return (
    <main className="page pf-login-page"><section className="card col pf-narrow"><div className="pf-login-brand"><span className="pf-brand-mark">S</span><span><b>Servio</b><small>Защищённый вход</small></span></div><h1>Защитите аккаунт</h1>
      <p className="muted">Чтобы защитить аккаунт, подключите приложение для кодов входа, например Google Authenticator или 1Password.</p>
      {!info ? <button className="btn" onClick={start}>Настроить</button> : (
        <form className="col" onSubmit={verify}><img src={info.qr} alt="QR-код для приложения-аутентификатора" width={200} height={200} />
          <p className="muted small">Или введите ключ вручную: <code>{info.secret}</code></p>
          <input className="field" inputMode="numeric" maxLength={6} placeholder="Код из приложения" value={code} onChange={(e) => setCode(e.target.value)} required />
          <button className="btn">Подтвердить</button></form>)}
      {err && <p className="err">{err}</p>}</section></main>);
}

/* ----------------------------------------------------------------------------------- каркас */
const TABS = ['Главная', 'Организации', 'Поддержка', 'Заявки с сайта', 'Новая организация', 'Подписки', 'Тарифы', 'Платежи', 'Документы', 'Объявления и статус', 'Уведомления', 'Журнал', 'Администраторы', 'Настройки'] as const;
type Tab = (typeof TABS)[number];

const PLATFORM_ROLE_LABEL: Record<string, string> = { owner: 'Владелец', support: 'Поддержка', finance: 'Финансы', read_only: 'Только чтение' };
function Console({ onLogout, role, accountEmail }: { onLogout: () => void; onMfa: () => void; role: string; accountEmail: string }) {
  const [tab, setTab] = useState<Tab>(role === 'support' ? 'Поддержка' : 'Главная');
  const [openTenant, setOpenTenant] = useState<string | null>(null);
  const [leadPrefill, setLeadPrefill] = useState<LeadPrefill | null>(null);
  const platformNotices=useLoad<Row[]>('notifications',{limit:200})
  // A new response is surfaced even when the administrator stays on another section.
  useEffect(()=>{const timer=window.setInterval(()=>void platformNotices.reload(),30_000);return()=>window.clearInterval(timer)},[platformNotices.reload])
  const visibleTabs = TABS.filter((t) => {
    if (role === 'owner') return true;
    if (t === 'Поддержка') return role === 'support';
    if (t === 'Заявки с сайта') return role === 'support' || role === 'owner';
    if(t==='Объявления и статус')return false;
    if (t === 'Администраторы') return false;
    if (t === 'Новая организация' || t === 'Настройки') return false;
    if (role === 'finance') return !['Организации','Уведомления','Администраторы','Настройки'].includes(t);
    if (role === 'read_only') return !['Уведомления','Документы'].includes(t);
    return !['Главная','Подписки','Тарифы','Платежи','Настройки'].includes(t);
  });
  useEffect(() => { if (!visibleTabs.includes(tab)) setTab(role === 'support' ? 'Поддержка' : 'Главная'); }, [role]);
  return (
    <main className="page pf-wide">
      <header className="pf-app-header"><div className="pf-brand"><span className="pf-brand-mark">S</span><div><b>Servio</b><span>Platform console</span></div></div><div className="pf-header-actions"><span className="pf-header-user">{PLATFORM_ROLE_LABEL[role] ?? 'Нет доступа'}{accountEmail && <><br/><small>{accountEmail}</small></>}</span><button className="pf-logout" onClick={onLogout}>Выйти</button></div></header>
      <div className="pf-console-layout"><nav className="pf-tabs" aria-label="Разделы платформы">{visibleTabs.map((t) => <button key={t} className={tab === t && !openTenant ? 'is-current' : ''} onClick={() => { setOpenTenant(null); setTab(t); if(t==='Уведомления'){const ids=platformNotices.data?.filter(x=>!x.is_read).map(x=>String(x.id))??[];if(ids.length)void call('notifications_read',{ids}).then(()=>platformNotices.reload())} }}>{t}{t==='Уведомления'&&platformNotices.data?.some(x=>!x.is_read)&&<i className="admin-unread-dot" aria-label="Есть непрочитанные уведомления"/>}</button>)}</nav>
      <section className="pf-console-content">{openTenant ? <TenantCard id={openTenant} role={role} onBack={() => setOpenTenant(null)} />
        : tab === 'Главная' ? <Dashboard onOpen={setOpenTenant} onNavigate={setTab} />
        : tab === 'Организации' ? <Tenants onOpen={setOpenTenant} />
        : tab === 'Поддержка' ? <SupportQueue />
        : tab === 'Заявки с сайта' ? <BusinessLeads canConnect={role === 'owner'} onConnect={(lead) => { setLeadPrefill(lead); setTab('Новая организация'); }} />
        : tab === 'Новая организация' ? <CreateTenant key={leadPrefill?.id ?? 'new'} prefill={leadPrefill} onCreated={(id) => { setLeadPrefill(null); setOpenTenant(id); }} />
        : tab === 'Подписки' ? <Subscriptions onOpen={setOpenTenant} />
        : tab === 'Тарифы' ? <Plans />
        : tab === 'Платежи' ? <Payments />
        : tab === 'Документы' ? <BillingDocuments />
        : tab === 'Объявления и статус' ? <PlatformServiceAdmin />
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
function useAllTenants() {
  const [data,setData]=useState<Row[]|null>(null); const [err,setErr]=useState(''); const [loading,setLoading]=useState(true);
  useEffect(()=>{let live=true;setLoading(true);void (async()=>{try{const all:Row[]=[];for(let offset=0;offset<100000;offset+=200){const page=await call<Row[]>('tenants',{limit:200,offset});all.push(...page);if(page.length<200)break}if(live)setData(all)}catch(e){if(live)setErr(errText(e))}finally{if(live)setLoading(false)}})();return()=>{live=false}},[]);
  return {data,err,loading};
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
    ['Доход за месяц', kzt(d.mrr_kzt), 'Регулярные платежи по подпискам'],
    ['Доход за год', kzt(d.arr_kzt), 'Расчёт по текущим подпискам'],
    ['Отмены за месяц', `${Number(d.churn_rate_pct ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`, `Организаций отменили подписку: ${d.churned_this_month ?? 0}`],
    ['Выбрали тариф после пробного', `${Number(d.trial_conversion_pct ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`, 'Доля организаций, которые продолжили работу'],
    ['В среднем на организацию', kzt(d.arpu_kzt), 'Средний ежемесячный платёж'],
    ['Выручка за месяц', kzt(d.revenue_month_kzt), 'Подтверждённые платежи'],
  ];
  return (<>
    <div className="pf-dashboard-heading">
      <div><span className="pf-kicker">ОБЗОР ПЛАТФОРМЫ</span><h2>Рабочий день начинается здесь</h2><p className="muted">Все важные данные об организациях, оплате и обращениях собраны на одной странице.</p></div>
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
function SubscriptionActionModal({type,subscription,initialPlan='START',initialDate='',onClose,onSubmit}:{type:string;subscription:Row;initialPlan?:string;initialDate?:string;onClose:()=>void;onSubmit:(data:Row)=>Promise<void>}){
  const [reason,setReason]=useState('');const [plan,setPlan]=useState(initialPlan);const [date,setDate]=useState(initialDate);const [busy,setBusy]=useState(false);
  const title=type==='suspend'?'Приостановить подписку':type==='cancel'?'Отменить подписку':type==='change_plan'?'Сменить тариф':'Изменить дату окончания';
  const submit=async(e:FormEvent)=>{e.preventDefault();if(['suspend','cancel'].includes(type)&&reason.trim().length<3)return;if(type==='set_dates'&&!date)return;setBusy(true);try{await onSubmit(type==='suspend'||type==='cancel'?{reason:reason.trim()}:type==='change_plan'?{plan_code:plan}:{ends_at:iso(date)})}finally{setBusy(false)}};
  return <div className="pf-modal-backdrop"><form className="pf-modal card col" role="dialog" aria-modal="true" onSubmit={e=>void submit(e)}><h2>{title}</h2><p className="muted small">{subscription.name??subscription.slug??'Организация'} · {subscription.plan_code??''}</p>{type==='change_plan'?<label className="pf-label">Тариф<select className="field" value={plan} onChange={e=>setPlan(e.target.value)}><option>START</option><option>PRO</option><option>LEGACY</option></select></label>:type==='set_dates'?<label className="pf-label">Дата окончания<input className="field" type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>:<label className="pf-label">Причина<textarea className="field" rows={3} maxLength={500} minLength={3} value={reason} onChange={e=>setReason(e.target.value)} required/></label>}<div className="row wrap"><button className="pf-action-primary" disabled={busy}>{busy?'Сохраняем…':'Подтвердить'}</button><button type="button" className="pf-action-secondary" onClick={onClose}>Отмена</button></div></form></div>
}
async function resumeFlow(sub: string): Promise<boolean> {
  try { await runSubAction(sub, 'resume'); return true; }
  catch (e) {
    if ((e as Error).message === 'no_paid_payment' && window.confirm('Нет подтверждённого платежа. Возобновить на один период без оплаты?')) { await runSubAction(sub, 'resume', { force: true }); return true; }
    throw e;
  }
}
async function suspendFlow(sub:string):Promise<void>{const reason=window.prompt('Причина приостановки (обязательно):');if(!reason?.trim())return;if(!window.confirm('Подтвердить приостановку подписки?'))return;await runSubAction(sub,'suspend',{reason:reason.trim()})}

function Tenants({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState(''); const [phase, setPhase] = useState(''); const [plan, setPlan] = useState(''); const [applied, setApplied] = useState({ search: '', phase: '', plan: '' });
  const [savedFilters,setSavedFilters]=useState<Record<string,{search:string;phase:string;plan:string}>>(()=>{try{return JSON.parse(localStorage.getItem('platform-tenant-filters')||'{}')}catch{return {}}});
  const [page,setPage]=useState(0); const pageSize=50;
  useEffect(()=>setPage(0),[applied]);
  const { data, err, loading, reload } = useLoad<Row[]>('tenants', { search: applied.search, phase: applied.phase, plan: applied.plan, limit:pageSize+1, offset:page*pageSize }, [applied,page]);
  const rows=(data??[]).slice(0,pageSize); const hasNext=(data?.length??0)>pageSize;
  const [msg, setMsg] = useState('');
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  const saveFilter=()=>{const name=window.prompt('Название сохранённого фильтра');if(!name?.trim())return;const next={...savedFilters,[name.trim()]:{search,phase,plan}};setSavedFilters(next);localStorage.setItem('platform-tenant-filters',JSON.stringify(next))};
  const exportCsv=async()=>{try{const all:Row[]=[];for(let offset=0;offset<100000;offset+=200){const batch=await call<Row[]>('tenants',{...applied,limit:200,offset});all.push(...batch);if(batch.length<200)break}const quote=(x:unknown)=>'"'+String(x??'').replace(/[\r\n]+/g,' ').replace(/"/g,'""')+'"';const csv=['Организация,Адрес страницы,Владелец,Тариф,Статус,Окончание',...all.map(r=>[r.name,r.slug,r.owner_email,r.plan_code,r.phase,r.ends_at].map(quote).join(','))].join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));a.download='organizations.csv';a.click();URL.revokeObjectURL(a.href)}catch(e){setMsg(errText(e))}};
  return (<>
    <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setApplied({ search, phase, plan }); }}>
      <input className="field" placeholder="Название, адрес страницы или почта владельца" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select className="field" value={phase} onChange={(e) => setPhase(e.target.value)}><option value="">Все статусы</option>{Object.entries(PHASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select className="field" value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">Все тарифы</option><option>START</option><option>PRO</option><option>LEGACY</option></select>
      <button className="btn inline">Найти</button><button type="button" className="pf-action-secondary" onClick={saveFilter}>Сохранить условия поиска</button><button type="button" className="pf-action-secondary" onClick={()=>void exportCsv()}>Скачать таблицу Excel</button></form>
    {Object.keys(savedFilters).length>0&&<label className="pf-label">Сохранённые фильтры<select className="field" value="" onChange={e=>{const v=savedFilters[e.target.value];if(v){setSearch(v.search);setPhase(v.phase);setPlan(v.plan);setApplied(v)}}}><option value="">Выбрать…</option>{Object.keys(savedFilters).map(n=><option key={n}>{n}</option>)}</select></label>}
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Организация', 'Владелец', 'Тариф', 'Статус', 'До', 'Действия']}>{rows.map((r) => (
      <tr key={r.id}><td><button className="pf-link" onClick={() => onOpen(r.id)}>{r.name ?? r.slug}</button><br /><span className="muted small">{r.slug}</span></td>
        <td>{r.owner_email ?? '—'}</td><td>{r.plan_code ?? '—'}</td><td><Badge phase={r.phase} /></td><td>{r.ends_at ? fmtDate(r.ends_at) : 'бессрочно'}</td>
        <td className="pf-actions">
          <a href={`/s/${r.slug}/`} target="_blank" rel="noreferrer">Сайт</a>
          {r.owner_email && <button onClick={() => act(() => resendInvite(r.owner_email, r.slug))}>Приглашение</button>}
          {r.subscription_id && ['suspended', 'expired'].includes(r.phase) && <button onClick={() => act(() => resumeFlow(r.subscription_id))}>Возобновить</button>}
        </td></tr>))}</Table>}
    {data&&(rows.length>0||page>0)&&<nav className="admin-service-pagination" aria-label="Организации"><button className="admin-page-button" disabled={page===0||loading} onClick={()=>setPage(page-1)}>Назад</button><span className="muted small">Страница <b>{page+1}</b></span><button className="admin-page-button" disabled={!hasNext||loading} onClick={()=>setPage(page+1)}>Далее</button></nav>}
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
  const featureFields:[string,string][]=[['telegram','Уведомления в Telegram'],['export','Скачивание копии данных'],['reviews','Отзывы клиентов']];
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

function TenantSupportPanel({tenantId}:{tenantId:string}){
  const {data,err,loading,reload}=useLoad<Row>('tenant_support',{tenant_id:tenantId},[tenantId]);
  const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
  const submit=async(action:string,body:Row)=>{setBusy(true);setMsg('');try{await call(action,{tenant_id:tenantId,...body});await reload();return true}catch(e){setMsg(errText(e));return false}finally{setBusy(false)}};
  return <section className="card col"><div><h3>Внутренние заметки</h3><p className="muted small">Заметки видны только платформенным администраторам. Тикеты находятся в отдельной вкладке «Поддержка».</p></div>
    <State err={err} loading={loading}/>
    <div className="col"><h4>Добавить заметку</h4><textarea className="field" rows={3} maxLength={3000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Внутренняя заметка для команды Servio"/><button className="btn" disabled={busy||!note.trim()} onClick={async()=>{if(await submit('tenant_note_add',{body:note.trim()}))setNote('')}}>{busy?'Сохраняем…':'Сохранить заметку'}</button>
      <div className="pf-support-list">{(data?.notes??[]).map((item:Row)=><article className="pf-event" key={item.id}><div className="row between wrap"><b>{item.created_by_email}</b><time className="muted small">{fmtDateTime(item.created_at)}</time></div><p>{item.body}</p></article>)}{data&&!data.notes?.length&&<p className="muted small">Заметок пока нет.</p>}</div>
    </div>{msg&&<p className="err" role="status">{msg}</p>}
  </section>
}

function TenantCard({ id, role, onBack }: { id: string; role: string; onBack: () => void }) {
  const { data: d, err, loading, reload } = useLoad<Row>('tenant', { tenant_id: id });
  const [eventPage,setEventPage]=useState(0);
  const events=useLoad<Row>('tenant_events',{tenant_id:id,limit:50,offset:eventPage*50},[id,eventPage]);
  useEffect(()=>setEventPage(0),[id]);
  const [msg, setMsg] = useState(''); const [reason,setReason]=useState(''); const [impBusy,setImpBusy]=useState(false);
  const [lifeReason,setLifeReason]=useState('');
  const [subModal,setSubModal]=useState<{type:string;subscription:Row}|null>(null);
  if (!d) return <><button className="back" onClick={onBack}>← Назад</button><State err={err} loading={loading} /></>;
  const t = d.tenant as Row; const subs: Row[] = d.subscriptions; const cur = subs.find((s) => ['trial', 'active', 'grace', 'suspended'].includes(s.status)) ?? subs[0];
  const exportData = async () => {
    setMsg('');
    try{const data=await platformFile('export',{tenant_id:id});const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = `${t.slug}-export.zip`; a.click(); URL.revokeObjectURL(a.href)}catch{setMsg('Не удалось выгрузить данные.')}
  };
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  const startImpersonation = async (e: FormEvent) => {
    e.preventDefault(); setMsg(''); setImpBusy(true);
    try {
      const response = await fetch('/api/platform?action=impersonate_start',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant_id:id,reason:reason.trim()})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(String(payload.error??'operation_failed'));
      window.location.assign(`/s/${payload.tenant_slug}/owner`);
    } catch(e2) { setMsg(errText(e2)); } finally { setImpBusy(false); }
  };
  return (<>
    <button className="back" onClick={onBack}>← Назад</button>
    {subModal&&<SubscriptionActionModal type={subModal.type} subscription={subModal.subscription} initialPlan={cur?.plan_code??'START'} initialDate={cur?.ends_at?.slice(0,10)??''} onClose={()=>setSubModal(null)} onSubmit={async values=>{await act(()=>runSubAction(subModal.subscription.id,subModal.type,values));setSubModal(null)}}/>}
    <section className="card pf-org">
      <div className="pf-org__head">
        <div className="pf-org__avatar" aria-hidden="true">{String(t.config?.name ?? t.slug).trim().charAt(0).toUpperCase()}</div>
        <div className="pf-org__title">
          <h2>{t.config?.name ?? t.slug}</h2>
          <div className="pf-org__chips">
            {cur && <Badge phase={cur.phase} />}
            {cur?.plan_code && <span className="pf-chip">Тариф {cur.plan_code}</span>}
            <span className="pf-chip">/s/{t.slug}</span>
            <span className="pf-chip">{t.timezone}</span>
            <span className="pf-chip">Создана {fmtDate(t.created_at)}</span>
            <span className="pf-chip">Доступ: {d.access_state}</span>
          </div>
          {t.owner_email && <p className="pf-org__owner">Владелец: <b>{t.owner_email}</b></p>}
          {t.archived_at && <p className="err small">В архиве с {fmtDate(t.archived_at)}{t.deletion_requested_at ? ` · удаление запрошено, хранение до ${fmtDate(new Date(new Date(t.deletion_requested_at).getTime()+30*86400000).toISOString())}` : ''}</p>}
        </div>
      </div>
      <div className="pf-org__stats">
        <div className="pf-stat"><b>{d.counters.staff}</b><span>Сотрудники</span></div>
        <div className="pf-stat"><b>{d.counters.services}</b><span>Услуги</span></div>
        <div className="pf-stat"><b>{d.counters.bookings_30d}</b><span>Записи за 30 дней</span></div>
      </div>
      <div className="pf-org__actions">
        <a className="pf-action-secondary" href={`/s/${t.slug}/`} target="_blank" rel="noreferrer">Публичная страница</a>
        {t.owner_email && <button className="pf-action-secondary" onClick={()=>void act(()=>resendInvite(t.owner_email, t.slug))}>Отправить приглашение владельцу</button>}
        <button className="pf-action-secondary" onClick={exportData}>Экспорт данных</button>
      </div>
      {msg && <p className="err">{msg}</p>}
      {role==='owner' && <div className="pf-zone pf-zone--danger">
        <h3>Архив и удаление</h3>
        <p className="muted small">Действия записываются в журнал. Удаление не стирает данные сразу: они хранятся 30 дней.</p>
        <label className="pf-label">Причина<input className="field" minLength={5} maxLength={500} value={lifeReason} onChange={e=>setLifeReason(e.target.value)} placeholder="Обязательная причина (не менее 5 символов)"/></label>
        <div className="pf-zone__row">
          <button className="pf-action-secondary" disabled={lifeReason.trim().length<5} onClick={()=>void act(()=>call('tenant_lifecycle',{tenant_id:id,lifecycle_action:t.archived_at?'restore':'archive',reason:lifeReason.trim()}))}>{t.archived_at?'Восстановить':'В архив'}</button>
          <button className="pf-danger-btn" disabled={lifeReason.trim().length<5||!!t.deletion_requested_at} onClick={()=>{if(window.confirm('Удаление будет запрошено с 30-дневным сроком хранения. Данные сейчас не стираются. Продолжить?'))void act(()=>call('tenant_lifecycle',{tenant_id:id,lifecycle_action:'delete_request',reason:lifeReason.trim()}))}}>Запросить удаление (30 дней)</button>
        </div>
      </div>}
    </section>
    {['owner','support'].includes(role) && <form className="card col pf-support" onSubmit={(e)=>void startImpersonation(e)}><h3>Режим поддержки</h3><p className="muted small">Вход в кабинет владельца на 30 минут. Причина обязательна; действия будут записаны в журнал.</p><label className="pf-label">Причина доступа<textarea className="field" minLength={5} maxLength={500} rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Например: воспроизведение ошибки при создании записи" required /></label><button className="pf-action-primary" disabled={impBusy||reason.trim().length<5}>{impBusy?'Открываем кабинет…':'Войти в кабинет организации'}</button></form>}
      <section className="card"><h3>Текущая подписка</h3>
      {cur ? <><p><Badge phase={cur.phase} /> {cur.plan_code} · {fmtDate(cur.starts_at)} — {cur.ends_at ? fmtDate(cur.ends_at) : 'бессрочно'}{cur.grace_ends_at ? ` (grace до ${fmtDate(cur.grace_ends_at)})` : ''}</p>
        <div className="pf-actions">
          {cur.ends_at && <button onClick={() => act(() => runSubAction(cur.id, 'extend', { months: 1 }))}>Продлить на 1 мес.</button>}
          {['trial', 'active', 'grace'].includes(cur.phase) && <button onClick={() => setSubModal({type:'suspend',subscription:cur})}>Приостановить</button>}
          {['suspended', 'expired'].includes(cur.phase) && <button onClick={() => act(() => resumeFlow(cur.id))}>Возобновить</button>}
          <button onClick={() => setSubModal({type:'change_plan',subscription:cur})}>Сменить тариф</button>
          {['trial','active','grace','suspended'].includes(cur.status)&&<button className="danger" onClick={()=>setSubModal({type:'cancel',subscription:cur})}>Отменить подписку</button>}
        </div></> : <p className="muted">Подписки нет.</p>}</section>
    {role==='owner'&&<TenantPlanOverrides tenantId={id} access={d.plan_access??{}} usage={d.plan_usage??{}} onSaved={()=>void reload()}/>}
    {role==='owner'&&<TenantFeatureFlags tenantId={id}/>}
    {['owner','support'].includes(role)&&<TenantSupportPanel tenantId={id}/>}
    <section className="card"><h3>Владельцы и сотрудники</h3><Table head={['Email', 'Роль', 'Последний вход']}>{(d.members as Row[]).map((m) => <tr key={m.user_id}><td>{m.email}</td><td>{m.role}</td><td>{fmtDateTime(m.last_sign_in_at)}</td></tr>)}</Table></section>
    <section className="card"><h3>История подписок</h3><Table head={['Тариф', 'Статус', 'Начало', 'Окончание']}>{subs.map((s) => <tr key={s.id}><td>{s.plan_code}</td><td><Badge phase={s.phase} /></td><td>{fmtDate(s.starts_at)}</td><td>{s.ends_at ? fmtDate(s.ends_at) : '—'}</td></tr>)}</Table></section>
    <section className="card"><h3>Платежи</h3><Table head={['Дата', 'Сумма', 'Период', 'Способ', 'Статус']}>{(d.payments as Row[]).map((p) => <tr key={p.id}><td>{fmtDate(p.received_at)}</td><td>{kzt(p.amount_kzt)}</td><td>{fmtDate(p.period_start)} — {fmtDate(p.period_end)}</td><td>{METHODS[p.method] ?? p.method}</td><td><Badge phase={p.status} /></td></tr>)}</Table></section>
    <section className="card col"><div><h3>История подписки</h3><p className="muted small">Платежи, изменения тарифа и статуса организации.</p></div><State err={events.err} loading={events.loading}/>{events.data&&<>{(events.data.items as Row[]).length===0?<p className="muted">Событий пока нет.</p>:<div className="pf-event-list">{(events.data.items as Row[]).map((e)=><article className="pf-event" key={e.id}><div className="row between wrap"><b>{subscriptionEventTitle(String(e.type))}</b><time className="muted small">{fmtDateTime(e.created_at)}</time></div><p className="muted small">{subscriptionEventDetail(e)}</p></article>)}</div>}{((events.data.items as Row[]).length>0||eventPage>0)&&<nav className="admin-service-pagination" aria-label="История подписки"><button className="admin-page-button" disabled={eventPage===0||events.loading} onClick={()=>setEventPage(eventPage-1)}>Назад</button><span className="muted small">Страница <b>{eventPage+1}</b></span><button className="admin-page-button" disabled={!events.data.has_more||events.loading} onClick={()=>setEventPage(eventPage+1)}>Далее</button></nav>}</>}</section>
  </>);
}

/* ----------------------------------------------------------------------------------- создание организации */
const CYR_MAP:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',қ:'k',ғ:'g',ң:'n',ө:'o',ү:'u',ұ:'u',һ:'h',ә:'a',і:'i'};
const slugFromName=(name:string)=>{const v=[...name.toLowerCase()].map(c=>CYR_MAP[c]??c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40).replace(/-+$/g,'');return v.length>=2?v:''};
type LeadPrefill={id:string,name:string,slug:string,owner_name:string,owner_email:string,phone:string,plan_code:string,trial:boolean};

function CreateTenant({ onCreated, prefill }: { onCreated: (id: string) => void; prefill?: LeadPrefill | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<Row>({ name: prefill?.name ?? '', slug: prefill?.slug ?? '', business_type: 'autoservice', owner_name: prefill?.owner_name ?? '', owner_email: prefill?.owner_email ?? '', phone: prefill?.phone ?? '', bin_iin:'', address: '', timezone: 'Asia/Aqtobe', currency: '₸', plan_code: prefill?.plan_code ?? 'START', start: today, months: 1, trial: prefill?.trial ?? true, services: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const key = useRef(newKey()); // один ключ на форму: повторный клик «Создать» не создаёт дубликат
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setErr(''); setOk('');
    const services = String(f.services).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, price, dur] = l.split(';').map((x) => x.trim()); return { name, price: Number(price), duration_minutes: Number(dur) }; });
    try {
      const r = await call<Row>('create_tenant', { idempotency_key: key.current, tenant: { ...f, start: iso(f.start), months: Number(f.months), services } });
      { const okText = r.replayed ? 'Организация уже была создана этим запросом.' : r.invite_sent ? 'Организация создана, приглашение отправлено владельцу.' : 'Организация создана. Приглашение не отправлено — отправьте его из карточки.'; setOk(okText); notify(okText, r.invite_sent || r.replayed ? 'ok' : 'warn'); }
      if(prefill?.id){try{await call('business_lead_update',{lead_id:prefill.id,status:'converted',tenant_id:r.tenant_id,tenant_slug:r.slug??f.slug})}catch{setOk(x=>x+' Заявку не удалось отметить подключённой — сделайте это вручную.')}}
      key.current = newKey(); onCreated(r.tenant_id);
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  };
  const input = (label: string, k: string, type = 'text', ph = '') => <label className="pf-label">{label}<input className="field" type={type} placeholder={ph} value={f[k]} onChange={(e) => set(k, e.target.value)} required={['name', 'slug', 'owner_email'].includes(k)} /></label>;
  return (
    <form className="card col pf-form" onSubmit={submit}><h2>Новая организация</h2>{prefill&&<p className="muted small">Данные подставлены из заявки с сайта. Проверьте их и нажмите «Создать»: заявка станет «Подключён», владелец получит письмо для установки пароля.</p>}
      {input('Название студии или компании', 'name')}{input('Адрес страницы', 'slug', 'text', 'my-studio')}{input('Чем занимается организация', 'business_type')}
      {input('Имя владельца', 'owner_name')}{input('Почта владельца', 'owner_email', 'email')}{input('Телефон', 'phone', 'tel')}{input('БИН/ИИН', 'bin_iin')}{input('Адрес организации', 'address')}
      {input('Часовой пояс', 'timezone')}{input('Валюта', 'currency')}
      <label className="pf-label">Тариф<select className="field" value={f.plan_code} onChange={(e) => set('plan_code', e.target.value)}><option>START</option><option>PRO</option></select></label>
      <label className="pf-check"><input type="checkbox" checked={f.trial} onChange={(e) => set('trial', e.target.checked)} /> Пробный период (длительность из настроек)</label>
      {input('Дата старта подписки', 'start', 'date')}
      {!f.trial && input('Длительность, месяцев', 'months', 'number')}
      <label className="pf-label">Услуги организации (каждая с новой строки: название; цена; длительность в минутах). Поле можно оставить пустым<textarea className="field" rows={4} placeholder={'Мойка; 3500; 60'} value={f.services} onChange={(e) => set('services', e.target.value)} /></label>
      {err && <p className="err">{err}</p>}{ok && <p>{ok}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Создаём…' : 'Создать'}</button></form>);
}

/* ----------------------------------------------------------------------------------- подписки */
function Subscriptions({ onOpen }: { onOpen: (id: string) => void }) {
  const [phase, setPhase] = useState('');
  const [subModal,setSubModal]=useState<{type:string;subscription:Row}|null>(null);
  const { data, err, loading, reload } = useLoad<Row[]>('subscriptions', { phase }, [phase]);
  const [msg, setMsg] = useState('');
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  return (<>
    {subModal&&<SubscriptionActionModal type={subModal.type} subscription={subModal.subscription} initialPlan={subModal.subscription.plan_code} initialDate={subModal.subscription.ends_at?.slice(0,10)??''} onClose={()=>setSubModal(null)} onSubmit={async values=>{await act(()=>runSubAction(subModal.subscription.id,subModal.type,values));setSubModal(null)}}/>}
    <select className="field" value={phase} onChange={(e) => setPhase(e.target.value)}><option value="">Все статусы</option>{Object.entries(PHASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Организация', 'Тариф', 'Цена по подписке', 'Статус', 'Начало', 'Окончание', 'Действия']}>{data.map((s) => (
      <tr key={s.id}><td><button className="pf-link" onClick={() => onOpen(s.tenant_id)}>{s.name ?? s.slug}</button></td><td>{s.plan_code}</td><td>{kzt(s.price_kzt)} / {s.price_period_months} мес.</td><td><Badge phase={s.phase} /></td><td>{fmtDate(s.starts_at)}</td><td>{s.ends_at ? fmtDate(s.ends_at) : 'бессрочно'}</td>
        <td className="pf-actions">
          {s.ends_at && <button onClick={() => act(() => runSubAction(s.id, 'extend', { months: 1 }))}>+1 мес.</button>}
          <button onClick={() => setSubModal({type:'change_plan',subscription:s})}>Тариф</button>
          <button onClick={() => setSubModal({type:'set_dates',subscription:s})}>Даты</button>
          {['trial', 'active', 'grace'].includes(s.phase) && <button onClick={() => setSubModal({type:'suspend',subscription:s})}>Приостановить</button>}
          {['suspended', 'expired'].includes(s.phase) && <button onClick={() => act(() => resumeFlow(s.id))}>Возобновить</button>}
        </td></tr>))}</Table>}</>);
}

/* ----------------------------------------------------------------------------------- тарифы */
function Plans() {
  const { data, err, loading, reload } = useLoad<Row[]>('plans');
  const [msg, setMsg] = useState('');
  const save = async (p: Row, patch: Row) => { setMsg(''); try { await call('plan_save', { plan: { id: p.id, ...patch } }); await reload(); } catch (e) { setMsg(errText(e)); throw e; } };
  return (<><State err={err} loading={loading && !data} />{msg && <p className="err">{msg}</p>}
    <p className="muted small">При изменении цены или периода всем владельцам организаций с активной подпиской появится предложение в кабинете. Нужно уведомить за 30 дней; новые условия начнут действовать после принятия и указанной даты. При отказе сохраняются прежние условия.</p>
    {data?.map((p) => <PlanRow key={p.id} p={p} onSave={(patch) => save(p, patch)} />)}</>);
}
function PlanRow({ p, onSave }: { p: Row; onSave: (patch: Row) => void | Promise<void> }) {
  const [name, setName] = useState<string>(p.name); const [price, setPrice] = useState<string>(String(p.price_kzt)); const [desc, setDesc] = useState<string>(p.description ?? ''); const [editing,setEditing]=useState(false); const [busy,setBusy]=useState(false);
  const [features, setFeatures] = useState<string>((p.features as string[]).join(', '));
  const [limits,setLimits]=useState<Row>(p.limits??{}); const [featureAccess,setFeatureAccess]=useState<Row>(p.feature_access??{telegram:true,export:true,reviews:true});
  const setLimit=(key:string,value:string)=>setLimits((prev:Row)=>({...prev,[key]:value===''?null:Number(value)}));
  const limitFields:[string,string][]=[['employees','Сотрудники'],['services','Услуги'],['branches','Филиалы'],['bookings_per_month','Записи в месяц']];
  const accessFields:[string,string][]=[['telegram','Telegram'],['export','Экспорт ZIP'],['reviews','Отзывы']];
  const patch=()=>({name:name.trim(),price_kzt:Number(price),description:desc.trim(),features:features.split(',').map((x)=>x.trim()).filter(Boolean),limits:Object.fromEntries(limitFields.map(([key])=>[key,limits[key]===''?null:(limits[key]===undefined?(p.limits?.[key]??null):Number(limits[key]))])),feature_access:featureAccess});
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!name.trim()||!Number.isFinite(Number(price))||Number(price)<0||!Number.isInteger(Number(price)))return;setBusy(true);try{await onSave(patch());setEditing(false)}catch{/* ошибка показана в Plans, окно остаётся открытым */}finally{setBusy(false)}};
  return <>
    <section className="card col"><div className="row between wrap"><div><b>{p.code} · {name}</b><p className="muted small">{Number(price).toLocaleString('ru-RU')} ₸ / {p.period_months} мес. · {p.is_active?'Активен':'Выключен'}</p></div><div className="row wrap"><label className="pf-check"><input type="checkbox" checked={p.is_active} onChange={(e) => { void Promise.resolve(onSave({ is_active: e.target.checked })).catch(() => {}); }} /> Активен</label><button className="btn inline" onClick={()=>setEditing(true)}>Изменить тариф</button></div></div></section>
    {editing&&<div className="pf-modal-backdrop"><form className="pf-modal card col" role="dialog" aria-modal="true" aria-labelledby={`plan-title-${p.id}`} onSubmit={e=>void submit(e)}><h2 id={`plan-title-${p.id}`}>Изменить тариф {p.code}</h2><label className="pf-label">Название<input className="field" required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><label className="pf-label">Цена, ₸ за период<input className="field" type="number" min={0} step={1} required value={price} onChange={e=>setPrice(e.target.value)}/></label><label className="pf-label">Описание<textarea className="field" rows={2} maxLength={1000} value={desc} onChange={e=>setDesc(e.target.value)}/></label><label className="pf-label">Возможности через запятую<input className="field" maxLength={1000} value={features} onChange={e=>setFeatures(e.target.value)}/></label><b>Лимиты тарифа</b><p className="muted small">Пустое значение означает «без ограничений».</p><div className="pf-plan-limits">{limitFields.map(([key,label])=><label key={key} className="pf-label">{label}<input className="field" type="number" min={1} step={1} value={limits[key]??''} onChange={e=>setLimit(key,e.target.value)} placeholder="Без ограничений"/></label>)}</div><b>Доступ к функциям</b><div className="row wrap">{accessFields.map(([key,label])=><label key={key} className="pf-check"><input type="checkbox" checked={featureAccess[key]!==false} onChange={e=>setFeatureAccess((prev:Row)=>({...prev,[key]:e.target.checked}))}/>{label}</label>)}</div><div className="row wrap"><button className="pf-action-primary" disabled={busy||!name.trim()||!Number.isInteger(Number(price))||Number(price)<0}>{busy?'Сохраняем…':'Сохранить тариф'}</button><button type="button" className="pf-action-secondary" disabled={busy} onClick={()=>setEditing(false)}>Отмена</button></div></form></div>}
  </>;
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
  const [page,setPage]=useState(0); const [status,setStatus]=useState('');const pageSize=50;
  useEffect(()=>setPage(0),[status]);
  const { data, err, loading, reload } = useLoad<Row[]>('payments',{status:status||undefined,limit:pageSize+1,offset:page*pageSize},[page,status]);
  const rows=(data??[]).slice(0,pageSize); const hasNext=(data?.length??0)>pageSize;
  const tenants = useAllTenants();
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
  const exportCsv=async()=>{try{const all:Row[]=[];for(let offset=0;offset<100000;offset+=200){const batch=await call<Row[]>('payments',{status:status||undefined,limit:200,offset});all.push(...batch);if(batch.length<200)break}const quote=(x:unknown)=>'"'+String(x??'').replace(/[\r\n]+/g,' ').replace(/"/g,'""')+'"';const csv=['Дата,Организация,Slug,Сумма KZT,Период с,Период по,Метод,Статус',...all.map(p=>[p.received_at,p.name,p.slug,p.amount_kzt,p.period_start,p.period_end,p.method,p.status].map(quote).join(','))].join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));a.download='payments.csv';a.click();URL.revokeObjectURL(a.href)}catch(e){setMsg(errText(e))}};
  return (<>
    <form className="card col pf-form" onSubmit={create}><h2>Новый платёж</h2>
      <select className="field" value={f.tenant_id} onChange={(e) => setF({ ...f, tenant_id: e.target.value })} required><option value="">Организация…</option>{tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.slug}</option>)}</select>
      <input className="field" type="number" min={1} placeholder="Сумма, ₸" value={f.amount_kzt} onChange={(e) => setF({ ...f, amount_kzt: e.target.value })} required />
      <label className="pf-label">Период с<input className="field" type="date" value={f.period_start} onChange={(e) => setF({ ...f, period_start: e.target.value })} required /></label>
      <label className="pf-label">Период по<input className="field" type="date" value={f.period_end} onChange={(e) => setF({ ...f, period_end: e.target.value })} required /></label>
      <select className="field" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <label className="pf-label">Дата получения<input className="field" type="date" value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} required /></label>
      <button className="btn" disabled={busy}>Создать (статус «Ожидает»)</button></form>
    <div className="row wrap"><select className="field" aria-label="Статус платежа" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Все платежи</option><option value="pending">Ожидает</option><option value="paid">Оплачен</option><option value="failed">Не прошёл</option><option value="refunded">Возврат</option></select><button className="pf-action-secondary" onClick={()=>void exportCsv()}>Скачать таблицу платежей</button></div>
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Дата', 'Организация', 'Сумма', 'Период', 'Способ', 'Статус', 'Действия']}>{rows.map((p) => (
      <tr key={p.id}><td>{fmtDate(p.received_at)}</td><td>{p.name ?? p.slug}</td><td>{kzt(p.amount_kzt)}</td><td>{fmtDate(p.period_start)} — {fmtDate(p.period_end)}</td><td>{METHODS[p.method] ?? p.method}</td>
        <td><Badge phase={p.status} />{p.refund_reason && <div className="muted small">{p.refund_reason}</div>}</td>
        <td className="pf-actions">
          {p.status === 'pending' && <button onClick={() => { if (window.confirm(`Подтвердить получение ${kzt(p.amount_kzt)}?`)) void act(() => call('payment_confirm', { payment_id: p.id })); }}>Подтвердить</button>}
          {p.status === 'pending' && <button onClick={() => act(() => call('payment_fail', { payment_id: p.id }))}>Не прошёл</button>}
          {p.status === 'paid' && <button onClick={() => { const r = window.prompt('Причина возврата (обязательно):'); if (r?.trim() && window.confirm('Подтвердить возврат ' + kzt(p.amount_kzt) + '?')) void act(() => call('payment_refund', { payment_id: p.id, reason: r.trim() })); }}>Возврат</button>}
        </td></tr>))}</Table>}{data&&(rows.length>0||page>0)&&<nav className='admin-service-pagination' aria-label='Платежи'><button className='admin-page-button' disabled={page===0||loading} onClick={()=>setPage(page-1)}>Назад</button><span className='muted small'>Страница <b>{page+1}</b></span><button className='admin-page-button' disabled={!hasNext||loading} onClick={()=>setPage(page+1)}>Далее</button></nav>}</>);
}

function TenantFeatureFlags({tenantId}:{tenantId:string}){
  const {data,err,loading,reload}=useLoad<Row[]>('tenant_flags_get',{tenant_id:tenantId},[tenantId]);
  const [key,setKey]=useState('');const [enabled,setEnabled]=useState(true);const [msg,setMsg]=useState('');
  const save=async(flag_key:string,value:boolean)=>{setMsg('');try{await call('tenant_flags_set',{tenant_id:tenantId,flag_key,enabled:value});await reload()}catch(e){setMsg(errText(e))}};
  return <section className="card col"><h3>Дополнительные возможности</h3><p className="muted small">Можно включить пробные возможности отдельно для этой организации.</p><State err={err} loading={loading&&!data}/>{data?.map(f=><div className="row between wrap" key={f.flag_key}><code>{f.flag_key}</code><label className="pf-check"><input type="checkbox" checked={!!f.enabled} onChange={e=>void save(f.flag_key,e.target.checked)}/> Включена</label></div>)}<form className="row wrap" onSubmit={e=>{e.preventDefault();void save(key,enabled).then(()=>setKey(''))}}><input className="field" value={key} onChange={e=>setKey(e.target.value)} placeholder="Название возможности" pattern="[a-z][a-z0-9_]{1,63}" required/><label className="pf-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Включить</label><button className="btn" disabled={!key}>Сохранить</button></form>{msg&&<p className="err">{msg}</p>}</section>
}
function PlatformServiceAdmin(){
  const announcements=useLoad<Row[]>('announcements');
  const tenants=useAllTenants();
  const [title,setTitle]=useState('');const [body,setBody]=useState('');const [audience,setAudience]=useState('all');const [tenantIds,setTenantIds]=useState<string[]>([]);const [startsAt,setStartsAt]=useState('');const [endsAt,setEndsAt]=useState('');const [msg,setMsg]=useState('');
  const saveAnnouncement=async(e:FormEvent)=>{e.preventDefault();setMsg('');try{await call('announcement_save',{announcement:{title,body,audience,tenant_ids:tenantIds,starts_at:startsAt?new Date(startsAt).toISOString():new Date().toISOString(),ends_at:endsAt?new Date(endsAt).toISOString():null,is_active:true}});setTitle('');setBody('');setMsg('Объявление опубликовано.');await announcements.reload()}catch(e){setMsg(errText(e))}};
  const toggleAnnouncement=async(a:Row)=>{setMsg('');try{await call('announcement_save',{announcement:{id:a.id,title:a.title,body:a.body,audience:a.audience,tenant_ids:a.tenant_ids??[],starts_at:a.starts_at,ends_at:a.ends_at,is_active:!a.is_active}});notify(a.is_active?'Объявление снято с показа.':'Объявление снова показывается организациям.');await announcements.reload()}catch(e){setMsg(errText(e))}};
  const removeAnnouncement=async(a:Row)=>{if(!window.confirm(`Удалить объявление «${a.title}»? Организации перестанут его видеть, восстановить его нельзя.`))return;setMsg('');try{await call('announcement_delete',{id:a.id});notify('Объявление удалено.');await announcements.reload()}catch(e){setMsg(errText(e))}};
  return <div className="col"><section className="card col"><div className="row between wrap"><div><h2>Автоматический статус</h2><p className="muted small">Сайт, API, база данных, авторизация и серверные функции проверяются автоматически каждые 30 секунд. Изменить эти статусы вручную нельзя.</p></div><a className="pf-action-secondary" href="/status" target="_blank" rel="noreferrer">Открыть страницу статуса</a></div></section>
  <section className="card col"><h2>Объявления</h2><p className="muted small">Сообщите организациям о важных изменениях или плановых работах.</p><form className="col" onSubmit={saveAnnouncement}><input className="field" minLength={3} maxLength={180} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Заголовок" required/><textarea className="field" rows={4} maxLength={5000} value={body} onChange={e=>setBody(e.target.value)} placeholder="Текст объявления" required/><select className="field" value={audience} onChange={e=>setAudience(e.target.value)}><option value="all">Всем организациям</option><option value="selected">Выбранным организациям</option></select>{audience==='selected'&&<select className="field" multiple size={6} value={tenantIds} onChange={e=>setTenantIds(Array.from(e.target.selectedOptions,o=>o.value))}>{tenants.data?.map(t=><option key={t.id} value={t.id}>{t.name??t.slug}</option>)}</select>}<div className="row wrap"><label className="pf-label">Начало<input className="field" type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label><label className="pf-label">Окончание<input className="field" type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)}/></label></div><button className="btn" disabled={audience==='selected'&&!tenantIds.length}>Опубликовать</button></form>{msg&&<p className="muted small" role="status">{msg}</p>}<State err={announcements.err} loading={announcements.loading&&!announcements.data}/>{announcements.data?.map(a=><article className="pf-event" key={a.id}><div className="row between wrap"><b>{a.title}</b><span className="pf-badge">{a.is_active?'Активно':'Выключено'}</span></div><p>{a.body}</p><p className="muted small">{a.audience==='all'?'Все организации':'Выбрано: '+(a.tenant_ids??[]).length} · {fmtDateTime(a.starts_at)}{a.ends_at?' — '+fmtDateTime(a.ends_at):''}</p><div className="pf-actions"><button type="button" onClick={()=>void toggleAnnouncement(a)}>{a.is_active?'Снять с показа':'Показать снова'}</button><button type="button" className="pf-danger-btn" onClick={()=>void removeAnnouncement(a)}>Удалить</button></div></article>)}</section></div>
}
/* ----------------------------------------------------------------------------------- журнал, настройки */
const ADMIN_ROLE: Record<string, string> = { owner: 'Владелец', support: 'Поддержка', finance: 'Финансы', read_only: 'Только чтение' };
function Admins() {
  const { data, err, loading, reload } = useLoad<Row[]>('admins');
  const logins=useLoad<Row[]>('admin_logins');
  const [email, setEmail] = useState(''); const [role, setRole] = useState('support'); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const act = async (action: string, body: Row) => {
    setBusy(true); setMsg('');
    try { const result = await call<Row>(action, body); await reload(); return result; }
    catch (e) { setMsg(errText(e)); }
    finally { setBusy(false); }
  };
  const add = async (e: FormEvent) => { e.preventDefault(); const result = await act('admin_add', { email: email.trim(), role }); if (result) { setEmail(''); setMsg(result.invite_sent ? 'Администратор добавлен, письмо для входа отправлено.' : result.created ? 'Администратор добавлен, но письмо не отправлено. Проверьте настройки почты.' : 'Существующий аккаунт добавлен как администратор.'); } };
  return <>
    <div className="pf-dashboard-heading"><div><span className="pf-kicker">ДОСТУП К ПЛАТФОРМЕ</span><h2>Команда</h2><p className="muted">Добавляйте коллег и выбирайте, какие разделы будут им доступны.</p></div></div>
    <form className="card row wrap" onSubmit={add}><input className="field" type="email" placeholder="Email сотрудника" value={email} onChange={(e)=>setEmail(e.target.value)} required />
      <select className="field" value={role} onChange={(e)=>setRole(e.target.value)}>{Object.entries(ADMIN_ROLE).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
      <button className="pf-action-primary" disabled={busy}>Добавить администратора</button></form>
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Администратор','Роль','Статус','Добавлен','Действия']}>{data.map((a)=><tr key={a.user_id}>
      <td>{a.email}</td><td><select className="field" value={a.role} disabled={busy || !a.is_active} onChange={(e)=>void act('admin_update',{user_id:a.user_id,role:e.target.value})}>{Object.entries(ADMIN_ROLE).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></td>
      <td><Badge phase={a.is_active?'active':'suspended'} /></td><td>{fmtDate(a.created_at)}</td>
      <td className="pf-actions">{a.is_active && <><button className="pf-action-secondary" disabled={busy} onClick={()=>{if(window.confirm(`Сбросить дополнительную проверку входа для ${a.email}?`))void act('admin_reset_mfa',{user_id:a.user_id})}}>Сбросить проверку входа</button><button className="pf-action-secondary" disabled={busy} onClick={()=>{if(window.confirm(`Отключить доступ для ${a.email}?`))void act('admin_disable',{user_id:a.user_id})}}>Отключить</button></>}<button className="pf-danger-btn" disabled={busy} onClick={()=>{if(window.confirm(`Удалить администратора ${a.email} из команды? Доступ к платформе будет закрыт, настройка Google Authenticator сбросится. Сам аккаунт (почта) останется.`))void act('admin_delete',{user_id:a.user_id}).then(r=>{if(r)notify(`Администратор ${a.email} удалён.`)})}}>Удалить</button></td>
    </tr>)}</Table>}
    <section className="card col"><h3>Последние входы в аккаунты команды</h3><State err={logins.err} loading={logins.loading&&!logins.data}/>{logins.data&&<Table head={['Время','Администратор','Адрес сети','Устройство']}>{logins.data.map(item=><tr key={item.id}><td>{fmtDateTime(item.signed_in_at)}</td><td>{item.email}</td><td>{item.ip_address??'—'}</td><td>{item.user_agent||'—'}</td></tr>)}</Table>}</section>
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
  'owner.resend_invite':'Повторно отправил приглашение владельцу','admin.delete':'Удалил администратора','announcement.delete':'Удалил объявление','tenant.create':'Создал организацию','plan.upsert':'Изменил тариф','settings.update':'Изменил настройки платформы',
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
  if(action==='owner.resend_invite')return payload.sent===false?`Не удалось отправить приглашение на ${String(payload.email??'адрес владельца')}`:`Приглашение отправлено на ${String(payload.email??'адрес владельца')}`;
  if(action==='impersonation.end'||action==='impersonation.expired')return 'Служебный сеанс завершён';
  return 'Изменения сохранены';
}

const TICKET_STATUS:Record<string,string>={open:'Открыт',in_progress:'В работе',resolved:'Решён'};
const TICKET_TYPE:Record<string,string>={support:'Поддержка',billing:'Оплата и подписка',technical:'Техническая проблема',access:'Вход и доступ',booking:'Записи и расписание',feature:'Функция сервиса',other:'Другое'};
const TICKET_SEVERITY:Record<string,string>={low:'Низкая',normal:'Обычная',high:'Высокая',urgent:'Критичная'};
function SupportQueue(){
  const [status,setStatus]=useState(''),[category,setCategory]=useState(''),[severity,setSeverity]=useState(''),[searchInput,setSearchInput]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0),[ticket,setTicket]=useState<Row|null>(null),[reply,setReply]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
  const q=useLoad<Row>('support_tickets',{status,category,severity,search,limit:25,offset:page*25},[status,category,severity,search,page]);
  const open=async(item:Row)=>{setMsg('');setBusy(true);try{setTicket(await call<Row>('support_ticket_detail',{ticket_id:item.id}));setReply('')}catch(e){setMsg(errText(e))}finally{setBusy(false)}};
  const refresh=async()=>{await q.reload();if(ticket){try{setTicket(await call<Row>('support_ticket_detail',{ticket_id:ticket.id}))}catch(e){setMsg(errText(e))}}};
  const update=async(nextStatus:string,message='')=>{if(!ticket)return;setBusy(true);setMsg('');try{await call('support_ticket_update',{ticket_id:ticket.id,status:nextStatus,message});setReply('');await refresh()}catch(e){setMsg(errText(e))}finally{setBusy(false)}};
  const rows:Row[]=q.data?.rows??[],count=Number(q.data?.count??0),pages=Math.max(1,Math.ceil(count/25));
  if(ticket)return <div className="col"><button className="back" onClick={()=>{setTicket(null);void q.reload()}}>← К списку обращений</button><div className="admin-subheading"><div><h2>{ticket.subject}</h2><p className="muted small">{ticket.tenant?.name} · /{ticket.tenant?.slug} · создано {fmtDateTime(ticket.created_at)}</p></div><span className={`pf-badge pf-${ticket.severity}`}>{TICKET_SEVERITY[ticket.severity]??ticket.severity}</span></div>
    <section className="card col"><div className="row between wrap"><div><b>{TICKET_TYPE[ticket.category]??'Другое'}{ticket.custom_type?` · ${ticket.custom_type}`:''}</b><p className="muted small">От: {ticket.created_by_email}</p></div><label className="muted small">Статус<select className="field" value={ticket.status} disabled={busy} onChange={e=>void update(e.target.value)}>{Object.entries(TICKET_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    <div className="support-admin-thread" aria-label="Переписка по обращению">{(ticket.events??[]).map((event:Row)=><article className={`support-admin-message ${event.is_support?'from-support':'from-organization'}`} key={event.id}><div className="support-admin-message-meta"><b>{event.is_support?'Поддержка Servio':event.actor_email}</b><time>{fmtDateTime(event.created_at)}</time></div><p>{event.message??(event.event_type==='created'?'Обращение создано.':'Статус изменён: '+(TICKET_STATUS[event.status]??event.status))}</p></article>)}</div>
    <form className="col" onSubmit={e=>{e.preventDefault();void update(ticket.status,reply.trim())}}><label className="muted small">Ответ организации<textarea className="field" rows={4} maxLength={3000} minLength={1} value={reply} onChange={e=>setReply(e.target.value)} placeholder="Напишите ответ или задайте уточняющий вопрос" required/></label><button className="btn" disabled={busy||!reply.trim()}>Отправить ответ</button></form></section>{msg&&<p className="err" role="alert">{msg}</p>}</div>;
  return <div className="col"><div className="admin-subheading"><div><h2>Обращения организаций</h2><p className="muted small">Здесь собраны просьбы о помощи. Найдите нужное обращение по теме, типу или срочности.</p></div><button className="btn ghost mini" onClick={()=>void q.reload()}>Обновить</button></div>
    <form className="support-queue-filters" onSubmit={e=>{e.preventDefault();setPage(0);setSearch(searchInput.trim())}}><input className="field" value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Поиск по теме или типу"/><select className="field" value={status} onChange={e=>{setPage(0);setStatus(e.target.value)}}><option value="">Все статусы</option>{Object.entries(TICKET_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select className="field" value={category} onChange={e=>{setPage(0);setCategory(e.target.value)}}><option value="">Все типы</option>{Object.entries(TICKET_TYPE).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select className="field" value={severity} onChange={e=>{setPage(0);setSeverity(e.target.value)}}><option value="">Любая срочность</option>{Object.entries(TICKET_SEVERITY).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><button className="btn">Найти</button><button className="btn ghost" type="button" onClick={()=>{setSearchInput('');setSearch('');setStatus('');setCategory('');setSeverity('');setPage(0)}}>Сбросить</button></form>
    <State err={q.err} loading={q.loading}/>{!q.loading&&!q.err&&!rows.length&&<p className="muted">По выбранным условиям обращений нет.</p>}
    <div className="support-queue-list">{rows.map(item=><article className="card support-queue-item" key={item.id}><div className="row between wrap"><div><button className="pf-link" onClick={()=>void open(item)}>{item.subject}</button><p className="muted small">{item.tenant?.name??'Организация'} · {item.tenant?.slug??'—'} · {TICKET_TYPE[item.category]??item.category}{item.custom_type?` · ${item.custom_type}`:''}</p></div><div className="row wrap"><span className={`pf-badge pf-${item.severity}`}>{TICKET_SEVERITY[item.severity]??item.severity}</span><span className={`pf-badge pf-${item.status}`}>{TICKET_STATUS[item.status]??item.status}</span></div></div><div className="row between wrap"><span className="muted small">{item.created_by_email} · обновлено {fmtDateTime(item.updated_at)}</span><button className="btn ghost mini" disabled={busy} onClick={()=>void open(item)}>Открыть обращение</button></div></article>)}</div>
    <div className="row between wrap"><span className="muted small">{count} тикетов · страница {page+1} из {pages}</span><div className="row"><button className="btn ghost mini" disabled={page===0||q.loading} onClick={()=>setPage(p=>p-1)}>Назад</button><button className="btn ghost mini" disabled={page+1>=pages||q.loading} onClick={()=>setPage(p=>p+1)}>Дальше</button></div></div>{msg&&<p className="err" role="alert">{msg}</p>}
  </div>
}

const LEAD_STATUS:Record<string,string>={new:'Новая',contacted:'Связались',converted:'Подключён',closed:'Закрыта'};
function BusinessLeads({canConnect,onConnect}:{canConnect:boolean;onConnect:(lead:LeadPrefill)=>void}){
  const [status,setStatus]=useState(''),[page,setPage]=useState(0),[msg,setMsg]=useState('');
  const q=useLoad<Row>('business_leads',{status,limit:25,offset:page*25},[status,page]);
  const rows:Row[]=q.data?.rows??[],count=Number(q.data?.count??0),pages=Math.max(1,Math.ceil(count/25));
  const change=async(id:string,next:string)=>{setMsg('');try{await call('business_lead_update',{lead_id:id,status:next});await q.reload()}catch(e){setMsg(errText(e))}};
  return <div className="col"><div className="admin-subheading"><div><h2>Заявки с сайта</h2><p className="muted small">Запросы на подключение и демонстрацию Servio. Свяжитесь с человеком и обновите состояние заявки.</p></div><button className="btn ghost mini" onClick={()=>void q.reload()} disabled={q.loading}>Обновить</button></div>
    <div className="support-queue-filters"><select className="field" value={status} onChange={e=>{setStatus(e.target.value);setPage(0)}}><option value="">Все заявки</option>{Object.entries(LEAD_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
    <State err={q.err} loading={q.loading}/>{!q.loading&&!q.err&&!rows.length&&<p className="muted">Заявок пока нет.</p>}
    <div className="support-queue-list">{rows.map(lead=><article className="card support-queue-item" key={lead.id}><div className="row between wrap"><div><b>{lead.business_name??lead.name}</b><p className="muted small">{lead.owner_name?`${lead.owner_name} · `:''}{lead.business_type} · {lead.request_type==='demo'?'Демонстрация':'Подключение'}{lead.plan?` · тариф ${lead.plan}`:''}</p></div><span className={`pf-badge pf-${lead.status}`}>{LEAD_STATUS[lead.status]??lead.status}</span></div><div className="row between wrap"><span className="col"><a href={`tel:${String(lead.phone).replace(/[^+\d]/g,'')}`}>{lead.phone}</a>{lead.owner_email&&<a href={`mailto:${lead.owner_email}`}>{lead.owner_email}</a>}</span><time className="muted small">Поступила {fmtDateTime(lead.created_at)}</time></div>{lead.comment&&<p className="muted small">{lead.comment}</p>}{lead.consent_at?<p className="muted small">Согласие на обработку данных: {fmtDateTime(lead.consent_at)}</p>:null}{lead.tenant_slug?<p className="small">Организация создана: <a href={`/s/${lead.tenant_slug}`} target="_blank" rel="noopener noreferrer">/s/{lead.tenant_slug}</a></p>:null}{canConnect&&!lead.tenant_id&&lead.status!=='closed'&&<button className="btn mini" onClick={()=>onConnect({id:String(lead.id),name:String(lead.business_name??''),slug:slugFromName(String(lead.business_name??'')),owner_name:String(lead.owner_name??''),owner_email:String(lead.owner_email??''),phone:String(lead.phone??''),plan_code:String(lead.plan||'').toUpperCase()==='PRO'?'PRO':'START',trial:lead.request_type==='demo'})}>Подключить организацию</button>}<label className="muted small">Состояние заявки<select className="field" value={lead.status} onChange={e=>void change(String(lead.id),e.target.value)}>{Object.entries(LEAD_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></article>)}</div>
    <div className="row between wrap"><span className="muted small">{count} заявок · страница {page+1} из {pages}</span><div className="row"><button className="btn ghost mini" disabled={page===0||q.loading} onClick={()=>setPage(p=>p-1)}>Назад</button><button className="btn ghost mini" disabled={page+1>=pages||q.loading} onClick={()=>setPage(p=>p+1)}>Далее</button></div></div>{msg&&<p className="err" role="alert">{msg}</p>}
  </div>
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
