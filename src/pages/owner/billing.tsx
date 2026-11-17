import { useQuery } from '@tanstack/react-query'
import { errText, owner, type OwnerBillingDocument, type OwnerPayment } from '../../lib/api'

const kzt = (n?: number | null) => `${(n ?? 0).toLocaleString('ru-RU')} ₸`
const date = (v?: string | null) => v ? new Date(v).toLocaleDateString('ru-RU') : '—'
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))

const DOC_TYPE: Record<string, string> = { invoice: 'Счёт', act: 'Акт' }
const PAY_STATUS: Record<string, string> = { pending: 'Ожидает подтверждения', paid: 'Оплачен', failed: 'Не прошёл', refunded: 'Возвращён' }
const PAY_METHOD: Record<string, string> = { cash: 'Наличные', kaspi: 'Kaspi', transfer: 'Перевод', card: 'Карта', other: 'Другое' }
const PHASE: Record<string, string> = { trial: 'Пробный период', active: 'Активна', grace: 'Льготный период', scheduled: 'Запланирована', suspended: 'Приостановлена', expired: 'Истекла', cancelled: 'Отменена', none: 'Нет подписки' }

function printDocument(d: OwnerBillingDocument) {
  const w = window.open('', '_blank')
  if (!w) return
  const title = `${DOC_TYPE[d.document_type] ?? 'Документ'} ${esc(d.number)}`
  w.document.write(`<meta charset="utf-8"><title>${title}</title><h1>${title}</h1><p>Дата: ${date(d.issue_date)}</p><p>Исполнитель: Renvio, Казахстан</p><p>Услуги: ${date(d.service_from)} — ${date(d.service_to)}</p><p>${esc(d.description)}</p><h2>${kzt(d.amount_kzt)}</h2><p>ЭСФ: ${esc(d.esf_number || 'не оформлена')} · ${esc(d.esf_status)}</p><small>Печатная форма Renvio не является официальной ЭСФ.</small><script>window.print()</script>`)
  w.document.close()
}

