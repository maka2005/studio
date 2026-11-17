import { useEffect, useRef, useState, type FormEvent } from 'react';
import { businessTypeCode } from '../../lib/businessTypes';
import { notify } from '../../components/Toaster';
import { Badge, FilterBar, PLATFORM_ROLE_LABEL, State, Table, call, downloadCsv, errText, exportAllRows, exportPagedRows, fmtDate, fmtDateTime, iso, isoEnd, slugFromName, useAllTenants, useLoad, usePlatformFilters, type LeadPrefill, type Row } from './shared';

export function PlatformServiceAdmin(){
  const announcements=useLoad<Row[]>('announcements');
  const tenants=useAllTenants();
  const [title,setTitle]=useState('');const [body,setBody]=useState('');const [audience,setAudience]=useState('all');const [tenantIds,setTenantIds]=useState<string[]>([]);const [startsAt,setStartsAt]=useState('');const [endsAt,setEndsAt]=useState('');const [msg,setMsg]=useState('');
  const saveAnnouncement=async(e:FormEvent)=>{e.preventDefault();setMsg('');try{await call('announcement_save',{announcement:{title,body,audience,tenant_ids:tenantIds,starts_at:startsAt?new Date(startsAt).toISOString():new Date().toISOString(),ends_at:endsAt?new Date(endsAt).toISOString():null,is_active:true}});setTitle('');setBody('');setMsg('Объявление опубликовано.');await announcements.reload()}catch(e){setMsg(errText(e))}};
  const toggleAnnouncement=async(a:Row)=>{setMsg('');try{await call('announcement_save',{announcement:{id:a.id,title:a.title,body:a.body,audience:a.audience,tenant_ids:a.tenant_ids??[],starts_at:a.starts_at,ends_at:a.ends_at,is_active:!a.is_active}});notify(a.is_active?'Объявление снято с показа.':'Объявление снова показывается организациям.');await announcements.reload()}catch(e){setMsg(errText(e))}};
  const removeAnnouncement=async(a:Row)=>{if(!window.confirm(`Удалить объявление «${a.title}»? Организации перестанут его видеть, восстановить его нельзя.`))return;setMsg('');try{await call('announcement_delete',{id:a.id});notify('Объявление удалено.');await announcements.reload()}catch(e){setMsg(errText(e))}};
  return <div className="col"><section className="card col"><div className="row between wrap"><div><h2>Автоматический статус</h2><p className="muted small">Сайт, API, база данных, авторизация и серверные функции проверяются автоматически каждые 30 секунд. Изменить эти статусы вручную нельзя.</p></div><a className="pf-action-secondary" href="/status" target="_blank" rel="noreferrer">Открыть страницу статуса</a></div></section>
  <section className="card col"><h2>Объявления</h2><p className="muted small">Сообщите организациям о важных изменениях или плановых работах.</p><form className="col" onSubmit={saveAnnouncement}><input className="field" minLength={3} maxLength={180} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Заголовок" required/><textarea className="field" rows={4} maxLength={5000} value={body} onChange={e=>setBody(e.target.value)} placeholder="Текст объявления" required/><select className="field" value={audience} onChange={e=>setAudience(e.target.value)}><option value="all">Всем организациям</option><option value="selected">Выбранным организациям</option></select>{audience==='selected'&&<select className="field" multiple size={6} value={tenantIds} onChange={e=>setTenantIds(Array.from(e.target.selectedOptions,o=>o.value))}>{tenants.data?.map(t=><option key={t.id} value={t.id}>{t.name??t.slug}</option>)}</select>}<div className="row wrap"><label className="pf-label">Начало<input className="field" type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label><label className="pf-label">Окончание<input className="field" type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)}/></label></div><button className="btn" disabled={audience==='selected'&&!tenantIds.length}>Опубликовать</button></form>{msg&&<p className="muted small" role="status">{msg}</p>}<State err={announcements.err} loading={announcements.loading&&!announcements.data}/>{announcements.data?.map(a=><article className="pf-event" key={a.id}><div className="row between wrap"><b>{a.title}</b><span className="pf-badge">{a.is_active?'Активно':'Выключено'}</span></div><p>{a.body}</p><p className="muted small">{a.audience==='all'?'Все организации':'Выбрано: '+(a.tenant_ids??[]).length} · {fmtDateTime(a.starts_at)}{a.ends_at?' — '+fmtDateTime(a.ends_at):''}</p><div className="pf-actions"><button type="button" onClick={()=>void toggleAnnouncement(a)}>{a.is_active?'Снять с показа':'Показать снова'}</button><button type="button" className="pf-danger-btn" onClick={()=>void removeAnnouncement(a)}>Удалить</button></div></article>)}</section></div>
}
/* ----------------------------------------------------------------------------------- журнал, настройки */
const ADMIN_ROLE: Record<string, string> = { owner: 'Владелец', support: 'Поддержка', finance: 'Финансы', read_only: 'Только чтение' };
export function Admins() {
  const { data, err, loading, reload } = useLoad<Row[]>('admins');
  const logins=useLoad<Row[]>('admin_logins');
  const [email, setEmail] = useState(''); const [role, setRole] = useState('support'); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const act = async (action: string, body: Row) => {
    setBusy(true); setMsg('');
    try { const result = await call<Row>(action, body); await reload(); return result; }
    catch (e) { setMsg(errText(e)); }
    finally { setBusy(false); }
  };
  const add = async (e: FormEvent) => { e.preventDefault(); const result = await act('admin_add', { email: email.trim(), role }); if (result) { setEmail(''); setMsg(result.invite_sent ? 'Администратор добавлен, письмо для входа отправлено.' : result.created ? 'Администратор добавлен, но письмо не отправлено. Проверьте настройки почты.' : 'Существующий аккаунт добавлен как администратор.'); } };
  return <>
    <div className="pf-dashboard-heading"><div><span className="pf-kicker">ДОСТУП К ПЛАТФОРМЕ</span><h2>Команда</h2><p className="muted">Добавляйте коллег и выбирайте, какие разделы будут им доступны.</p></div></div>
    <form className="card row wrap" onSubmit={add}><input className="field" type="email" placeholder="Email сотрудника" value={email} onChange={(e)=>setEmail(e.target.value)} required />
      <select className="field" value={role} onChange={(e)=>setRole(e.target.value)}>{Object.entries(ADMIN_ROLE).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
      <button className="pf-action-primary" disabled={busy}>Добавить администратора</button></form>
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Администратор','Роль','Статус','Добавлен','Действия']}>{data.map((a)=><tr key={a.user_id}>
      <td>{a.email}</td><td><select className="field" value={a.role} disabled={busy || !a.is_active} onChange={(e)=>void act('admin_update',{user_id:a.user_id,role:e.target.value})}>{Object.entries(ADMIN_ROLE).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></td>
      <td><Badge phase={a.is_active?'active':'suspended'} /></td><td>{fmtDate(a.created_at)}</td>
      <td className="pf-actions">{a.is_active && <><button className="pf-action-secondary" disabled={busy} onClick={()=>{if(window.confirm(`Сбросить дополнительную проверку входа для ${a.email}?`))void act('admin_reset_mfa',{user_id:a.user_id})}}>Сбросить проверку входа</button><button className="pf-action-secondary" disabled={busy} onClick={()=>{if(window.confirm(`Отключить доступ для ${a.email}?`))void act('admin_disable',{user_id:a.user_id})}}>Отключить</button></>}<button className="pf-danger-btn" disabled={busy} onClick={()=>{if(window.confirm(`Удалить администратора ${a.email} из команды? Доступ к платформе будет закрыт, настройка Google Authenticator сбросится. Сам аккаунт (почта) останется.`))void act('admin_delete',{user_id:a.user_id}).then(r=>{if(r)notify(`Администратор ${a.email} удалён.`)})}}>Удалить</button></td>
    </tr>)}</Table>}
    <section className="card col"><h3>Последние входы в аккаунты команды</h3><State err={logins.err} loading={logins.loading&&!logins.data}/>{logins.data&&<Table head={['Время','Администратор','Адрес сети','Устройство']}>{logins.data.map(item=><tr key={item.id}><td>{fmtDateTime(item.signed_in_at)}</td><td>{item.email}</td><td>{item.ip_address??'—'}</td><td>{item.user_agent||'—'}</td></tr>)}</Table>}</section>
  </>;
}

