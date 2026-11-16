import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { owner } from '../../lib/api'
import { money } from '../../lib/format'
import type { Business } from '../../lib/tenant'
import { MoreMenu, auditAction, auditDetail, auditEntity, downloadCsv, fmtT, today } from './shared'

export function Reports({ b }: { b: Business }) {
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
  return <div className="col"><div className="admin-subheading"><div><h2>Итоги за последние 30 дней</h2><p className="muted small">Оплаты, записи, занятость расписания и услуги, которые выбирают чаще.</p></div><div className="row wrap"><button className="btn ghost mini" disabled={!reportReady} onClick={exportReport}>Скачать сводку</button><button className="btn ghost mini" disabled={bookings.isPending||bookings.isError} onClick={exportBookings}>Скачать список записей</button></div></div>
    {kpis.data&&<div className="stats admin-stats"><div className="card admin-stat"><span className="muted small">Получено</span><b>{money(kpis.data.received_cents/100,b.currency)}</b></div><div className="card admin-stat"><span className="muted small">Записей</span><b>{kpis.data.booked}</b></div><div className="card admin-stat"><span className="muted small">Визитов</span><b>{kpis.data.visits}</b></div><div className="card admin-stat"><span className="muted small">Загрузка постов</span><b>{bookings.isPending||resources.isPending?'…':`${occupancy}%`}</b></div></div>}
    <p className="muted small">Занятость показывает, какую часть рабочего времени мастера были записаны клиенты.</p>
    <div className="admin-subheading"><div><h2>Популярные услуги</h2><p className="muted small">За последние 30 дней, по числу записей.</p></div></div>
    {bookings.isPending?<p className="muted">Собираем данные по услугам…</p>:bookings.isError?<p className="err">Не удалось загрузить список услуг. <button className="link" onClick={()=>void bookings.refetch()}>Попробовать снова</button></p>:popularServices.length===0?<p className="muted">Записей за этот период пока нет.</p>:<div className="admin-report-services"><div className="admin-report-service-head"><span>Услуга</span><span>Записи</span><span>Визиты</span><span>Оплачено</span></div>{popularServices.map((s,i)=><div className="admin-report-service" key={s.id}><span className="admin-report-service-name"><i>{i+1}</i><b>{s.name}</b></span><span>{s.bookings}</span><span>{s.done}</span><b>{money(s.received/100,b.currency)}</b></div>)}</div>}
    <div className="admin-subheading"><div><h2>Средний чек и повторные визиты</h2><p className="muted small">По завершённым визитам за последние 30 дней.</p></div></div>
    {repeat.isPending?<p className="muted">Считаем визиты клиентов…</p>:repeat.isError?<p className="err">Не удалось загрузить повторные визиты. <button className="link" onClick={()=>void repeat.refetch()}>Повторить</button></p>:<><div className="stats admin-stats"><div className="card admin-stat"><span className="muted small">Средний чек</span><b>{repeat.data.completed_visits?money(repeat.data.average_check_cents/100,b.currency):'—'}</b></div><div className="card admin-stat"><span className="muted small">Клиентов с визитами</span><b>{repeat.data.unique_clients}</b></div><div className="card admin-stat"><span className="muted small">Вернулись снова</span><b>{repeat.data.returning_clients}{repeat.data.unique_clients?` · ${returningRate}%`:''}</b></div><div className="card admin-stat"><span className="muted small">Повторных визитов</span><b>{repeat.data.returning_visits}</b></div></div><p className="muted small">Средний чек рассчитан по цене завершённого визита с учётом скидки. Повторный визит — завершённая запись клиента, у которого уже был завершённый визит раньше.</p></>}
    <div className="admin-subheading"><div><h2>Откуда приходят клиенты</h2><p className="muted small">Показываем переходы на сайт студии и записи по ним.</p></div></div>
    {stats.isPending ? <p className="muted">Собираем данные…</p> : stats.isError ? <p className="err">Не удалось загрузить данные. <button className="link" onClick={() => void stats.refetch()}>Попробовать снова</button></p> : (stats.data ?? []).length === 0 ? <p className="muted">Записей за этот период пока нет.</p> : <div className="card col">{stats.data!.map((x) => <div className="kv" key={x.source}><span>{x.source === 'direct' ? 'Прямые переходы' : x.source} · записей: {x.visits}</span><b>{money(x.received_cents / 100,b.currency)}</b></div>)}</div>}
    <p className="muted small">Считаем источник перехода на сайт. Личные данные клиентов не включаются в этот отчёт.</p>
  </div>;
}

