import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatInTimeZone } from 'date-fns-tz'
import { ru } from 'date-fns/locale'
import { errText, owner } from '../../lib/api'
import type { Business } from '../../lib/tenant'

const KINDS: [string, string][] = [
  ['booking_created', 'Новая запись'],
  ['booking_cancelled', 'Отмена записи'],
  ['booking_reminder', 'Напоминание о записи'],
  ['booking_followup', 'Напоминание о повторном визите'],
  ['waitlist_interest', 'Новая заявка в лист ожидания'],
]
const AUDIENCE: [string, string][] = [['client', 'Сообщение клиенту'], ['owner', 'Сообщение студии']]
const PLACEHOLDERS = '{studio}, {service}, {date}, {time}, {address}, {customer}, {phone}, {car}, {price}'
const JOB_KIND: Record<string, string> = Object.fromEntries(KINDS)
const JOB_STATUS: Record<string, string> = { pending: 'Ожидает', sent: 'Отправлено', failed: 'Не отправлено' }
const BOUNCE_TYPE: Record<string, string> = { soft: 'Временная ошибка', hard: 'Адрес не существует', complaint: 'Жалоба на письмо' }

const stamp = (value: string | null, tz: string) => value ? formatInTimeZone(new Date(value), tz, 'd MMM, HH:mm', { locale: ru }) : '—'

/** Per-tenant Telegram wording. Empty text restores the built-in default. */
export function NotificationTemplates({ b }: { b: Business }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['owner', 'notification-templates', b.slug], queryFn: () => owner.notificationTemplates(b.slug), retry: false })
  const [draft, setDraft] = useState<Record<string, { body: string; active: boolean }>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (!q.data) return
    const next: Record<string, { body: string; active: boolean }> = {}
    for (const t of q.data) next[`${t.audience}:${t.kind}`] = { body: t.body ?? '', active: t.is_active }
    setDraft(next)
  }, [q.data])

  const save = useMutation({
    mutationFn: async (key: string) => {
      const [audience = '', kind = ''] = key.split(':')
      const value = draft[key] ?? { body: '', active: false }
      return owner.upsertNotificationTemplate(b.slug, { kind, audience: audience as 'client' | 'owner', body: value.body.trim(), active: value.active })
    },
    onSuccess: async (_id, key) => {
      setSaved(key); setMsg(null)
      await qc.invalidateQueries({ queryKey: ['owner', 'notification-templates', b.slug] })
    },
    onError: (e) => { setSaved(null); setMsg(errText(e)) },
  })

  return <section className="card col">
    <div className="admin-subheading"><div><h2>Шаблоны уведомлений</h2><p className="muted small">Своя формулировка для каждого сообщения. Оставьте текст пустым, чтобы вернуть стандартный вариант.</p></div></div>
    <p className="muted small">Доступные подстановки: {PLACEHOLDERS}. Шаблон проверяется при сохранении.</p>
    {q.isPending && <p className="muted small">Загружаем шаблоны…</p>}
    {q.isError && <p className="err small">Не удалось загрузить шаблоны. <button className="link" onClick={() => void q.refetch()}>Повторить</button></p>}
    {msg && <p className="err small" role="alert">{msg}</p>}
    {AUDIENCE.map(([audience, audienceLabel]) => <div className="col" key={audience}>
      <b>{audienceLabel}</b>
      {KINDS.map(([kind, kindLabel]) => {
        const key = `${audience}:${kind}`
        const value = draft[key] ?? { body: '', active: false }
        const slot = q.data?.find((t) => t.audience === audience && t.kind === kind)
        return <div className="card col" key={key}>
          <div className="row between wrap"><b>{kindLabel}</b><span className="muted small">{slot?.source === 'template' ? 'Свой текст' : 'Стандартный текст'}</span></div>
          <textarea className="field" rows={2} maxLength={2000} value={value.body}
            placeholder="Стандартный текст" aria-label={`${audienceLabel}: ${kindLabel}`}
            onChange={(e) => { setSaved(null); setMsg(null); setDraft((prev) => ({ ...prev, [key]: { ...value, body: e.target.value } })) }} />
          <div className="row between wrap">
            <label className="check"><input type="checkbox" checked={value.active} onChange={(e) => { setSaved(null); setDraft((prev) => ({ ...prev, [key]: { ...value, active: e.target.checked } })) }} /> Использовать этот текст</label>
            <div className="row wrap">
              <button className="btn ghost mini" disabled={save.isPending} onClick={() => {
                setSaved(null); setDraft((prev) => ({ ...prev, [key]: { body: '', active: false } }))
                void save.mutate(key)
              }}>Вернуть стандарт</button>
              <button className="btn mini" disabled={save.isPending || !slot} onClick={() => save.mutate(key)}>Сохранить</button>
            </div>
          </div>
          {saved === key && <p className="muted small" role="status">Шаблон сохранён.</p>}
        </div>
      })}
    </div>
  )}
  </section>
}

