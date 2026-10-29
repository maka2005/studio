import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { z } from 'zod'
import { ru } from 'date-fns/locale'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { supabase } from '../lib/supabase'
import { errText, fetchServices, fetchSlots, owner, type OwnerBooking } from '../lib/api'
import { duration, money, telHref } from '../lib/format'
import { assetUrl, type Business, type Ctx } from '../lib/tenant'
import { prepareImage, removeByUrl, uploadImage } from '../lib/media'
import { Sheet } from '../components/Sheet'
import { AssistantSheet } from '../components/AssistantSheet'
import { SERVICE_CATEGORIES, serviceCategories } from '../lib/serviceCatalog'
import './owner-login.css'
import './owner-media.css'
import { AI_ENABLED } from '../lib/features'

const TABS = ['Записи', 'Отчёты', 'Ожидание', 'Промокоды', 'Отзывы', 'Услуги', 'Студия', 'Фото', 'Уведомления', 'Документы', 'Помощник'] as const
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
    queryFn: async () => (await supabase.auth.getSession()).data.session,
  })
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => {
      void qc.invalidateQueries({ queryKey: ['owner'] })
    })
    return () => data.subscription.unsubscribe()
  }, [qc])
  const logout = async () => {
    await supabase.auth.signOut()
    qc.removeQueries({ queryKey: ['owner'] })
  } // приватный кэш очищается при выходе
  if (sess.isPending) return <p className="pad muted">Загрузка…</p>
  if (!sess.data) return <Login />
  return <Cabinet b={b} onLogout={logout} />
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
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const { data, error } = await supabase.functions.invoke('owner-login', { body: { email: email.trim(), password } })
      const body = error ? await (error as { context?: Response }).context?.clone().json().catch(() => null) : data
      if (body?.error === 'rate_limited') setErr('Слишком много попыток входа. Подождите 15 минут и попробуйте снова.')
      else if (body?.error === 'bad_credentials') setErr('Неверная почта или пароль.')
      else if (error || !body?.session) setErr('Не удалось войти. Проверьте соединение и повторите позже.')
      else {
        const { error: sessionError } = await supabase.auth.setSession(body.session)
        if (sessionError) setErr('Не удалось открыть сессию. Повторите вход.')
      }
    } catch {
      setErr('Не удалось связаться с сервером. Проверьте интернет и повторите.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page admin-login-page">
      <form className="login-wrap admin-login" onSubmit={(e) => { e.preventDefault(); void submit() }}>
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
      </form>
    </div>
  )
}

function Cabinet({ b, onLogout }: { b: Business; onLogout: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Записи')
  const [ai, setAi] = useState(false)
  const me = useQuery({ queryKey: ['owner', 'me', b.slug], queryFn: () => owner.me(b.slug) })
  if (me.isPending) return <p className="pad muted">Проверяем доступ…</p>
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
      <div className="tabs2 admin-tabs" role="tablist" aria-label="Разделы кабинета">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            disabled={t === 'Помощник' && !AI_ENABLED}
            onClick={() => (t === 'Помощник' ? setAi(true) : setTab(t))}
          >
            {t === 'Помощник' && !AI_ENABLED ? 'Помощник · скоро' : t}
          </button>
        ))}
      </div>
      {tab === 'Записи' && <Bookings b={b} />}
      {tab === 'Отчёты' && <Reports b={b} />}
      {tab === 'Ожидание' && <WaitlistAdmin b={b} />}
      {tab === 'Промокоды' && <Promos b={b} />}
      {tab === 'Отзывы' && <Reviews b={b} />}
      {tab === 'Услуги' && <Services b={b} />}
      {tab === 'Студия' && <Settings b={b} />}
      {tab === 'Фото' && <Media b={b} />}
      {tab === 'Уведомления' && <Notify b={b} />}
      {tab === 'Документы' && <Docs b={b} />}
      {ai && <AssistantSheet slug={b.slug} onClose={() => setAi(false)} />}
    </section>
  )
}

