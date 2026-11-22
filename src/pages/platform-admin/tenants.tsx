import { useEffect, useRef, useState, type FormEvent } from 'react';
import { maskPhone, PHONE_PLACEHOLDER } from '../../lib/phone'
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { businessTypeCode } from '../../lib/businessTypes';
import { notify } from '../../components/Toaster';
import { Badge, METHODS, PHASE, State, SubscriptionActionModal, Table, call, errText, fmtDate, fmtDateTime, iso, kzt, newKey, platformFile, resendInvite, resumeFlow, runSubAction, slugFromName, subscriptionEventDetail, subscriptionEventTitle, useLoad, type LeadPrefill, type Row } from './shared';

/* ----------------------------------------------------------------------------------- организации */
export function Tenants({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState(''); const [phase, setPhase] = useState(''); const [plan, setPlan] = useState(''); const [applied, setApplied] = useState({ search: '', phase: '', plan: '' });
  const [savedFilters,setSavedFilters]=useState<Record<string,{search:string;phase:string;plan:string}>>(()=>{try{return JSON.parse(localStorage.getItem('platform-tenant-filters')||'{}')}catch{return {}}});
  const [page,setPage]=useState(0); const pageSize=50;
  const debouncedSearch=useDebouncedValue(search,300);
  useEffect(()=>setPage(0),[applied]);
  useEffect(()=>setApplied(prev=>prev.search===debouncedSearch?prev:{...prev,search:debouncedSearch}),[debouncedSearch]);
  const { data, err, loading, reload } = useLoad<Row[]>('tenants', { search: applied.search, phase: applied.phase, plan: applied.plan, limit:pageSize+1, offset:page*pageSize }, [applied,page]);
  const rows=(data??[]).slice(0,pageSize); const hasNext=(data?.length??0)>pageSize;
  const [msg, setMsg] = useState('');
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  const saveFilter=()=>{const name=window.prompt('Название сохранённого фильтра');if(!name?.trim())return;const next={...savedFilters,[name.trim()]:{search,phase,plan}};setSavedFilters(next);localStorage.setItem('platform-tenant-filters',JSON.stringify(next))};
  const exportCsv=async()=>{try{const all:Row[]=[];for(let offset=0;offset<100000;offset+=200){const batch=await call<Row[]>('tenants',{...applied,limit:200,offset});all.push(...batch);if(batch.length<200)break}const quote=(x:unknown)=>'"'+String(x??'').replace(/[\r\n]+/g,' ').replace(/"/g,'""')+'"';const csv=['Организация,Адрес страницы,Владелец,Тариф,Статус,Окончание',...all.map(r=>[r.name,r.slug,r.owner_email,r.plan_code,r.phase,r.ends_at].map(quote).join(','))].join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));a.download='organizations.csv';a.click();URL.revokeObjectURL(a.href)}catch(e){setMsg(errText(e))}};
  return (<>
    <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setApplied({ search, phase, plan }); }}>
      <input className="field" placeholder="Название, адрес страницы или почта владельца" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select className="field" value={phase} onChange={(e) => setPhase(e.target.value)}><option value="">Все статусы</option>{Object.entries(PHASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select className="field" value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">Все тарифы</option><option>START</option><option>PRO</option><option>LEGACY</option></select>
      <button className="btn inline">Найти</button><button type="button" className="pf-action-secondary" onClick={saveFilter}>Сохранить условия поиска</button><button type="button" className="pf-action-secondary" onClick={()=>void exportCsv()}>Скачать таблицу Excel</button></form>
    {Object.keys(savedFilters).length>0&&<label className="pf-label">Сохранённые фильтры<select className="field" value="" onChange={e=>{const v=savedFilters[e.target.value];if(v){setSearch(v.search);setPhase(v.phase);setPlan(v.plan);setApplied(v)}}}><option value="">Выбрать…</option>{Object.keys(savedFilters).map(n=><option key={n}>{n}</option>)}</select></label>}
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Организация', 'Владелец', 'Тариф', 'Статус', 'До', 'Действия']}>{rows.map((r) => (
      <tr key={r.id}><td><button className="pf-link" onClick={() => onOpen(r.id)}>{r.name ?? r.slug}</button><br /><span className="muted small">{r.slug}</span></td>
        <td>{r.owner_email ?? '—'}</td><td>{r.plan_code ?? '—'}</td><td><Badge phase={r.phase} /></td><td>{r.ends_at ? fmtDate(r.ends_at) : 'бессрочно'}</td>
        <td className="pf-actions">
          <a href={`/s/${r.slug}/`} target="_blank" rel="noreferrer">Сайт</a>
          {r.owner_email && <button onClick={() => act(() => resendInvite(r.owner_email, r.slug))}>Приглашение</button>}
          {r.subscription_id && ['suspended', 'expired'].includes(r.phase) && <button onClick={() => act(() => resumeFlow(r.subscription_id))}>Возобновить</button>}
        </td></tr>))}</Table>}
    {data&&(rows.length>0||page>0)&&<nav className="admin-service-pagination" aria-label="Организации"><button className="admin-page-button" disabled={page===0||loading} onClick={()=>setPage(page-1)}>Назад</button><span className="muted small">Страница <b>{page+1}</b></span><button className="admin-page-button" disabled={!hasNext||loading} onClick={()=>setPage(page+1)}>Далее</button></nav>}
  </>);
}