/** Owner-facing billing overview: current plan, limit usage, documents and payments. */
export function Billing({ slug, onOpenSupport }: { slug: string; onOpenSupport?: () => void }) {
  const sub = useQuery({ queryKey: ['owner', 'subscription', slug], queryFn: () => owner.subscription(slug), retry: false })
  const usage = useQuery({ queryKey: ['owner', 'plan-usage', slug], queryFn: () => owner.planUsage(slug), retry: false })
  const docs = useQuery({ queryKey: ['owner', 'billing-documents', slug], queryFn: () => owner.billingDocuments(slug), retry: false })
  const payments = useQuery({ queryKey: ['owner', 'payments', slug], queryFn: () => owner.payments(slug), retry: false })

  const limits: [string, string][] = [['employees', 'Сотрудники'], ['services', 'Услуги'], ['bookings_per_month', 'Записи за месяц'], ['branches', 'Филиалы']]
  const values = usage.data?.usage ?? {}
  const caps = usage.data?.limits ?? {}

  return <div className="col">
    <div className="admin-subheading"><div><h2>Счета и оплата</h2><p className="muted small">Тариф, лимиты, документы и история платежей вашей организации.</p></div></div>

    {sub.isPending && <p className="muted">Загружаем подписку…</p>}
    {sub.isError && <p className="err">Не удалось загрузить подписку: {errText(sub.error)}.</p>}
    {sub.data && <section className="card col">
      <div className="row between wrap"><b>{sub.data.plan_name ?? sub.data.plan_code ?? 'Тариф не выбран'}</b><span className={`pf-badge pf-${sub.data.phase}`}>{PHASE[sub.data.phase] ?? 'Статус уточняется'}</span></div>
      <div className="owner-account-grid">
        <div><span className="muted small">Действует до</span><b>{date(sub.data.ends_at)}</b></div>
        <div><span className="muted small">Осталось</span><b>{sub.data.days_left == null ? '—' : `${Math.max(0, sub.data.days_left)} дней`}</b></div>
        <div><span className="muted small">Стоимость периода</span><b>{kzt(sub.data.price_kzt)} / {sub.data.price_period_months ?? 1} мес.</b></div>
      </div>
    </section>}

    <section className="card col">
      <b>Использование тарифа</b>
      {usage.isPending && <p className="muted small">Загружаем лимиты…</p>}
      {usage.isError && <p className="err small">Не удалось загрузить лимиты: {errText(usage.error)}.</p>}
      {usage.data && <div className="col">
        {limits.map(([key, label]) => {
          const current = Number(values[key] ?? 0)
          const cap = caps[key]
          const pct = cap == null || Number(cap) <= 0 ? 0 : Math.min(100, Math.round(current / Number(cap) * 100))
          const near = cap != null && pct >= 80
          return <div key={key} style={{ display: 'grid', gap: 4 }}>
            <div className="row between"><span className="muted small">{label}</span><b className={near ? 'err small' : 'muted small'}>{current.toLocaleString('ru-RU')} / {cap == null ? 'без ограничений' : Number(cap).toLocaleString('ru-RU')}</b></div>
            {cap != null && <div style={{ height: 6, borderRadius: 999, background: 'var(--line, #222)', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: near ? '#e0a030' : 'var(--accent, #568cff)' }} /></div>}
            {near && <p className="err small">Лимит почти исчерпан. Увеличьте тариф через поддержку, чтобы продолжить работу без перерыва.</p>}
          </div>
        })}
        <div className="row wrap">{Object.entries(usage.data.features).map(([key, enabled]) => <span key={key} className={`pf-badge ${enabled ? 'pf-active' : 'pf-expired'}`}>{key}: {enabled ? 'доступно' : 'не включено'}</span>)}</div>
      </div>}
    </section>

    <section className="card col">
      <div className="row between wrap"><b>Счета и акты</b><span className="muted small">Внутренние документы, не официальная ЭСФ</span></div>
      {docs.isPending && <p className="muted small">Загружаем документы…</p>}
      {docs.isError && <p className="err small">Не удалось загрузить документы: {errText(docs.error)}.</p>}
      {docs.data?.length === 0 && <p className="muted">Документов пока нет.</p>}
      {docs.data?.map(d => <div className="card row between wrap" key={d.id}>
        <div><b>{DOC_TYPE[d.document_type] ?? d.document_type} №{esc(d.number)}</b><p className="muted small">{date(d.issue_date)} · {date(d.service_from)} — {date(d.service_to)} · {esc(d.description)}</p><p className="muted small">ЭСФ: {esc(d.esf_number || 'не оформлена')} · {esc(d.esf_status)}</p></div>
        <div className="row wrap"><b>{kzt(d.amount_kzt)}</b><button className="btn ghost mini" onClick={() => printDocument(d)}>Печать / сохранить</button></div>
      </div>)}
    </section>

    <section className="card col">
      <b>История платежей</b>
      {payments.isPending && <p className="muted small">Загружаем платежи…</p>}
      {payments.isError && <p className="err small">Не удалось загрузить платежи: {errText(payments.error)}.</p>}
      {payments.data?.length === 0 && <p className="muted">Платежей пока не зарегистрировано.</p>}
      {payments.data?.map((p: OwnerPayment) => <div className="card row between wrap" key={p.id}>
        <div><b>{kzt(p.amount_kzt)} · {PAY_STATUS[p.status] ?? p.status}</b><p className="muted small">{PAY_METHOD[p.method] ?? p.method} · {date(p.received_at)} · период {date(p.period_start)} — {date(p.period_end)}</p>{p.note && <p className="muted small">{esc(p.note)}</p>}{p.refund_reason && <p className="err small">Причина возврата: {esc(p.refund_reason)}</p>}</div>
      </div>)}
    </section>

    <section className="card col">
      <b>Нужно больше возможностей?</b>
      <p className="muted small">Смена тарифа и продление оформляются через поддержку Renvio. Напишите нам, если хотите изменить лимиты или получить официальную ЭСФ.</p>
      {onOpenSupport && <div><button className="btn ghost mini" onClick={onOpenSupport}>Открыть поддержку</button></div>}
    </section>
  </div>
}