function Reports({ b }: { b: Business }) {
  const to = today(b); const from = new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 864e5).toISOString().slice(0, 10);
  const stats = useQuery({ queryKey: ['owner','source-stats',b.slug,from,to], queryFn: () => owner.sourceStats(b.slug,from,to) });
  const kpis = useQuery({ queryKey: ['owner','report-stats',b.slug,from,to], queryFn: () => owner.stats(b.slug,from,to) });
  const bookings = useQuery({ queryKey: ['owner','report-bookings',b.slug,from,to], queryFn: () => owner.bookings(b.slug,from,to) });
  const resources = useQuery({ queryKey: ['owner','resources',b.slug], queryFn: () => owner.resources(b.slug) });
  let capacityMinutes=0; const keys=['sun','mon','tue','wed','thu','fri','sat'];
  for(let i=0;i<30;i++){const d=new Date(Date.parse(`${from}T12:00:00Z`)+i*864e5);const hours=b.hours[keys[d.getUTCDay()]!];if(hours){const a=Number(hours[0].slice(0,2))*60+Number(hours[0].slice(3,5));const z=Number(hours[1].slice(0,2))*60+Number(hours[1].slice(3,5));capacityMinutes+=Math.max(0,z-a)*Math.max(1,resources.data?.length??b.resources.length);}}
  const reservedMinutes=(bookings.data??[]).filter(x=>x.status!=='cancelled').reduce((n,x)=>n+Math.max(0,(Date.parse(x.ends_at)-Date.parse(x.starts_at))/60000),0);
  const occupancy=capacityMinutes?Math.min(100,Math.round(reservedMinutes/capacityMinutes*100)):0;
  return <div className="col"><div className="admin-subheading"><div><h2>Отчёты за 30 дней</h2><p className="muted small">Выручка, загрузка постов и источники обращений.</p></div></div>
    {kpis.data&&<div className="stats admin-stats"><div className="card admin-stat"><span className="muted small">Получено</span><b>{money(kpis.data.received_cents/100,b.currency)}</b></div><div className="card admin-stat"><span className="muted small">Записей</span><b>{kpis.data.booked}</b></div><div className="card admin-stat"><span className="muted small">Визитов</span><b>{kpis.data.visits}</b></div><div className="card admin-stat"><span className="muted small">Загрузка постов</span><b>{bookings.isPending||resources.isPending?'…':`${occupancy}%`}</b></div></div>}
    <p className="muted small">Загрузка — оценка занятых минут к рабочим минутам всех постов по недельному графику.</p>
    <div className="admin-subheading"><div><h2>Источники записей</h2><p className="muted small">UTM-метки и домены переходов.</p></div></div>
    {stats.isPending ? <p className="muted">Загрузка отчёта…</p> : stats.isError ? <p className="err">Не удалось загрузить отчёт. <button className="link" onClick={() => void stats.refetch()}>Повторить</button></p> : (stats.data ?? []).length === 0 ? <p className="muted">Записей за этот период пока нет.</p> : <div className="card col">{stats.data!.map((x) => <div className="kv" key={x.source}><span>{x.source === 'direct' ? 'Прямые переходы' : x.source} · {x.visits} записей</span><b>{money(x.received_cents / 100,b.currency)}</b></div>)}</div>}
    <p className="muted small">Источник сохраняется при записи: UTM-метка или домен перехода. Личные данные и полный URL не записываются.</p>
  </div>;
}

function WaitlistAdmin({ b }: { b: Business }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['owner','waitlist',b.slug], queryFn: () => owner.waitlist(b.slug) });
  const setStatus = useMutation({ mutationFn: ({ id,status }: {id:string;status:'waiting'|'contacted'|'closed'}) => owner.waitlistStatus(id,status), onSuccess: () => void qc.invalidateQueries({ queryKey: ['owner','waitlist',b.slug] }) });
  return <div className="col"><div className="admin-subheading"><div><h2>Лист ожидания</h2><p className="muted small">Заявки клиентов на дни без свободных окон. О новых заявках придёт сообщение в Telegram.</p></div></div>
    {q.isPending ? <p className="muted">Загрузка…</p> : q.isError ? <p className="err">Не удалось загрузить лист ожидания. <button className="link" onClick={() => void q.refetch()}>Повторить</button></p> : !q.data?.length ? <p className="muted">Заявок пока нет.</p> : q.data.map((w) => <div className="card col" key={w.id}><div className="row between"><b>{w.customer_name} · {w.preferred_day}</b><span className="pill">{{waiting:'Ожидает',contacted:'Связались',closed:'Закрыта'}[w.status] ?? w.status}</span></div><span>{w.service_name} · {w.car}</span><a href={telHref(w.customer_phone)}>{w.customer_phone}</a><div className="row wrap"><button className="btn ghost mini" disabled={setStatus.isPending} onClick={() => setStatus.mutate({id:w.id,status:'contacted'})}>Связались</button><button className="btn ghost mini" disabled={setStatus.isPending} onClick={() => setStatus.mutate({id:w.id,status:'closed'})}>Закрыть заявку</button></div></div>)}
    {setStatus.isError && <p className="err small">Не удалось обновить статус заявки.</p>}
  </div>;
}