function TenantPlanOverrides({tenantId,access,usage,onSaved}:{tenantId:string;access:Row;usage:Row;onSaved:()=>void}){
  const limitFields:[string,string][]=[['employees','Сотрудники'],['services','Услуги'],['branches','Филиалы'],['bookings_per_month','Записи в месяц']];
  const featureFields:[string,string][]=[['telegram','Уведомления в Telegram'],['export','Скачивание копии данных'],['reviews','Отзывы клиентов']];
  const [limits,setLimits]=useState<Row>({}); const [unlimited,setUnlimited]=useState<Row>({}); const [features,setFeatures]=useState<Row>({}); const [reason,setReason]=useState(''); const [msg,setMsg]=useState(''); const [busy,setBusy]=useState(false);
  useEffect(()=>{const overrides=access?.override??{};const rawLimits=overrides.limits??{};setLimits(Object.fromEntries(limitFields.map(([key])=>[key,rawLimits[key]==null?'':String(rawLimits[key])])));setUnlimited(Object.fromEntries(limitFields.map(([key])=>[key,key in rawLimits&&rawLimits[key]===null])));setFeatures(Object.fromEntries(featureFields.map(([key])=>[key,typeof overrides.features?.[key]==='boolean'?String(overrides.features[key]):'inherit'])));setReason('')},[access]);
  const save=async(reset=false)=>{if(reason.trim().length<5){setMsg('Укажите причину (не менее 5 символов).');return}setBusy(true);setMsg('');try{const lim=reset?{}:Object.fromEntries(limitFields.filter(([key])=>unlimited[key]||String(limits[key]??'').trim()!=='').map(([key])=>[key,unlimited[key]?null:Number(limits[key])]));const flags=reset?{}:Object.fromEntries(featureFields.filter(([key])=>features[key]&&features[key]!=='inherit').map(([key])=>[key,features[key]==='true']));await call('tenant_limits_set',{tenant_id:tenantId,limits:lim,features:flags,reason:reason.trim()});setMsg(reset?'Исключения сброшены.':'Индивидуальные лимиты сохранены.');setReason('');onSaved()}catch(e){setMsg(errText(e))}finally{setBusy(false)}};
  const displayLimit=(key:string)=>access?.limits?.[key]==null?'без ограничений':Number(access.limits[key]).toLocaleString('ru-RU');
  const usageValue=(key:string)=>usage?.[key]==null?'не учитывается':Number(usage[key]).toLocaleString('ru-RU');
  return <section className="card col"><div><h3>Лимиты и функции организации</h3><p className="muted small">Тариф {access?.plan_code??'—'}. Текущие данные остаются доступными; превышение блокирует только новые добавления.</p></div>
    <div className="pf-plan-limits">{limitFields.map(([key,label])=><label key={key} className="pf-label">{label}<span className="muted small">По тарифу: {displayLimit(key)} · Сейчас: {usageValue(key)}</span><input className="field" type="number" min={1} step={1} value={limits[key]??''} disabled={!!unlimited[key]} onChange={e=>setLimits((prev:Row)=>({...prev,[key]:e.target.value}))} placeholder="Наследовать лимит тарифа"/><span className="pf-check"><input type="checkbox" checked={!!unlimited[key]} onChange={e=>setUnlimited((prev:Row)=>({...prev,[key]:e.target.checked}))}/> Без лимита</span></label>)}</div>
    <p className="muted small">Сейчас считается один основной филиал на организацию. Управление несколькими филиалами в приложении пока не подключено.</p>
    <div className="col"><b>Исключения по функциям</b><div className="row wrap">{featureFields.map(([key,label])=><label className="pf-label" key={key}>{label}<select className="field" value={features[key]??'inherit'} onChange={e=>setFeatures((prev:Row)=>({...prev,[key]:e.target.value}))}><option value="inherit">Как в тарифе ({access?.features?.[key]===false?'выключено':'включено'})</option><option value="true">Включить</option><option value="false">Выключить</option></select></label>)}</div></div>
    <label className="pf-label">Причина изменения<textarea className="field" rows={2} maxLength={500} minLength={5} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Например: согласовано индивидуальное расширение тарифа"/></label>
    {msg&&<p className="muted small" role="status">{msg}</p>}<div className="row wrap"><button className="btn" disabled={busy||reason.trim().length<5} onClick={()=>void save()}>{busy?'Сохраняем…':'Сохранить исключения'}</button><button className="btn ghost" disabled={busy||reason.trim().length<5} onClick={()=>void save(true)}>Сбросить к тарифу</button></div>{access?.override?.reason&&<p className="muted small">Последняя причина: {String(access.override.reason)}</p>}
  </section>
}

