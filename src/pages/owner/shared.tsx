import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { formatInTimeZone } from 'date-fns-tz'
import { ru } from 'date-fns/locale'
import { downloadOwnerExport } from '../../lib/ownerSession'
import { errText, type OwnerAuditEvent, type OwnerBillingNotification } from '../../lib/api'
import { money } from '../../lib/format'
import type { Business } from '../../lib/tenant'

export const TABS = ['Записи', 'Отчёты', 'Сотрудники', 'Личный кабинет', 'Счета и оплата', 'Центр уведомлений', 'Поддержка', 'Мой доступ', 'Команда и посты', 'История', 'Ожидание', 'Промокоды', 'Отзывы', 'Услуги', 'Студия', 'Фото', 'Уведомления', 'Документы'] as const

// Группы разделов кабинета. Идентификаторы вкладок не меняются, меняются только подписи и группировка.
export const TAB_GROUPS: { name: string; tabs: (typeof TABS)[number][] }[] = [
  { name: 'Сегодня', tabs: ['Записи', 'Ожидание'] },
  { name: 'Клиенты', tabs: ['История', 'Отзывы', 'Промокоды', 'Уведомления'] },
  { name: 'Мой кабинет', tabs: ['Личный кабинет', 'Счета и оплата', 'Центр уведомлений', 'Поддержка'] },
  { name: 'Услуги и студия', tabs: ['Услуги', 'Студия', 'Фото', 'Документы'] },
  { name: 'Команда', tabs: ['Сотрудники', 'Команда и посты', 'Мой доступ'] },
  { name: 'Отчёты', tabs: ['Отчёты'] },
];
export const TAB_LABELS: Partial<Record<(typeof TABS)[number], string>> = {
  'Мой доступ': 'Резервный доступ',
  'Команда и посты': 'Посты и мастера',
};
export const STATUS: Record<string, string> = {
  booked: 'Записан',
  arrived: 'Принята',
  done: 'Готова',
  cancelled: 'Отменена',
}

export const today = (b: Business) => formatInTimeZone(new Date(), b.timezone, 'yyyy-MM-dd')
export const fmtT = (b: Business, s: string, p: string) =>
  formatInTimeZone(new Date(s), b.timezone, p, { locale: ru })