function Promos({ b }: { b: Business }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['owner','promos',b.slug], queryFn: () => owner.promos(b.slug) });
  const [form,setForm] = useState({code:'',kind:'percent' as 'percent'|'fixed',value:'10',limit:''}); const [msg,setMsg] = useState<string|null>(null);
  const save = useMutation({ mutationFn: () => owner.upsertPromo(b.slug,{code:form.code.trim().toUpperCase(),kind:form.kind,value:form.kind==='fixed'?Math.round(Number(form.value)*100):Number(form.value),limit:form.limit?Number(form.limit):null,active:true}), onSuccess: () => { setForm({...form,code:''});setMsg(null);void qc.invalidateQueries({queryKey:['owner','promos',b.slug]}); }, onError: () => setMsg('Проверьте код, размер скидки и лимит использований.') });
  const toggle = useMutation({ mutationFn: (p: NonNullable<typeof q.data>[number]) => owner.upsertPromo(b.slug,{id:p.id,code:p.code,kind:p.discount_kind,value:p.discount_value,limit:p.usage_limit,active:!p.active}), onSuccess: () => void qc.invalidateQueries({queryKey:['owner','promos',b.slug]}) });
  return <div className="col"><div className="admin-subheading"><div><h2>Промокоды</h2><p className="muted small">Скидка пересчитывается и списывается атомарно при подтверждении записи.</p></div></div>
    <div className="card col"><input className="field" aria-label="Код промокода" placeholder="Код, например START10" maxLength={24} value={form.code} onChange={(e)=>setForm({...form,code:e.target.value.toUpperCase()})}/><div className="row wrap"><select className="field" value={form.kind} onChange={(e)=>setForm({...form,kind:e.target.value as 'percent'|'fixed'})}><option value="percent">Процент</option><option value="fixed">Сумма</option></select><input className="field" aria-label="Размер скидки" type="number" min="1" max={form.kind==='percent'?100:1000000} value={form.value} onChange={(e)=>setForm({...form,value:e.target.value})}/><input className="field" aria-label="Лимит применений" type="number" min="1" placeholder="Без лимита" value={form.limit} onChange={(e)=>setForm({...form,limit:e.target.value})}/></div>{msg&&<p className="err small">{msg}</p>}<button className="btn" disabled={save.isPending||!form.code.trim()||!Number(form.value)} onClick={()=>save.mutate()}>{save.isPending?'Сохраняем…':'Создать промокод'}</button></div>
    {q.isPending?<p className="muted">Загрузка промокодов…</p>:q.isError?<p className="err">Не удалось загрузить промокоды.</p>:q.data?.map(p=><div className="card row between" key={p.id}><div><b>{p.code}</b><p className="muted small">{p.discount_kind==='percent'?`${p.discount_value}%`:`${money(p.discount_value/100,b.currency)}`} · использован {p.used_count}{p.usage_limit?` из ${p.usage_limit}`:''}</p></div><button className="btn ghost mini" disabled={toggle.isPending} onClick={()=>toggle.mutate(p)}>{p.active?'Отключить':'Включить'}</button></div>)}
  </div>;
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