function TenantSupportPanel({tenantId}:{tenantId:string}){
  const {data,err,loading,reload}=useLoad<Row>('tenant_support',{tenant_id:tenantId},[tenantId]);
  const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
  const submit=async(action:string,body:Row)=>{setBusy(true);setMsg('');try{await call(action,{tenant_id:tenantId,...body});await reload();return true}catch(e){setMsg(errText(e));return false}finally{setBusy(false)}};
  return <section className="card col"><div><h3>Внутренние заметки</h3><p className="muted small">Заметки видны только платформенным администраторам. Тикеты находятся в отдельной вкладке «Поддержка».</p></div>
    <State err={err} loading={loading}/>
    <div className="col"><h4>Добавить заметку</h4><textarea className="field" rows={3} maxLength={3000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Внутренняя заметка для команды Renvio"/><button className="btn" disabled={busy||!note.trim()} onClick={async()=>{if(await submit('tenant_note_add',{body:note.trim()}))setNote('')}}>{busy?'Сохраняем…':'Сохранить заметку'}</button>
      <div className="pf-support-list">{(data?.notes??[]).map((item:Row)=><article className="pf-event" key={item.id}><div className="row between wrap"><b>{item.created_by_email}</b><time className="muted small">{fmtDateTime(item.created_at)}</time></div><p>{item.body}</p></article>)}{data&&!data.notes?.length&&<p className="muted small">Заметок пока нет.</p>}</div>
    </div>{msg&&<p className="err" role="status">{msg}</p>}
  </section>
}

function TenantFeatureFlags({tenantId}:{tenantId:string}){
  const {data,err,loading,reload}=useLoad<Row[]>('tenant_flags_get',{tenant_id:tenantId},[tenantId]);
  const [key,setKey]=useState('');const [enabled,setEnabled]=useState(true);const [msg,setMsg]=useState('');
  const save=async(flag_key:string,value:boolean)=>{setMsg('');try{await call('tenant_flags_set',{tenant_id:tenantId,flag_key,enabled:value});await reload()}catch(e){setMsg(errText(e))}};
  return <section className="card col"><h3>Дополнительные возможности</h3><p className="muted small">Можно включить пробные возможности отдельно для этой организации.</p><State err={err} loading={loading&&!data}/>{data?.map(f=><div className="row between wrap" key={f.flag_key}><code>{f.flag_key}</code><label className="pf-check"><input type="checkbox" checked={!!f.enabled} onChange={e=>void save(f.flag_key,e.target.checked)}/> Включена</label></div>)}<form className="row wrap" onSubmit={e=>{e.preventDefault();void save(key,enabled).then(()=>setKey(''))}}><input className="field" value={key} onChange={e=>setKey(e.target.value)} placeholder="Название возможности" pattern="[a-z][a-z0-9_]{1,63}" required/><label className="pf-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Включить</label><button className="btn" disabled={!key}>Сохранить</button></form>{msg&&<p className="err">{msg}</p>}</section>
}

export function TenantCard({ id, role, onBack }: { id: string; role: string; onBack: () => void }) {
  const { data: d, err, loading, reload } = useLoad<Row>('tenant', { tenant_id: id });
  const [eventPage,setEventPage]=useState(0);
  const events=useLoad<Row>('tenant_events',{tenant_id:id,limit:50,offset:eventPage*50},[id,eventPage]);
  useEffect(()=>setEventPage(0),[id]);
  const [msg, setMsg] = useState(''); const [reason,setReason]=useState(''); const [impBusy,setImpBusy]=useState(false);
  const [lifeReason,setLifeReason]=useState('');
  const [subModal,setSubModal]=useState<{type:string;subscription:Row}|null>(null);
  if (!d) return <><button className="back" onClick={onBack}>← Назад</button><State err={err} loading={loading} /></>;
  const t = d.tenant as Row; const subs: Row[] = d.subscriptions; const cur = subs.find((s) => ['trial', 'active', 'grace', 'suspended'].includes(s.status)) ?? subs[0];
  const exportData = async () => {
    setMsg('');
    try{const data=await platformFile('export',{tenant_id:id});const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = `${t.slug}-export.zip`; a.click(); URL.revokeObjectURL(a.href)}catch{setMsg('Не удалось выгрузить данные.')}
  };
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  const startImpersonation = async (e: FormEvent) => {
    e.preventDefault(); setMsg(''); setImpBusy(true);
    try {
      const response = await fetch('/api/platform?action=impersonate_start',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant_id:id,reason:reason.trim()})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(String(payload.error??'operation_failed'));
      window.location.assign(`/s/${payload.tenant_slug}/owner`);
    } catch(e2) { setMsg(errText(e2)); } finally { setImpBusy(false); }
  };
  return (<>
    <button className="back" onClick={onBack}>← Назад</button>
    {subModal&&<SubscriptionActionModal type={subModal.type} subscription={subModal.subscription} initialPlan={cur?.plan_code??'START'} initialDate={cur?.ends_at?.slice(0,10)??''} onClose={()=>setSubModal(null)} onSubmit={async values=>{await act(()=>runSubAction(subModal.subscription.id,subModal.type,values));setSubModal(null)}}/>}
    <section className="card pf-org">
      <div className="pf-org__head">
        <div className="pf-org__avatar" aria-hidden="true">{String(t.config?.name ?? t.slug).trim().charAt(0).toUpperCase()}</div>
        <div className="pf-org__title">
          <h2>{t.config?.name ?? t.slug}</h2>
          <div className="pf-org__chips">
            {cur && <Badge phase={cur.phase} />}
            {cur?.plan_code && <span className="pf-chip">Тариф {cur.plan_code}</span>}
            <span className="pf-chip">/s/{t.slug}</span>
            <span className="pf-chip">{t.timezone}</span>
            <span className="pf-chip">Создана {fmtDate(t.created_at)}</span>
            <span className="pf-chip">Доступ: {d.access_state}</span>
          </div>
          {t.owner_email && <p className="pf-org__owner">Владелец: <b>{t.owner_email}</b></p>}
          {t.archived_at && <p className="err small">В архиве с {fmtDate(t.archived_at)}{t.deletion_requested_at ? ` · удаление запрошено, хранение до ${fmtDate(new Date(new Date(t.deletion_requested_at).getTime()+30*86400000).toISOString())}` : ''}</p>}
        </div>
      </div>
      <div className="pf-org__stats">
        <div className="pf-stat"><b>{d.counters.staff}</b><span>Сотрудники</span></div>
        <div className="pf-stat"><b>{d.counters.services}</b><span>Услуги</span></div>
        <div className="pf-stat"><b>{d.counters.bookings_30d}</b><span>Записи за 30 дней</span></div>
      </div>
      <div className="pf-org__actions">
        <a className="pf-action-secondary" href={`/s/${t.slug}/`} target="_blank" rel="noreferrer">Публичная страница</a>
        {t.owner_email && <button className="pf-action-secondary" onClick={()=>void act(()=>resendInvite(t.owner_email, t.slug))}>Отправить приглашение владельцу</button>}
        <button className="pf-action-secondary" onClick={exportData}>Экспорт данных</button>
      </div>
      {msg && <p className="err">{msg}</p>}
      {role==='owner' && <div className="pf-zone pf-zone--danger">
        <h3>Архив и удаление</h3>
        <p className="muted small">Действия записываются в журнал. Удаление не стирает данные сразу: они хранятся 30 дней.</p>
        <label className="pf-label">Причина<input className="field" minLength={5} maxLength={500} value={lifeReason} onChange={e=>setLifeReason(e.target.value)} placeholder="Обязательная причина (не менее 5 символов)"/></label>
        <div className="pf-zone__row">
          <button className="pf-action-secondary" disabled={lifeReason.trim().length<5} onClick={()=>void act(()=>call('tenant_lifecycle',{tenant_id:id,lifecycle_action:t.archived_at?'restore':'archive',reason:lifeReason.trim()}))}>{t.archived_at?'Восстановить':'В архив'}</button>
          <button className="pf-danger-btn" disabled={lifeReason.trim().length<5||!!t.deletion_requested_at} onClick={()=>{if(window.confirm('Удаление будет запрошено с 30-дневным сроком хранения. Данные сейчас не стираются. Продолжить?'))void act(()=>call('tenant_lifecycle',{tenant_id:id,lifecycle_action:'delete_request',reason:lifeReason.trim()}))}}>Запросить удаление (30 дней)</button>
        </div>
      </div>}
    </section>
    {['owner','support'].includes(role) && <form className="card col pf-support" onSubmit={(e)=>void startImpersonation(e)}><h3>Режим поддержки</h3><p className="muted small">Вход в кабинет владельца на 30 минут. Причина обязательна; действия будут записаны в журнал.</p><label className="pf-label">Причина доступа<textarea className="field" minLength={5} maxLength={500} rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Например: воспроизведение ошибки при создании записи" required /></label><button className="pf-action-primary" disabled={impBusy||reason.trim().length<5}>{impBusy?'Открываем кабинет…':'Войти в кабинет организации'}</button></form>}
      <section className="card"><h3>Текущая подписка</h3>
      {cur ? <><p><Badge phase={cur.phase} /> {cur.plan_code} · {fmtDate(cur.starts_at)} — {cur.ends_at ? fmtDate(cur.ends_at) : 'бессрочно'}{cur.grace_ends_at ? ` (grace до ${fmtDate(cur.grace_ends_at)})` : ''}</p>
        <div className="pf-actions">
          {cur.ends_at && <button onClick={() => act(() => runSubAction(cur.id, 'extend', { months: 1 }))}>Продлить на 1 мес.</button>}
          {['trial', 'active', 'grace'].includes(cur.phase) && <button onClick={() => setSubModal({type:'suspend',subscription:cur})}>Приостановить</button>}
          {['suspended', 'expired'].includes(cur.phase) && <button onClick={() => act(() => resumeFlow(cur.id))}>Возобновить</button>}
          <button onClick={() => setSubModal({type:'change_plan',subscription:cur})}>Сменить тариф</button>
          {['trial','active','grace','suspended'].includes(cur.status)&&<button className="danger" onClick={()=>setSubModal({type:'cancel',subscription:cur})}>Отменить подписку</button>}
        </div></> : <p className="muted">Подписки нет.</p>}</section>
    {role==='owner'&&<TenantPlanOverrides tenantId={id} access={d.plan_access??{}} usage={d.plan_usage??{}} onSaved={()=>void reload()}/>}
    {role==='owner'&&<TenantFeatureFlags tenantId={id}/>}
    {['owner','support'].includes(role)&&<TenantSupportPanel tenantId={id}/>}
    <section className="card"><h3>Владельцы и сотрудники</h3><Table head={['Email', 'Роль', 'Последний вход']}>{(d.members as Row[]).map((m) => <tr key={m.user_id}><td>{m.email}</td><td>{m.role}</td><td>{fmtDateTime(m.last_sign_in_at)}</td></tr>)}</Table></section>
    <section className="card"><h3>История подписок</h3><Table head={['Тариф', 'Статус', 'Начало', 'Окончание']}>{subs.map((s) => <tr key={s.id}><td>{s.plan_code}</td><td><Badge phase={s.phase} /></td><td>{fmtDate(s.starts_at)}</td><td>{s.ends_at ? fmtDate(s.ends_at) : '—'}</td></tr>)}</Table></section>
    <section className="card"><h3>Платежи</h3><Table head={['Дата', 'Сумма', 'Период', 'Способ', 'Статус']}>{(d.payments as Row[]).map((p) => <tr key={p.id}><td>{fmtDate(p.received_at)}</td><td>{kzt(p.amount_kzt)}</td><td>{fmtDate(p.period_start)} — {fmtDate(p.period_end)}</td><td>{METHODS[p.method] ?? p.method}</td><td><Badge phase={p.status} /></td></tr>)}</Table></section>
    <section className="card col"><div><h3>История подписки</h3><p className="muted small">Платежи, изменения тарифа и статуса организации.</p></div><State err={events.err} loading={events.loading}/>{events.data&&<>{(events.data.items as Row[]).length===0?<p className="muted">Событий пока нет.</p>:<div className="pf-event-list">{(events.data.items as Row[]).map((e)=><article className="pf-event" key={e.id}><div className="row between wrap"><b>{subscriptionEventTitle(String(e.type))}</b><time className="muted small">{fmtDateTime(e.created_at)}</time></div><p className="muted small">{subscriptionEventDetail(e)}</p></article>)}</div>}{((events.data.items as Row[]).length>0||eventPage>0)&&<nav className="admin-service-pagination" aria-label="История подписки"><button className="admin-page-button" disabled={eventPage===0||events.loading} onClick={()=>setEventPage(eventPage-1)}>Назад</button><span className="muted small">Страница <b>{eventPage+1}</b></span><button className="admin-page-button" disabled={!events.data.has_more||events.loading} onClick={()=>setEventPage(eventPage+1)}>Далее</button></nav>}</>}</section>
  </>);
}

/* ----------------------------------------------------------------------------------- создание организации */
export function CreateTenant({ onCreated, prefill }: { onCreated: (id: string) => void; prefill?: LeadPrefill | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<Row>({ name: prefill?.name ?? '', slug: prefill?.slug ?? '', business_type: prefill?.business_type ?? 'autoservice', owner_name: prefill?.owner_name ?? '', owner_email: prefill?.owner_email ?? '', phone: maskPhone(prefill?.phone ?? ''), bin_iin:'', address: '', timezone: 'Asia/Aqtobe', currency: '₸', plan_code: prefill?.plan_code ?? 'START', start: today, months: 1, trial: prefill?.trial ?? true, services: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const key = useRef(newKey()); // один ключ на форму: повторный клик «Создать» не создаёт дубликат
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setErr(''); setOk('');
    const services = String(f.services).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, price, dur] = l.split(';').map((x) => x.trim()); return { name, price: Number(price), duration_minutes: Number(dur) }; });
    try {
      const r = await call<Row>('create_tenant', { idempotency_key: key.current, tenant: { ...f, start: iso(f.start), months: Number(f.months), services } });
      { const okText = r.replayed ? 'Организация уже была создана этим запросом.' : r.invite_sent ? 'Организация создана, приглашение отправлено владельцу.' : 'Организация создана. Приглашение не отправлено — отправьте его из карточки.'; setOk(okText); notify(okText, r.invite_sent || r.replayed ? 'ok' : 'warn'); }
      if(prefill?.id){try{await call('business_lead_update',{lead_id:prefill.id,status:'converted',tenant_id:r.tenant_id,tenant_slug:r.slug??f.slug})}catch{setOk(x=>x+' Заявку не удалось отметить подключённой — сделайте это вручную.')}}
      key.current = newKey(); onCreated(r.tenant_id);
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  };
  const input = (label: string, k: string, type = 'text', ph = '') => <label className="pf-label">{label}<input className="field" type={type} placeholder={type==='tel'?PHONE_PLACEHOLDER:ph} maxLength={type==='tel'?18:undefined} value={f[k]} onChange={(e) => set(k, type==='tel'?maskPhone(e.target.value,String(f[k]??'')):e.target.value)} required={['name', 'slug', 'owner_email'].includes(k)} /></label>;
  return (
    <form className="card col pf-form" onSubmit={submit}><h2>Новая организация</h2>{prefill&&<p className="muted small">Данные подставлены из заявки с сайта. Проверьте их и нажмите «Создать»: заявка станет «Подключён», владелец получит письмо для установки пароля.</p>}
      {input('Название студии или компании', 'name')}{input('Адрес страницы', 'slug', 'text', 'my-studio')}{input('Чем занимается организация', 'business_type')}
      {input('Имя владельца', 'owner_name')}{input('Почта владельца', 'owner_email', 'email')}{input('Телефон', 'phone', 'tel')}{input('БИН/ИИН', 'bin_iin')}{input('Адрес организации', 'address')}
      {input('Часовой пояс', 'timezone')}{input('Валюта', 'currency')}
      <label className="pf-label">Тариф<select className="field" value={f.plan_code} onChange={(e) => set('plan_code', e.target.value)}><option>START</option><option>PRO</option><option>BUSINESS</option></select></label>
      <label className="pf-check"><input type="checkbox" checked={f.trial} onChange={(e) => set('trial', e.target.checked)} /> Пробный период (длительность из настроек)</label>
      {input('Дата старта подписки', 'start', 'date')}
      {!f.trial && input('Длительность, месяцев', 'months', 'number')}
      <label className="pf-label">Услуги организации (каждая с новой строки: название; цена; длительность в минутах). Поле можно оставить пустым<textarea className="field" rows={4} placeholder={'Мойка; 3500; 60'} value={f.services} onChange={(e) => set('services', e.target.value)} /></label>
      {err && <p className="err">{err}</p>}{ok && <p>{ok}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Создаём…' : 'Создать'}</button></form>);
}
