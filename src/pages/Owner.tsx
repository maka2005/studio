import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { z } from 'zod'
import { addDays, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { supabase } from '../lib/supabase'
import { errText, fetchServices, fetchSlots, owner, type OwnerBooking } from '../lib/api'
import { duration, money, telHref } from '../lib/format'
import { assetUrl, type Business, type Ctx } from '../lib/tenant'
import { prepareImage, removeByUrl, uploadImage } from '../lib/media'
import { Sheet } from '../components/Sheet'
import { AssistantSheet } from '../components/AssistantSheet'
import './owner-login.css'
import './owner-media.css'
import { AI_ENABLED } from '../lib/features'

const TABS = ['Записи', 'Услуги', 'Студия', 'Фото', 'Уведомления', 'Документы', 'Помощник'] as const
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
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setErr('Неверная почта или пароль.')
  }
  return (
    <div className="page">
      <div className="login-wrap">
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && email && password) void submit()
          }}
        />
        {err && (
          <p role="alert" className="err">
            {err}
          </p>
        )}
        <button
          className="btn"
          disabled={busy || !email || !password}
          onClick={() => void submit()}
        >
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </div>
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
    <section className="pad">
      <div className="row between">
        <h2>Кабинет</h2>
        <button className="link" onClick={onLogout}>
          Выйти
        </button>
      </div>
      <div className="tabs2" role="tablist">
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
      {tab === 'Услуги' && <Services b={b} />}
      {tab === 'Студия' && <Settings b={b} />}
      {tab === 'Фото' && <Media b={b} />}
      {tab === 'Уведомления' && <Notify b={b} />}
      {tab === 'Документы' && <Docs b={b} />}
      {ai && <AssistantSheet slug={b.slug} scope="owner" onClose={() => setAi(false)} />}
    </section>
  )
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
  const to = mode === 'day' ? day : format(addDays(new Date(`${day}T12:00:00`), 6), 'yyyy-MM-dd')
  const list = useQuery({
    queryKey: ['owner', 'bookings', b.slug, day, to],
    queryFn: () => owner.bookings(b.slug, day, to),
  })
  const stats = useQuery({
    queryKey: ['owner', 'stats', b.slug, day, to],
    queryFn: () => owner.stats(b.slug, day, to),
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['owner'] })
  return (
    <>
      <div className="row wrap">
        <button
          className={`chip mini ${mode === 'day' ? 'sel' : ''}`}
          onClick={() => setMode('day')}
        >
          День
        </button>
        <button
          className={`chip mini ${mode === 'week' ? 'sel' : ''}`}
          onClick={() => setMode('week')}
        >
          Неделя
        </button>
        <input
          aria-label="Дата"
          className="field"
          style={{ flex: 1 }}
          type="date"
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
        />
      </div>
      {stats.data && (
        <div className="stats">
          <div className="card">
            <span className="muted small">Заезды</span>
            <b>{stats.data.visits}</b>
          </div>
          <div className="card">
            <span className="muted small">Завершено</span>
            <b>{stats.data.done}</b>
          </div>
          <div className="card">
            <span className="muted small">Получено</span>
            <b>{money(Number(stats.data.received_cents) / 100, b.currency)}</b>
          </div>
          <div className="card">
            <span className="muted small">Ожидаемая стоимость записей</span>
            <b>{money(Number(stats.data.expected_cents) / 100, b.currency)}</b>
          </div>
        </div>
      )}
      {stats.isError && <p className="err small">Статистика недоступна.</p>}
      <div className="row wrap">
        <button className="btn mini" onClick={() => setAdd(true)}>
          + Запись
        </button>
        <button className="btn ghost mini" onClick={() => setBlock(true)}>
          Заблокировать пост
        </button>
      </div>
      <div style={{ height: 12 }} />
      {list.isPending ? (
        <p className="muted">Загрузка…</p>
      ) : list.isError ? (
        <p className="err">
          Не удалось загрузить записи.{' '}
          <button className="link" onClick={() => list.refetch()}>
            Повторить
          </button>
        </p>
      ) : list.data.length === 0 ? (
        <p className="muted">Записей на этот период нет.</p>
      ) : (
        list.data.map((x) => (
          <button key={x.id} className="card bk" onClick={() => setSel(x)}>
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
  const sid = svc.data?.find((s) => s.name === bk.service_name)?.id ?? null
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
}: {
  b: Business
  s: {
    id: string | null
    name: string
    price_cents: number
    duration_minutes: number
    active?: boolean
  }
  onSaved: () => void
}) {
  const a = useAct(onSaved)
  const [name, setName] = useState(s.name)
  const [price, setPrice] = useState(String(s.price_cents / 100))
  const [min, setMin] = useState(String(s.duration_minutes))
  const [active, setActive] = useState(s.active ?? true)
  const minutes = Number(min)
  const cents = Math.round(Number(price.replace(',', '.')) * 100)
  const ok =
    name.trim() && Number.isFinite(cents) && cents >= 0 && Number.isInteger(minutes) && minutes > 0
  return (
    <div className="card col">
      <Err m={a.msg} />
      <input
        aria-label="Название"
        className="field"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="row">
        <div style={{ flex: 1 }}>
          <label className="muted small">Цена, {b.currency}</label>
          <input
            className="field"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="muted small">Минут ({ok ? duration(minutes) : '—'})</label>
          <input
            className="field"
            inputMode="numeric"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </div>
      </div>
      <label className="row">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{' '}
        Показывать клиентам
      </label>
      <button
        className="btn mini"
        disabled={!ok || a.busy}
        onClick={() =>
          a.run(() => owner.upsertService(b.slug, { id: s.id, name, cents, minutes, active }))
        }
      >
        Сохранить
      </button>
    </div>
  )
}
function Services({ b }: { b: Business }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['services', b.slug], queryFn: () => fetchServices(b.slug) })
  const [n, setN] = useState(0)
  const saved = () => {
    void qc.invalidateQueries({ queryKey: ['services', b.slug] })
  }
  return (
    <>
      {q.isPending ? (
        <p className="muted">Загрузка…</p>
      ) : q.isError ? (
        <p className="err">Не удалось загрузить услуги.</p>
      ) : (
        q.data.map((s) => <ServiceRow key={s.id + s.name} b={b} s={s} onSaved={saved} />)
      )}
      <h3>Новая услуга</h3>
      <ServiceRow
        key={n}
        b={b}
        s={{ id: null, name: '', price_cents: 0, duration_minutes: 60 }}
        onSaved={() => {
          saved()
          setN(n + 1)
        }}
      />
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
  const card = (k: 'booking' | 'ai' | 'install', label: string): ReactNode => (
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
      <Err m={msg} />
      {ok && (
        <p className="muted" role="status">
          Сохранено.
        </p>
      )}
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
      <h3>Часы работы</h3>
      {DAYS.map(([k, l]) => {
        const h = f.hours[k] ?? null
        const set = (v: [string, string] | null) => setF({ ...f, hours: { ...f.hours, [k]: v } })
        return (
          <div className="row wrap" key={k}>
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
      <h3>Карточки на главной</h3>
      {card('booking', 'Запись')}
      {card('ai', 'ИИ')}
      {card('install', 'Установка')}
      <button className="btn" disabled={m.isPending} onClick={save}>
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
      <Err m={msg} />
      {saved && (
        <p className="muted" role="status">
          Сохранено. Фото на сайте обновились.
        </p>
      )}
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
      <h3>Работы студии</h3>
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
  const links = useQuery({
    queryKey: ['owner', 'telegram', b.slug],
    queryFn: () => owner.telegramLinks(b.slug),
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
      <h3>Telegram-уведомления</h3>
      <p className="muted small">Получайте уведомления о новых записях и отменах. После открытия ссылки обязательно нажмите «Запустить» в чате с ботом.</p>
      {msg && <p className="err" role="alert">{msg}</p>}
      {links.isPending ? <p className="muted small">Проверяем подключённые чаты…</p>
        : links.isError ? <p className="err small">Не удалось загрузить подключения. <button className="link" onClick={() => void links.refetch()}>Повторить</button></p>
        : links.data.length === 0 ? <p className="muted small">Пока нет подключённых чатов.</p>
        : links.data.map((item) => <div className="row between" key={item.id}>
            <span>Чат подключён · {formatInTimeZone(new Date(item.created_at), b.timezone, 'd MMM yyyy', { locale: ru })}</span>
            <button className="btn ghost mini" disabled={unlink.isPending} onClick={() => unlink.mutate(item.id)}>Отключить</button>
          </div>)}
      <button className="link" onClick={() => void links.refetch()}>Обновить статус подключения</button>
      {link && <div className="card col">
        <b>Шаг 1. Откройте бота и нажмите «Запустить»</b>
        <a className="btn" href={link.url} target="_blank" rel="noreferrer">Открыть Telegram</a>
        <b>Если Telegram открыл сайт или не передал код</b>
        <p className="muted small">Откройте чат с ботом вручную и отправьте ему эту команду:</p>
        <code style={{ overflowWrap: 'anywhere' }}>/start {link.code}</code>
        <p className="muted small">Код действует 15 минут. Успешное подключение подтвердит бот сообщением «Готово! Уведомления … подключены».</p>
      </div>}
      {!bot && <p className="muted small">Для кнопки подключения задайте публичную переменную VITE_TELEGRAM_BOT с именем бота.</p>}
      <button className="btn" disabled={!bot || connect.isPending} onClick={() => connect.mutate()}>
        {connect.isPending ? 'Создаём ссылку…' : 'Подключить чат'}
      </button>
      <p className="muted small">Если бот подтвердил привязку, но уведомлений о тестовой клиентской записи нет, проверьте настройку webhook и расписание `notify-dispatch` в Supabase. Одной переменной Vercel недостаточно.</p>
    </div>
  )
}