const PLATFORM_MUTATIONS=new Set(['owner_set_status','staff_set_status','owner_cancel','owner_erase_customer','owner_reschedule','owner_create_booking','owner_block','owner_add_payment','owner_upsert_service','owner_delete_service','owner_upsert_resource','owner_delete_resource','owner_update_notification_settings','owner_update_config','owner_update_legal','owner_telegram_unlink','owner_waitlist_status','owner_upsert_promo','owner_delete_promo','owner_publish_review','owner_respond_price_change']);
const PLATFORM_ACTION_LABELS:Record<string,string>={
  'impersonation.start':'Начал работу в кабинете организации','impersonation.end':'Завершил работу в кабинете организации','impersonation.expired':'Завершилось время доступа к кабинету','impersonation.action':'Изменил данные в кабинете организации',
  'admin.add':'Добавил администратора','admin.role_update':'Изменил роль администратора','admin.disable':'Отключил администратора','admin.mfa_reset':'Сбросил MFA администратора','admin.owner_recovery':'Восстановил доступ владельцу платформы',
  'owner.resend_invite':'Повторно отправил приглашение владельцу','admin.delete':'Удалил администратора','announcement.delete':'Удалил объявление','tenant.create':'Создал организацию','plan.upsert':'Изменил тариф','settings.update':'Изменил настройки платформы',
  'subscription.create':'Подключил тариф организации','subscription.extend':'Продлил подписку','subscription.change_plan':'Изменил тариф организации','subscription.set_dates':'Изменил даты подписки','subscription.suspend':'Приостановил подписку','subscription.resume':'Возобновил подписку','subscription.cancel':'Отменил подписку',
  'payment.create':'Добавил платёж','payment.confirm':'Подтвердил оплату','payment.refund':'Оформил возврат','payment.fail':'Отметил платёж как неуспешный',
  'price_change.accepted':'Организация согласилась с новой ценой','price_change.declined':'Организация отклонила новую цену','platform.bootstrap':'Назначил первого администратора платформы','tenant.export':'Выгрузил данные организации'
};
function platformActionLabel(action:string){return PLATFORM_ACTION_LABELS[action]??'Выполнил действие в платформе'}
function platformAuditDetail(action:string,payload:Row){
  if(action==='impersonation.start')return `Причина: ${String(payload.reason??'не указана')}${payload.owner_email?` · кабинет владельца ${String(payload.owner_email)}`:''}`;
  if(action==='impersonation.action'){const names:Record<string,string>={owner_set_status:'Изменил статус записи',owner_cancel:'Отменил запись',owner_erase_customer:'Удалил данные клиента',owner_reschedule:'Перенёс запись',owner_create_booking:'Создал запись',owner_block:'Закрыл время для записи',owner_add_payment:'Добавил оплату',owner_upsert_service:'Изменил услугу',owner_delete_service:'Удалил услугу',owner_upsert_resource:'Изменил мастера или пост',owner_delete_resource:'Удалил мастера или пост',owner_update_notification_settings:'Изменил настройки уведомлений',owner_update_config:'Изменил настройки организации',owner_update_legal:'Изменил реквизиты',owner_telegram_unlink:'Отключил Telegram',owner_waitlist_status:'Изменил статус листа ожидания',owner_upsert_promo:'Изменил промокод',owner_delete_promo:'Удалил промокод',owner_publish_review:'Изменил видимость отзыва'};return `${names[String(payload.action)]??'Изменил данные'} · ${payload.succeeded===true?'успешно':'не выполнено'}`}
  if(action.startsWith('subscription.')){const data=payload.data??{};const parts:string[]=[];if(payload.plan)parts.push(`тариф: ${String(payload.plan)}`);if(data.plan_code)parts.push(`тариф: ${String(data.plan_code)}`);if(data.months)parts.push(`продление на ${Number(data.months)} мес.`);if(data.days)parts.push(`продление на ${Number(data.days)} дн.`);if(data.starts_at)parts.push(`начало: ${fmtDate(String(data.starts_at))}`);if(data.ends_at)parts.push(`окончание: ${fmtDate(String(data.ends_at))}`);if(data.reason)parts.push(`причина: ${String(data.reason)}`);if(action==='subscription.resume')parts.push(data.force===true?'возобновлена вручную':'по подтверждённой оплате');return parts.join(' · ')||'Изменены условия подписки'}
  if(action==='tenant.create')return `Организация: ${String(payload.slug??'—')} · владелец: ${String(payload.owner_email??'—')} · тариф: ${String(payload.plan??'—')}`;
  if(action==='payment.create'||action==='payment.confirm')return `${Number(payload.amount_kzt??0).toLocaleString('ru-RU')} ₸`;
  if(action==='payment.refund'||action==='payment.fail')return String(payload.reason??'Причина не указана');
  if(action==='settings.update')return `${payload.key==='trial_days'?'Пробный период':payload.key==='grace_days'?'Период ожидания оплаты':String(payload.key??'Настройка')}: ${String(payload.value??'изменено')}${payload.key==='trial_days'||payload.key==='grace_days'?' дн.':''}`;
  if(action.startsWith('price_change.'))return `${Number(payload.old_price??0).toLocaleString('ru-RU')} ₸ → ${Number(payload.new_price??0).toLocaleString('ru-RU')} ₸`;
  if(action==='admin.owner_recovery')return `Восстановлен доступ: ${String(payload.email??'владелец платформы')}`;
  if(action.startsWith('admin.')){const target=payload.target_email?`Администратор: ${String(payload.target_email)} · `:'';if(action==='admin.add'||action==='admin.role_update')return `${target}роль: ${PLATFORM_ROLE_LABEL[String(payload.role)]??String(payload.role??'—')}${payload.invite_sent===true?' · приглашение отправлено':''}`;if(action==='admin.mfa_reset')return `${target}сброшено способов MFA: ${Number(payload.factors_removed??0)}`;return `${target}доступ отключён`}
  if(action==='tenant.export'){const counts=payload.counts??{};return `Выгружены данные · записей: ${Number(counts.bookings??0)}, услуг: ${Number(counts.services??0)}`}
  if(action==='plan.upsert'){const d=payload.data??{};return `${String(d.name??'Тариф')} · ${Number(d.price_kzt??0).toLocaleString('ru-RU')} ₸ за ${Number(d.period_months??1)} мес. · ${d.is_active===false?'выключен':'активен'}`}
  if(action==='owner.resend_invite')return payload.sent===false?`Не удалось отправить приглашение на ${String(payload.email??'адрес владельца')}`:`Приглашение отправлено на ${String(payload.email??'адрес владельца')}`;
  if(action==='impersonation.end'||action==='impersonation.expired')return 'Служебный сеанс завершён';
  return 'Изменения сохранены';
}