function Bookings({ b }: { b: Business }) {
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
    queryFn: () => owner.bookings(b.slug, day, to),
  })
  const stats = useQuery({
    queryKey: ['owner', 'stats', b.slug, day, to],
    queryFn: () => owner.stats(b.slug, day, to),
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
      {stats.data && (
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
      {stats.isError && <p className="err small">Статистика недоступна.</p>}
      <div className="admin-actions">
        <button className="btn mini" onClick={() => setAdd(true)}>
          + Запись
        </button>
        <button className="btn ghost mini" onClick={() => setBlock(true)}>
          Заблокировать пост
        </button>
      </div>
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
                  <span className="muted small">{money(x.price_cents / 100, b.currency)} · оплачено {money(x.paid_cents / 100, b.currency)}</span>
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
            <span className="muted small">
              {x.car} · {x.customer_name} · {x.customer_phone}
            </span>
            <span className="muted small">
              {money(x.price_cents / 100, b.currency)} · оплачено{' '}
              {money(x.paid_cents / 100, b.currency)}
            </span>
          </button>
        ))
      )}
      {sel && <Actions b={b} bk={sel} onClose={() => setSel(null)} onDone={refresh} />}
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
  onClose,
  onDone,
}: {
  b: Business
  bk: OwnerBooking
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
        <br />
        {money(bk.price_cents / 100, b.currency)} · оплачено{' '}
        {money(bk.paid_cents / 100, b.currency)}
      </p>
      <div className="row wrap">
        {bk.status === 'booked' && (
          <button
            className="btn mini"
            disabled={a.busy}
            onClick={() => a.run(() => owner.setStatus(bk.id, 'arrived'))}
          >
            Машина принята
          </button>
        )}
        {(bk.status === 'booked' || bk.status === 'arrived') && (
          <button
            className="btn mini"
            disabled={a.busy}
            onClick={() => a.run(() => owner.setStatus(bk.id, 'done'))}
          >
            Готова
          </button>
        )}
      </div>
      <label className="muted small" htmlFor="amt">
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
      {bk.status === 'booked' && (
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
        <div><label className="muted small" htmlFor={`${categoryListId}-input`}>Категория</label><select id={`${categoryListId}-input`} aria-label="Категория услуги" className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
          {[...new Set([...SERVICE_CATEGORIES, ...categoryOptions])].map((item) => <option key={item} value={item}>{item}</option>)}
        </select></div>
        <div><label className="muted small" htmlFor={`${categoryListId}-price`}>Цена, {b.currency}</label><input id={`${categoryListId}-price`} className="field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><label className="muted small" htmlFor={`${categoryListId}-duration`}>Длительность</label><input id={`${categoryListId}-duration`} className="field" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} /><span className="muted small">{ok ? duration(minutes) : 'Укажите минуты'}</span></div>
      </div>
      <div className="admin-service-footer">
        <label className="admin-service-active"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span className={`admin-service-status ${active ? 'on' : 'off'}`}>{active ? 'Показывается клиентам' : 'Скрыта от клиентов'}</span></label>
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
  const [visibilityFilter, setVisibilityFilter] = useState<'Все' | 'Активные' | 'Скрытые'>('Все')
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
              const matchesVisibility = visibilityFilter === 'Все' || (visibilityFilter === 'Активные' ? service.active : !service.active)
              return matchesSearch && matchesCategory && matchesVisibility
            })
            const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
            const currentPage = Math.min(servicePage, pageCount)
            const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
            return <>
              <div className="admin-service-filters">
                <label><span className="muted small">Категория</span><select className="field" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setServicePage(1); }}><option>Все услуги</option>{options.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label><span className="muted small">Показ</span><select className="field" value={visibilityFilter} onChange={(e) => { setVisibilityFilter(e.target.value as typeof visibilityFilter); setServicePage(1); }}><option>Все</option><option>Активные</option><option>Скрытые</option></select></label>
                <span className="admin-service-result-count">Найдено <b>{rows.length}</b> из {q.data.length}</span>
              </div>
              <div className="admin-service-table">
                <div className="admin-service-table-head"><span>Услуга</span><span>Цена</span><span>Время</span><span>Статус</span><span>Действия</span></div>
                {visibleRows.map((s) => <ServiceRow key={s.id + s.name} b={b} s={s} categoryOptions={options} onSaved={saved} />)}
              </div>
              {rows.length === 0 && <p className="muted">По этому запросу услуги не найдены.</p>}
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
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value })
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
  )
}