export function useAct(onDone: () => void, close?: () => void) {
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
export const Err = ({ m }: { m: string | null }) =>
  m ? (
    <p role="alert" className="err">
      {m}
    </p>
  ) : null

export function ExportButton({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async () => {
    setBusy(true); setErr('')
    try { await downloadOwnerExport(slug) }
    catch (e) { setErr((e as Error).message === 'rate_limited' ? 'Слишком много выгрузок, попробуйте позже.' : 'Не удалось сформировать выгрузку. Попробуйте ещё раз.') }
    finally { setBusy(false) }
  }
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <button className="btn ghost mini" onClick={run} disabled={busy}>{busy ? 'Готовим копию…' : 'Скачать копию данных'}</button>
      {err && <span className="err small" role="alert">{err}</span>}
    </div>
  )
}

export function MoreMenu({label,children}:{label:string;children:ReactNode}) {
  return <details className="admin-more-menu"><summary aria-label={label} title={label}>⋯</summary><div className="admin-more-panel">{children}</div></details>
}

export function downloadCsv(fileName:string, rows:unknown[][]) {
  const cell=(value:unknown)=>{const raw=String(value??'');const safe=/^[\s]*[=+\-@]/.test(raw)?`'${raw}`:raw;return `"${safe.replaceAll('"','""')}"`;};
  const csv='\ufeff'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=fileName;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function billingEventTitle(type:string){return ({suspended:'Подписка приостановлена',resumed:'Подписка возобновлена',expired:'Срок подписки закончился',grace_started:'Начался льготный период',extended:'Срок подписки продлён',plan_changed:'Изменён тариф',dates_changed:'Изменены даты подписки',cancelled:'Подписка отменена',payment_failed:'Не удалось подтвердить платёж',price_change_accepted:'Новая цена принята',price_change_declined:'Новая цена отклонена'} as Record<string,string>)[type]??'Изменение подписки'}
export function billingEventDetail(e:OwnerBillingNotification){const p=e.payload??{};const reason=String(p.reason??'').trim();if(e.event_type==='suspended')return `${reason?`Причина: ${reason}. `:''}Онлайн-запись временно отключена. Данные организации сохранены. Чтобы восстановить работу, свяжитесь с поддержкой Renvio.`;if(e.event_type==='payment_failed')return `${reason?`Причина: ${reason}. `:''}Платёж не прошёл. Проверьте перевод или обратитесь в поддержку Renvio для сверки.`;if(e.event_type==='grace_started')return 'Подписка ожидает продления. Продлите её до окончания льготного периода, чтобы сервис продолжил работу.';if(e.event_type==='resumed')return 'Доступ к функциям подписки восстановлен.';if(e.event_type==='expired'||e.event_type==='cancelled')return 'Данные организации сохранены. Для возобновления обслуживания свяжитесь с поддержкой Renvio.';if(e.event_type==='extended')return 'Период действия подписки продлён.';if(e.event_type==='plan_changed')return 'В подписке организации изменён тариф.';if(e.event_type==='dates_changed')return 'Обновлён срок действия подписки.';if(e.event_type==='price_change_accepted')return 'Владелец организации принял предложенные условия тарифа.';if(e.event_type==='price_change_declined')return 'Предложенные условия тарифа отклонены.';return 'Появилось обновление по подписке. Подробности можно уточнить у поддержки Renvio.'}

export function auditEntity(entity:string) { return ({booking:'Запись',service:'Услуга',resource:'Мастер / пост',payment:'Оплата',studio:'Студия',notifications:'Уведомления',team:'Доступ сотрудника',support:'Поддержка',subscription:'Подписка'} as Record<string,string>)[entity]??'Действие в организации' }
export function auditAction(action:string,entity='') { if(entity==='team'&&action==='created')return 'доступ выдан';if(entity==='team'&&action==='updated')return 'права изменены';if(entity==='team'&&action==='deleted')return 'доступ отозван';if(entity==='subscription')return billingEventTitle(action).toLocaleLowerCase('ru-RU');return ({created:'создано',updated:'изменено',deleted:'удалено',payment:'оплата добавлена',refund:'возврат добавлен',settings_changed:'настройки обновлены',password_reset:'выдан новый временный пароль',account_recovered:'восстановлен доступ',support_started:'вход в кабинет',support_action:'изменение в кабинете',support_ended:'завершение сеанса',support_expired:'доступ завершился по времени'} as Record<string,string>)[action]??'данные обновлены' }
export const SUPPORT_ACTION_LABELS:Record<string,string>={owner_set_status:'изменила статус записи',owner_cancel:'отменила запись',owner_erase_customer:'удалила данные клиента',owner_reschedule:'перенесла запись',owner_create_booking:'создала запись',owner_block:'закрыла время для записи',owner_add_payment:'добавила оплату',owner_upsert_service:'изменила услугу',owner_delete_service:'удалила услугу',owner_upsert_resource:'изменила мастера или пост',owner_delete_resource:'удалила мастера или пост',owner_update_notification_settings:'изменила настройки уведомлений',owner_update_config:'изменила настройки организации',owner_update_legal:'изменила реквизиты',owner_telegram_unlink:'отключила Telegram',owner_waitlist_status:'изменила статус листа ожидания',owner_upsert_promo:'изменила промокод',owner_delete_promo:'удалила промокод',owner_publish_review:'изменила видимость отзыва'};
export function auditDetail(e:OwnerAuditEvent,currency:string,timezone:string) {
  let d:Record<string,unknown>=e.details??{};
  if(typeof d==='string'){try{const parsed=JSON.parse(d);if(parsed&&typeof parsed==='object')d=parsed as Record<string,unknown>}catch{d={}}}
  if(e.entity==='support') {
    if(e.action==='support_started')return `Причина: ${String(d.reason??'не указана')} · доступ до ${d.expires_at?new Date(String(d.expires_at)).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'—'}`;
    if(e.action==='support_action')return `${d.succeeded===true?'Успешно':'Не выполнено'}: ${SUPPORT_ACTION_LABELS[String(d.owner_action)]??'изменены данные в кабинете'}`;
    if(e.action==='support_ended')return 'Сеанс доступа поддержки завершён';
    if(e.action==='support_expired')return 'Сеанс поддержки автоматически завершён по истечении 30 минут';
  }
  if(e.entity==='subscription')return billingEventDetail({id:String(e.id),event_type:e.action,payload:d,created_at:e.created_at,is_read:true});
  if(e.entity==='service'||e.entity==='resource') {
    const pieces:string[]=[];
    const format=(key:string,value:unknown)=>key==='price_cents'?money(Number(value)/100,currency):key==='active'?(value===true||value==='true'?'показывается клиентам':'скрыта от клиентов'):String(value??'—');
    for(const key of ['name','category','price_cents','active'])if(d[key]!==undefined){const value=d[key];const label:Record<string,string>={name:'Название',category:'Категория',price_cents:'Цена',active:'Показ'};const change=value&&typeof value==='object'?value as Record<string,unknown>:null;pieces.push(change?`${label[key]}: ${format(key,change.from)} → ${format(key,change.to)}`:`${label[key]}: ${format(key,value)}`)}
    return pieces.join(' · ')||`ID ${e.entity_id?.slice(0,8)??''}`;
  }
  if(e.entity==='payment')return `${money(Number(d.amount_cents??0)/100,currency)}${e.action==='refund'?' возвращено':' получено'}`;
  if(e.entity==='team')return `${String(d.email??'Сотрудник')}${d.role?` · роль: ${d.role==='staff'?'сотрудник':'менеджер'}`:''}${d.resource?` · пост: ${String(d.resource)}`:''}`;
  if(e.entity==='studio'||e.entity==='notifications') {const names:Record<string,string>={phone:'телефон',address:'адрес',description:'описание',cards:'текст главной',hours:'часы работы',gallery:'галерея',client_telegram_enabled:'Telegram для клиентов',reminder_hours_before:'время напоминания',repeat_after_days:'период повторного визита',reminder_message:'текст напоминания',repeat_message:'текст повторного сообщения',legal:'юридические реквизиты'};const fields=Array.isArray(d.fields)?d.fields.map(x=>names[String(x)]??String(x)).join(', '):'настройки';const hours=d.hours as {from?:unknown;to?:unknown}|undefined;const days:Record<string,string>={mon:'Пн',tue:'Вт',wed:'Ср',thu:'Чт',fri:'Пт',sat:'Сб',sun:'Вс'};const schedule=(value:unknown)=>value&&typeof value==='object'?Object.entries(value as Record<string,unknown>).map(([day,range])=>`${days[day]??day} ${Array.isArray(range)?range.join('–'):'выходной'}`).join(', '):'не задан';return `Изменены поля: ${fields}${hours?` · график: ${schedule(hours.from)} → ${schedule(hours.to)}`:''}`}
  const changes=Object.entries(d).filter(([key])=>key!=='hours').map(([key,value])=>{const labels:Record<string,string>={status:'Статус',starts_at:'Время записи',service_id:'Услуга',resource_id:'Мастер / пост',reason:'Причина',expires_at:'Срок доступа',owner_action:'Действие поддержки',succeeded:'Результат',fields:'Изменённые настройки'};const label=labels[key]??'Изменённые данные';const change=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;const status=(v:unknown)=>({booked:'Записан',arrived:'Прибыл',done:'Завершён',cancelled:'Отменён'} as Record<string,string>)[String(v)]??String(v??'—');const display=(v:unknown)=>key==='status'?status(v):key==='starts_at'&&v?formatInTimeZone(new Date(String(v)),timezone,'d MMM yyyy, HH:mm'):key==='service_id'||key==='resource_id'?'изменено':key==='succeeded'?(v===true?'успешно':'не выполнено'):key==='owner_action'?SUPPORT_ACTION_LABELS[String(v)]??'изменены данные в кабинете':key==='expires_at'&&v?formatInTimeZone(new Date(String(v)),timezone,'d MMM yyyy, HH:mm'):Array.isArray(v)?v.map(x=>String(x)).join(', '):String(v??'—');return change?`${label}: ${display(change.from)} → ${display(change.to)}`:`${label}: ${display(value)}`});
  return changes.join(' · ')||`ID ${e.entity_id?.slice(0,8)??''}`;
}
