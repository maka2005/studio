import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { z } from 'zod'
import { ru } from 'date-fns/locale'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { ownerRequest, type OwnerUser } from '../lib/ownerSession'
import { supabase } from '../lib/supabase'
import { errText, fetchServices, fetchSlots, owner, type OwnerBooking, type OwnerNotificationSettings, type OwnerAuditEvent } from '../lib/api'
import { duration, money, telHref } from '../lib/format'
import { assetUrl, type Business, type Ctx } from '../lib/tenant'
import { prepareImage, removeByUrl, uploadImage } from '../lib/media'
import { Sheet } from '../components/Sheet'
import { LoadingScreen } from '../components/LoadingScreen'
import { SERVICE_CATEGORIES, serviceCategories } from '../lib/serviceCatalog'
import './owner-login.css'
import './owner-media.css'

const TABS = ['Записи', 'Отчёты', 'Сотрудники', 'Мой доступ', 'Команда и посты', 'История', 'Ожидание', 'Промокоды', 'Отзывы', 'Услуги', 'Студия', 'Фото', 'Уведомления', 'Документы'] as const

// Группы разделов кабинета. Идентификаторы вкладок не меняются, меняются только подписи и группировка.
const TAB_GROUPS: { name: string; tabs: (typeof TABS)[number][] }[] = [
  { name: 'Сегодня', tabs: ['Записи', 'Ожидание'] },
  { name: 'Клиенты', tabs: ['История', 'Отзывы', 'Промокоды', 'Уведомления'] },
  { name: 'Услуги и студия', tabs: ['Услуги', 'Студия', 'Фото', 'Документы'] },
  { name: 'Команда', tabs: ['Сотрудники', 'Команда и посты', 'Мой доступ'] },
  { name: 'Отчёты', tabs: ['Отчёты'] },
];
const TAB_LABELS: Partial<Record<(typeof TABS)[number], string>> = {
  'Мой доступ': 'Мой аккаунт',
  'Команда и посты': 'Посты и мастера',
};
const STATUS: Record<string, string> = {
  booked: 'Записан',
  arrived: 'Принята',
  done: 'Готова',
  cancelled: 'Отменена',
}

export function Owner() {
  const { b } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const sess = useQuery({
    queryKey: ['owner', 'session'],
    queryFn: async () => (await ownerRequest<{user:OwnerUser|null}>('session',undefined,'GET')).user,
  })
  useEffect(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ['owner'] })
    }
    window.addEventListener('owner-session-changed', refresh)
    return () => window.removeEventListener('owner-session-changed', refresh)
  }, [qc])
  const logout = async () => {
    await ownerRequest('logout')
    qc.removeQueries({ queryKey: ['owner'] })
  } // приватный кэш очищается при выходе
  if (sess.isPending) return <LoadingScreen label="Открываем кабинет…" />
  if (!sess.data) return <Login />
  if (sess.data.user_metadata?.must_change_password === true) return <SetInitialPassword />
  return <Cabinet b={b} onLogout={logout} />
}

function SetInitialPassword() {
  const [password,setPassword]=useState(''); const [confirm,setConfirm]=useState(''); const [msg,setMsg]=useState(''); const [busy,setBusy]=useState(false)
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setMsg('');if(password.length<10){setMsg('Придумайте пароль не короче 10 символов.');return}if(password!==confirm){setMsg('Пароли не совпадают.');return}setBusy(true);try{await ownerRequest('password',{password});window.location.reload()}catch{setMsg('Не удалось изменить пароль. Проверьте соединение и повторите.')}finally{setBusy(false)}}
  return <div className="page admin-login-page"><form className="login-wrap admin-login" onSubmit={(e)=>void submit(e)}><div className="login-ico"><LockIcon/></div><h1>Задайте свой пароль</h1><p className="muted">Это нужно сделать при первом входе. Временный пароль больше не понадобится.</p><label className="muted small">Новый пароль</label><input className="field" type="password" minLength={10} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required/><label className="muted small">Повторите пароль</label><input className="field" type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/>{msg&&<p className="err" role="alert">{msg}</p>}<button className="btn" disabled={busy}>{busy?'Сохраняем…':'Сохранить пароль'}</button></form></div>
}

const LockIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor" />
    <circle cx="12" cy="15.5" r="1.4" fill="#141518" />
    <path d="M12 16v2" stroke="#141518" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recovering,setRecovering]=useState(false)
  const [recoveryEmail,setRecoveryEmail]=useState('');const [recoveryKey,setRecoveryKey]=useState('');const [newPassword,setNewPassword]=useState('');const [recoveryMessage,setRecoveryMessage]=useState('');const [newRecoveryKey,setNewRecoveryKey]=useState('')
  const recover=async()=>{setRecoveryMessage('');setNewRecoveryKey('');try{const result=await owner.teamAction('','recover',{email:recoveryEmail.trim(),recovery_key:recoveryKey,password:newPassword});setRecoveryMessage('Пароль изменён. Войдите с новым паролем. Сохраните новый ключ восстановления:');setNewRecoveryKey(result.recovery_key??'Ключ не удалось обновить. После входа создайте новый во вкладке «Мой доступ».')}catch{setRecoveryMessage('Не удалось восстановить доступ. Проверьте почту и резервный ключ. Если ключ не сохранили, обратитесь к администратору проекта.')}}
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const body = await ownerRequest<{error?:string}>('login',{email:email.trim(),password})
      if (body?.error === 'rate_limited') setErr('Слишком много попыток входа. Подождите 15 минут и попробуйте снова.')
      else if (body?.error === 'bad_credentials') setErr('Неверная почта или пароль.')
      else if (!body || body.error) setErr('Не удалось войти. Проверьте соединение и повторите позже.')
      else {
        const oldSession = (await supabase.auth.getSession()).data.session
        if (oldSession?.user.email?.toLowerCase() === email.trim().toLowerCase()) await supabase.auth.signOut({ scope: 'local' })
        window.dispatchEvent(new Event('owner-session-changed'))
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : ''
      if (reason === 'bad_credentials') setErr('Неверная почта или пароль.')
      else if (reason === 'rate_limited') setErr('Слишком много попыток входа. Подождите 15 минут и попробуйте снова.')
      else setErr('Не удалось связаться с сервером. Проверьте интернет и повторите.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page admin-login-page">
      <form className="login-wrap admin-login" onSubmit={(e) => { e.preventDefault(); if(recovering)void recover(); else void submit() }}>
        <div className="login-ico">
          <LockIcon />
        </div>
        <h1>Кабинет студии</h1>
        <p className="muted">Войдите, чтобы управлять записями</p>
        <label className="muted small" htmlFor="em">
          Почта
        </label>
        <input
          id="em"
          className="field"
          type="email"
          required
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="muted small" htmlFor="pw">
          Пароль
        </label>
        <input
          id="pw"
          className="field"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && (
          <p role="alert" className="err">
            {err}
          </p>
        )}
        <button
          className="btn"
          disabled={busy || !email || !password}
          type="submit"
        >
          {busy ? 'Входим…' : 'Войти'}
        </button>
        <button type="button" className="link" onClick={()=>{setRecovering(!recovering);setRecoveryMessage('')}}>{recovering?'Назад ко входу':'Забыли пароль?'}</button>
        {recovering&&<div className="col"><p className="muted small">Введите почту и резервный ключ, который вы сохранили в кабинете. Письмо с кодом не отправляется.</p><input className="field" type="email" required placeholder="Почта аккаунта" value={recoveryEmail} onChange={e=>setRecoveryEmail(e.target.value)}/><input className="field" required placeholder="Резервный ключ" value={recoveryKey} onChange={e=>setRecoveryKey(e.target.value)}/><input className="field" type="password" minLength={10} required placeholder="Новый пароль (от 10 символов)" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/><button type="button" className="btn" disabled={!recoveryEmail||!recoveryKey||newPassword.length<10} onClick={()=>void recover()}>Восстановить доступ</button>{recoveryMessage&&<p className="muted small" role="status">{recoveryMessage}</p>}{newRecoveryKey&&<div className="card col"><b>Новый резервный ключ</b><code>{newRecoveryKey}</code><button type="button" className="btn ghost mini" onClick={async()=>{try{await navigator.clipboard.writeText(newRecoveryKey);setNewRecoveryKey('');setRecoveryMessage('Новый ключ скопирован. Сохраните его в надёжном месте.')}catch{setRecoveryMessage('Сохраните ключ вручную в надёжном месте.')}}}>Скопировать и скрыть</button></div>}</div>}
      </form>
    </div>
  )
}

