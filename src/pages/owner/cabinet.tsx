import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ownerRequest } from '../../lib/ownerSession'
import { fetchServices, owner, type OwnerBillingNotification } from '../../lib/api'
import { LoadingScreen } from '../../components/LoadingScreen'
import type { Business } from '../../lib/tenant'
import { ExportButton, TAB_GROUPS, TAB_LABELS, TABS, billingEventDetail, billingEventTitle } from './shared'
import { Bookings } from './bookings'
import { MyAccess, TeamAccess, TeamResources } from './team'
import { AuditHistory, Promos, Reports, Reviews, WaitlistAdmin } from './reports'
import { Services } from './services'
import { Docs, Media, Notify, Settings } from './settings'

function hasWorkingHours(hours: Business['hours']) {
  return Object.values(hours || {}).some((slot) => Array.isArray(slot) && slot[0] && slot[1])
}

function OnboardingChecklist({
  b,
  role,
  onGo,
}: {
  b: Business
  role?: string
  onGo: (tab: (typeof TABS)[number]) => void
}) {
  const services = useQuery({
    queryKey: ['owner', 'onboarding-services', b.slug],
    queryFn: () => fetchServices(b.slug),
    enabled: role === 'owner' || role === 'manager',
    retry: false,
    staleTime: 30_000,
  })
  const telegram = useQuery({
    queryKey: ['owner', 'telegram', b.slug],
    queryFn: () => owner.telegramLinks(b.slug),
    enabled: role === 'owner' || role === 'manager',
    retry: false,
    staleTime: 30_000,
  })

  const items = useMemo(() => {
    const addressDone = !!b.address?.trim()
    const scheduleDone = hasWorkingHours(b.hours)
    const servicesDone = (services.data?.length ?? 0) > 0
    const telegramDone = (telegram.data?.length ?? 0) > 0
    return [
      {
        key: 'services',
        title: 'Услуги',
        done: servicesDone,
        loading: services.isPending,
        error: services.isError,
        hint: servicesDone ? 'Добавлены активные услуги.' : 'Добавьте хотя бы одну услугу с ценой и длительностью.',
        action: () => onGo('Услуги'),
        actionLabel: 'К услугам',
      },
      {
        key: 'schedule',
        title: 'Расписание',
        done: scheduleDone,
        loading: false,
        error: false,
        hint: scheduleDone ? 'Рабочие часы настроены.' : 'Укажите рабочие дни и часы, чтобы клиенты могли записываться.',
        action: () => onGo('Студия'),
        actionLabel: 'К настройкам',
      },
      {
        key: 'telegram',
        title: 'Telegram',
        done: telegramDone,
        loading: telegram.isPending,
        error: telegram.isError,
        hint: telegramDone ? 'Telegram подключён для уведомлений.' : 'Подключите Telegram, чтобы получать уведомления о записях.',
        action: () => onGo('Уведомления'),
        actionLabel: 'К уведомлениям',
      },
      {
        key: 'address',
        title: 'Адрес',
        done: addressDone,
        loading: false,
        error: false,
        hint: addressDone ? 'Адрес заполнен.' : 'Добавьте адрес, чтобы клиентам было проще вас найти.',
        action: () => onGo('Студия'),
        actionLabel: 'К настройкам',
      },
    ]
  }, [b.address, b.hours, onGo, services.data, services.isError, services.isPending, telegram.data, telegram.isError, telegram.isPending])

  if (role !== 'owner' && role !== 'manager') return null
  const doneCount = items.filter((i) => i.done).length
  if (doneCount === items.length) return null

  return (
    <section className="card col" aria-label="Онбординг-чеклист" style={{ gap: 12 }}>
      <div className="row between wrap">
        <div>
          <p className="admin-eyebrow">Начало работы</p>
          <h2>Чеклист настройки студии</h2>
          <p className="muted small">Заполните основные разделы, чтобы клиенты могли записываться и получать информацию.</p>
        </div>
        <b>{doneCount}/{items.length}</b>
      </div>
      <div className="col" style={{ gap: 10 }}>
        {items.map((item) => (
          <div key={item.key} className="row between wrap" style={{ gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 240px' }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span aria-hidden="true">{item.done ? '✓' : item.loading ? '…' : '○'}</span>
                <b>{item.title}</b>
                {item.error && !item.loading && <span className="muted small">(не удалось проверить)</span>}
              </div>
              <p className="muted small" style={{ margin: '4px 0 0' }}>{item.hint}</p>
            </div>
            {!item.done && (
              <button type="button" className="btn ghost mini" onClick={item.action}>
                {item.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// Статус подписки для владельца. Если запрос не удался (например, не разрешён прокси), баннер просто не показывается.
export function SubscriptionBanner({ slug, canRespond, latestSuspension }: { slug: string; canRespond: boolean; latestSuspension?: OwnerBillingNotification }) {
  const sub = useQuery({ queryKey: ['owner', 'subscription', slug], queryFn: () => owner.subscription(slug), retry: false })
  const qc = useQueryClient()
  const proposals = useQuery({ queryKey: ['owner', 'price-changes', slug], queryFn: () => owner.pendingPriceChanges(slug), retry: false, refetchInterval: 60_000, refetchOnWindowFocus: true })
  const [priceMsg, setPriceMsg] = useState('')
  const answerPrice = useMutation({ mutationFn: ({id,accept}:{id:string;accept:boolean}) => owner.respondPriceChange(slug,id,accept), onSuccess: async () => { setPriceMsg('Ответ сохранён.'); await qc.invalidateQueries({queryKey:['owner','price-changes',slug]}); await qc.invalidateQueries({queryKey:['owner','subscription',slug]}) }, onError: () => setPriceMsg('Не удалось сохранить ответ. Обновите страницу и попробуйте снова.') })
  const s = sub.data
  const priceNotice = proposals.data?.map(p => <div key={p.id} className="card col owner-price-notice" role="status">
    <b>Предложение об изменении цены подписки</b>
    <p>Текущая цена: <b>{p.old_price_kzt.toLocaleString('ru-RU')} ₸ за {p.old_period_months} мес.</b><br/>Новая цена: <b>{p.new_price_kzt.toLocaleString('ru-RU')} ₸ за {p.new_period_months} мес.</b></p>
    <p className="muted small">Изменение вступит в силу {new Date(p.effective_at).toLocaleDateString('ru-RU')}. До вашего согласия сохраняется текущая цена. При отказе подписка продолжит действовать по прежней цене; свяжитесь с поддержкой, чтобы обсудить варианты.</p>
    {priceMsg && <p className="muted small" role="status">{priceMsg}</p>}
    {canRespond ? <div className="row wrap"><button className="btn" disabled={answerPrice.isPending} onClick={() => answerPrice.mutate({id:p.id,accept:true})}>Принять новую цену</button><button className="btn ghost" disabled={answerPrice.isPending} onClick={() => { if(window.confirm('При отказе сервис продолжит работать до конца оплаченного периода, затем подписка не продлится и онлайн-запись будет отключена. Уведомление об отказе получит Renvio. Продолжить?')) answerPrice.mutate({id:p.id,accept:false}) }}>Отклонить</button></div> : <p className="muted small">Ответить на предложение может владелец организации.</p>}
  </div>)
  if (!s) return <>{proposals.isError && <p className="err small">Не удалось проверить новые условия подписки. Обновите кабинет.</p>}{priceNotice}</>
  const date = (v?: string | null) => (v ? new Date(v).toLocaleDateString('ru-RU') : '')
  if (s.phase === 'scheduled')
    return <>{proposals.isError && <p className="err small">Не удалось проверить новые условия подписки. Обновите кабинет.</p>}{priceNotice}<p className="muted small">Подписка начнёт действовать {date(s.starts_at)}. До этой даты онлайн-запись и уведомления отключены.</p></>
  if (s.state === 'closed') {
    const closedTitle=s.phase==='suspended'?'Подписка приостановлена':s.phase==='cancelled'?'Подписка отменена':'Срок подписки закончился';
    const closedDetail=s.phase==='suspended'?'Онлайн-запись временно отключена. Ваши данные сохранены. Для восстановления работы свяжитесь с поддержкой Renvio.':s.phase==='cancelled'?'Данные организации сохранены. Для возобновления обслуживания свяжитесь с поддержкой Renvio.':'Подписка истекла. Для возобновления обслуживания свяжитесь с поддержкой Renvio.';
    return <>{proposals.isError && <p className="err small">Не удалось проверить новые условия подписки. Обновите кабинет.</p>}{priceNotice}<div className="card col owner-subscription-alert" role="alert"><div className="row between wrap"><b>{closedTitle}</b><span className={`pf-badge pf-${s.phase}`}>{closedTitle}</span></div><p className="muted">{closedDetail}</p>{s.phase==='suspended'&&!!latestSuspension?.payload.reason&&<p><b>Причина приостановки:</b> {String(latestSuspension.payload.reason)}</p>}{s.plan_name&&<p className="muted small">Тариф: {s.plan_name}</p>}</div></>
  }
  if (s.state === 'grace')
    return (
      <>{proposals.isError && <p className="err small">Не удалось проверить новые условия подписки. Обновите кабинет.</p>}{priceNotice}<div className="card col" role="status" style={{ borderColor: '#e0a030' }}>
        <b>Срок подписки закончился {date(s.ends_at)}</b>
        <p className="muted">Всё продолжает работать до {date(s.grace_ends_at)}. После этой даты онлайн-запись и уведомления будут отключены. Оплатите продление, чтобы этого избежать.</p>
      </div></>
    )
  return <>{proposals.isError && <p className="err small">Не удалось проверить новые условия подписки. Обновите кабинет.</p>}{priceNotice}{s.phase !== 'none' && <div className="card owner-subscription-summary"><div className="owner-subscription-heading"><b>Подписка · {s.plan_name ?? s.plan_code}</b><span className={`pf-badge pf-${s.phase}`}>{s.phase==='active'?'Активна':s.phase==='trial'?'Пробный период':s.phase==='grace'?'Льготный период':'Статус уточняется'}</span></div><div className="owner-subscription-details"><div><span>Окончание</span><b>{s.ends_at ? date(s.ends_at) : 'Без срока'}</b></div><div><span>Осталось</span><b>{s.days_left == null ? '—' : `${Math.max(0,s.days_left)} дней`}</b></div><div><span>К оплате за период</span><b>{(s.price_kzt ?? 0).toLocaleString('ru-RU')} ₸ / {s.price_period_months ?? 1} мес.</b></div></div></div>}</>
}

export function OwnerAccount({slug,canExport,canRespond,latestSuspension}:{slug:string;canExport:boolean;canRespond:boolean;latestSuspension?:OwnerBillingNotification}) {
  const q=useQuery({queryKey:['owner','subscription',slug],queryFn:()=>owner.subscription(slug),refetchInterval:60_000});
  const planUsage=useQuery({queryKey:['owner','plan-usage',slug],queryFn:()=>owner.planUsage(slug),retry:false});
  if(q.isPending)return <p className="muted">Загружаем подписку…</p>;
  if(q.isError)return <p className="err">Не удалось загрузить подписку. <button className="link" onClick={()=>void q.refetch()}>Повторить</button></p>;
  const s=q.data; const date=(v?:string|null)=>v?new Date(v).toLocaleDateString('ru-RU'):'—';
  const statusLabels:Record<string,string>={trial:'Пробный период',active:'Активна',grace:'Льготный период',scheduled:'Запланирована',suspended:'Приостановлена',expired:'Истекла',cancelled:'Отменена',none:'Нет подписки'};
  const rows:[string,string][]=[['employees','Сотрудники'],['services','Услуги'],['bookings_per_month','Записи за этот месяц']];
  const featureRows:[string,string][]=[['telegram','Telegram'],['export','Выгрузка данных'],['reviews','Отзывы']];
  const usageValue=(key:string)=>{const current=Number(planUsage.data?.usage?.[key]??0);const cap=planUsage.data?.limits?.[key];return `${current.toLocaleString('ru-RU')} / ${cap==null?'без ограничений':Number(cap).toLocaleString('ru-RU')}`};
  return <div className="col"><div className="admin-subheading"><div><h2>Личный кабинет</h2><p className="muted small">Текущие условия и оплата подписки.</p></div></div><SubscriptionBanner slug={slug} canRespond={canRespond} latestSuspension={latestSuspension}/><section className="card col owner-account-card"><div className="row between wrap"><b>Тариф {s.plan_name??s.plan_code??'—'}</b><span className={`pf-badge pf-${s.phase}`}>{statusLabels[s.phase]??'Статус уточняется'}</span></div><div className="owner-account-grid"><div><span className="muted small">Подписка действует до</span><b>{s.ends_at?date(s.ends_at):'Без срока'}</b></div><div><span className="muted small">Осталось</span><b>{s.days_left==null?'—':`${Math.max(0,s.days_left)} дней`}</b></div><div><span className="muted small">К оплате за период</span><b>{(s.price_kzt??0).toLocaleString('ru-RU')} ₸</b></div><div><span className="muted small">Период</span><b>{s.price_period_months??1} мес.</b></div></div></section>
    <section className="card col"><div className="row between wrap"><b>Использование тарифа</b>{planUsage.data&&<span className="muted small">{planUsage.data.plan_code}</span>}</div>{planUsage.isPending?<p className="muted small">Загружаем лимиты…</p>:planUsage.isError?<p className="err small">Не удалось загрузить лимиты. Обновите страницу.</p>:<><div className="owner-account-grid">{rows.map(([key,label])=><div key={key}><span className="muted small">{label}</span><b>{usageValue(key)}</b></div>)}</div><p className="muted small">Основной филиал: 1 / {planUsage.data.limits.branches==null?'без ограничений':planUsage.data.limits.branches}. Управление несколькими филиалами в приложении пока не подключено.</p><div className="row wrap">{featureRows.map(([key,label])=><span className={`pf-badge ${planUsage.data.features[key]?'pf-active':'pf-expired'}`} key={key}>{label}: {planUsage.data.features[key]?'доступно':'не включено'}</span>)}</div></>}</section>
    {canExport&&planUsage.data?.features.export===true&&<ExportButton slug={slug}/>}</div>
}

export function OwnerNotificationCenter({slug,canRespond}:{slug:string;canRespond:boolean}) {
  const q=useQuery({queryKey:['owner','price-changes',slug],queryFn:()=>owner.pendingPriceChanges(slug),refetchInterval:60_000,refetchOnWindowFocus:true});
  const events=useInfiniteQuery({
    queryKey:['owner','billing-notifications-page',slug],
    queryFn:({pageParam})=>owner.billingNotificationsPage(slug,50,pageParam??null),
    initialPageParam:null as Record<string,string>|null,
    getNextPageParam:(last)=>last.has_more?(last.next_cursor??undefined):undefined,
    retry:false,refetchInterval:30_000,refetchOnWindowFocus:true,
  });
  const qc=useQueryClient(); const [msg,setMsg]=useState('');
  const respond=useMutation({mutationFn:({id,accept}:{id:string;accept:boolean})=>owner.respondPriceChange(slug,id,accept),onSuccess:async()=>{setMsg('Ответ сохранён.');await qc.invalidateQueries({queryKey:['owner','price-changes',slug]});await qc.invalidateQueries({queryKey:['owner','subscription',slug]})},onError:()=>setMsg('Не удалось сохранить ответ. Обновите страницу и повторите.')});
  const eventItems=events.data?.pages.flatMap((p)=>p.items)??[];
  const unread=eventItems.filter(e=>!e.is_read);
  const markRead=async()=>{if(!unread.length)return;try{await owner.markBillingNotificationsRead(slug,unread.map(e=>e.id));await qc.invalidateQueries({queryKey:['owner','billing-notifications-page',slug]})}catch{setMsg('Не удалось отметить уведомления прочитанными. Повторите позже.')}};
  const empty=q.data?.length===0&&eventItems.length===0;
  return <div className="col"><div className="admin-subheading"><div><h2>Центр уведомлений</h2><p className="muted small">Статус подписки и важные сообщения Renvio.</p></div>{unread.length>0&&<button className="btn ghost mini" onClick={()=>void markRead()}>Отметить прочитанными</button>}</div>{msg&&<p className="muted small" role="status">{msg}</p>}
    {events.isPending?<p className="muted">Проверяем события подписки…</p>:events.isError?<p className="err">Не удалось загрузить события подписки. <button className="link" onClick={()=>void events.refetch()}>Повторить</button></p>:eventItems.length?<section className="col"><h3>Подписка и платежи</h3>{eventItems.map(e=><article className="card col owner-price-notice" key={e.id} style={!e.is_read?{borderColor:'var(--accent,#568cff)'}:undefined}><div className="row between wrap"><b>{billingEventTitle(e.event_type)}</b><time className="muted small">{new Date(e.created_at).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'})}</time></div><p>{billingEventDetail(e)}</p>{!e.is_read&&<span className="muted small">Новое</span>}</article>)}{events.hasNextPage&&<div className="row"><button className="btn ghost mini" disabled={events.isFetchingNextPage} onClick={()=>void events.fetchNextPage()}>{events.isFetchingNextPage?'Загружаем…':'Показать ещё'}</button></div>}</section>:null}
    {q.isPending?<p className="muted">Проверяем изменения условий…</p>:q.isError?<p className="err">Не удалось загрузить предложения о цене. <button className="link" onClick={()=>void q.refetch()}>Повторить</button></p>:q.data?.length?<section className="col"><h3>Новые условия тарифа</h3>{q.data.map(p=><article className="card col owner-price-notice" key={p.id}><b>Изменение цены подписки</b><p>Сейчас: {p.old_price_kzt.toLocaleString('ru-RU')} ₸ за {p.old_period_months} мес. · Новые условия: {p.new_price_kzt.toLocaleString('ru-RU')} ₸ за {p.new_period_months} мес.</p><p className="muted small">Вступает в силу {new Date(p.effective_at).toLocaleDateString('ru-RU')}. До этой даты действует текущая цена. При отказе подписка не продлится на новых условиях и завершится по окончании оплаченного срока.</p>{canRespond?<div className="row wrap"><button className="btn" disabled={respond.isPending} onClick={()=>respond.mutate({id:p.id,accept:true})}>Принять условия</button><button className="btn ghost" disabled={respond.isPending} onClick={()=>{if(window.confirm('Отказ означает, что подписка не продлится на новых условиях.'))respond.mutate({id:p.id,accept:false})}}>Отказаться</button></div>:<p className="muted small">Решение принимает владелец организации.</p>}</article>)}</section>:null}
    {!q.isPending&&!events.isPending&&empty&&<p className="muted">Новых уведомлений нет.</p>}
  </div>
}

type SupportTicket={id:string;subject:string;category:string;custom_type?:string|null;severity:string;status:string;created_at:string;updated_at:string;created_by_email:string};
type SupportEvent={id:string;case_id:string;event_type:string;message?:string|null;status:string;actor_email:string;is_support:boolean;created_at:string};
const SUPPORT_TYPE:Record<string,string>={support:'Поддержка',technical:'Техническая проблема',billing:'Оплата и подписка',access:'Вход и доступ',booking:'Записи и расписание',feature:'Функция сервиса',other:'Другое'};
const SUPPORT_LEVEL:Record<string,string>={low:'Низкая',normal:'Обычная',high:'Высокая',urgent:'Критичная'};
const SUPPORT_STATE:Record<string,string>={open:'Открыт',in_progress:'В работе',resolved:'Решён'};
export function OwnerSupportTickets({slug}:{slug:string}){
  const qc=useQueryClient();const [page,setPage]=useState(0),[subject,setSubject]=useState(''),[category,setCategory]=useState('technical'),[customType,setCustomType]=useState(''),[severity,setSeverity]=useState('normal'),[message,setMessage]=useState(''),[reply,setReply]=useState<Record<string,string>>({}),[notice,setNotice]=useState('');
  const pageSize=10;
  const q=useQuery({queryKey:['owner','support',slug,page],queryFn:()=>ownerRequest<{tickets:SupportTicket[];events:SupportEvent[];count:number;limit:number;offset:number}>('support',{slug,action:'list',limit:pageSize,offset:page*pageSize}),refetchInterval:30_000,refetchOnWindowFocus:true});
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setNotice('');try{await ownerRequest('support',{slug,action:'create',subject,category,custom_type:customType,severity,message});setSubject('');setCategory('technical');setCustomType('');setSeverity('normal');setMessage('');setPage(0);setNotice('Обращение отправлено. Команда поддержки ответит здесь.');await qc.invalidateQueries({queryKey:['owner','support',slug]})}catch{setNotice('Не удалось отправить обращение. Проверьте поля и попробуйте ещё раз.')}};
  const sendReply=async(e:React.FormEvent,id:string)=>{e.preventDefault();const text=(reply[id]??'').trim();if(!text)return;try{await ownerRequest('support',{slug,action:'reply',ticket_id:id,message:text});setReply(v=>({...v,[id]:''}));setNotice('Сообщение отправлено.');await qc.invalidateQueries({queryKey:['owner','support',slug]})}catch{setNotice('Не удалось отправить сообщение. Повторите позже.')}};
  const tickets=q.data?.tickets??[],events=q.data?.events??[],count=q.data?.count??0,pages=Math.max(1,Math.ceil(count/pageSize));
  return <div className="col"><div className="admin-subheading"><div><h2>Поддержка</h2><p className="muted small">Создайте тикет, укажите тип и срочность. Ответ поддержки появится в переписке.</p></div></div>
    <form className="card col owner-support-form" onSubmit={e=>void submit(e)}><h3>Новое обращение</h3><label className="muted small">Кратко опишите проблему<input className="field" minLength={3} maxLength={200} required value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Например: не открывается расписание"/></label>
      <div className="owner-support-fields"><label className="muted small">Тип проблемы<select className="field" value={category} onChange={e=>setCategory(e.target.value)}>{Object.entries(SUPPORT_TYPE).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="muted small">Срочность<select className="field" value={severity} onChange={e=>setSeverity(e.target.value)}>{Object.entries(SUPPORT_LEVEL).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
      {category==='other'&&<label className="muted small">Укажите свой тип проблемы<input className="field" minLength={3} maxLength={120} required value={customType} onChange={e=>setCustomType(e.target.value)} placeholder="Напишите, с чем нужна помощь"/></label>}
      <label className="muted small">Расскажите подробнее<textarea className="field" rows={4} minLength={5} maxLength={3000} required value={message} onChange={e=>setMessage(e.target.value)} placeholder="Опишите, что случилось и чем мы можем помочь. Не указывайте данные банковских карт и пароли."/></label><button className="btn" disabled={subject.trim().length<3||message.trim().length<5||(category==='other'&&customType.trim().length<3)}>Отправить обращение</button>
    </form>{notice&&<p className="muted small" role="status">{notice}</p>}
    <section className="col"><div className="owner-support-list-heading"><h3>Мои обращения</h3>{count>0&&<span className="muted small">{count} {count===1?'обращение':'обращений'}</span>}</div>
      {q.isPending?<p className="muted">Загружаем обращения…</p>:q.isError?<p className="err">Не удалось загрузить обращения. <button className="link" onClick={()=>void q.refetch()}>Попробовать снова</button></p>:!tickets.length?<section className="card"><p className="muted">Обращений пока нет. Если нужна помощь — напишите нам выше.</p></section>:<div className="owner-support-ticket-list">{tickets.map((ticket,index)=>{const thread=events.filter(event=>event.case_id===ticket.id);return <details className="card owner-support-ticket" key={ticket.id} open={index===0}>
        <summary className="owner-support-ticket-summary"><div className="owner-support-ticket-title"><b>{ticket.subject}</b><span className={`pf-badge pf-${ticket.status}`}>{SUPPORT_STATE[ticket.status]??ticket.status}</span></div><div className="owner-support-ticket-meta"><span>{SUPPORT_TYPE[ticket.category]??'Другое'}{ticket.custom_type&&ticket.category==='other'?` · ${ticket.custom_type}`:''}</span><span className={`owner-support-priority priority-${ticket.severity}`}>Срочность: {SUPPORT_LEVEL[ticket.severity]??ticket.severity}</span><span>Обновлён {new Date(ticket.updated_at).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'})}</span></div>
      </summary><div className="owner-support-ticket-content"><div className="owner-support-thread" aria-label="Переписка по обращению">{thread.map(event=><article className={`owner-support-message ${event.is_support?'from-support':'from-organization'}`} key={event.id}><div className="owner-support-message-meta"><b>{event.is_support?'Поддержка Renvio':'Организация'}</b><time>{new Date(event.created_at).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'})}</time></div><p>{event.message??(event.event_type==='created'?'Тикет создан.':'Статус изменён: '+(SUPPORT_STATE[event.status]??event.status))}</p></article>)}</div>
      <form className="owner-support-reply" onSubmit={e=>void sendReply(e,ticket.id)}><textarea className="field" rows={2} maxLength={3000} value={reply[ticket.id]??''} onChange={e=>setReply(v=>({...v,[ticket.id]:e.target.value}))} placeholder="Напишите сообщение…" aria-label={`Ответ по тикету «${ticket.subject}»`}/><button className="btn mini" disabled={!reply[ticket.id]?.trim()}>Отправить</button></form></div>
      </details>})}</div>}
      {!q.isPending&&!q.isError&&count>pageSize&&<nav className="owner-support-pagination" aria-label="Страницы обращений"><span className="muted small">Страница {page+1} из {pages}</span><div className="row"><button className="btn ghost mini" disabled={page===0||q.isFetching} onClick={()=>setPage(p=>p-1)}>Назад</button><button className="btn ghost mini" disabled={page+1>=pages||q.isFetching} onClick={()=>setPage(p=>p+1)}>Дальше</button></div></nav>}
    </section>
  </div>
}

export function Cabinet({ b, onLogout, impersonation }: { b: Business; onLogout: () => void; impersonation?:{reason:string;expires_at:string;tenant_slug:string} }) {
  const qc=useQueryClient()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Записи')
  const [dismissedAnnouncements,setDismissedAnnouncements]=useState<string[]>(()=>{try{const value=localStorage.getItem(`servio-hidden-announcements:${b.slug}`);const parsed=value?JSON.parse(value):[];return Array.isArray(parsed)?parsed.filter((id):id is string=>typeof id==='string'):[]}catch{return[]}})
  const [expandedGroups,setExpandedGroups]=useState<Record<string,boolean>>({})
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false)
  const priceNotices=useQuery({queryKey:['owner','price-changes',b.slug],queryFn:()=>owner.pendingPriceChanges(b.slug),refetchInterval:60_000,enabled:true})
  const me = useQuery({ queryKey: ['owner', 'me', b.slug], queryFn: () => owner.me(b.slug) })
  const access = useQuery({ queryKey: ['owner', 'access', b.slug], queryFn: () => owner.access(b.slug), enabled: !!me.data })
  const platformAnnouncements=useQuery({queryKey:['owner','platform-announcements',b.slug],queryFn:()=>owner.platformAnnouncements(b.slug),enabled:access.data==='owner'||access.data==='manager',refetchInterval:60_000,retry:false})
  const platformFlags=useQuery({queryKey:['owner','platform-flags',b.slug],queryFn:()=>owner.platformFeatureFlags(b.slug),enabled:access.data==='owner'||access.data==='manager',retry:false})
  const billingNotices=useInfiniteQuery({queryKey:['owner','billing-notifications-page',b.slug],queryFn:({pageParam})=>owner.billingNotificationsPage(b.slug,50,pageParam??null),initialPageParam:null as Record<string,string>|null,getNextPageParam:(last)=>last.has_more?(last.next_cursor??undefined):undefined,enabled:access.data==='owner'||access.data==='manager',retry:false,refetchInterval:30_000,refetchOnWindowFocus:true})
  const billingNoticeItems:OwnerBillingNotification[]=billingNotices.data?.pages.flatMap((p)=>p.items)??[]
  const planUsage=useQuery({queryKey:['owner','plan-usage',b.slug],queryFn:()=>owner.planUsage(b.slug),enabled:access.data==='owner'||access.data==='manager',retry:false,refetchOnWindowFocus:true})
  const archiveStatus=useQuery({queryKey:['owner','archive-status',b.slug],queryFn:()=>owner.archiveStatus(b.slug),enabled:access.data==='owner',retry:false})
  const role=access.data
  const roleTabs=(role==='staff'?['Записи','Поддержка','Мой доступ']:role==='manager'?TABS.filter((t)=>!['Студия','Фото','Уведомления','Документы'].includes(t)):TABS) as readonly (typeof TABS)[number][]
  const visibleTabs=roleTabs.filter(t=>!(t==='Отзывы'&&planUsage.data?.features.reviews===false))
  const groupList=TAB_GROUPS.map(g=>({name:g.name,tabs:g.tabs.filter((t)=>visibleTabs.includes(t)) as (typeof TABS)[number][]})).filter(g=>g.tabs.length>0)
  const activeGroup=groupList.find(g=>g.tabs.includes(tab))
  useEffect(()=>{if(activeGroup)setExpandedGroups(prev=>({...prev,[activeGroup.name]:true}))},[activeGroup?.name])
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
  if (!visibleTabs.includes(tab)) setTab('Записи')
  const stopImpersonation = async () => {
    await ownerRequest('impersonate_stop');
    qc.removeQueries({ queryKey: ['owner'] });
    window.location.assign('/platform/admin');
  };
  const dismissAnnouncement=(id:string)=>setDismissedAnnouncements(current=>{const next=[...new Set([...current,id])];try{localStorage.setItem(`servio-hidden-announcements:${b.slug}`,JSON.stringify(next))}catch{/* localStorage unavailable */}return next});
  return (
    <section className="pad admin-shell">
      {archiveStatus.data?.archived&&<aside className="owner-subscription-alert card" role="alert"><b>Организация находится в архиве</b><p>Доступ к управлению и онлайн-записи приостановлен. Данные сохранены. Перед закрытием скачайте копию данных или свяжитесь с поддержкой Renvio для восстановления доступа.{archiveStatus.data.deletion_requested_at&&' Также зарегистрирован запрос на удаление данных.'}</p>{role==='owner'&&<ExportButton slug={b.slug}/>}</aside>}
      {impersonation && <aside className="impersonation-banner" role="status" aria-label="Активен режим поддержки">
        <span className="impersonation-banner-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 19 6v5.1c0 4.2-2.8 7.7-7 9.4-4.2-1.7-7-5.2-7-9.4V6l7-2.5Z" stroke="currentColor" strokeWidth="1.7"/><path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
        <span className="impersonation-banner-copy"><span className="impersonation-banner-title">Режим поддержки <i>·</i> вы в кабинете организации</span><span className="impersonation-banner-reason"><b>Причина</b>{impersonation.reason}</span></span>
        <span className="impersonation-banner-expiry"><span className="impersonation-live-dot"/> До {new Date(impersonation.expires_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span>
        <button className="impersonation-banner-exit" onClick={()=>void stopImpersonation()}>Завершить сеанс <span aria-hidden="true">↗</span></button>
      </aside>}
      <div className="admin-heading">
        <div>
          <p className="admin-eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>
          <h1>Кабинет студии</h1>
          <p className="muted">Записи, клиенты и дела студии — в одном месте.</p>
        </div>
        <button className="btn ghost mini admin-logout" onClick={onLogout}>
          Выйти
        </button>
      </div>
      <OnboardingChecklist b={b} role={role ?? undefined} onGo={setTab} />
      {platformAnnouncements.data?.filter(a=>!dismissedAnnouncements.includes(a.id)).map(a=><aside className="owner-subscription-alert card owner-platform-announcement" key={a.id}><div><b>{a.title}</b><p>{a.body}</p></div><button className="owner-announcement-dismiss" type="button" aria-label={`Скрыть уведомление: ${a.title}`} onClick={()=>dismissAnnouncement(a.id)}>Скрыть</button></aside>)}
      {Object.entries(platformFlags.data??{}).some(([,enabled])=>enabled)&&<aside className="owner-account-card card"><b>Для вашей студии доступны новые возможности</b><p className="muted small">{Object.entries(platformFlags.data??{}).filter(([,enabled])=>enabled).map(([key])=>key).join(' · ')}</p></aside>}
      <div className="admin-layout">
        <div className="admin-mobile-navigation">
          <button className="admin-mobile-trigger" type="button" aria-expanded={mobileMenuOpen} aria-controls="owner-mobile-menu" onClick={()=>setMobileMenuOpen(open=>!open)}>
            <span className="admin-mobile-trigger-icon" aria-hidden="true">☰</span><span><small>РАЗДЕЛ КАБИНЕТА</small><b>{TAB_LABELS[tab] ?? tab}</b></span><span className="admin-mobile-trigger-action">{mobileMenuOpen?'Свернуть':'Меню'}</span>
          </button>
          {mobileMenuOpen&&<nav className="admin-mobile-panel" id="owner-mobile-menu" aria-label="Разделы кабинета">
            {groupList.map(g=><section className="admin-mobile-group" key={g.name}><h2>{g.name}</h2><div>{g.tabs.map(t=><button key={t} type="button" className={`admin-mobile-tab${tab===t?' is-current':''}`} aria-current={tab===t?'page':undefined} onClick={()=>{setTab(t);setMobileMenuOpen(false)}}>{TAB_LABELS[t]??t}{t==='Центр уведомлений'&&(priceNotices.data?.some(x=>!x.is_read)||billingNoticeItems.some(x=>!x.is_read))&&<i className="admin-unread-dot" aria-label="Есть непрочитанные уведомления"/>}</button>)}</div></section>)}
          </nav>}
        </div>
        <nav className="admin-side" aria-label="Разделы кабинета">
          {groupList.map((g) => {
            const isActive = activeGroup?.name === g.name;
            const isExpanded = expandedGroups[g.name] ?? isActive;
            return (
              <div key={g.name} className={`admin-group${isActive ? ' is-active' : ''}${isExpanded ? ' is-expanded' : ''}${g.tabs.length === 1 ? ' is-single' : ''}`}>
                <button
                  type="button"
                  className="admin-group-title"
                  aria-expanded={isExpanded}
                  onClick={() => {
                    if (g.tabs.length === 1) {
                      setTab(g.tabs[0]!);
                      return;
                    }
                    setExpandedGroups(prev=>({...prev,[g.name]:!isExpanded}));
                  }}
                  aria-current={g.tabs.length === 1 && tab === g.tabs[0] ? 'page' : undefined}
                >
                  <span>{g.name}</span>
                  <span className="admin-group-chevron" aria-hidden="true">›</span>
                </button>
                {g.tabs.length > 1 && isExpanded && (
                  <div className="admin-group-tabs">
                    {g.tabs.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`admin-group-tab${tab === t ? ' is-current' : ''}`}
                        aria-current={tab === t ? 'page' : undefined}
                        onClick={() => {setTab(t);if(t==='Центр уведомлений'){const ids=priceNotices.data?.filter(x=>!x.is_read).map(x=>x.id)??[];if(ids.length)void owner.markPriceChangesRead(b.slug,ids).then(()=>qc.invalidateQueries({queryKey:['owner','price-changes',b.slug]}));const eventIds=billingNoticeItems.filter(x=>!x.is_read).map(x=>x.id)??[];if(eventIds.length)void owner.markBillingNotificationsRead(b.slug,eventIds).then(()=>qc.invalidateQueries({queryKey:['owner','billing-notifications-page',b.slug]}))}}}
                      >
                        {TAB_LABELS[t] ?? t}{t==='Центр уведомлений'&&(priceNotices.data?.some(x=>!x.is_read)||billingNoticeItems.some(x=>!x.is_read))&&<i className="admin-unread-dot" aria-label="Есть непрочитанные уведомления"/>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="admin-main">
      {tab === 'Записи' && <Bookings b={b} role={role??undefined} />}
      {tab === 'Сотрудники' && role === 'owner' && <TeamAccess b={b} />}
      {tab === 'Сотрудники' && role === 'manager' && <TeamAccess b={b} canManageManagers={false} />}
      {tab === 'Мой доступ' && <MyAccess b={b} />}
      {tab === 'Личный кабинет' && <OwnerAccount slug={b.slug} canExport={role==='owner'} canRespond={role==='owner'} latestSuspension={billingNoticeItems.find(e=>e.event_type==='suspended')} />}
      {tab === 'Центр уведомлений' && <OwnerNotificationCenter slug={b.slug} canRespond={role === 'owner'} />}
      {tab === 'Поддержка' && <OwnerSupportTickets slug={b.slug} />}
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