export function WaitlistAdmin({ b }: { b: Business }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['owner','waitlist',b.slug], queryFn: () => owner.waitlist(b.slug) });
  const setStatus = useMutation({ mutationFn: ({ id,status }: {id:string;status:'waiting'|'contacted'|'closed'}) => owner.waitlistStatus(id,status), onSuccess: () => void qc.invalidateQueries({ queryKey: ['owner','waitlist',b.slug] }) });
  return <div className="col"><div className="admin-subheading"><div><h2>Лист ожидания</h2><p className="muted small">Заявки клиентов на дни без свободных окон. О новых заявках придёт сообщение в Telegram.</p></div></div>
    {q.isPending ? <p className="muted">Загрузка…</p> : q.isError ? <p className="err">Не удалось загрузить лист ожидания. <button className="link" onClick={() => void q.refetch()}>Повторить</button></p> : !q.data?.length ? <p className="muted">Заявок пока нет.</p> : q.data.map((w) => <div className="card col" key={w.id}><div className="row between"><b>{w.customer_name} · {w.preferred_day}</b><span className="pill">{{waiting:'Ожидает',contacted:'Связались',closed:'Закрыта'}[w.status] ?? w.status}</span></div><span>{w.service_name} · {w.car}</span><a href={`tel:${w.customer_phone.replace(/[^\d+]/g, '')}`}>{w.customer_phone}</a><div className="row wrap"><button className="btn ghost mini" disabled={setStatus.isPending} onClick={() => setStatus.mutate({id:w.id,status:'contacted'})}>Связались</button><button className="btn ghost mini" disabled={setStatus.isPending} onClick={() => setStatus.mutate({id:w.id,status:'closed'})}>Закрыть заявку</button></div></div>)}
    {setStatus.isError && <p className="err small">Не удалось обновить статус заявки.</p>}
  </div>;
}

export function AuditHistory({b}:{b:Business}) {
  const [page,setPage]=useState(0);const limit=50;
  const q=useQuery({queryKey:['owner','audit',b.slug,page],queryFn:()=>owner.auditHistory(b.slug,limit+1,page*limit)});
  const items=q.data?.slice(0,limit)??[];const hasNext=(q.data?.length??0)>limit;
  return <div className="col"><div className="admin-subheading"><div><h2>История изменений</h2><p className="muted small">Записи, услуги, команда, оплаты, настройки и действия поддержки.</p></div></div>
    {q.isPending?<p className="muted">Загрузка истории…</p>:q.isError?<p className="err">Не удалось загрузить историю. <button className="link" onClick={()=>void q.refetch()}>Повторить</button></p>:items.length===0?<p className="muted">Изменений пока нет.</p>:<div className="admin-audit-list">{items.map(e=><article className="card admin-audit-event" key={e.id}><div className="row between wrap"><b>{auditEntity(e.entity)} · {auditAction(e.action,e.entity)}</b><time className="muted small">{fmtT(b,e.created_at,'d MMM yyyy, HH:mm')}</time></div><p className="muted small">{auditDetail(e,b.currency,b.timezone)}{e.actor_email?` · ${e.entity==='support'?'Сотрудник поддержки':'Изменил'}: ${e.actor_email}`:e.entity==='subscription'?' · Сервис Renvio':''}</p></article>)}</div>}
    {q.data&& (items.length>0||page>0)&&<nav className="admin-service-pagination" aria-label="История изменений"><button className="admin-page-button" disabled={page===0} onClick={()=>setPage(page-1)}>Назад</button><span className="muted small">Страница <b>{page+1}</b></span><button className="admin-page-button" disabled={!hasNext} onClick={()=>setPage(page+1)}>Далее</button></nav>}
  </div>
}

