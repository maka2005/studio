import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { ru } from 'date-fns/locale'
import { fetchServices, fetchSlots, owner, type OwnerBooking } from '../../lib/api'
import { money } from '../../lib/format'
import { isFullPhone, maskPhone, PHONE_PLACEHOLDER } from '../../lib/phone'
import { telHref, type Business } from '../../lib/tenant'
import { Sheet } from '../../components/Sheet'
import { Err, STATUS, fmtT, today, useAct } from './shared'

export function Bookings({ b, role = 'owner' }: { b: Business; role?: 'owner'|'manager'|'staff' }) {
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
      {sel && <Actions b={b} bk={sel} role={role??undefined} onClose={() => setSel(null)} onDone={refresh} />}
      {add && <AddBooking b={b} onClose={() => setAdd(false)} onDone={refresh} />}
      {block && <BlockPost b={b} onClose={() => setBlock(false)} onDone={refresh} />}
    </>
  )
}

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
    .refine(isFullPhone),
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
          placeholder={{ name: 'Имя', phone: PHONE_PLACEHOLDER, car: 'Автомобиль' }[k]}
          type={k === 'phone' ? 'tel' : 'text'}
          inputMode={k === 'phone' ? 'tel' : undefined}
          maxLength={k === 'phone' ? 18 : undefined}
          value={f[k]}
          onChange={(e) => setF({ ...f, [k]: k === 'phone' ? maskPhone(e.target.value, f.phone) : e.target.value })}
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