function Cabinet({ b, onLogout }: { b: Business; onLogout: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Записи')
  const me = useQuery({ queryKey: ['owner', 'me', b.slug], queryFn: () => owner.me(b.slug) })
  const access = useQuery({ queryKey: ['owner', 'access', b.slug], queryFn: () => owner.access(b.slug), enabled: !!me.data })
  if (me.isPending) return <LoadingScreen label="Проверяем доступ…" />
  if (me.isError)
    return (
      <p className="pad err">
        Не удалось проверить доступ.{' '}
        <button className="link" onClick={() => me.refetch()}>
          Повторить
        </button>
      </p>
    )
  if (!me.data)
    return (
      <section className="pad">
        <h2>Нет доступа</h2>
        <p className="muted">Эта учётная запись не привязана к студии.</p>
        <button className="btn ghost" onClick={onLogout}>
          Выйти
        </button>
      </section>
    )
  if (access.isPending) return <LoadingScreen label="Загружаем права доступа…" />
  if (access.isError || !access.data) return <p className="pad err">Не удалось определить роль. Обновите страницу или обратитесь к владельцу.</p>
  const role = access.data
  const visibleTabs = (role === 'staff' ? ['Записи','Мой доступ'] : role === 'manager' ? TABS.filter((t) => !['Студия','Фото','Уведомления','Документы'].includes(t)) : TABS) as readonly (typeof TABS)[number][]
  if (!visibleTabs.includes(tab)) setTab('Записи')
  const groupList = TAB_GROUPS
    .map((g) => ({ name: g.name, tabs: g.tabs.filter((t) => visibleTabs.includes(t)) as (typeof TABS)[number][] }))
    .filter((g) => g.tabs.length > 0);
  const activeGroup = groupList.find((g) => g.tabs.includes(tab));
  return (
    <section className="pad admin-shell">
      <div className="admin-heading">
        <div>
          <p className="admin-eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</p>
          <h1>Кабинет студии</h1>
          <p className="muted">Расписание, клиенты и настройки в одном месте</p>
        </div>
        <button className="btn ghost mini admin-logout" onClick={onLogout}>
          Выйти
        </button>
      </div>
      <div className="admin-layout">
        <nav className="admin-side" aria-label="Разделы кабинета">
          {groupList.map((g) => {
            const isActive = activeGroup?.name === g.name;
            const firstTab = g.tabs[0];
            return (
              <div key={g.name} className={`admin-group${isActive ? ' is-active' : ''}${g.tabs.length === 1 ? ' is-single' : ''}`}>
                <button
                  type="button"
                  className="admin-group-title"
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => { if (firstTab) setTab(firstTab) }}
                >
                  <span>{g.name}</span>
                  <span className="admin-group-chevron" aria-hidden="true">›</span>
                </button>
                {g.tabs.length > 1 && (
                  <div className="admin-group-tabs">
                    {g.tabs.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`admin-group-tab${tab === t ? ' is-current' : ''}`}
                        aria-current={tab === t ? 'page' : undefined}
                        onClick={() => setTab(t)}
                      >
                        {TAB_LABELS[t] ?? t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="admin-main">
      {tab === 'Записи' && <Bookings b={b} role={role} />}
      {tab === 'Сотрудники' && role === 'owner' && <TeamAccess b={b} />}
      {tab === 'Сотрудники' && role === 'manager' && <TeamAccess b={b} canManageManagers={false} />}
      {tab === 'Мой доступ' && <MyAccess b={b} />}
      {tab === 'Отчёты' && <Reports b={b} />}
      {tab === 'Команда и посты' && <TeamResources b={b} />}
      {tab === 'История' && <AuditHistory b={b} />}
      {tab === 'Ожидание' && <WaitlistAdmin b={b} />}
      {tab === 'Промокоды' && <Promos b={b} />}
      {tab === 'Отзывы' && <Reviews b={b} />}
      {tab === 'Услуги' && <Services b={b} />}
      {tab === 'Студия' && <Settings b={b} />}
      {tab === 'Фото' && <Media b={b} />}
      {tab === 'Уведомления' && <Notify b={b} />}
      {tab === 'Документы' && <Docs b={b} />}
        </div>
      </div>
    </section>
  )
}

function TeamAccess({ b, canManageManagers = true }: { b: Business; canManageManagers?: boolean }) {
  const qc=useQueryClient(); const people=useQuery({queryKey:['owner','team',b.slug],queryFn:()=>owner.team(b.slug,'list')});
  const resources=useQuery({queryKey:['owner','resources',b.slug],queryFn:()=>owner.resources(b.slug)});
  const [email,setEmail]=useState(''); const [role,setRole]=useState<'manager'|'staff'>('staff'); const [resource,setResource]=useState(''); const [notice,setNotice]=useState('');
  const [credentials,setCredentials]=useState<{email:string;password:string}|null>(null);
  const refresh=()=>{void qc.invalidateQueries({queryKey:['owner','team',b.slug]})};
  const create=useMutation({mutationFn:()=>owner.team(b.slug,'create',{email:email.trim(),role,resource_id:role==='staff'?resource:null}),onSuccess:(data)=>{setNotice(data.created?'Аккаунт создан. Передайте сотруднику временный пароль лично.':'Почта уже зарегистрирована: доступ выдан, сотрудник входит со своим паролем.');if(data.temporary_password)setCredentials({email:email.trim(),password:data.temporary_password});setEmail('');refresh()},onError:(e)=>setNotice(errText(e))});
  const save=useMutation({mutationFn:(x:{user_id:string;role:'manager'|'staff';resource_id:string|null})=>owner.team(b.slug,'set_role',x),onSuccess:()=>{setNotice('Доступ обновлён.');refresh()},onError:e=>setNotice(errText(e))});
  const remove=useMutation({mutationFn:(id:string)=>owner.team(b.slug,'remove',{user_id:id}),onSuccess:()=>{setNotice('Доступ сотрудника отозван.');refresh()},onError:e=>setNotice(errText(e))});
  const reset=useMutation({mutationFn:(id:string)=>owner.teamAction(b.slug,'reset_password',{user_id:id}),onSuccess:(data, id)=>{const member=people.data?.members.find(x=>x.user_id===id);if(data.temporary_password&&member)setCredentials({email:member.email,password:data.temporary_password});setNotice('Создан новый временный пароль. Старый пароль больше не действует.')},onError:e=>setNotice(errText(e))});
  return <div className="col"><div className="admin-subheading"><div><h2>Доступ сотрудников</h2><p className="muted small">Сотрудник входит по почте и паролю. Система не отправляет письма и коды.</p></div></div>
    <div className="card col"><b>Добавить сотрудника</b><label className="muted small">Почта сотрудника</label><input className="field" type="email" autoComplete="off" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/>
      <label className="muted small">Роль</label><select className="field" value={role} onChange={e=>setRole(e.target.value as 'manager'|'staff')}><option value="staff">Сотрудник — только свой пост и записи</option>{canManageManagers&&<option value="manager">Менеджер — записи и рабочие разделы</option>}</select>
      {role==='staff'&&<><label className="muted small">Рабочий пост</label><select className="field" value={resource} onChange={e=>setResource(e.target.value)}><option value="">Выберите пост</option>{resources.data?.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></>}
      {notice&&<p className="muted small" role="status">{notice}</p>}
      {credentials&&<div className="card col"><b>Временный пароль — сохраните сейчас</b><span>Логин: {credentials.email}</span><code>{credentials.password}</code><p className="muted small">Показывается только один раз. Передайте пароль лично. При первом входе сотрудник задаст новый.</p><button className="btn ghost mini" onClick={async()=>{try{await navigator.clipboard.writeText(`Логин: ${credentials.email}\nВременный пароль: ${credentials.password}`);setCredentials(null);setNotice('Данные скопированы. Передайте их сотруднику лично.')}catch{setNotice('Скопируйте пароль вручную и передайте сотруднику лично.')}}}>Скопировать и скрыть</button></div>}
      <button className="btn mini" disabled={create.isPending||!email.trim()||(role==='staff'&&!resource)} onClick={()=>{setNotice('');setCredentials(null);create.mutate()}}>{create.isPending?'Создаём аккаунт…':'Создать доступ'}</button>
    </div>
    <div className="admin-list-heading"><div><h2>Сотрудники</h2></div><button className="btn ghost mini" onClick={refresh}>Обновить</button></div>
    {people.isPending?<p className="muted">Загружаем…</p>:people.isError?<p className="err">Не удалось загрузить сотрудников. <button className="link" onClick={()=>void people.refetch()}>Повторить</button></p>:(people.data?.members??[]).length===0?<p className="muted">Пока нет добавленных сотрудников.</p>:(people.data?.members??[]).map(m=><TeamMemberRow key={m.user_id} member={m} resources={resources.data??[]} canManageManagers={canManageManagers} onSave={x=>save.mutate(x)} onRemove={()=>{if(window.confirm(`Отозвать доступ для ${m.email}?`))remove.mutate(m.user_id)}} onReset={()=>reset.mutate(m.user_id)} busy={save.isPending||remove.isPending||reset.isPending}/>)}
  </div>
}
function TeamMemberRow({member,resources,onSave,onRemove,onReset,canManageManagers,busy}:{member:{user_id:string;email:string;role:'manager'|'staff';resource_id:string|null;resource_name:string|null};resources:{id:string;name:string}[];onSave:(x:{user_id:string;role:'manager'|'staff';resource_id:string|null})=>void;onRemove:()=>void;onReset:()=>void;canManageManagers:boolean;busy:boolean}){
  const [role,setRole]=useState(member.role);const [resource,setResource]=useState(member.resource_id??'');
  return <div className="card col"><b>{member.email}</b><div className="row wrap"><select className="field" value={role} onChange={e=>setRole(e.target.value as 'manager'|'staff')}><option value="staff">Сотрудник</option>{canManageManagers&&<option value="manager">Менеджер</option>}</select>{role==='staff'&&<select className="field" value={resource} onChange={e=>setResource(e.target.value)}><option value="">Выберите пост</option>{resources.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>}<button className="btn ghost mini" disabled={busy||(role==='staff'&&!resource)} onClick={()=>onSave({user_id:member.user_id,role,resource_id:role==='staff'?resource:null})}>Сохранить</button><button className="btn ghost mini" disabled={busy} onClick={onReset}>Выдать новый пароль</button><button className="btn danger mini" disabled={busy} onClick={onRemove}>Отозвать доступ</button></div></div>
}

function MyAccess({b}:{b:Business}){
 const [key,setKey]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false)
 const create=async()=>{setBusy(true);setMessage('');try{const result=await owner.teamAction(b.slug,'enroll_recovery');setKey(result.recovery_key??'');setMessage('Ключ создан. Сохраните его в надёжном месте — при следующем создании старый ключ перестанет работать.')}catch{setMessage('Не удалось создать ключ восстановления. Повторите позже.')}finally{setBusy(false)}}
 return <div className="col"><div className="admin-subheading"><div><h2>Мой доступ</h2><p className="muted small">Создайте резервный ключ, чтобы восстановить пароль без писем и кодов.</p></div></div><div className="card col"><b>Восстановление аккаунта</b><p className="muted small">Ключ показывается только один раз. Если потеряете пароль и ключ, владелец или менеджер сможет выдать временный пароль. Владельцу без другого администратора поможет администратор проекта.</p>{message&&<p className="muted small" role="status">{message}</p>}{key&&<div className="card col"><code>{key}</code><button className="btn ghost mini" onClick={async()=>{try{await navigator.clipboard.writeText(key);setKey('');setMessage('Ключ скопирован. Сохраните его в надёжном месте.')}catch{setMessage('Скопируйте ключ вручную и сохраните в надёжном месте.')}}}>Скопировать и скрыть</button></div>}<button className="btn mini" disabled={busy} onClick={()=>void create()}>{busy?'Создаём…':'Создать или заменить ключ'}</button></div></div>
}

function Reports({ b }: { b: Business }) {
  const to = today(b); const from = new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 864e5).toISOString().slice(0, 10);
  const stats = useQuery({ queryKey: ['owner','source-stats',b.slug,from,to], queryFn: () => owner.sourceStats(b.slug,from,to) });
  const kpis = useQuery({ queryKey: ['owner','report-stats',b.slug,from,to], queryFn: () => owner.stats(b.slug,from,to) });
  const bookings = useQuery({ queryKey: ['owner','report-bookings',b.slug,from,to], queryFn: () => owner.bookings(b.slug,from,to) });
  const repeat = useQuery({ queryKey: ['owner','repeat-stats',b.slug,from,to], queryFn: () => owner.repeatStats(b.slug,from,to) });
  const resources = useQuery({ queryKey: ['owner','resources',b.slug], queryFn: () => owner.resources(b.slug) });
  let capacityMinutes=0; const keys=['sun','mon','tue','wed','thu','fri','sat'];
  for(let i=0;i<30;i++){const d=new Date(Date.parse(`${from}T12:00:00Z`)+i*864e5);const hours=b.hours[keys[d.getUTCDay()]!];if(hours){const a=Number(hours[0].slice(0,2))*60+Number(hours[0].slice(3,5));const z=Number(hours[1].slice(0,2))*60+Number(hours[1].slice(3,5));capacityMinutes+=Math.max(0,z-a)*Math.max(1,resources.data?.length??b.resources.length);}}
  const reservedMinutes=(bookings.data??[]).filter(x=>x.status!=='cancelled').reduce((n,x)=>n+Math.max(0,(Date.parse(x.ends_at)-Date.parse(x.starts_at))/60000),0);
  const occupancy=capacityMinutes?Math.min(100,Math.round(reservedMinutes/capacityMinutes*100)):0;
  const popularServices = Object.values((bookings.data??[]).reduce<Record<string,{id:string;name:string;bookings:number;done:number;received:number}>>((acc,x)=>{const item=acc[x.service_id]??{id:x.service_id,name:x.service_name,bookings:0,done:0,received:0};if(x.status!=='cancelled')item.bookings++;if(x.status==='done')item.done++;item.received+=x.paid_cents;acc[x.service_id]=item;return acc},{})).sort((a,z)=>z.bookings-a.bookings||z.done-a.done);
  const returningRate=repeat.data?.unique_clients?Math.round(repeat.data.returning_clients/repeat.data.unique_clients*100):0;
  const reportReady=!bookings.isPending&&!kpis.isPending&&!repeat.isPending&&!bookings.isError&&!kpis.isError&&!repeat.isError;
  const exportReport = () => {
    const rows: unknown[][] = [['Раздел','Показатель','Значение'],['Период','С',''],['Период','По',''],['Общее','Получено',kpis.data?.received_cents ? kpis.data.received_cents/100 : 0],['Общее','Записей',kpis.data?.booked ?? 0],['Общее','Визитов',kpis.data?.visits ?? 0],['Общее','Загрузка постов',`${occupancy}%`],['Клиенты','Средний чек',repeat.data?.average_check_cents ? repeat.data.average_check_cents/100 : 0],['Клиенты','Всего клиентов',repeat.data?.unique_clients ?? 0],['Клиенты','Вернувшиеся клиенты',repeat.data?.returning_clients ?? 0],['Клиенты','Повторные визиты',repeat.data?.returning_visits ?? 0],[],['Популярные услуги','Услуга','Записи','Визиты','Получено']];
    rows[1]![2]=from; rows[2]![2]=to;
    popularServices.forEach((s)=>rows.push(['Популярные услуги',s.name,s.bookings,s.done,s.received/100]));
    downloadCsv(`report-${b.slug}-${from}-${to}.csv`,rows);
  };
  const exportBookings = () => downloadCsv(`bookings-${b.slug}-${from}-${to}.csv`,[
    ['Дата и время','Услуга','Клиент','Телефон','Автомобиль','Мастер / пост','Статус','Стоимость','Получено'],
    ...(bookings.data??[]).map(x=>[fmtT(b,x.starts_at,'yyyy-MM-dd HH:mm'),x.service_name,x.customer_name,x.customer_phone,x.car,x.resource_name,({booked:'Записан',arrived:'Прибыл',done:'Завершён',cancelled:'Отменён'} as Record<string,string>)[x.status]??x.status,x.price_cents/100,x.paid_cents/100])
  ]);
  return <div className="col"><div className="admin-subheading"><div><h2>Отчёты за 30 дней</h2><p className="muted small">Выручка, загрузка постов и источники обращений.</p></div><div className="row wrap"><button className="btn ghost mini" disabled={!reportReady} onClick={exportReport}>Скачать отчёт для Excel</button><button className="btn ghost mini" disabled={bookings.isPending||bookings.isError} onClick={exportBookings}>Скачать записи</button></div></div>
    {kpis.data&&<div className="stats admin-stats"><div className="card admin-stat"><span className="muted small">Получено</span><b>{money(kpis.data.received_cents/100,b.currency)}</b></div><div className="card admin-stat"><span className="muted small">Записей</span><b>{kpis.data.booked}</b></div><div className="card admin-stat"><span className="muted small">Визитов</span><b>{kpis.data.visits}</b></div><div className="card admin-stat"><span className="muted small">Загрузка постов</span><b>{bookings.isPending||resources.isPending?'…':`${occupancy}%`}</b></div></div>}
    <p className="muted small">Загрузка — оценка занятых минут к рабочим минутам всех постов по недельному графику.</p>
    <div className="admin-subheading"><div><h2>Популярные услуги</h2><p className="muted small">За последние 30 дней, по числу записей.</p></div></div>
    {bookings.isPending?<p className="muted">Считаем популярность услуг…</p>:bookings.isError?<p className="err">Не удалось загрузить популярность услуг. <button className="link" onClick={()=>void bookings.refetch()}>Повторить</button></p>:popularServices.length===0?<p className="muted">Записей за этот период пока нет.</p>:<div className="admin-report-services"><div className="admin-report-service-head"><span>Услуга</span><span>Записи</span><span>Визиты</span><span>Получено</span></div>{popularServices.map((s,i)=><div className="admin-report-service" key={s.id}><span className="admin-report-service-name"><i>{i+1}</i><b>{s.name}</b></span><span>{s.bookings}</span><span>{s.done}</span><b>{money(s.received/100,b.currency)}</b></div>)}</div>}
    <div className="admin-subheading"><div><h2>Средний чек и повторные визиты</h2><p className="muted small">По завершённым визитам за последние 30 дней.</p></div></div>
    {repeat.isPending?<p className="muted">Считаем визиты клиентов…</p>:repeat.isError?<p className="err">Не удалось загрузить повторные визиты. <button className="link" onClick={()=>void repeat.refetch()}>Повторить</button></p>:<><div className="stats admin-stats"><div className="card admin-stat"><span className="muted small">Средний чек</span><b>{repeat.data.completed_visits?money(repeat.data.average_check_cents/100,b.currency):'—'}</b></div><div className="card admin-stat"><span className="muted small">Клиентов с визитами</span><b>{repeat.data.unique_clients}</b></div><div className="card admin-stat"><span className="muted small">Вернулись снова</span><b>{repeat.data.returning_clients}{repeat.data.unique_clients?` · ${returningRate}%`:''}</b></div><div className="card admin-stat"><span className="muted small">Повторных визитов</span><b>{repeat.data.returning_visits}</b></div></div><p className="muted small">Средний чек рассчитан по цене завершённого визита с учётом скидки. Повторный визит — завершённая запись клиента, у которого уже был завершённый визит раньше.</p></>}
    <div className="admin-subheading"><div><h2>Источники записей</h2><p className="muted small">UTM-метки и домены переходов.</p></div></div>
    {stats.isPending ? <p className="muted">Загрузка отчёта…</p> : stats.isError ? <p className="err">Не удалось загрузить отчёт. <button className="link" onClick={() => void stats.refetch()}>Повторить</button></p> : (stats.data ?? []).length === 0 ? <p className="muted">Записей за этот период пока нет.</p> : <div className="card col">{stats.data!.map((x) => <div className="kv" key={x.source}><span>{x.source === 'direct' ? 'Прямые переходы' : x.source} · {x.visits} записей</span><b>{money(x.received_cents / 100,b.currency)}</b></div>)}</div>}
    <p className="muted small">Источник сохраняется при записи: UTM-метка или домен перехода. Личные данные и полный URL не записываются.</p>
  </div>;
}

function downloadCsv(fileName:string, rows:unknown[][]) {
  const cell=(value:unknown)=>{const raw=String(value??'');const safe=/^[\s]*[=+\-@]/.test(raw)?`'${raw}`:raw;return `"${safe.replaceAll('"','""')}"`;};
  const csv='\ufeff'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=fileName;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function WaitlistAdmin({ b }: { b: Business }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['owner','waitlist',b.slug], queryFn: () => owner.waitlist(b.slug) });
  const setStatus = useMutation({ mutationFn: ({ id,status }: {id:string;status:'waiting'|'contacted'|'closed'}) => owner.waitlistStatus(id,status), onSuccess: () => void qc.invalidateQueries({ queryKey: ['owner','waitlist',b.slug] }) });
  return <div className="col"><div className="admin-subheading"><div><h2>Лист ожидания</h2><p className="muted small">Заявки клиентов на дни без свободных окон. О новых заявках придёт сообщение в Telegram.</p></div></div>
    {q.isPending ? <p className="muted">Загрузка…</p> : q.isError ? <p className="err">Не удалось загрузить лист ожидания. <button className="link" onClick={() => void q.refetch()}>Повторить</button></p> : !q.data?.length ? <p className="muted">Заявок пока нет.</p> : q.data.map((w) => <div className="card col" key={w.id}><div className="row between"><b>{w.customer_name} · {w.preferred_day}</b><span className="pill">{{waiting:'Ожидает',contacted:'Связались',closed:'Закрыта'}[w.status] ?? w.status}</span></div><span>{w.service_name} · {w.car}</span><a href={telHref(w.customer_phone)}>{w.customer_phone}</a><div className="row wrap"><button className="btn ghost mini" disabled={setStatus.isPending} onClick={() => setStatus.mutate({id:w.id,status:'contacted'})}>Связались</button><button className="btn ghost mini" disabled={setStatus.isPending} onClick={() => setStatus.mutate({id:w.id,status:'closed'})}>Закрыть заявку</button></div></div>)}
    {setStatus.isError && <p className="err small">Не удалось обновить статус заявки.</p>}
  </div>;
}

function TeamResources({b}:{b:Business}) {
  const qc=useQueryClient();const q=useQuery({queryKey:['owner','resources',b.slug],queryFn:()=>owner.resources(b.slug)});
  const [name,setName]=useState('');const [msg,setMsg]=useState<string|null>(null);const [saved,setSaved]=useState(false);
  const refresh=()=>{void qc.invalidateQueries({queryKey:['owner','resources',b.slug]});void qc.invalidateQueries({queryKey:['owner','bookings',b.slug]});void qc.invalidateQueries({queryKey:['owner','report-bookings',b.slug]});void qc.invalidateQueries({queryKey:['slots',b.slug]})};
  const add=useMutation({mutationFn:()=>owner.upsertResource(b.slug,null,name.trim()),onSuccess:()=>{setName('');setMsg(null);setSaved(true);refresh()},onError:e=>{setSaved(false);setMsg(errText(e))}});
  return <div className="col"><div className="admin-subheading"><div><h2>Команда и посты</h2><p className="muted small">Каждый мастер или пост получает отдельное расписание и учитывается при подборе свободного времени. Для ресурса с прошлыми записями можно изменить название, но удалить его нельзя.</p></div></div>
    {q.isPending?<p className="muted">Загружаем…</p>:q.isError?<p className="err">Не удалось загрузить список. <button className="link" onClick={()=>void q.refetch()}>Повторить</button></p>:q.data.map((r)=><TeamResourceRow key={r.id} b={b} resource={r} onSaved={refresh}/>)}
    <div className="card col"><b>Добавить мастера или пост</b><p className="muted small">Укажите рабочее место, например «Мастер Арман» или «Пост 2». Если запись занимает мастера и конкретный пост, объедините их в названии: «Арман — пост 2».</p><input className="field" maxLength={80} placeholder="Имя мастера или название поста" value={name} onChange={e=>{setName(e.target.value);setSaved(false);setMsg(null)}}/>{msg&&<p className="err small">{msg}</p>}{saved&&<p className="muted small" role="status">Добавлено.</p>}<button className="btn" disabled={add.isPending||!name.trim()} onClick={()=>add.mutate()}>{add.isPending?'Добавляем…':'Добавить'}</button></div>
  </div>
}

function TeamResourceRow({b,resource,onSaved}:{b:Business;resource:{id:string;name:string};onSaved:()=>void}) {
  const [name,setName]=useState(resource.name);const [msg,setMsg]=useState<string|null>(null);
  const save=useMutation({mutationFn:()=>owner.upsertResource(b.slug,resource.id,name.trim()),onSuccess:()=>{setMsg(null);onSaved()},onError:e=>setMsg(errText(e))});
  const remove=useMutation({mutationFn:()=>owner.deleteResource(b.slug,resource.id),onSuccess:()=>{setMsg(null);onSaved()},onError:e=>setMsg(errText(e))});
  return <div className="card col"><div className="row wrap"><input className="field" aria-label="Название рабочего ресурса" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/><button className="btn ghost mini" disabled={save.isPending||name.trim()===resource.name||!name.trim()} onClick={()=>save.mutate()}>{save.isPending?'Сохраняем…':'Сохранить'}</button><button className="btn ghost mini" disabled={remove.isPending} onClick={()=>{if(window.confirm(`Удалить «${resource.name}»?`))remove.mutate()}}>{remove.isPending?'Удаляем…':'Удалить'}</button></div>{msg&&<p className="err small" role="alert">{msg}</p>}</div>
}

function AuditHistory({b}:{b:Business}) {
  const [page,setPage]=useState(0);const limit=50;
  const q=useQuery({queryKey:['owner','audit',b.slug,page],queryFn:()=>owner.auditHistory(b.slug,limit+1,page*limit)});
  const items=q.data?.slice(0,limit)??[];const hasNext=(q.data?.length??0)>limit;
  return <div className="col"><div className="admin-subheading"><div><h2>История изменений</h2><p className="muted small">Записи, услуги, команда, оплаты и настройки студии.</p></div></div>
    {q.isPending?<p className="muted">Загрузка истории…</p>:q.isError?<p className="err">Не удалось загрузить историю. <button className="link" onClick={()=>void q.refetch()}>Повторить</button></p>:items.length===0?<p className="muted">Изменений пока нет.</p>:<div className="admin-audit-list">{items.map(e=><article className="card admin-audit-event" key={e.id}><div className="row between wrap"><b>{auditEntity(e.entity)} · {auditAction(e.action,e.entity)}</b><time className="muted small">{fmtT(b,e.created_at,'d MMM yyyy, HH:mm')}</time></div><p className="muted small">{auditDetail(e,b.currency)}{e.actor_email?` · ${e.actor_email}`:''}</p></article>)}</div>}
    {(page>0||hasNext)&&<nav className="admin-service-pagination" aria-label="История изменений"><button className="admin-page-button" disabled={page===0} onClick={()=>setPage(page-1)}>Назад</button><span className="muted small">Страница <b>{page+1}</b></span><button className="admin-page-button" disabled={!hasNext} onClick={()=>setPage(page+1)}>Далее</button></nav>}
  </div>
}

function auditEntity(entity:string) { return ({booking:'Запись',service:'Услуга',resource:'Мастер / пост',payment:'Оплата',studio:'Студия',notifications:'Уведомления',team:'Доступ сотрудника'} as Record<string,string>)[entity]??entity }
function auditAction(action:string,entity='') { if(entity==='team'&&action==='created')return 'доступ выдан';if(entity==='team'&&action==='updated')return 'права изменены';if(entity==='team'&&action==='deleted')return 'доступ отозван';return ({created:'создано',updated:'изменено',deleted:'удалено',payment:'оплата добавлена',refund:'возврат добавлен',settings_changed:'настройки обновлены',password_reset:'выдан новый временный пароль',account_recovered:'восстановлен доступ'} as Record<string,string>)[action]??action }
function auditDetail(e:OwnerAuditEvent,currency:string) {
  const d=e.details??{};
  if(e.entity==='service'||e.entity==='resource') {
    const pieces:string[]=[];
    const format=(key:string,value:unknown)=>key==='price_cents'?money(Number(value)/100,currency):key==='active'?(value===true||value==='true'?'показывается клиентам':'скрыта от клиентов'):String(value??'—');
    for(const key of ['name','category','price_cents','active'])if(d[key]!==undefined){const value=d[key];const label:Record<string,string>={name:'Название',category:'Категория',price_cents:'Цена',active:'Показ'};const change=value&&typeof value==='object'?value as Record<string,unknown>:null;pieces.push(change?`${label[key]}: ${format(key,change.from)} → ${format(key,change.to)}`:`${label[key]}: ${format(key,value)}`)}
    return pieces.join(' · ')||`ID ${e.entity_id?.slice(0,8)??''}`;
  }
  if(e.entity==='payment')return `${money(Number(d.amount_cents??0)/100,currency)}${e.action==='refund'?' возвращено':' получено'}`;
  if(e.entity==='team')return `${String(d.email??'Сотрудник')}${d.role?` · роль: ${d.role==='staff'?'сотрудник':'менеджер'}`:''}${d.resource?` · пост: ${String(d.resource)}`:''}`;
  if(e.entity==='studio'||e.entity==='notifications') {const names:Record<string,string>={phone:'телефон',address:'адрес',description:'описание',cards:'текст главной',hours:'часы работы',gallery:'галерея',client_telegram_enabled:'Telegram для клиентов',reminder_hours_before:'время напоминания',repeat_after_days:'период повторного визита',reminder_message:'текст напоминания',repeat_message:'текст повторного сообщения',legal:'юридические реквизиты'};const fields=Array.isArray(d.fields)?d.fields.map(x=>names[String(x)]??String(x)).join(', '):'настройки';const hours=d.hours as {from?:unknown;to?:unknown}|undefined;const days:Record<string,string>={mon:'Пн',tue:'Вт',wed:'Ср',thu:'Чт',fri:'Пт',sat:'Сб',sun:'Вс'};const schedule=(value:unknown)=>value&&typeof value==='object'?Object.entries(value as Record<string,unknown>).map(([day,range])=>`${days[day]??day} ${Array.isArray(range)?range.join('–'):'выходной'}`).join(', '):'не задан';return `Изменены поля: ${fields}${hours?` · график: ${schedule(hours.from)} → ${schedule(hours.to)}`:''}`}
  const changes=Object.entries(d).filter(([key])=>key!=='hours').map(([key,value])=>{const labels:Record<string,string>={status:'Статус',starts_at:'Время',service_id:'Услуга',resource_id:'Мастер / пост'};const label=labels[key]??key;const change=value&&typeof value==='object'?value as Record<string,unknown>:null;const status=(v:unknown)=>({booked:'Записан',arrived:'Прибыл',done:'Завершён',cancelled:'Отменён'} as Record<string,string>)[String(v)]??String(v??'—');return change?`${label}: ${key==='status'?status(change.from):String(change.from??'—')} → ${key==='status'?status(change.to):String(change.to??'—')}`:`${label}: ${String(value)}`});
  return changes.join(' · ')||`ID ${e.entity_id?.slice(0,8)??''}`;
}

function Promos({ b }: { b: Business }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['owner','promos',b.slug], queryFn: () => owner.promos(b.slug) });
  const emptyForm = {code:'',kind:'percent' as 'percent'|'fixed',value:'10',limit:''};
  const [form,setForm] = useState(emptyForm); const [editingId,setEditingId] = useState<string|null>(null); const [msg,setMsg] = useState<string|null>(null);
  const refresh = () => void qc.invalidateQueries({queryKey:['owner','promos',b.slug]});
  const save = useMutation({ mutationFn: () => owner.upsertPromo(b.slug,{id:editingId??undefined,code:form.code.trim().toUpperCase(),kind:form.kind,value:form.kind==='fixed'?Math.round(Number(form.value)*100):Number(form.value),limit:form.limit?Number(form.limit):null,active:editingId ? q.data?.find(p=>p.id===editingId)?.active??true : true}), onSuccess: () => { setForm(emptyForm);setEditingId(null);setMsg(null);refresh(); }, onError: () => setMsg('Проверьте код, размер скидки и лимит использований.') });
  const toggle = useMutation({ mutationFn: (p: NonNullable<typeof q.data>[number]) => owner.upsertPromo(b.slug,{id:p.id,code:p.code,kind:p.discount_kind,value:p.discount_value,limit:p.usage_limit,active:!p.active}), onSuccess: () => void qc.invalidateQueries({queryKey:['owner','promos',b.slug]}) });
  const remove = useMutation({mutationFn:(id:string)=>owner.deletePromo(b.slug,id),onSuccess:refresh,onError:(e)=>setMsg(errText(e))});
  const edit = (p: NonNullable<typeof q.data>[number]) => { setEditingId(p.id); setForm({code:p.code,kind:p.discount_kind,value:String(p.discount_kind==='fixed'?p.discount_value/100:p.discount_value),limit:p.usage_limit?String(p.usage_limit):''}); setMsg(null); };
  return <div className="col"><div className="admin-subheading"><div><h2>Промокоды</h2><p className="muted small">Скидка пересчитывается и списывается атомарно при подтверждении записи.</p></div></div>
    <div className="card col"><h3>{editingId?'Изменить промокод':'Добавить промокод'}</h3><input className="field" aria-label="Код промокода" placeholder="Код, например START10" maxLength={24} value={form.code} onChange={(e)=>setForm({...form,code:e.target.value.toUpperCase()})}/><div className="row wrap"><select className="field" value={form.kind} onChange={(e)=>setForm({...form,kind:e.target.value as 'percent'|'fixed'})}><option value="percent">Процент</option><option value="fixed">Сумма</option></select><input className="field" aria-label="Размер скидки" type="number" min="1" max={form.kind==='percent'?100:1000000} value={form.value} onChange={(e)=>setForm({...form,value:e.target.value})}/><input className="field" aria-label="Лимит применений" type="number" min="1" placeholder="Без лимита" value={form.limit} onChange={(e)=>setForm({...form,limit:e.target.value})}/></div>{msg&&<p className="err small">{msg}</p>}<div className="row wrap"><button className="btn" disabled={save.isPending||!form.code.trim()||!Number(form.value)} onClick={()=>save.mutate()}>{save.isPending?'Сохраняем…':editingId?'Сохранить':'Создать промокод'}</button>{editingId&&<button className="btn ghost" onClick={()=>{setEditingId(null);setForm(emptyForm);setMsg(null)}}>Отмена</button>}</div></div>
    {q.isPending?<p className="muted">Загрузка промокодов…</p>:q.isError?<p className="err">Не удалось загрузить промокоды.</p>:q.data?.map(p=><div className="card row between admin-promo-row" key={p.id}><div><b>{p.code}</b><p className="muted small">{p.discount_kind==='percent'?`${p.discount_value}%`:`${money(p.discount_value/100,b.currency)}`} · использован {p.used_count}{p.usage_limit?` из ${p.usage_limit}`:' · без лимита'} · {p.active?'Активен':'Отключён'}</p></div><MoreMenu label={`Действия для промокода ${p.code}`}><button onClick={()=>edit(p)}>Изменить</button><button disabled={toggle.isPending} onClick={()=>toggle.mutate(p)}>{p.active?'Отключить':'Включить'}</button><button className="danger" disabled={remove.isPending} onClick={()=>{if(window.confirm(`Удалить промокод ${p.code}?`))remove.mutate(p.id)}}>Удалить</button></MoreMenu></div>)}
  </div>;
}

function MoreMenu({label,children}:{label:string;children:ReactNode}) {
  return <details className="admin-more-menu"><summary aria-label={label} title={label}>⋯</summary><div className="admin-more-panel">{children}</div></details>
}

function Reviews({ b }: { b: Business }) {
  const qc=useQueryClient();const q=useQuery({queryKey:['owner','reviews',b.slug],queryFn:()=>owner.reviews(b.slug)});
  const toggle=useMutation({mutationFn:({id,published}:{id:string;published:boolean})=>owner.publishReview(id,published),onSuccess:()=>void qc.invalidateQueries({queryKey:['owner','reviews',b.slug]})});
  return <div className="col"><div className="admin-subheading"><div><h2>Отзывы клиентов</h2><p className="muted small">Отзывы доступны после завершённого визита. Публикация отображает отзыв на главной странице.</p></div></div>
    {q.isPending?<p className="muted">Загрузка…</p>:q.isError?<p className="err">Не удалось загрузить отзывы.</p>:!q.data?.length?<p className="muted">Отзывы появятся после выполненных записей.</p>:q.data.map(r=><div className="card col" key={r.id}><div className="row between"><b>{r.customer_name} · {r.service_name}</b><span>{'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}</span></div>{r.comment&&<p>{r.comment}</p>}<button className="btn ghost mini" disabled={toggle.isPending} onClick={()=>toggle.mutate({id:r.id,published:!r.published})}>{r.published?'Снять с публикации':'Опубликовать отзыв'}</button></div>)}
  </div>;
}

const today = (b: Business) => formatInTimeZone(new Date(), b.timezone, 'yyyy-MM-dd')
const fmtT = (b: Business, s: string, p: string) =>
  formatInTimeZone(new Date(s), b.timezone, p, { locale: ru })

function Bookings({ b, role = 'owner' }: { b: Business; role?: 'owner'|'manager'|'staff' }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'day' | 'week'>('day')
  const [day, setDay] = useState(today(b))
  const [sel, setSel] = useState<OwnerBooking | null>(null)
  const [add, setAdd] = useState(false)
  const [block, setBlock] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [resourceFilter, setResourceFilter] = useState('all')
  const resources = useQuery({ queryKey: ['owner','resources',b.slug], queryFn: () => owner.resources(b.slug) })
  const shiftDay = (date: string, amount: number) =>
    new Date(Date.parse(`${date}T12:00:00Z`) + amount * 864e5).toISOString().slice(0, 10)
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    shiftDay(day, i),
  )
  const to = mode === 'day' ? day : weekDays[6]!
  const list = useQuery({
    queryKey: ['owner', 'bookings', b.slug, day, to],
    queryFn: () => role === 'staff' ? owner.staffBookings(b.slug, day, to) : owner.bookings(b.slug, day, to),
  })
  const stats = useQuery({
    queryKey: ['owner', 'stats', b.slug, day, to],
    queryFn: () => owner.stats(b.slug, day, to),
    enabled: role !== 'staff',
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['owner'] })
  const visible = (list.data ?? []).filter((x) => {
    const q = search.trim().toLocaleLowerCase('ru')
    const matchesSearch = !q || [x.customer_name, x.customer_phone, x.car, x.service_name, x.resource_name]
      .some((value) => value.toLocaleLowerCase('ru').includes(q))
    return matchesSearch && (statusFilter === 'all' || x.status === statusFilter) && (resourceFilter === 'all' || x.resource_name === resources.data?.find((r) => r.id === resourceFilter)?.name)
  })
  return (
    <>
      <div className="admin-toolbar">
        <div className="admin-view-switch" role="group" aria-label="Период расписания">
          <button className={`chip mini ${mode === 'day' ? 'sel' : ''}`} onClick={() => setMode('day')}>День</button>
          <button className={`chip mini ${mode === 'week' ? 'sel' : ''}`} onClick={() => setMode('week')}>Неделя</button>
        </div>
        <div className="admin-date-controls">
          <button className="admin-icon-button" aria-label="Предыдущий период" onClick={() => setDay(shiftDay(day, mode === 'day' ? -1 : -7))}>‹</button>
          <input aria-label="Дата расписания" className="field admin-date" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <button className="admin-icon-button" aria-label="Следующий период" onClick={() => setDay(shiftDay(day, mode === 'day' ? 1 : 7))}>›</button>
          <button className="btn ghost mini" onClick={() => setDay(today(b))}>Сегодня</button>
        </div>
        <button className="btn ghost mini admin-refresh" onClick={refresh} disabled={list.isFetching || stats.isFetching}>
          {list.isFetching || stats.isFetching ? 'Обновляем…' : 'Обновить'}
        </button>
      </div>
      {role !== 'staff' && stats.data && (
        <>
          <p className="muted small admin-section-caption">Сводка за {mode === 'day' ? 'день' : 'неделю'}</p>
          <div className="stats admin-stats">
            <div className="card admin-stat"><span className="muted small">Записи</span><b>{stats.data.visits}</b></div>
            <div className="card admin-stat"><span className="muted small">Завершено</span><b>{stats.data.done}</b></div>
            <div className="card admin-stat"><span className="muted small">Получено</span><b>{money(Number(stats.data.received_cents) / 100, b.currency)}</b></div>
            <div className="card admin-stat"><span className="muted small">К оплате</span><b>{money(Number(stats.data.expected_cents) / 100, b.currency)}</b></div>
          </div>
        </>
      )}
      {role !== 'staff' && stats.isError && <p className="err small">Статистика недоступна.</p>}
      {role !== 'staff' && <div className="admin-actions">
        <button className="btn mini" onClick={() => setAdd(true)}>
          + Запись
        </button>
        <button className="btn ghost mini" onClick={() => setBlock(true)}>
          Заблокировать пост
        </button>
      </div>}
      <div className="admin-list-heading">
        <div><h2>Записи</h2><span className="muted small">{visible.length} из {list.data?.length ?? 0}</span></div>
        <div className="admin-filters">
          <input className="field admin-search" aria-label="Поиск записей" placeholder="Клиент, телефон, авто…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="field admin-status-filter" aria-label="Фильтр по статусу" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Все статусы</option>
            <option value="booked">Записаны</option>
            <option value="arrived">Приняты</option>
            <option value="done">Завершены</option>
            <option value="cancelled">Отменены</option>
          </select>
          <select className="field admin-status-filter" aria-label="Фильтр по посту" value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)}><option value="all">Все посты</option>{resources.data?.map((r)=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        </div>
      </div>
      {list.isPending ? (
        <p className="muted">Загрузка…</p>
      ) : list.isError ? (
        <p className="err">
          Не удалось загрузить записи.{' '}
          <button className="link" onClick={() => list.refetch()}>
            Повторить
          </button>
        </p>
      ) : visible.length === 0 ? (
        <div className="admin-empty">
          <span className="admin-empty-icon">✓</span>
          <b>{list.data.length === 0 ? 'На этот период записей пока нет' : 'По вашему запросу ничего не найдено'}</b>
          <p className="muted small">{list.data.length === 0 ? 'Новые записи появятся здесь автоматически.' : 'Попробуйте изменить запрос или очистить фильтры.'}</p>
          {(search || statusFilter !== 'all' || resourceFilter !== 'all') && <button className="link" onClick={() => { setSearch(''); setStatusFilter('all'); setResourceFilter('all') }}>Очистить фильтры</button>}
        </div>
      ) : mode === 'week' ? (
        <div className="week-calendar">
          {weekDays.map((iso) => {
            const entries = visible.filter((x) => fmtT(b, x.starts_at, 'yyyy-MM-dd') === iso)
            return <section className="week-day" key={iso}>
              <h3>{formatInTimeZone(new Date(`${iso}T12:00:00Z`), b.timezone, 'EEEE, d MMMM', { locale: ru })}<span>{entries.length}</span></h3>
              {entries.length === 0 ? <p className="muted small">Записей нет</p> : entries.map((x) => (
                <button key={x.id} className={`card bk admin-booking status-${x.status}`} onClick={() => setSel(x)}>
                  <span className="row between"><b>{fmtT(b, x.starts_at, 'HH:mm')}</b><span className="pill">{STATUS[x.status] ?? x.status}</span></span>
                  <span>{x.service_name} · {x.resource_name}</span>
                  <span className="muted small">{x.car} · {x.customer_name} · {x.customer_phone}</span>
                  {role !== 'staff' && <span className="muted small">{money(x.price_cents / 100, b.currency)} · оплачено {money(x.paid_cents / 100, b.currency)}</span>}
                </button>
              ))}
            </section>
          })}
        </div>
      ) : (
        visible.map((x) => (
          <button key={x.id} className={`card bk admin-booking status-${x.status}`} onClick={() => setSel(x)}>
            <span className="row between">
              <b>{fmtT(b, x.starts_at, 'd MMM, HH:mm')}</b>
              <span className="pill">{STATUS[x.status] ?? x.status}</span>
            </span>
            <span>
              {x.service_name} · {x.resource_name}
            </span>
            {role !== 'staff' && <span className="muted small">
              {x.car} · {x.customer_name} · {x.customer_phone}
            </span>}
            <span className="muted small">
              {money(x.price_cents / 100, b.currency)} · оплачено{' '}
              {money(x.paid_cents / 100, b.currency)}
            </span>
          </button>
        ))
      )}
      {sel && <Actions b={b} bk={sel} role={role} onClose={() => setSel(null)} onDone={refresh} />}
      {add && <AddBooking b={b} onClose={() => setAdd(false)} onDone={refresh} />}
      {block && <BlockPost b={b} onClose={() => setBlock(false)} onDone={refresh} />}
    </>
  )
}

function useAct(onDone: () => void, close?: () => void) {
  const [msg, setMsg] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => {
      setMsg(null)
      onDone()
      close?.()
    },
    onError: (e) => setMsg(errText(e)),
  })
  return { run: (f: () => Promise<unknown>) => m.mutate(f), busy: m.isPending, msg }
}
const Err = ({ m }: { m: string | null }) =>
  m ? (
    <p role="alert" className="err">
      {m}
    </p>
  ) : null

function SlotPicker({
  b,
  service,
  onPick,
  picked,
}: {
  b: Business
  service: string | null
  onPick: (s: string) => void
  picked: string | null
}) {
  const [day, setDay] = useState(today(b))
  const q = useQuery({
    queryKey: ['slots', b.slug, service, day],
    queryFn: () => fetchSlots(b.slug, service!, day),
    enabled: !!service,
  })
  return (
    <>
      <input
        aria-label="Дата"
        className="field"
        type="date"
        value={day}
        onChange={(e) => e.target.value && setDay(e.target.value)}
      />
      {!service ? (
        <p className="muted small">Выберите услугу.</p>
      ) : q.isPending ? (
        <p className="muted">Загрузка…</p>
      ) : q.isError ? (
        <p className="err">Не удалось получить время.</p>
      ) : q.data.length === 0 ? (
        <p className="muted">В этот день приёма нет.</p>
      ) : (
        <div className="chips">
          {q.data.map((s) => (
            <button
              key={s.slot}
              disabled={!s.free}
              className={`chip ${picked === s.slot ? 'sel' : ''}`}
              onClick={() => onPick(s.slot)}
            >
              {fmtT(b, s.slot, 'HH:mm')}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function Actions({
  b,
  bk,
  role = 'owner',
  onClose,
  onDone,
}: {
  b: Business
  bk: OwnerBooking
  role?: 'owner'|'manager'|'staff'
  onClose: () => void
  onDone: () => void
}) {
  const a = useAct(onDone, onClose)
  const [amount, setAmount] = useState('')
  const [move, setMove] = useState(false)
  const [slot, setSlot] = useState<string | null>(null)
  const svc = useQuery({ queryKey: ['owner', 'svc', b.slug], queryFn: () => fetchServices(b.slug) })
  const sid = svc.data?.find((s) => s.id === bk.service_id)?.id ?? null
  const cents = Math.round(Number(amount.replace(',', '.')) * 100)
  const okAmt = Number.isFinite(cents) && cents > 0
  return (
    <Sheet
      title={bk.service_name}
      sub={`${fmtT(b, bk.starts_at, 'd MMMM, HH:mm')} · ${bk.car}`}
      onClose={onClose}
    >
      <Err m={a.msg} />
      <p className="muted small">
        {bk.customer_name}, <a href={telHref(bk.customer_phone)}>{bk.customer_phone}</a>
        {role !== 'staff' && <><br />{money(bk.price_cents / 100, b.currency)} · оплачено {money(bk.paid_cents / 100, b.currency)}</>}
      </p>
      <div className="row wrap">
        {bk.status === 'booked' && (
          <button
            className="btn mini"
            disabled={a.busy}
            onClick={() => a.run(() => role === 'staff' ? owner.staffSetStatus(bk.id, 'arrived') : owner.setStatus(bk.id, 'arrived'))}
          >
            Машина принята
          </button>
        )}
        {(bk.status === 'booked' || bk.status === 'arrived') && (
          <button
            className="btn mini"
            disabled={a.busy}
            onClick={() => a.run(() => role === 'staff' ? owner.staffSetStatus(bk.id, 'done') : owner.setStatus(bk.id, 'done'))}
          >
            Готова
          </button>
        )}
      </div>
      {role !== 'staff' && <><label className="muted small" htmlFor="amt">
        Сумма оплаты или возврата, {b.currency}
      </label>
      <input
        id="amt"
        className="field"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <div className="row wrap">
        <button
          className="btn ghost mini"
          disabled={a.busy || !okAmt}
          onClick={() => a.run(() => owner.payment(bk.id, cents, 'payment'))}
        >
          Внести оплату
        </button>
        <button
          className="btn ghost mini"
          disabled={a.busy || !okAmt}
          onClick={() => a.run(() => owner.payment(bk.id, cents, 'refund'))}
        >
          Вернуть
        </button>
      </div>
      <button
        className="btn ghost"
        disabled={a.busy}
        onClick={() => {
          if (
            window.confirm(
              'Удалить имя, телефон и автомобиль клиента из этой записи? Действие необратимо.',
            )
          )
            a.run(() => owner.erase(bk.id))
        }}
      >
        Удалить данные клиента
      </button>
      </>}
      {role !== 'staff' && bk.status === 'booked' && (
        <>
          <button className="btn ghost" onClick={() => setMove(!move)}>
            Перенести
          </button>
          {move && (
            <>
              <SlotPicker b={b} service={sid} picked={slot} onPick={setSlot} />
              <button
                className="btn"
                disabled={!slot || a.busy}
                onClick={() => a.run(() => owner.reschedule(bk.id, slot!))}
              >
                Перенести на выбранное время
              </button>
            </>
          )}
          <button
            className="btn danger"
            disabled={a.busy}
            onClick={() => {
              if (window.confirm('Отменить запись?')) a.run(() => owner.cancel(bk.id))
            }}
          >
            Отменить запись
          </button>
        </>
      )}
    </Sheet>
  )
}

const Contact = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s()-]{10,18}$/),
  car: z.string().trim().min(2).max(60),
})
function AddBooking({
  b,
  onClose,
  onDone,
}: {
  b: Business
  onClose: () => void
  onDone: () => void
}) {
  const a = useAct(onDone, onClose)
  const svc = useQuery({ queryKey: ['owner', 'svc', b.slug], queryFn: () => fetchServices(b.slug) })
  const [service, setService] = useState<string | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const [f, setF] = useState({ name: '', phone: '', car: '' })
  const v = Contact.safeParse(f)
  return (
    <Sheet title="Новая запись" onClose={onClose}>
      <Err m={a.msg} />
      <label className="muted small" htmlFor="sv">
        Услуга
      </label>
      <select
        id="sv"
        className="field"
        value={service ?? ''}
        onChange={(e) => {
          setService(e.target.value || null)
          setSlot(null)
        }}
      >
        <option value="">Выберите…</option>
        {svc.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <SlotPicker b={b} service={service} picked={slot} onPick={setSlot} />
      {(['name', 'phone', 'car'] as const).map((k) => (
        <input
          key={k}
          className="field"
          placeholder={{ name: 'Имя', phone: 'Телефон', car: 'Автомобиль' }[k]}
          value={f[k]}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
        />
      ))}
      <button
        className="btn"
        disabled={!service || !slot || !v.success || a.busy}
        onClick={() => a.run(() => owner.create(b.slug, { service: service!, start: slot!, ...f }))}
      >
        Создать запись
      </button>
    </Sheet>
  )
}

function BlockPost({
  b,
  onClose,
  onDone,
}: {
  b: Business
  onClose: () => void
  onDone: () => void
}) {
  const a = useAct(onDone, onClose)
  const res = useQuery({
    queryKey: ['owner', 'res', b.slug],
    queryFn: () => owner.resources(b.slug),
  })
  const [r, setR] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const ok = r && from && to && fromZonedTime(to, b.timezone) > fromZonedTime(from, b.timezone)
  return (
    <Sheet
      title="Блокировка поста"
      sub="Время указывается по часовому поясу студии"
      onClose={onClose}
    >
      <Err m={a.msg} />
      <select aria-label="Пост" className="field" value={r} onChange={(e) => setR(e.target.value)}>
        <option value="">Пост…</option>
        {res.data?.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <label className="muted small" htmlFor="bf">
        С
      </label>
      <input
        id="bf"
        className="field"
        type="datetime-local"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      <label className="muted small" htmlFor="bt">
        До
      </label>
      <input
        id="bt"
        className="field"
        type="datetime-local"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <button
        className="btn"
        disabled={!ok || a.busy}
        onClick={() =>
          a.run(() =>
            owner.block(
              b.slug,
              r,
              fromZonedTime(from, b.timezone).toISOString(),
              fromZonedTime(to, b.timezone).toISOString(),
            ),
          )
        }
      >
        Заблокировать
      </button>
    </Sheet>
  )
}

function ServiceRow({
  b,
  s,
  onSaved,
  categoryOptions,
}: {
  b: Business
  s: {
    id: string | null
    name: string
    category: string
    price_cents: number
    duration_minutes: number
    active?: boolean
  }
  onSaved: () => void
  categoryOptions: string[]
}) {
  const a = useAct(onSaved)
  const [name, setName] = useState(s.name)
  const [category, setCategory] = useState(s.category || 'Другое')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [price, setPrice] = useState(String(s.price_cents / 100))
  const [min, setMin] = useState(String(s.duration_minutes))
  const [active, setActive] = useState(s.active ?? true)
  const minutes = Number(min)
  const cents = Math.round(Number(price.replace(',', '.')) * 100)
  const ok =
    name.trim() && category.trim().length > 0 && category.trim().length <= 60 && Number.isFinite(cents) && cents >= 0 && Number.isInteger(minutes) && minutes > 0
  const categoryListId = `service-categories-${b.slug}-${s.id ?? 'new'}`
  return (
    <article className="admin-service-row">
      <Err m={a.msg} />
      <div className="admin-service-main">
        <div><label className="muted small" htmlFor={`${categoryListId}-name`}>Название услуги</label><input id={`${categoryListId}-name`} aria-label="Название" className="field" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="muted small" htmlFor={`${categoryListId}-input`}>Категория</label>{creatingCategory
          ? <div className="admin-new-category-control"><input id={`${categoryListId}-input`} aria-label="Название новой категории" className="field" maxLength={60} autoFocus placeholder="Например, Стёкла" value={category} onChange={(e) => setCategory(e.target.value)} /><button type="button" className="link" onClick={() => { setCreatingCategory(false); setCategory(s.category || 'Другое'); }}>Отмена</button></div>
          : <select id={`${categoryListId}-input`} aria-label="Категория услуги" className="field" value={category} onChange={(e) => { if (e.target.value === '__create_category__') { setCreatingCategory(true); setCategory(''); } else setCategory(e.target.value); }}>
            {[...new Set([...SERVICE_CATEGORIES, ...categoryOptions])].map((item) => <option key={item} value={item}>{item}</option>)}
            <option value="__create_category__">＋ Создать новую категорию…</option>
          </select>}</div>
        <div><label className="muted small" htmlFor={`${categoryListId}-price`}>Цена, {b.currency}</label><input id={`${categoryListId}-price`} className="field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><label className="muted small" htmlFor={`${categoryListId}-duration`}>Длительность</label><input id={`${categoryListId}-duration`} className="field" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} /><span className="muted small">{ok ? duration(minutes) : 'Укажите минуты'}</span></div>
      </div>
      <div className="admin-service-footer">
        <label className="admin-service-active"><input type="checkbox" checked={active} disabled={a.busy} onChange={(e) => { const next = e.target.checked; if (!s.id) { setActive(next); return; } if (!next && !window.confirm(`Скрыть услугу «${name}»? Она исчезнет из списка услуг и переместится в архив. Её можно будет вернуть в любой момент.`)) return; a.run(async () => { await owner.upsertService(b.slug, { id: s.id, name, category, cents, minutes, active: next }); setActive(next); }) }} /><span className={`admin-service-status ${active ? 'on' : 'off'}`}>Показывать клиентам</span></label>
        <button className="btn mini admin-service-save" disabled={!ok || a.busy} onClick={() => a.run(() => owner.upsertService(b.slug, { id: s.id, name, category, cents, minutes, active }))}>{a.busy ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </article>
  )
}
function Services({ b }: { b: Business }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['owner', 'services', b.slug], queryFn: () => fetchServices(b.slug, true) })
  const [n, setN] = useState(0)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('Все услуги')
  const [visibilityFilter, setVisibilityFilter] = useState<'Активные' | 'Архив'>('Активные')
  const [servicePage, setServicePage] = useState(1)
  const pageSize = 10
  const saved = () => {
    void qc.invalidateQueries({ queryKey: ['services', b.slug] })
    void qc.invalidateQueries({ queryKey: ['owner', 'services', b.slug] })
  }
  return (
    <>
      <div className="admin-subheading">
        <div><h2>Услуги</h2><p className="muted small">Название, длительность и цена, которые видят клиенты.</p></div>
        {!q.isPending && !q.isError && <span className="admin-count">{q.data.length}</span>}
      </div>
      {q.isPending ? (
        <p className="muted">Загрузка…</p>
      ) : q.isError ? (
        <p className="err">Не удалось загрузить услуги.</p>
      ) : (
        <>
          <label className="sr-only" htmlFor={`admin-service-search-${b.slug}`}>Найти услугу</label>
          <input id={`admin-service-search-${b.slug}`} className="field" type="search" placeholder="Поиск по названию или категории" value={search} onChange={(e) => { setSearch(e.target.value); setServicePage(1); }} />
          {(() => {
            const needle = search.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
            const options = [...new Set([...SERVICE_CATEGORIES, ...serviceCategories(q.data)])]
            const rows = q.data.filter((service) => {
              const matchesSearch = `${service.name} ${service.category}`.toLocaleLowerCase('ru').replaceAll('ё', 'е').includes(needle)
              const matchesCategory = categoryFilter === 'Все услуги' || service.category === categoryFilter
              const matchesVisibility = visibilityFilter === 'Активные' ? service.active : !service.active
              return matchesSearch && matchesCategory && matchesVisibility
            })
            const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
            const currentPage = Math.min(servicePage, pageCount)
            const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
            return <>
              <div className="admin-service-filters">
                <label><span className="muted small">Категория</span><select className="field" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setServicePage(1); }}><option>Все услуги</option>{options.map((item) => <option key={item}>{item}</option>)}</select></label>
                <div className="admin-service-views" role="tablist" aria-label="Услуги и архив"><button type="button" role="tab" aria-selected={visibilityFilter==='Активные'} className={visibilityFilter==='Активные'?'active':''} onClick={()=>{setVisibilityFilter('Активные');setServicePage(1)}}>Услуги <span>{q.data.filter(x=>x.active).length}</span></button><button type="button" role="tab" aria-selected={visibilityFilter==='Архив'} className={visibilityFilter==='Архив'?'active':''} onClick={()=>{setVisibilityFilter('Архив');setServicePage(1)}}>Архив <span>{q.data.filter(x=>!x.active).length}</span></button></div>
                <span className="admin-service-result-count">Найдено <b>{rows.length}</b> из {q.data.length}</span>
              </div>
              <div className="admin-service-table">
                <div className="admin-service-table-head"><span>Услуга</span><span>Категория</span><span>Цена</span><span>Длительность</span></div>
                {visibleRows.map((s) => <ServiceRow key={s.id + s.name} b={b} s={s} categoryOptions={options} onSaved={saved} />)}
              </div>
              {rows.length === 0 && <p className="muted">{visibilityFilter === 'Архив' && !search.trim() ? 'Архив пока пуст.' : 'По этому запросу услуги не найдены.'}</p>}
              {rows.length > pageSize && <nav className="admin-service-pagination" aria-label="Страницы списка услуг">
                <button className="admin-page-button" disabled={currentPage === 1} onClick={() => setServicePage(currentPage - 1)}>Назад</button>
                <span className="muted small">Страница <b>{currentPage}</b> из {pageCount}</span>
                <button className="admin-page-button" disabled={currentPage === pageCount} onClick={() => setServicePage(currentPage + 1)}>Далее</button>
              </nav>}
            </>
          })()}
        </>
      )}
      <div className="admin-subheading admin-subheading-new">
        <div><h3>Добавить услугу</h3><p className="muted small">Она появится в форме записи после сохранения.</p></div>
      </div>
      <div className="admin-new-service">
        <ServiceRow
          key={n}
          b={b}
          s={{ id: null, name: '', category: 'Другое', price_cents: 0, duration_minutes: 60 }}
          categoryOptions={[...new Set([...SERVICE_CATEGORIES, ...serviceCategories(q.data ?? [])])]}
          onSaved={() => {
            saved()
            setN(n + 1)
          }}
        />
      </div>
      <p className="muted small">Изменение цены не затрагивает уже созданные записи.</p>
    </>
  )
}

const DAYS: [string, string][] = [
  ['mon', 'Пн'],
  ['tue', 'Вт'],
  ['wed', 'Ср'],
  ['thu', 'Чт'],
  ['fri', 'Пт'],
  ['sat', 'Сб'],
  ['sun', 'Вс'],
]
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
function Settings({ b }: { b: Business }) {
  const qc = useQueryClient()
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [f, setF] = useState({
    phone: b.phone,
    address: b.address,
    route_url: b.route_url ?? '',
    description: b.description,
    cards: b.cards,
    hours: b.hours,
  })
  const m = useMutation({
    mutationFn: () =>
      owner.updateConfig(b.slug, { ...f, phone: f.phone.trim(), address: f.address.trim() }),
    onSuccess: () => {
      setMsg(null)
      setOk(true)
      void qc.invalidateQueries({ queryKey: ['business', b.slug] })
    },
    onError: (e) => {
      setOk(false)
      setMsg(errText(e))
    },
  })
  const save = () => {
    for (const [, h] of Object.entries(f.hours))
      if (h && (!Time.safeParse(h[0]).success || !Time.safeParse(h[1]).success || h[0] >= h[1])) {
        setOk(false)
        setMsg('Проверьте часы работы: начало раньше конца, формат ЧЧ:ММ.')
        return
      }
    if (f.route_url && !/^https:\/\//.test(f.route_url)) {
      setOk(false)
      setMsg('Ссылка 2ГИС должна начинаться с https://')
      return
    }
    if (!/^\+?[0-9\s()-]{7,20}$/.test(f.phone.trim())) {
      setOk(false)
      setMsg('Проверьте номер телефона, например +7 700 000 00 00.')
      return
    }
    if (!f.address.trim()) {
      setOk(false)
      setMsg('Укажите адрес.')
      return
    }
    m.mutate()
  }
  const card = (k: 'booking' | 'catalog' | 'install', label: string): ReactNode => (
    <div className="card col">
      <b>{label}</b>
      <input
        aria-label={`${label}: заголовок`}
        className="field"
        value={f.cards[k].title}
        onChange={(e) =>
          setF({ ...f, cards: { ...f.cards, [k]: { ...f.cards[k], title: e.target.value } } })
        }
      />
      <textarea
        aria-label={`${label}: текст`}
        className="field"
        rows={2}
        value={f.cards[k].text}
        onChange={(e) =>
          setF({ ...f, cards: { ...f.cards, [k]: { ...f.cards[k], text: e.target.value } } })
        }
      />
    </div>
  )
  return (
    <>
      <div className="admin-subheading"><div><h2>Настройки студии</h2><p className="muted small">Контакты, часы работы и текст главной страницы.</p></div></div>
      <Err m={msg} />
      {ok && (
        <p className="muted" role="status">
          Сохранено.
        </p>
      )}
      <div className="card col admin-settings-card">
      <label className="muted small" htmlFor="ph">
        Телефон
      </label>
      <input
        id="ph"
        className="field"
        value={f.phone}
        onChange={(e) => setF({ ...f, phone: e.target.value })}
      />
      <label className="muted small" htmlFor="ad">
        Адрес
      </label>
      <input
        id="ad"
        className="field"
        value={f.address}
        onChange={(e) => setF({ ...f, address: e.target.value })}
      />
      <label className="muted small" htmlFor="ru">
        Ссылка 2ГИС для кнопки «Маршрут»
      </label>
      <input
        id="ru"
        className="field"
        placeholder="https://go.2gis.com/…"
        value={f.route_url}
        onChange={(e) => setF({ ...f, route_url: e.target.value })}
      />
      <p className="muted small">
        Найдите студию в 2ГИС, нажмите «Поделиться» и вставьте ссылку сюда. Без неё кнопка откроет
        поиск 2ГИС по адресу.
      </p>
      <label className="muted small" htmlFor="ds">
        Описание
      </label>
      <textarea
        id="ds"
        className="field"
        rows={3}
        value={f.description}
        onChange={(e) => setF({ ...f, description: e.target.value })}
      />
      </div>
      <h3>Часы работы</h3>
      <div className="card col admin-hours">
      {DAYS.map(([k, l]) => {
        const h = f.hours[k] ?? null
        const set = (v: [string, string] | null) => setF({ ...f, hours: { ...f.hours, [k]: v } })
        return (
          <div className="row wrap admin-hours-row" key={k}>
            <b style={{ width: 28 }}>{l}</b>
            <label className="row small">
              <input
                type="checkbox"
                checked={!h}
                onChange={(e) => set(e.target.checked ? null : ['09:00', '17:00'])}
              />
              выходной
            </label>
            {h && (
              <>
                <input
                  aria-label={`${l} с`}
                  className="field"
                  style={{ width: 100 }}
                  value={h[0]}
                  onChange={(e) => set([e.target.value, h[1]])}
                />
                <input
                  aria-label={`${l} до`}
                  className="field"
                  style={{ width: 100 }}
                  value={h[1]}
                  onChange={(e) => set([h[0], e.target.value])}
                />
              </>
            )}
          </div>
        )
      })}
      </div>
      <h3>Карточки на главной</h3>
      <div className="admin-copy-grid">
      {card('booking', 'Запись')}
      {card('catalog', 'Каталог услуг')}
      {card('install', 'Установка')}
      </div>
      <button className="btn admin-save" disabled={m.isPending} onClick={save}>
        {m.isPending ? 'Сохраняем…' : 'Сохранить'}
      </button>
      <p className="muted small">
        Логотип, главное фото и фотографии работ меняются на вкладке «Фото».
      </p>
    </>
  )
}

type Work = { image: string; caption: string }
const ACCEPT = 'image/jpeg,image/png,image/webp'
function Media({ b }: { b: Business }) {
  const qc = useQueryClient()
  const tid = useQuery({
    queryKey: ['owner', 'tid', b.slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('id')
        .eq('slug', b.slug)
        .single()
      if (error) throw error
      return data.id as string
    },
  })
  const [logo, setLogo] = useState(b.images.logo)
  const [hero, setHero] = useState(b.images.hero)
  const [works, setWorks] = useState<Work[]>(b.gallery)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [newCap, setNewCap] = useState('')
  const trash = useRef<string[]>([])
  const upload = async (
    file: File | undefined,
    kind: 'logo' | 'hero' | 'work',
    done: (url: string) => void,
  ) => {
    if (!file) return
    if (!tid.data) {
      setMsg('Данные студии ещё загружаются. Повторите через секунду.')
      return
    }
    setBusy(kind)
    setMsg(null)
    setSaved(false)
    try {
      const isLogo = kind === 'logo'
      const blob = await prepareImage(
        file,
        isLogo ? 512 : 1600,
        isLogo ? 'image/png' : 'image/jpeg',
      )
      done(await uploadImage(tid.data, blob, isLogo ? 'png' : 'jpg'))
    } catch (e) {
      setMsg(`Не удалось загрузить фото: ${e instanceof Error ? e.message : 'ошибка'}`)
    } finally {
      setBusy(null)
    }
  }
  const save = useMutation({
    mutationFn: () => owner.updateConfig(b.slug, { images: { logo, hero }, gallery: works }),
    onSuccess: () => {
      setSaved(true)
      setMsg(null)
      const old = trash.current
      trash.current = []
      old.forEach((u) => void removeByUrl(u))
      void qc.invalidateQueries({ queryKey: ['business', b.slug] })
    },
    onError: (e) => {
      setSaved(false)
      setMsg(errText(e))
    },
  })
  const onFile = (fn: (f: File | undefined) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    fn(f)
  }
  return (
    <>
      <div className="admin-subheading"><div><h2>Фото и оформление</h2><p className="muted small">Логотип, обложка и работы, которые отображаются клиентам.</p></div></div>
      <Err m={msg} />
      {saved && (
        <p className="muted" role="status">
          Сохранено. Фото на сайте обновились.
        </p>
      )}
      <div className="admin-media-grid">
      <div className="card col">
        <b>Логотип</b>
        <div className="row">
          <img className="thumb sq" src={assetUrl(b.slug, logo)} alt="" />
          <label className="btn ghost mini filebtn">
            {busy === 'logo' ? 'Загружаем…' : 'Заменить'}
            <input
              type="file"
              accept={ACCEPT}
              hidden
              disabled={!!busy}
              onChange={onFile(
                (f) =>
                  void upload(f, 'logo', (u) => {
                    trash.current.push(logo)
                    setLogo(u)
                  }),
              )}
            />
          </label>
        </div>
        <p className="muted small">
          Квадратное изображение, лучше PNG. Размер подгонится автоматически.
        </p>
      </div>
      <div className="card col">
        <b>Главное фото</b>
        <img className="thumb wide" src={assetUrl(b.slug, hero)} alt="" />
        <label className="btn ghost mini filebtn">
          {busy === 'hero' ? 'Загружаем…' : 'Заменить'}
          <input
            type="file"
            accept={ACCEPT}
            hidden
            disabled={!!busy}
            onChange={onFile(
              (f) =>
                void upload(f, 'hero', (u) => {
                  trash.current.push(hero)
                  setHero(u)
                }),
            )}
          />
        </label>
      </div>
      </div>
      <h3>Работы студии</h3>
      <div className="admin-work-grid">
      {works.length === 0 && <p className="muted">Пока нет ни одной работы.</p>}
      {works.map((w, i) => (
        <div className="card col" key={w.image + i}>
          <img className="thumb wide" src={assetUrl(b.slug, w.image)} alt="" />
          <input
            className="field"
            aria-label="Подпись под фото"
            maxLength={80}
            value={w.caption}
            onChange={(e) =>
              setWorks((p) => p.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))
            }
          />
          <div className="row wrap">
            <label className="btn ghost mini filebtn">
              {busy === 'work' ? 'Загружаем…' : 'Заменить фото'}
              <input
                type="file"
                accept={ACCEPT}
                hidden
                disabled={!!busy}
                onChange={onFile(
                  (f) =>
                    void upload(f, 'work', (u) => {
                      trash.current.push(w.image)
                      setWorks((p) => p.map((x, j) => (j === i ? { ...x, image: u } : x)))
                    }),
                )}
              />
            </label>
            <button
              className="btn ghost mini"
              onClick={() => {
                trash.current.push(w.image)
                setWorks((p) => p.filter((_, j) => j !== i))
              }}
            >
              Удалить
            </button>
          </div>
        </div>
      ))}
      {works.length < 12 && (
        <div className="card col">
          <b>Новая работа</b>
          <input
            className="field"
            placeholder="Подпись"
            maxLength={80}
            value={newCap}
            onChange={(e) => setNewCap(e.target.value)}
          />
          <label className="btn ghost mini filebtn">
            {busy === 'work' ? 'Загружаем…' : 'Выбрать фото и добавить'}
            <input
              type="file"
              accept={ACCEPT}
              hidden
              disabled={!!busy}
              onChange={onFile(
                (f) =>
                  void upload(f, 'work', (u) => {
                    setWorks((p) => [...p, { image: u, caption: newCap.trim() || 'Работа студии' }])
                    setNewCap('')
                  }),
              )}
            />
          </label>
        </div>
      )}
      </div>
      <button className="btn" disabled={save.isPending || !!busy} onClick={() => save.mutate()}>
        {save.isPending ? 'Сохраняем…' : 'Сохранить'}
      </button>
      <p className="muted small">До нажатия «Сохранить» клиенты изменений не видят.</p>
    </>
  )
}

const LegalForm = z.object({
  name: z.string().trim().min(2).max(200),
  bin: z
    .string()
    .trim()
    .regex(/^\d{12}$/),
  address: z.string().trim().min(5).max(200),
  email: z.string().trim().email().max(200),
  retention: z.string().trim().min(3).max(200),
  retention_days:z.number().int().min(1).max(36500).nullable(),
})
function Docs({ b }: { b: Business }) {
  const qc = useQueryClient()
  const l = b.legal ?? {}
  const [f, setF] = useState({
    name: l.name ?? '',
    bin: l.bin ?? '',
    address: l.address ?? b.address,
    email: l.email ?? '',
    retention: l.retention ?? 'до достижения целей обработки',
    retention_days:l.retention_days??null,
  })
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const m = useMutation({
    mutationFn: () => owner.updateLegal(b.slug, f),
    onSuccess: () => {
      setMsg(null)
      setOk(true)
      void qc.invalidateQueries({ queryKey: ['business', b.slug] })
    },
    onError: (e) => {
      setOk(false)
      setMsg(errText(e))
    },
  })
  const save = () => {
    if (!LegalForm.safeParse(f).success) {
      setOk(false)
      setMsg(
        'Проверьте поля: БИН/ИИН это 12 цифр, почта должна быть действительным адресом, остальные поля не должны быть пустыми.',
      )
      return
    }
    m.mutate()
  }
  const set = (k: 'name'|'bin'|'address'|'email'|'retention') => (e: ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value })
  const setRetentionDays=(e:ChangeEvent<HTMLInputElement>)=>{const raw=e.target.value;const days=raw===''?null:Number(raw);setF({...f,retention_days:days,retention:days?`Данные записей хранятся ${days} дней после завершения визита, затем обезличиваются.`:'до достижения целей обработки'})}
  return (
    <>
      <div className="admin-subheading"><div><h2>Документы</h2><p className="muted small">Реквизиты подставляются в юридические страницы сайта.</p></div></div>
      <Err m={msg} />
      {ok && (
        <p className="muted" role="status">
          Сохранено. Документы на сайте обновлены.
        </p>
      )}
      <p className="muted small">
        Эти данные подставляются в политику конфиденциальности, согласие и условия использования.
        Они нужны по закону о персональных данных: без них на сайте видно предупреждение.
      </p>
      <label className="muted small" htmlFor="ln">
        Наименование (ТОО, ИП) или ФИО
      </label>
      <input id="ln" className="field" value={f.name} onChange={set('name')} />
      <label className="muted small" htmlFor="lb">
        БИН / ИИН (12 цифр)
      </label>
      <input
        id="lb"
        className="field"
        inputMode="numeric"
        maxLength={12}
        value={f.bin}
        onChange={set('bin')}
      />
      <label className="muted small" htmlFor="la">
        Юридический адрес
      </label>
      <input id="la" className="field" value={f.address} onChange={set('address')} />
      <label className="muted small" htmlFor="le">
        Почта для обращений по персональным данным
      </label>
      <input id="le" className="field" type="email" value={f.email} onChange={set('email')} />
      <label className="muted small" htmlFor="lr">
        Срок обработки данных
      </label>
      <input id="lr" className="field" value={f.retention} onChange={set('retention')} />
      <label className="muted small" htmlFor="retention-days">Автообезличивание записей, дней</label>
      <input id="retention-days" className="field" type="number" min="1" max="36500" inputMode="numeric" placeholder="Не настроено" value={f.retention_days??''} onChange={setRetentionDays} />
      <p className="muted small">Выберите срок, который соответствует вашей политике хранения. После него имя, телефон и автомобиль в завершённых или отменённых записях будут обезличены ежедневно. Пустое поле выключает автообезличивание.</p>
      <button className="btn" disabled={m.isPending} onClick={save}>
        {m.isPending ? 'Сохраняем…' : 'Сохранить'}
      </button>
      <div className="card col" style={{ marginTop: 16 }}>
        <b>Документы на сайте</b>
        {(
          [
            ['privacy', 'Политика конфиденциальности'],
            ['terms', 'Условия использования'],
            ['consent', 'Согласие на обработку данных'],
            ['storage', 'Локальное хранилище'],
          ] as const
        ).map(([k, t]) => (
          <a key={k} href={`/s/${b.slug}/legal/${k}`} target="_blank" rel="noreferrer">
            {t}
          </a>
        ))}
      </div>
      <p className="muted small">
        Место хранения данных и поставщиков инфраструктуры указывает платформа, эти поля здесь не
        меняются.
      </p>
    </>
  )
}

const BOT = import.meta.env.VITE_TELEGRAM_BOT as string | undefined
function Notify({ b }: { b: Business }) {
  const qc = useQueryClient()
  const [link, setLink] = useState<{ url: string; code: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const bot = BOT?.trim().replace(/^@/, '')
  const botReady = !!bot && /^[A-Za-z0-9_]{5,32}$/.test(bot)
  const links = useQuery({
    queryKey: ['owner', 'telegram', b.slug],
    queryFn: () => owner.telegramLinks(b.slug),
  })
  const health = useQuery({
    queryKey: ['owner', 'notification-status', b.slug],
    queryFn: () => owner.notificationStatus(b.slug),
    refetchInterval: 30_000,
  })
  const clientToggle = useMutation({
    mutationFn: (enabled: boolean) => owner.updateConfig(b.slug, { client_telegram_enabled: enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['business', b.slug] }),
  })
  const connect = useMutation({
    mutationFn: async () => {
      if (!bot || !/^[A-Za-z0-9_]{5,32}$/.test(bot)) throw new Error('telegram_bot_not_configured')
      const code = await owner.telegramCode(b.slug)
      return { url: `https://t.me/${bot}?start=${code}`, code }
    },
    onSuccess: (invite) => { setLink(invite); setMsg(null) },
    onError: (e) => { setLink(null); setMsg(errText(e)) },
  })
  const unlink = useMutation({
    mutationFn: (id: string) => owner.telegramUnlink(id),
    onSuccess: () => { setMsg(null); void qc.invalidateQueries({ queryKey: ['owner', 'telegram', b.slug] }) },
    onError: (e) => setMsg(errText(e)),
  })
  return (
    <>
    <div className="card col" style={{ gap: 16 }}>
      <div className="admin-subheading"><div><h2>Уведомления в Telegram</h2><p className="muted small">Подключите чат и следите за доставкой сообщений о записях.</p></div></div>
      <p className="muted small">Получайте сообщения о новых записях и отменах. После перехода к боту нажмите «Запустить».</p>
      {msg && <p className="err" role="alert">{msg}</p>}
      {links.isPending ? <p className="muted small">Проверяем подключённые чаты…</p>
        : links.isError ? <p className="err small">Не удалось загрузить подключения. <button className="link" onClick={() => void links.refetch()}>Повторить</button></p>
        : links.data.length === 0 ? <p className="muted small">Пока нет подключённых чатов.</p>
        : links.data.map((item) => <div className="row between" key={item.id}>
            <span>Чат подключён · {formatInTimeZone(new Date(item.created_at), b.timezone, 'd MMM yyyy', { locale: ru })}</span>
            <button className="btn ghost mini" disabled={unlink.isPending} onClick={() => unlink.mutate(item.id)}>Отключить</button>
          </div>)}
      {links.data?.length ? <div className="delivery-status" role="status">
        <b>Доставка уведомлений</b>
        {health.isPending ? <span className="muted small">Проверяем очередь…</span>
          : health.isError ? <span className="err small">Не удалось проверить очередь. Обновите статус.</span>
          : health.data.failed > 0 ? <span className="err small">Не доставлено: {health.data.failed}. Проверьте настройки бота и доставки.</span>
          : health.data.pending > 0 ? <span className="muted small">Ожидают отправки: {health.data.pending}. Обычно это занимает до минуты.</span>
          : health.data.last_sent_at ? <span className="muted small">Последнее успешное уведомление: {formatInTimeZone(new Date(health.data.last_sent_at), b.timezone, 'd MMM, HH:mm', { locale: ru })}</span>
          : <span className="muted small">Бот подтвердил подключение. Уведомления о записях пока не отправлялись.</span>}
        {health.isError && <button className="link" onClick={() => void health.refetch()}>Повторить</button>}
      </div> : null}
      <button className="link" onClick={() => void links.refetch()}>Обновить статус подключения</button>
      <label className="check">
        <input type="checkbox" checked={!!b.client_telegram_enabled} disabled={clientToggle.isPending || (!b.client_telegram_enabled && !botReady)} onChange={(e) => clientToggle.mutate(e.target.checked)} />
        <span>Разрешить клиентам подключать уведомления в Telegram</span>
      </label>
      <p className="muted small">Клиент сам подключает Telegram после записи — аккаунт на сайте не нужен. Сообщения отправляются только по выбранной записи; отключить их можно командой /stop.</p>
      {clientToggle.isError && <p className="err small">Не удалось изменить настройку. Попробуйте ещё раз.</p>}
      {link && <div className="card col">
        <b>Шаг 1. Откройте бота и нажмите «Запустить»</b>
        <a className="btn" href={link.url} target="_blank" rel="noreferrer">Открыть Telegram</a>
        <b>Если Telegram открыл сайт или не передал код</b>
        <p className="muted small">Откройте чат с ботом вручную и отправьте ему эту команду:</p>
        <code style={{ overflowWrap: 'anywhere' }}>/start {link.code}</code>
        <p className="muted small">Код действует 15 минут. Успешное подключение подтвердит бот сообщением «Готово! Уведомления … подключены».</p>
      </div>}
      {!botReady && <p className="muted small">Подключение Telegram пока недоступно. Обратитесь к владельцу сайта.</p>}
      <button className="btn" disabled={!botReady || connect.isPending} onClick={() => connect.mutate()}>
        {connect.isPending ? 'Создаём ссылку…' : 'Подключить чат'}
      </button>
      <p className="muted small">Уведомления о новых записях и отменах будут приходить в подключённый чат автоматически.</p>
    </div>
    <NotificationPreferences b={b}/>
    </>
  )
}

function NotificationPreferences({b}:{b:Business}) {
  const qc=useQueryClient();const q=useQuery({queryKey:['owner','notification-settings',b.slug],queryFn:()=>owner.notificationSettings(b.slug)});
  const [form,setForm]=useState<OwnerNotificationSettings>({reminder_hours_before:24,repeat_after_days:90,reminder_message:'',repeat_message:''});
  const [saved,setSaved]=useState(false);const [msg,setMsg]=useState<string|null>(null);
  useEffect(()=>{if(q.data)setForm({...q.data,reminder_message:q.data.reminder_message??'',repeat_message:q.data.repeat_message??''})},[q.data]);
  const save=useMutation({mutationFn:()=>owner.updateNotificationSettings(b.slug,{...form,reminder_message:form.reminder_message||null,repeat_message:form.repeat_message||null}),onSuccess:()=>{setSaved(true);setMsg(null);void qc.invalidateQueries({queryKey:['owner','notification-settings',b.slug]})},onError:e=>{setSaved(false);setMsg(errText(e))}});
  return <section className="card col"><div className="admin-subheading"><div><h2>Напоминания клиентам</h2><p className="muted small">Время и текст Telegram-сообщений для этой студии.</p></div></div>
    {q.isPending?<p className="muted small">Загрузка настроек…</p>:q.isError?<p className="err small">Не удалось загрузить настройки. <button className="link" onClick={()=>void q.refetch()}>Повторить</button></p>:<>
      <label className="muted small" htmlFor="reminder-hours">Напомнить о записи за (часов)</label><input id="reminder-hours" className="field" type="number" min="1" max="168" value={form.reminder_hours_before} onChange={e=>{setSaved(false);setForm({...form,reminder_hours_before:Number(e.target.value)})}}/>
      <label className="muted small" htmlFor="reminder-text">Текст напоминания о записи</label><textarea id="reminder-text" className="field" rows={3} maxLength={500} placeholder="Оставьте пустым для стандартного текста" value={form.reminder_message??''} onChange={e=>{setSaved(false);setForm({...form,reminder_message:e.target.value})}}/>
      <label className="muted small" htmlFor="repeat-days">Напомнить о повторном визите через (дней)</label><input id="repeat-days" className="field" type="number" min="7" max="365" value={form.repeat_after_days} onChange={e=>{setSaved(false);setForm({...form,repeat_after_days:Number(e.target.value)})}}/>
      <label className="muted small" htmlFor="repeat-text">Текст напоминания о повторном визите</label><textarea id="repeat-text" className="field" rows={3} maxLength={500} placeholder="Оставьте пустым для стандартного текста" value={form.repeat_message??''} onChange={e=>{setSaved(false);setForm({...form,repeat_message:e.target.value})}}/>
      <p className="muted small">В тексте доступны подстановки: {'{studio}'}, {'{service}'}, {'{date}'}, {'{time}'}, {'{address}'}. Повторное напоминание отправится только клиентам, которые отдельно на него согласились.</p>
      {msg&&<p className="err small" role="alert">{msg}</p>}{saved&&<p className="muted small" role="status">Настройки сохранены.</p>}
      <button className="btn" disabled={save.isPending||form.reminder_hours_before<1||form.reminder_hours_before>168||form.repeat_after_days<7||form.repeat_after_days>365} onClick={()=>save.mutate()}>{save.isPending?'Сохраняем…':'Сохранить настройки'}</button>
    </>}
  </section>
}
