import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { formatInTimeZone } from 'date-fns-tz'
import { ru } from 'date-fns/locale'
import { owner, errText, type OwnerNotificationSettings } from '../../lib/api'
import { isFullPhone, maskPhone, PHONE_PLACEHOLDER } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import { prepareImage, removeByUrl, uploadImage } from '../../lib/media'
import { assetUrl, type Business } from '../../lib/tenant'
import { Err } from './shared'

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
export function Settings({ b }: { b: Business }) {
  const qc = useQueryClient()
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [f, setF] = useState({
    phone: maskPhone(b.phone ?? ''),
    address: b.address,
    route_url: b.route_url ?? '',
    description: b.description,
    cards: b.cards,
    hours: b.hours,
    breaks: b.breaks ?? {},
    buffer_minutes: String(b.buffer_minutes ?? 15),
    slot_minutes: String(b.slot_minutes ?? 60),
    cancel_hours: String(b.cancel_hours ?? 24),
    reschedule_hours: String(b.reschedule_hours ?? b.cancel_hours ?? 24),
    client_reschedule_enabled: !!b.client_reschedule_enabled,
  })
  const exceptions = useQuery({
    queryKey: ['owner', 'schedule-exceptions', b.slug],
    queryFn: () => owner.scheduleExceptions(b.slug),
  })
  const [exDraft, setExDraft] = useState({ id: null as string | null, date_from: '', date_to: '', is_closed: true, open: '09:00', close: '18:00', note: '' })

  const m = useMutation({
    mutationFn: async () => {
      await owner.updateConfig(b.slug, {
        phone: f.phone.trim(),
        address: f.address.trim(),
        route_url: f.route_url,
        description: f.description,
        cards: f.cards,
        hours: f.hours,
      })
      await owner.updateScheduleSettings(b.slug, {
        buffer_minutes: Number(f.buffer_minutes),
        slot_minutes: Number(f.slot_minutes),
        cancel_hours: Number(f.cancel_hours),
        reschedule_hours: Number(f.reschedule_hours),
        client_reschedule_enabled: f.client_reschedule_enabled,
        breaks: f.breaks,
      })
    },
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

  const exSave = useMutation({
    mutationFn: () => owner.upsertScheduleException(b.slug, {
      id: exDraft.id,
      date_from: exDraft.date_from,
      date_to: exDraft.date_to || exDraft.date_from,
      is_closed: exDraft.is_closed,
      hours: exDraft.is_closed ? null : [exDraft.open, exDraft.close],
      note: exDraft.note.trim(),
    }),
    onSuccess: () => {
      setExDraft({ id: null, date_from: '', date_to: '', is_closed: true, open: '09:00', close: '18:00', note: '' })
      setMsg(null)
      void qc.invalidateQueries({ queryKey: ['owner', 'schedule-exceptions', b.slug] })
    },
    onError: (e) => setMsg(errText(e)),
  })
  const exDelete = useMutation({
    mutationFn: (id: string) => owner.deleteScheduleException(b.slug, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['owner', 'schedule-exceptions', b.slug] }),
    onError: (e) => setMsg(errText(e)),
  })

  const validateHours = (hours: typeof f.hours) => {
    for (const [, h] of Object.entries(hours))
      if (h && (!Time.safeParse(h[0]).success || !Time.safeParse(h[1]).success || h[0] >= h[1])) return 'Неверные часы работы: начало раньше конца, формат ЧЧ:ММ.'
    return null
  }
  const validateBreaks = (breaks: typeof f.breaks, hours: typeof f.hours) => {
    for (const [k, arr] of Object.entries(breaks || {})) {
      if (!arr) continue
      const h = hours[k]
      for (const br of arr) {
        if (!Time.safeParse(br[0]).success || !Time.safeParse(br[1]).success || br[0] >= br[1]) return 'Неверное время перерыва: формат ЧЧ:ММ, начало раньше конца.'
        if (h && (br[0] < h[0] || br[1] > h[1])) return 'Перерыв должен быть внутри рабочего времени дня.'
      }
    }
    return null
  }

  const save = () => {
    const hErr = validateHours(f.hours)
    if (hErr) { setOk(false); setMsg(hErr); return }
    const bErr = validateBreaks(f.breaks, f.hours)
    if (bErr) { setOk(false); setMsg(bErr); return }
    if (f.route_url && !/^https:\/\//.test(f.route_url)) { setOk(false); setMsg('Ссылка 2ГИС должна начинаться с https://'); return }
    if (!isFullPhone(f.phone)) { setOk(false); setMsg('Введите корректный телефон в формате +7 (700) 000-00-00.'); return }
    if (!f.address.trim()) { setOk(false); setMsg('Укажите адрес.'); return }
    const nums = [Number(f.buffer_minutes), Number(f.slot_minutes), Number(f.cancel_hours), Number(f.reschedule_hours)]
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) { setOk(false); setMsg('Проверьте числовые настройки расписания.'); return }
    if (Number(f.slot_minutes) < 5 || Number(f.slot_minutes) > 240) { setOk(false); setMsg('Шаг слотов должен быть от 5 до 240 минут.'); return }
    if (Number(f.buffer_minutes) > 240 || Number(f.cancel_hours) > 168 || Number(f.reschedule_hours) > 168) { setOk(false); setMsg('Проверьте лимиты настроек (буфер до 240 мин, окна отмены/переноса до 168 ч).'); return }
    m.mutate()
  }

  const setHour = (k: string, v: [string, string] | null) => setF({ ...f, hours: { ...f.hours, [k]: v } })
  const setBreaksForDay = (k: string, arr: [string, string][] | null) => setF({ ...f, breaks: { ...f.breaks, [k]: arr && arr.length ? arr : null } })
  const card = (k: 'booking' | 'catalog' | 'install', label: string): ReactNode => (
    <div className="card col">
      <b>{label}</b>
      <input aria-label={`${label}: заголовок`} className="field" value={f.cards[k].title} onChange={(e) => setF({ ...f, cards: { ...f.cards, [k]: { ...f.cards[k], title: e.target.value } } })} />
      <textarea aria-label={`${label}: текст`} className="field" rows={2} value={f.cards[k].text} onChange={(e) => setF({ ...f, cards: { ...f.cards, [k]: { ...f.cards[k], text: e.target.value } } })} />
    </div>
  )

  return (
    <>
      <div className="admin-subheading"><div><h2>Настройки студии</h2><p className="muted small">Контакты, расписание, исключения, буферы и правила записи.</p></div></div>
      <Err m={msg} />
      {ok && <p className="muted" role="status">Сохранено.</p>}

      <div className="card col admin-settings-card">
        <label className="muted small" htmlFor="ph">Телефон</label>
        <input id="ph" className="field" type="tel" inputMode="tel" maxLength={18} placeholder={PHONE_PLACEHOLDER} value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value, f.phone) })} />
        <label className="muted small" htmlFor="ad">Адрес</label>
        <input id="ad" className="field" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        <label className="muted small" htmlFor="ru">Ссылка 2ГИС для маршрута</label>
        <input id="ru" className="field" placeholder="https://go.2gis.com/..." value={f.route_url} onChange={(e) => setF({ ...f, route_url: e.target.value })} />
        <label className="muted small" htmlFor="ds">Описание</label>
        <textarea id="ds" className="field" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>

      <h3>Часы работы</h3>
      <div className="card col admin-hours">
        {DAYS.map(([k, l]) => {
          const h = f.hours[k] ?? null
          return (
            <div className="row wrap admin-hours-row" key={k} style={{ gap: 8, alignItems: 'center' }}>
              <b style={{ width: 28 }}>{l}</b>
              <label className="row small"><input type="checkbox" checked={!h} onChange={(e) => setHour(k, e.target.checked ? null : ['09:00', '17:00'])} />Выходной</label>
              {h && (<>
                <input aria-label={`${l} с`} className="field" style={{ width: 100 }} value={h[0]} onChange={(e) => setHour(k, [e.target.value, h[1]])} />
                <input aria-label={`${l} до`} className="field" style={{ width: 100 }} value={h[1]} onChange={(e) => setHour(k, [h[0], e.target.value])} />
              </>)}
            </div>
          )
        })}
      </div>

      <h3>Перерывы по дням</h3>
      <div className="card col" style={{ gap: 10 }}>
        <p className="muted small">Укажите перерыв (например, обед), чтобы слоты в это время не предлагались клиентам.</p>
        {DAYS.map(([k, l]) => {
          const dayHours = f.hours[k]
          const brs = f.breaks[k] ?? []
          const add = () => setBreaksForDay(k, [...brs, ['13:00', '14:00']])
          const update = (i: number, idx: 0 | 1, val: string) => setBreaksForDay(k, brs.map((x, j) => j === i ? (idx === 0 ? [val, x[1]] : [x[0], val]) : x) as [string, string][])
          const remove = (i: number) => setBreaksForDay(k, brs.filter((_, j) => j !== i) as [string, string][])
          return (
            <div key={k} className="col" style={{ gap: 6 }}>
              <div className="row between wrap"><b>{l}</b>{dayHours ? <button type="button" className="btn ghost mini" onClick={add}>+ Перерыв</button> : <span className="muted small">Выходной</span>}</div>
              {dayHours && brs.length === 0 && <span className="muted small">Перерывов нет</span>}
              {dayHours && brs.map((br, i) => (
                <div className="row wrap" key={i} style={{ gap: 8, alignItems: 'center' }}>
                  <input aria-label={`${l} перерыв с`} className="field" style={{ width: 100 }} value={br[0]} onChange={(e) => update(i, 0, e.target.value)} />
                  <span>—</span>
                  <input aria-label={`${l} перерыв до`} className="field" style={{ width: 100 }} value={br[1]} onChange={(e) => update(i, 1, e.target.value)} />
                  <button type="button" className="btn ghost mini" onClick={() => remove(i)}>Удалить</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <h3>Слоты, буферы и правила отмены/переноса</h3>
      <div className="card col admin-settings-card" style={{ gap: 10 }}>
        <label className="muted small" htmlFor="slotm">Шаг слотов, минут</label>
        <input id="slotm" className="field" type="number" min={5} max={240} value={f.slot_minutes} onChange={(e) => setF({ ...f, slot_minutes: e.target.value })} />
        <label className="muted small" htmlFor="bufm">Буфер между записями, минут</label>
        <input id="bufm" className="field" type="number" min={0} max={240} value={f.buffer_minutes} onChange={(e) => setF({ ...f, buffer_minutes: e.target.value })} />
        <p className="muted small">Буфер автоматически резервирует время после каждой записи (подготовка/уборка), чтобы следующий слот не начинался вплотную.</p>
        <label className="muted small" htmlFor="canch">Отмена клиентом: минимум за, часов</label>
        <input id="canch" className="field" type="number" min={0} max={168} value={f.cancel_hours} onChange={(e) => setF({ ...f, cancel_hours: e.target.value })} />
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.client_reschedule_enabled} onChange={(e) => setF({ ...f, client_reschedule_enabled: e.target.checked })} /><span>Разрешить клиенту перенос записи (политика)</span></label>
        <label className="muted small" htmlFor="resh">Перенос клиентом: минимум за, часов</label>
        <input id="resh" className="field" type="number" min={0} max={168} value={f.reschedule_hours} onChange={(e) => setF({ ...f, reschedule_hours: e.target.value })} disabled={!f.client_reschedule_enabled} />
        <p className="muted small">Текущая клиентская отмена работает по окну отмены. Настройка переноса сохраняется как политика для дальнейшего включения клиентского переноса в интерфейсе записи.</p>
      </div>

      <h3>Исключения расписания (выходные, праздники, особые часы)</h3>
      <div className="card col" style={{ gap: 10 }}>
        <p className="muted small">Исключение перекрывает обычное недельное расписание на выбранную дату или период.</p>
        <div className="row wrap" style={{ gap: 8 }}>
          <label className="col muted small">С даты<input className="field" type="date" value={exDraft.date_from} onChange={(e) => setExDraft({ ...exDraft, date_from: e.target.value })} /></label>
          <label className="col muted small">По дату<input className="field" type="date" value={exDraft.date_to} onChange={(e) => setExDraft({ ...exDraft, date_to: e.target.value })} /></label>
        </div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={exDraft.is_closed} onChange={(e) => setExDraft({ ...exDraft, is_closed: e.target.checked })} /><span>Закрыто весь день (выходной/праздник)</span></label>
        {!exDraft.is_closed && (
          <div className="row wrap" style={{ gap: 8 }}>
            <label className="col muted small">Открыто с<input className="field" style={{ width: 120 }} value={exDraft.open} onChange={(e) => setExDraft({ ...exDraft, open: e.target.value })} /></label>
            <label className="col muted small">Открыто до<input className="field" style={{ width: 120 }} value={exDraft.close} onChange={(e) => setExDraft({ ...exDraft, close: e.target.value })} /></label>
          </div>
        )}
        <label className="col muted small">Комментарий<input className="field" maxLength={120} placeholder="Например: праздник / укороченный день" value={exDraft.note} onChange={(e) => setExDraft({ ...exDraft, note: e.target.value })} /></label>
        <button type="button" className="btn ghost" disabled={exSave.isPending || !exDraft.date_from} onClick={() => exSave.mutate()}>{exSave.isPending ? 'Сохранение…' : (exDraft.id ? 'Обновить исключение' : 'Добавить исключение')}</button>
        {exceptions.isPending ? <p className="muted small">Загрузка исключений…</p>
          : exceptions.isError ? <p className="err small">Не удалось загрузить исключения. <button className="link" onClick={() => void exceptions.refetch()}>Повторить</button></p>
          : (exceptions.data?.length ?? 0) === 0 ? <p className="muted small">Исключений пока нет.</p>
          : <div className="col" style={{ gap: 8 }}>{exceptions.data!.map((ex) => (
              <div key={ex.id} className="row between wrap" style={{ gap: 8 }}>
                <div>
                  <b>{ex.date_from}{ex.date_to !== ex.date_from ? ` — ${ex.date_to}` : ''}</b>
                  <div className="muted small">{ex.is_closed ? 'Закрыто' : `Особые часы: ${ex.hours?.[0] ?? '?'}–${ex.hours?.[1] ?? '?'}`}{ex.note ? ` · ${ex.note}` : ''}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn ghost mini" onClick={() => setExDraft({ id: ex.id, date_from: ex.date_from, date_to: ex.date_to, is_closed: ex.is_closed, open: ex.hours?.[0] ?? '09:00', close: ex.hours?.[1] ?? '18:00', note: ex.note ?? '' })}>Изменить</button>
                  <button type="button" className="btn ghost mini" disabled={exDelete.isPending} onClick={() => { if (window.confirm('Удалить исключение расписания?')) exDelete.mutate(ex.id) }}>Удалить</button>
                </div>
              </div>
            ))}</div>}
      </div>

      <h3>Тексты на страницах</h3>
      <div className="admin-copy-grid">
        {card('booking', 'Запись')}
        {card('catalog', 'Каталог услуг')}
        {card('install', 'Приложение')}
      </div>

      <button className="btn admin-save" disabled={m.isPending} onClick={save}>
        {m.isPending ? 'Сохранение…' : 'Сохранить'}
      </button>
      <p className="muted small">Логотип, обложка, фото и работы студии настраиваются в разделе «Фото».</p>
    </>
  )
}

type Work = { image: string; caption: string }
const ACCEPT = 'image/jpeg,image/png,image/webp'
export function Media({ b }: { b: Business }) {
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
export function Docs({ b }: { b: Business }) {
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
export function Notify({ b }: { b: Business }) {
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

export function NotificationPreferences({b}:{b:Business}) {
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
