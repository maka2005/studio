import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { notify } from '../../components/Toaster';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export const ERR: Record<string, string> = {
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
export const errText = (e: unknown) => { const m = (e as Error)?.message ?? ''; return ERR[m] ?? 'Ошибка: ' + (m || 'неизвестно'); };

export async function call<T = Row>(action: string, body: Row = {}): Promise<T> {
  const response=await fetch('/api/platform?action=invoke',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,body})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error)throw new Error(String(data?.error??('request_failed_'+response.status)));
  return (data&&'data' in data?data.data:data) as T;
}
export async function platformAuth(action:string,body:Row={}){const isGet=action==='session'||action==='factors';const response=await fetch('/api/platform?action='+action,{method:isGet?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:isGet?undefined:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(String(data?.error??'request_failed'));return data}
export async function platformFile(action:string,body:Row){const response=await fetch('/api/platform?action='+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(String(data?.error??'request_failed'))}return response.blob()}

export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('ru-RU') : '—');
export const fmtDateTime = (v?: string | null) => (v ? new Date(v).toLocaleString('ru-RU') : '—');
export const kzt = (n?: number | null) => `${(n ?? 0).toLocaleString('ru-RU')} ₸`;
export const iso = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : '');
export const isoEnd = (d:string) => { if(!d)return '';const end=new Date(`${d}T00:00:00`);end.setDate(end.getDate()+1);return end.toISOString(); };
export const PHASE: Record<string, string> = { trial: 'Пробный период', active: 'Активна', grace: 'Льготный период', scheduled: 'Запланирована', suspended: 'Приостановлена', expired: 'Истекла', cancelled: 'Отменена', none: 'Нет подписки' };
export const PAY: Record<string, string> = { pending: 'Ожидает', paid: 'Оплачен', failed: 'Не прошёл', refunded: 'Возврат' };
export const METHODS: Record<string, string> = { kaspi: 'Kaspi', transfer: 'Перевод', cash: 'Наличные', card: 'Карта', other: 'Другое' };
export const Badge = ({ phase }: { phase: string }) => <span className={`pf-badge pf-${phase}`}>{PHASE[phase] ?? PAY[phase] ?? 'Статус не распознан'}</span>;

export const TABS = ['Главная', 'Организации', 'Поддержка', 'Заявки с сайта', 'Новая организация', 'Подписки', 'Тарифы', 'Платежи', 'Документы', 'Объявления и статус', 'Уведомления', 'Журнал', 'Администраторы', 'Настройки'] as const;
export type Tab = (typeof TABS)[number];

export const PLATFORM_ROLE_LABEL: Record<string, string> = { owner: 'Владелец', support: 'Поддержка', finance: 'Финансы', read_only: 'Только чтение' };

export function useLoad<T>(action: string, body: Row = {}, deps: unknown[] = []) {
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
export function useAllTenants() {
  const [data,setData]=useState<Row[]|null>(null); const [err,setErr]=useState(''); const [loading,setLoading]=useState(true);
  useEffect(()=>{let live=true;setLoading(true);void (async()=>{try{const all:Row[]=[];for(let offset=0;offset<100000;offset+=200){const page=await call<Row[]>('tenants',{limit:200,offset});all.push(...page);if(page.length<200)break}if(live)setData(all)}catch(e){if(live)setErr(errText(e))}finally{if(live)setLoading(false)}})();return()=>{live=false}},[]);
  return {data,err,loading};
}
export const State = ({ err, loading }: { err: string; loading: boolean }) => (err ? <p className="err">{err}</p> : loading ? <p className="muted">Загрузка…</p> : null);
export const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="pf-scroll"><table className="pf-table"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>);

export const newKey = () => crypto.randomUUID();