export function Promos({ b }: { b: Business }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['owner','promos',b.slug], queryFn: () => owner.promos(b.slug) });
  const emptyForm = {code:'',kind:'percent' as 'percent'|'fixed',value:'10',limit:''};
  const [form,setForm] = useState(emptyForm); const [editingId,setEditingId] = useState<string|null>(null); const [msg,setMsg] = useState<string|null>(null);
  const refresh = () => void qc.invalidateQueries({queryKey:['owner','promos',b.slug]});
  const save = useMutation({ mutationFn: () => owner.upsertPromo(b.slug,{id:editingId??undefined,code:form.code.trim().toUpperCase(),kind:form.kind,value:form.kind==='fixed'?Math.round(Number(form.value)*100):Number(form.value),limit:form.limit?Number(form.limit):null,active:editingId ? q.data?.find(p=>p.id===editingId)?.active??true : true}), onSuccess: () => { setForm(emptyForm);setEditingId(null);setMsg(null);refresh(); }, onError: () => setMsg('Проверьте код, размер скидки и лимит использований.') });
  const toggle = useMutation({ mutationFn: (p: NonNullable<typeof q.data>[number]) => owner.upsertPromo(b.slug,{id:p.id,code:p.code,kind:p.discount_kind,value:p.discount_value,limit:p.usage_limit,active:!p.active}), onSuccess: () => void qc.invalidateQueries({queryKey:['owner','promos',b.slug]}) });
  const remove = useMutation({mutationFn:(id:string)=>owner.deletePromo(b.slug,id),onSuccess:refresh,onError:(e)=>setMsg((e as Error).message)});
  const edit = (p: NonNullable<typeof q.data>[number]) => { setEditingId(p.id); setForm({code:p.code,kind:p.discount_kind,value:String(p.discount_kind==='fixed'?p.discount_value/100:p.discount_value),limit:p.usage_limit?String(p.usage_limit):''}); setMsg(null); };
  return <div className="col"><div className="admin-subheading"><div><h2>Промокоды</h2><p className="muted small">Скидка пересчитывается и списывается атомарно при подтверждении записи.</p></div></div>
    <div className="card col"><h3>{editingId?'Изменить промокод':'Добавить промокод'}</h3><input className="field" aria-label="Код промокода" placeholder="Код, например START10" maxLength={24} value={form.code} onChange={(e)=>setForm({...form,code:e.target.value.toUpperCase()})}/><div className="row wrap"><select className="field" value={form.kind} onChange={(e)=>setForm({...form,kind:e.target.value as 'percent'|'fixed'})}><option value="percent">Процент</option><option value="fixed">Сумма</option></select><input className="field" aria-label="Размер скидки" type="number" min="1" max={form.kind==='percent'?100:1000000} value={form.value} onChange={(e)=>setForm({...form,value:e.target.value})}/><input className="field" aria-label="Лимит применений" type="number" min="1" placeholder="Без лимита" value={form.limit} onChange={(e)=>setForm({...form,limit:e.target.value})}/></div>{msg&&<p className="err small">{msg}</p>}<div className="row wrap"><button className="btn" disabled={save.isPending||!form.code.trim()||!Number(form.value)} onClick={()=>save.mutate()}>{save.isPending?'Сохраняем…':editingId?'Сохранить':'Создать промокод'}</button>{editingId&&<button className="btn ghost" onClick={()=>{setEditingId(null);setForm(emptyForm);setMsg(null)}}>Отмена</button>}</div></div>
    {q.isPending?<p className="muted">Загрузка промокодов…</p>:q.isError?<p className="err">Не удалось загрузить промокоды.</p>:q.data?.map(p=><div className="card row between admin-promo-row" key={p.id}><div><b>{p.code}</b><p className="muted small">{p.discount_kind==='percent'?`${p.discount_value}%`:`${money(p.discount_value/100,b.currency)}`} · использован {p.used_count}{p.usage_limit?` из ${p.usage_limit}`:' · без лимита'} · {p.active?'Активен':'Отключён'}</p></div><MoreMenu label={`Действия для промокода ${p.code}`}><button onClick={()=>edit(p)}>Изменить</button><button disabled={toggle.isPending} onClick={()=>toggle.mutate(p)}>{p.active?'Отключить':'Включить'}</button><button className="danger" disabled={remove.isPending} onClick={()=>{if(window.confirm(`Удалить промокод ${p.code}?`))remove.mutate(p.id)}}>Удалить</button></MoreMenu></div>)}
  </div>;
}

export function Reviews({ b }: { b: Business }) {
  const qc=useQueryClient();const q=useQuery({queryKey:['owner','reviews',b.slug],queryFn:()=>owner.reviews(b.slug)});
  const toggle=useMutation({mutationFn:({id,published}:{id:string;published:boolean})=>owner.publishReview(id,published),onSuccess:()=>void qc.invalidateQueries({queryKey:['owner','reviews',b.slug]})});
  return <div className="col"><div className="admin-subheading"><div><h2>Отзывы клиентов</h2><p className="muted small">Отзывы доступны после завершённого визита. Публикация отображает отзыв на главной странице.</p></div></div>
    {q.isPending?<p className="muted">Загрузка…</p>:q.isError?<p className="err">Не удалось загрузить отзывы.</p>:!q.data?.length?<p className="muted">Отзывы появятся после выполненных записей.</p>:q.data.map(r=><div className="card col" key={r.id}><div className="row between"><b>{r.customer_name} · {r.service_name}</b><span>{'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}</span></div>{r.comment&&<p>{r.comment}</p>}<button className="btn ghost mini" disabled={toggle.isPending} onClick={()=>toggle.mutate({id:r.id,published:!r.published})}>{r.published?'Снять с публикации':'Опубликовать отзыв'}</button></div>)}
  </div>;
}