export function Audit() {
  const filters = usePlatformFilters('platform-audit-filters', { tenant: '', action: '', from: '', to: '' });
  const { tenant, action, from, to } = filters.applied;
  const [page,setPage]=useState(0); const limit=50;
  const tenants = useLoad<Row[]>('tenants', { limit: 200 });
  useEffect(()=>setPage(0),[filters.applied]);
  const params = { tenant_id: tenant || undefined, from: from ? iso(from) : undefined, to: to ? isoEnd(to) : undefined, audit_action: action || undefined };
  const { data, err, loading } = useLoad<Row[]>('audit', { ...params, limit:limit+1, offset:page*limit }, [filters.applied, page]);
  const rows=(data??[]).filter((a)=>!(a.action==='impersonation.action'&&!PLATFORM_MUTATIONS.has(String(a.payload?.action??''))));
  const visibleRows=rows.slice(0,limit); const hasNext=(data?.length??0)>limit;
  const [msg,setMsg]=useState('');
  const exportCsv = async () => {
    setMsg('');
    try {
      const all = await exportAllRows<Row>('audit', params);
      downloadCsv('platform-audit.csv', ['Когда','Кто','Событие','Организация','Подробности'],
        all.filter((a)=>!(a.action==='impersonation.action'&&!PLATFORM_MUTATIONS.has(String(a.payload?.action??''))))
          .map((a)=>[fmtDateTime(a.created_at),a.actor_email??'',platformActionLabel(String(a.action)),a.slug??'',platformAuditDetail(String(a.action),a.payload??{})]));
    } catch (e) { setMsg(errText(e)); }
  };
  return (<>
    <FilterBar filters={filters} storageKey="журнала" onExport={()=>void exportCsv()}>
      <select className="field" value={filters.draft.tenant} onChange={(e) => filters.set('tenant',e.target.value)}><option value="">Все организации</option>{tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.slug}</option>)}</select>
      <select className="field" value={filters.draft.action} onChange={(e) => filters.set('action',e.target.value)} aria-label="Тип действия"><option value="">Все действия</option>{Object.keys(PLATFORM_ACTION_LABELS).map((key)=><option key={key} value={key}>{platformActionLabel(key)}</option>)}</select>
      <input className="field" type="date" value={filters.draft.from} onChange={(e) => filters.set('from',e.target.value)} aria-label="С даты" />
      <input className="field" type="date" value={filters.draft.to} onChange={(e) => filters.set('to',e.target.value)} aria-label="По дату" />
    </FilterBar>
    {msg && <p className="err small">{msg}</p>}
    <State err={err} loading={loading && !data} />
    {data && (visibleRows.length===0?<p className="muted">Записей по выбранным условиям нет.</p>:<Table head={['Когда','Кто','Что произошло','Организация','Подробности']}>{visibleRows.map((a)=><tr key={a.id}><td>{fmtDateTime(a.created_at)}</td><td>{a.actor_email??'—'}</td><td>{platformActionLabel(String(a.action))}</td><td>{a.slug??'—'}</td><td className="muted small">{platformAuditDetail(String(a.action),a.payload??{})}</td></tr>)}</Table>)}
    {data&&(visibleRows.length>0||page>0)&&<nav className="admin-service-pagination" aria-label="Журнал платформы"><button className="admin-page-button" disabled={page===0||loading} onClick={()=>setPage(page-1)}>Назад</button><span className="muted small">Страница <b>{page+1}</b></span><button className="admin-page-button" disabled={!hasNext||loading} onClick={()=>setPage(page+1)}>Далее</button></nav>}</>);
}