export async function runSubAction(sub: string, type: string, data: Row = {}) {
  return call('subscription_action', { subscription_id: sub, type, data, idempotency_key: newKey() });
}
export function SubscriptionActionModal({type,subscription,initialPlan='START',initialDate='',onClose,onSubmit}:{type:string;subscription:Row;initialPlan?:string;initialDate?:string;onClose:()=>void;onSubmit:(data:Row)=>Promise<void>}){
  const [reason,setReason]=useState('');const [plan,setPlan]=useState(initialPlan);const [date,setDate]=useState(initialDate);const [busy,setBusy]=useState(false);
  const title=type==='suspend'?'Приостановить подписку':type==='cancel'?'Отменить подписку':type==='change_plan'?'Сменить тариф':'Изменить дату окончания';
  const submit=async(e:FormEvent)=>{e.preventDefault();if(['suspend','cancel'].includes(type)&&reason.trim().length<3)return;if(type==='set_dates'&&!date)return;setBusy(true);try{await onSubmit(type==='suspend'||type==='cancel'?{reason:reason.trim()}:type==='change_plan'?{plan_code:plan}:{ends_at:iso(date)})}finally{setBusy(false)}};
  return <div className="pf-modal-backdrop"><form className="pf-modal card col" role="dialog" aria-modal="true" onSubmit={e=>void submit(e)}><h2>{title}</h2><p className="muted small">{subscription.name??subscription.slug??'Организация'} · {subscription.plan_code??''}</p>{type==='change_plan'?<label className="pf-label">Тариф<select className="field" value={plan} onChange={e=>setPlan(e.target.value)}><option>START</option><option>PRO</option><option>LEGACY</option></select></label>:type==='set_dates'?<label className="pf-label">Дата окончания<input className="field" type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>:<label className="pf-label">Причина<textarea className="field" rows={3} maxLength={500} minLength={3} value={reason} onChange={e=>setReason(e.target.value)} required/></label>}<div className="row wrap"><button className="pf-action-primary" disabled={busy}>{busy?'Сохраняем…':'Подтвердить'}</button><button type="button" className="pf-action-secondary" onClick={onClose}>Отмена</button></div></form></div>
}
export async function resumeFlow(sub: string): Promise<boolean> {
  try { await runSubAction(sub, 'resume'); return true; }
  catch (e) {
    if ((e as Error).message === 'no_paid_payment' && window.confirm('Нет подтверждённого платежа. Возобновить на один период без оплаты?')) { await runSubAction(sub, 'resume', { force: true }); return true; }
    throw e;
  }
}
export async function suspendFlow(sub:string):Promise<void>{const reason=window.prompt('Причина приостановки (обязательно):');if(!reason?.trim())return;if(!window.confirm('Подтвердить приостановку подписки?'))return;await runSubAction(sub,'suspend',{reason:reason.trim()})}

export async function resendInvite(email: string, slug: string) {
  try {
    await call('resend_invite', { email, slug });
    notify(`Приглашение отправлено на ${email}. Письмо приходит в течение минуты, проверьте также папку «Спам».`, 'ok');
  } catch (e) {
    notify(`Не удалось отправить приглашение на ${email}. ${errText(e)}`, 'err');
    throw e;
  }
}

export function subscriptionEventTitle(type:string){return ({created:'Подписка создана',suspended:'Подписка приостановлена',resumed:'Подписка возобновлена',extended:'Срок подписки продлён',dates_changed:'Изменён срок подписки',plan_changed:'Изменён тариф',cancelled:'Подписка отменена',expired:'Срок подписки закончился',grace_started:'Начался льготный период',payment_confirmed:'Платёж подтверждён',payment_failed:'Платёж не прошёл',payment_refunded:'Выполнен возврат',price_change_accepted:'Новая цена принята',price_change_declined:'Новая цена отклонена'} as Record<string,string>)[type]??'Обновление подписки'}
export function subscriptionEventDetail(e:Row){
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

const CYR_MAP:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',қ:'k',ғ:'g',ң:'n',ө:'o',ү:'u',ұ:'u',һ:'h',ә:'a',і:'i'};
export const slugFromName=(name:string)=>{const v=[...name.toLowerCase()].map(c=>CYR_MAP[c]??c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40).replace(/-+$/g,'');return v.length>=2?v:''};
export type LeadPrefill={id:string,name:string,slug:string,business_type?:string,owner_name:string,owner_email:string,phone:string,plan_code:string,trial:boolean};