/** Per-job delivery history, retry action and bounce suppression list. */
export function NotificationDelivery({ b }: { b: Business }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState('all')
  const [kind, setKind] = useState('all')
  const [page, setPage] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const limit = 25
  useEffect(() => setPage(0), [status, kind])

  const q = useQuery({
    queryKey: ['owner', 'notification-jobs', b.slug, status, kind, page],
    queryFn: () => owner.notificationJobs(b.slug, status, kind, limit, page * limit), retry: false,
  })
  const bounces = useQuery({
    queryKey: ['owner', 'notification-bounces', b.slug],
    queryFn: () => owner.notificationBounces(b.slug, 50, 0), retry: false,
  })
  const retry = useMutation({
    mutationFn: (id: string) => owner.notificationRetry(b.slug, id),
    onSuccess: async () => {
      setMsg(null)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['owner', 'notification-jobs', b.slug] }),
        qc.invalidateQueries({ queryKey: ['owner', 'notification-status', b.slug] }),
      ])
    },
    onError: (e) => setMsg(errText(e)),
  })

  const rows = q.data?.rows ?? []
  const count = Number(q.data?.count ?? 0)
  const pages = Math.max(1, Math.ceil(count / limit))
  const bounceRows = bounces.data?.rows ?? []

  return <section className="card col">
    <div className="admin-subheading"><div><h2>Статусы доставки</h2><p className="muted small">Каждое сообщение, ошибки отправки и повторная отправка.</p></div><button className="btn ghost mini" onClick={() => { void q.refetch(); void bounces.refetch() }}>Обновить</button></div>
    <div className="row wrap">
      <select className="field" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус отправки">
        <option value="all">Все статусы</option>
        {Object.entries(JOB_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <select className="field" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Тип сообщения">
        <option value="all">Все сообщения</option>
        {KINDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </div>
    {msg && <p className="err small" role="alert">{msg}</p>}
    {q.isPending && <p className="muted small">Загружаем историю…</p>}
    {q.isError && <p className="err small">Не удалось загрузить историю. <button className="link" onClick={() => void q.refetch()}>Повторить</button></p>}
    {q.data && rows.length === 0 && <p className="muted small">Сообщений по выбранным условиям нет.</p>}
    {rows.length > 0 && <div className="col">
      {rows.map((job) => <div className="card row between wrap" key={job.id}>
        <div><b>{JOB_KIND[job.kind] ?? job.kind} · {job.channel}</b><p className="muted small">{stamp(job.created_at, b.timezone)} · {JOB_STATUS[job.status] ?? job.status} · попыток: {job.attempts}</p>{job.last_error && <p className="err small">{job.last_error}</p>}</div>
        {job.status === 'failed' && <button className="btn ghost mini" disabled={retry.isPending} onClick={() => retry.mutate(job.id)}>Повторить</button>}
      </div>)}
    </div>}
    {q.data && (rows.length > 0 || page > 0) && <div className="row between wrap">
      <span className="muted small">{count} сообщений · страница {page + 1} из {pages}</span>
      <div className="row"><button className="btn ghost mini" disabled={page === 0 || q.isFetching} onClick={() => setPage((p) => p - 1)}>Назад</button><button className="btn ghost mini" disabled={page + 1 >= pages || q.isFetching} onClick={() => setPage((p) => p + 1)}>Дальше</button></div>
    </div>}
    <div className="admin-subheading"><div><h3>Отказы доставки</h3><p className="muted small">Адреса, на которые пришли отказы или жалобы. Повторная отправка на них заблокирована.</p></div></div>
    {bounces.isPending && <p className="muted small">Загружаем отказы…</p>}
    {bounces.data && bounceRows.length === 0 && <p className="muted small">Отказов нет.</p>}
    {bounceRows.length > 0 && <div className="col">
      {bounceRows.map((item) => <div className="card row between wrap" key={item.id}><div><b>{item.recipient}</b><p className="muted small">{stamp(item.created_at, b.timezone)} · {item.channel} · {BOUNCE_TYPE[item.bounce_type] ?? item.bounce_type}</p></div></div>)}
    </div>}
  </section>
}