const TICKET_STATUS:Record<string,string>={open:'Открыт',in_progress:'В работе',resolved:'Решён'};
const TICKET_TYPE:Record<string,string>={support:'Поддержка',billing:'Оплата и подписка',technical:'Техническая проблема',access:'Вход и доступ',booking:'Записи и расписание',feature:'Функция сервиса',other:'Другое'};
const TICKET_SEVERITY:Record<string,string>={low:'Низкая',normal:'Обычная',high:'Высокая',urgent:'Критичная'};
export function SupportQueue(){
  const filters = usePlatformFilters('platform-support-filters', { status: '', category: '', severity: '', search: '' });
  const { status, category, severity, search } = filters.applied;
  const [page,setPage]=useState(0),[ticket,setTicket]=useState<Row|null>(null),[reply,setReply]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>setPage(0),[filters.applied]);
  const q=useLoad<Row>('support_tickets',{status,category,severity,search,limit:25,offset:page*25},[filters.applied,page]);
  const exportCsv = async () => {
    setMsg('');
    try {
      const all = await exportPagedRows<Row>('support_tickets', { status, category, severity, search });
      downloadCsv('platform-support.csv', ['Тема','Организация','Адрес','Тип','Срочность','Статус','Автор','Создано'],
        all.map((item)=>[item.subject??'',item.tenant?.name??'',item.tenant?.slug??'',TICKET_TYPE[item.category]??item.category??'',TICKET_SEVERITY[item.severity]??item.severity??'',TICKET_STATUS[item.status]??item.status??'',item.created_by_email??'',fmtDateTime(item.created_at)]));
    } catch (e) { setMsg(errText(e)); }
  };
  const open=async(item:Row)=>{setMsg('');setBusy(true);try{setTicket(await call<Row>('support_ticket_detail',{ticket_id:item.id}));setReply('')}catch(e){setMsg(errText(e))}finally{setBusy(false)}};
  const refresh=async()=>{await q.reload();if(ticket){try{setTicket(await call<Row>('support_ticket_detail',{ticket_id:ticket.id}))}catch(e){setMsg(errText(e))}}};
  const update=async(nextStatus:string,message='')=>{if(!ticket)return;setBusy(true);setMsg('');try{await call('support_ticket_update',{ticket_id:ticket.id,status:nextStatus,message});setReply('');await refresh()}catch(e){setMsg(errText(e))}finally{setBusy(false)}};
  const rows:Row[]=q.data?.rows??[],count=Number(q.data?.count??0),pages=Math.max(1,Math.ceil(count/25));
  if(ticket)return <div className="col"><button className="back" onClick={()=>{setTicket(null);void q.reload()}}>← К списку обращений</button><div className="admin-subheading"><div><h2>{ticket.subject}</h2><p className="muted small">{ticket.tenant?.name} · /{ticket.tenant?.slug} · создано {fmtDateTime(ticket.created_at)}</p></div><span className={`pf-badge pf-${ticket.severity}`}>{TICKET_SEVERITY[ticket.severity]??ticket.severity}</span></div>
    <section className="card col"><div className="row between wrap"><div><b>{TICKET_TYPE[ticket.category]??'Другое'}{ticket.custom_type?` · ${ticket.custom_type}`:''}</b><p className="muted small">От: {ticket.created_by_email}</p></div><label className="muted small">Статус<select className="field" value={ticket.status} disabled={busy} onChange={e=>void update(e.target.value)}>{Object.entries(TICKET_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    <div className="support-admin-thread" aria-label="Переписка по обращению">{(ticket.events??[]).map((event:Row)=><article className={`support-admin-message ${event.is_support?'from-support':'from-organization'}`} key={event.id}><div className="support-admin-message-meta"><b>{event.is_support?'Поддержка Renvio':event.actor_email}</b><time>{fmtDateTime(event.created_at)}</time></div><p>{event.message??(event.event_type==='created'?'Обращение создано.':'Статус изменён: '+(TICKET_STATUS[event.status]??event.status))}</p></article>)}</div>
    <form className="col" onSubmit={e=>{e.preventDefault();void update(ticket.status,reply.trim())}}><label className="muted small">Ответ организации<textarea className="field" rows={4} maxLength={3000} minLength={1} value={reply} onChange={e=>setReply(e.target.value)} placeholder="Напишите ответ или задайте уточняющий вопрос" required/></label><button className="btn" disabled={busy||!reply.trim()}>Отправить ответ</button></form></section>{msg&&<p className="err" role="alert">{msg}</p>}</div>;
  return <div className="col"><div className="admin-subheading"><div><h2>Обращения организаций</h2><p className="muted small">Здесь собраны просьбы о помощи. Найдите нужное обращение по теме, типу или срочности.</p></div><button className="btn ghost mini" onClick={()=>void q.reload()}>Обновить</button></div>
    <FilterBar filters={filters} storageKey="обращений" onExport={()=>void exportCsv()}>
      <input className="field" value={filters.draft.search} onChange={e=>filters.set('search',e.target.value)} placeholder="Поиск по теме или типу" aria-label="Поиск обращений"/>
      <select className="field" value={filters.draft.status} onChange={e=>filters.set('status',e.target.value)} aria-label="Статус обращения"><option value="">Все статусы</option>{Object.entries(TICKET_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
      <select className="field" value={filters.draft.category} onChange={e=>filters.set('category',e.target.value)} aria-label="Тип обращения"><option value="">Все типы</option>{Object.entries(TICKET_TYPE).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
      <select className="field" value={filters.draft.severity} onChange={e=>filters.set('severity',e.target.value)} aria-label="Срочность"><option value="">Любая срочность</option>{Object.entries(TICKET_SEVERITY).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
    </FilterBar>
    <State err={q.err} loading={q.loading}/>{!q.loading&&!q.err&&!rows.length&&<p className="muted">По выбранным условиям обращений нет.</p>}
    <div className="support-queue-list">{rows.map(item=><article className="card support-queue-item" key={item.id}><div className="row between wrap"><div><button className="pf-link" onClick={()=>void open(item)}>{item.subject}</button><p className="muted small">{item.tenant?.name??'Организация'} · {item.tenant?.slug??'—'} · {TICKET_TYPE[item.category]??item.category}{item.custom_type?` · ${item.custom_type}`:''}</p></div><div className="row wrap"><span className={`pf-badge pf-${item.severity}`}>{TICKET_SEVERITY[item.severity]??item.severity}</span><span className={`pf-badge pf-${item.status}`}>{TICKET_STATUS[item.status]??item.status}</span></div></div><div className="row between wrap"><span className="muted small">{item.created_by_email} · обновлено {fmtDateTime(item.updated_at)}</span><button className="btn ghost mini" disabled={busy} onClick={()=>void open(item)}>Открыть обращение</button></div></article>)}</div>
    <div className="row between wrap"><span className="muted small">{count} тикетов · страница {page+1} из {pages}</span><div className="row"><button className="btn ghost mini" disabled={page===0||q.loading} onClick={()=>setPage(p=>p-1)}>Назад</button><button className="btn ghost mini" disabled={page+1>=pages||q.loading} onClick={()=>setPage(p=>p+1)}>Дальше</button></div></div>{msg&&<p className="err" role="alert">{msg}</p>}
  </div>
}

const LEAD_STATUS:Record<string,string>={new:'Новая',contacted:'Связались',converted:'Подключён',closed:'Закрыта'};
export function BusinessLeads({canConnect,onConnect}:{canConnect:boolean;onConnect:(lead:LeadPrefill)=>void}){
  const filters = usePlatformFilters('platform-leads-filters', { status: '', search: '' });
  const { status, search } = filters.applied;
  const [page,setPage]=useState(0),[msg,setMsg]=useState('');
  useEffect(()=>setPage(0),[filters.applied]);
  const q=useLoad<Row>('business_leads',{status,search,limit:25,offset:page*25},[filters.applied,page]);
  const exportCsv = async () => {
    setMsg('');
    try {
      const all = await exportPagedRows<Row>('business_leads', { status, search });
      downloadCsv('platform-leads.csv', ['Организация','Владелец','Email','Телефон','Тип','Тариф','Состояние','Поступила'],
        all.map((lead)=>[lead.business_name??lead.name??'',lead.owner_name??'',lead.owner_email??'',lead.phone??'',lead.business_type??'',lead.plan??'',LEAD_STATUS[lead.status]??lead.status??'',fmtDateTime(lead.created_at)]));
    } catch (e) { setMsg(errText(e)); }
  };
  const rows:Row[]=q.data?.rows??[],count=Number(q.data?.count??0),pages=Math.max(1,Math.ceil(count/25));
  const change=async(id:string,next:string)=>{setMsg('');try{await call('business_lead_update',{lead_id:id,status:next});await q.reload()}catch(e){setMsg(errText(e))}};
  return <div className="col"><div className="admin-subheading"><div><h2>Заявки с сайта</h2><p className="muted small">Запросы на подключение и демонстрацию Renvio. Свяжитесь с человеком и обновите состояние заявки.</p></div><button className="btn ghost mini" onClick={()=>void q.reload()} disabled={q.loading}>Обновить</button></div>
    <FilterBar filters={filters} storageKey="заявок" onExport={()=>void exportCsv()}>
      <input className="field" value={filters.draft.search} onChange={e=>filters.set('search',e.target.value)} placeholder="Название, владелец, email или телефон" aria-label="Поиск заявок"/>
      <select className="field" value={filters.draft.status} onChange={e=>filters.set('status',e.target.value)} aria-label="Состояние заявки"><option value="">Все заявки</option>{Object.entries(LEAD_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
    </FilterBar>
    <State err={q.err} loading={q.loading}/>{!q.loading&&!q.err&&!rows.length&&<p className="muted">Заявок пока нет.</p>}
    <div className="support-queue-list">{rows.map(lead=><article className="card support-queue-item" key={lead.id}><div className="row between wrap"><div><b>{lead.business_name??lead.name}</b><p className="muted small">{lead.owner_name?`${lead.owner_name} · `:''}{lead.business_type} · {lead.request_type==='demo'?'Демонстрация':'Подключение'}{lead.plan?` · тариф ${lead.plan}`:''}</p></div><span className={`pf-badge pf-${lead.status}`}>{LEAD_STATUS[lead.status]??lead.status}</span></div><div className="row between wrap"><span className="col"><a href={`tel:${String(lead.phone).replace(/[^+\d]/g,'')}`}>{lead.phone}</a>{lead.owner_email&&<a href={`mailto:${lead.owner_email}`}>{lead.owner_email}</a>}</span><time className="muted small">Поступила {fmtDateTime(lead.created_at)}</time></div>{lead.comment&&<p className="muted small">{lead.comment}</p>}{lead.consent_at?<p className="muted small">Согласие на обработку данных: {fmtDateTime(lead.consent_at)}</p>:null}{lead.tenant_slug?<p className="small">Организация создана: <a href={`/s/${lead.tenant_slug}`} target="_blank" rel="noopener noreferrer">/s/{lead.tenant_slug}</a></p>:null}{canConnect&&!lead.tenant_id&&lead.status!=='closed'&&<button className="btn mini" onClick={()=>onConnect({id:String(lead.id),name:String(lead.business_name??''),slug:slugFromName(String(lead.business_name??'')),business_type:businessTypeCode(String(lead.business_type??'')),owner_name:String(lead.owner_name??''),owner_email:String(lead.owner_email??''),phone:String(lead.phone??''),plan_code:String(lead.plan||'').toUpperCase()==='PRO'?'PRO':'START',trial:lead.request_type==='demo'})}>Подключить организацию</button>}<label className="muted small">Состояние заявки<select className="field" value={lead.status} onChange={e=>void change(String(lead.id),e.target.value)}>{Object.entries(LEAD_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></article>)}</div>
    <div className="row between wrap"><span className="muted small">{count} заявок · страница {page+1} из {pages}</span><div className="row"><button className="btn ghost mini" disabled={page===0||q.loading} onClick={()=>setPage(p=>p-1)}>Назад</button><button className="btn ghost mini" disabled={page+1>=pages||q.loading} onClick={()=>setPage(p=>p+1)}>Далее</button></div></div>{msg&&<p className="err" role="alert">{msg}</p>}
  </div>
}

const DELIVERY_STATUS:Record<string,string>={all:'Все статусы',pending:'Ожидают отправки',sent:'Отправлено',failed:'Не отправлено'};
const DELIVERY_KIND:Record<string,string>={booking_created:'Новая запись',booking_cancelled:'Отмена записи',booking_reminder:'Напоминание',booking_followup:'Повторный визит',waitlist_interest:'Лист ожидания'};
const BOUNCE_KIND:Record<string,string>={soft:'Временная ошибка',hard:'Адрес не существует',complaint:'Жалоба'};

export function PlatformNotifications() {
  const [noticePage,setNoticePage]=useState(0); const noticeLimit=25;
  const {data,err,loading,reload}=useLoad<Row[]>('notifications',{limit:noticeLimit+1,offset:noticePage*noticeLimit},[noticePage]);
  const notices=(data??[]).slice(0,noticeLimit); const hasNoticeNext=(data?.length??0)>noticeLimit;
  const marked=useRef(new Set<string>());
  useEffect(()=>{const ids=notices.filter(n=>!n.is_read&&!marked.current.has(String(n.id))).map(n=>String(n.id));if(ids.length){ids.forEach(id=>marked.current.add(id));void call('notifications_read',{ids}).then(()=>reload()).catch(()=>ids.forEach(id=>marked.current.delete(id))) }},[notices,reload]);
  const [status,setStatus]=useState('all'),[kind,setKind]=useState('all'),[page,setPage]=useState(0);
  const limit=50;
  useEffect(()=>setPage(0),[status,kind]);
  const delivery=useLoad<Row>('notification_delivery',{status,kind,limit,offset:page*limit},[status,kind,page]);
  const bounces=useLoad<Row>('notification_bounces',{limit:50,offset:0});
  const title=(action:string)=>action==='price_change.accepted'?'Организация приняла новые условия':action==='price_change.declined'?'Организация отказалась от новой цены':'Изменение цены подписки';
  const rows:Row[]=delivery.data?.rows??[],count=Number(delivery.data?.count??0),pages=Math.max(1,Math.ceil(count/limit));
  const summary:Row=delivery.data?.summary??{};
  return <div className="pf-notifications"><div className="pf-panel-heading"><div><span className="pf-kicker">RENVIO</span><h2>Уведомления и доставка</h2></div><button className="pf-action-secondary" onClick={()=>{void reload();void delivery.reload();void bounces.reload()}} disabled={loading}>{loading?'Обновляем…':'Обновить'}</button></div>
    <section className="card col"><h3>Доставка сообщений</h3><p className="muted small">Очередь уведомлений организаций за последние 30 дней.</p>
      <div className="row wrap"><span className="pf-badge pf-pending">Ожидают: {Number(summary.pending??0)}</span><span className="pf-badge pf-active">Отправлено: {Number(summary.sent??0)}</span><span className="pf-badge pf-failed">Ошибок: {Number(summary.failed??0)}</span><span className="pf-badge pf-grace">Отказов: {Number(summary.bounced??0)}</span></div>
      <div className="row wrap"><select className="field" value={status} onChange={(e)=>setStatus(e.target.value)} aria-label="Статус доставки">{Object.entries(DELIVERY_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select className="field" value={kind} onChange={(e)=>setKind(e.target.value)} aria-label="Тип уведомления"><option value="all">Все сообщения</option>{Object.entries(DELIVERY_KIND).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
      <State err={delivery.err} loading={delivery.loading&&!delivery.data}/>
      {delivery.data&&rows.length===0&&<p className="muted small">Сообщений по выбранным условиям нет.</p>}
      {rows.length>0&&<Table head={['Когда','Организация','Сообщение','Статус','Попытки','Ошибка']}>{rows.map((j)=><tr key={j.id}><td>{fmtDateTime(j.created_at)}</td><td>{j.slug??'—'}</td><td>{DELIVERY_KIND[j.kind]??j.kind} · {j.channel}</td><td>{DELIVERY_STATUS[j.status]??j.status}</td><td>{j.attempts}</td><td className="muted small">{j.last_error??'—'}</td></tr>)}</Table>}
      {delivery.data&&(rows.length>0||page>0)&&<div className="row between wrap"><span className="muted small">{count} сообщений · страница {page+1} из {pages}</span><div className="row"><button className="pf-action-secondary" disabled={page===0||delivery.loading} onClick={()=>setPage(p=>p-1)}>Назад</button><button className="pf-action-secondary" disabled={page+1>=pages||delivery.loading} onClick={()=>setPage(p=>p+1)}>Дальше</button></div></div>}
    </section>
    <section className="card col"><h3>Отказы доставки</h3><p className="muted small">Адреса, на которые пришли отказы или жалобы.</p><State err={bounces.err} loading={bounces.loading&&!bounces.data}/>
      {bounces.data&&(bounces.data.rows??[]).length===0&&<p className="muted small">Отказов нет.</p>}
      {(bounces.data?.rows??[]).length>0&&<Table head={['Когда','Организация','Канал','Адрес','Тип отказа']}>{(bounces.data?.rows as Row[] ?? []).map((b)=><tr key={b.id}><td>{fmtDateTime(b.created_at)}</td><td>{b.slug??'—'}</td><td>{b.channel}</td><td>{b.recipient}</td><td>{BOUNCE_KIND[b.bounce_type]??b.bounce_type}</td></tr>)}</Table>}
    </section>
    <State err={err} loading={loading&&!data}/>{notices.length===0&&!loading?<p className="muted">Событий по изменению цен нет.</p>:notices.map((n)=><article className="card pf-notice" key={n.id}><div className="row between wrap"><b>{title(String(n.action))}</b><span className={`pf-notice-status${n.is_read?'':' unread'}`}>{n.is_read?'Прочитано':'Новое'}</span><time className="muted small">{fmtDateTime(n.created_at)}</time></div><p>{n.slug??'Организация'} · {n.payload?.old_price??'—'} ₸ → {n.payload?.new_price??'—'} ₸</p><p className="muted small">Новые условия вступают в силу: {fmtDateTime(n.payload?.effective_at)}</p></article>)}
    {data&&(notices.length>0||noticePage>0)&&<div className="row between wrap"><span className="muted small">События цен · страница {noticePage+1}</span><div className="row"><button className="pf-action-secondary" disabled={noticePage===0||loading} onClick={()=>setNoticePage(p=>p-1)}>Назад</button><button className="pf-action-secondary" disabled={!hasNoticeNext||loading} onClick={()=>setNoticePage(p=>p+1)}>Дальше</button></div></div>}</div>
}

export function Settings() {
  const { data, err, loading, reload } = useLoad<Row>('settings');
  const [trial, setTrial] = useState(''); const [grace, setGrace] = useState(''); const [msg, setMsg] = useState('');
  useEffect(() => { if (data) { setTrial(String(data.trial_days ?? 14)); setGrace(String(data.grace_days ?? 5)); } }, [data]);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setMsg('');
    try { await call('settings_set', { key: 'trial_days', value: Number(trial) }); await call('settings_set', { key: 'grace_days', value: Number(grace) }); await reload(); setMsg('Сохранено. Новые значения действуют для новых подписок и продлений.'); }
    catch (e2) { setMsg(errText(e2)); }
  };
  return (
    <>
      <State err={err} loading={loading && !data} />
      <form className="card col pf-form" onSubmit={save}><h2>Настройки</h2>
      <label className="pf-label">Пробный период, дней (1–90)<input className="field" type="number" min={1} max={90} value={trial} onChange={(e) => setTrial(e.target.value)} /></label>
      <label className="pf-label">Grace-период, дней (0–30)<input className="field" type="number" min={0} max={30} value={grace} onChange={(e) => setGrace(e.target.value)} /></label>
      {msg && <p>{msg}</p>}
      <button className="btn">Сохранить</button>
    </form>
    </>
  );
}
