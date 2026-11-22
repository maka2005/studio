import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, FilterBar, METHODS, PHASE, State, SubscriptionActionModal, Table, call, downloadCsv, errText, exportAllRows, fmtDate, iso, kzt, newKey, resumeFlow, runSubAction, useAllTenants, useLoad, usePlatformFilters, type Row } from './shared';

/* ----------------------------------------------------------------------------------- подписки */
export function Subscriptions({ onOpen }: { onOpen: (id: string) => void }) {
  const filters = usePlatformFilters('platform-subscriptions-filters', { phase: '' });
  const { phase } = filters.applied;
  const [subModal,setSubModal]=useState<{type:string;subscription:Row}|null>(null);
  const [page,setPage]=useState(0); const pageSize=50;
  useEffect(()=>setPage(0),[filters.applied]);
  const { data, err, loading, reload } = useLoad<Row[]>('subscriptions', { phase, limit: pageSize+1, offset: page*pageSize }, [filters.applied, page]);
  const rows=(data??[]).slice(0,pageSize); const hasNext=(data?.length??0)>pageSize;
  const [msg, setMsg] = useState('');
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  const exportCsv = async () => {
    setMsg('');
    try {
      const all = await exportAllRows<Row>('subscriptions', { phase });
      downloadCsv('platform-subscriptions.csv', ['Организация','Slug','Тариф','Цена','Период, мес.','Статус','Начало','Окончание'],
        all.map((s)=>[s.name??'',s.slug??'',s.plan_code??'',s.price_kzt??'',s.price_period_months??'',PHASE[s.phase]??s.phase??'',fmtDate(s.starts_at),s.ends_at?fmtDate(s.ends_at):'бессрочно']));
    } catch (e) { setMsg(errText(e)); }
  };
  return (<>
    {subModal&&<SubscriptionActionModal type={subModal.type} subscription={subModal.subscription} initialPlan={subModal.subscription.plan_code} initialDate={subModal.subscription.ends_at?.slice(0,10)??''} onClose={()=>setSubModal(null)} onSubmit={async values=>{await act(()=>runSubAction(subModal.subscription.id,subModal.type,values));setSubModal(null)}}/>}
    <FilterBar filters={filters} storageKey="подписок" onExport={()=>void exportCsv()}>
      <select className="field" value={filters.draft.phase} onChange={(e) => filters.set('phase', e.target.value)} aria-label="Статус подписки"><option value="">Все статусы</option>{Object.entries(PHASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    </FilterBar>
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Организация', 'Тариф', 'Цена по подписке', 'Статус', 'Начало', 'Окончание', 'Действия']}>{rows.map((s) => (
      <tr key={s.id}><td><button className="pf-link" onClick={() => onOpen(s.tenant_id)}>{s.name ?? s.slug}</button></td><td>{s.plan_code}</td><td>{kzt(s.price_kzt)} / {s.price_period_months} мес.</td><td><Badge phase={s.phase} /></td><td>{fmtDate(s.starts_at)}</td><td>{s.ends_at ? fmtDate(s.ends_at) : 'бессрочно'}</td>
        <td className="pf-actions">
          {s.ends_at && <button onClick={() => act(() => runSubAction(s.id, 'extend', { months: 1 }))}>+1 мес.</button>}
          <button onClick={() => setSubModal({type:'change_plan',subscription:s})}>Тариф</button>
          <button onClick={() => setSubModal({type:'set_dates',subscription:s})}>Даты</button>
          {['trial', 'active', 'grace'].includes(s.phase) && <button onClick={() => setSubModal({type:'suspend',subscription:s})}>Приостановить</button>}
          {['suspended', 'expired'].includes(s.phase) && <button onClick={() => act(() => resumeFlow(s.id))}>Возобновить</button>}
        </td></tr>))}</Table>}
    {data&&(rows.length>0||page>0)&&<nav className='admin-service-pagination' aria-label='Подписки'><button className='admin-page-button' disabled={page===0||loading} onClick={()=>setPage(page-1)}>Назад</button><span className='muted small'>Страница <b>{page+1}</b></span><button className='admin-page-button' disabled={!hasNext||loading} onClick={()=>setPage(page+1)}>Далее</button></nav>}</>);
}

/* ----------------------------------------------------------------------------------- тарифы */
export function Plans() {
  const { data, err, loading, reload } = useLoad<Row[]>('plans');
  const [msg, setMsg] = useState('');
  const save = async (p: Row, patch: Row) => { setMsg(''); try { await call('plan_save', { plan: { id: p.id, ...patch } }); await reload(); } catch (e) { setMsg(errText(e)); throw e; } };
  return (<><State err={err} loading={loading && !data} />{msg && <p className="err">{msg}</p>}
    <p className="muted small">При изменении цены или периода всем владельцам организаций с активной подпиской появится предложение в кабинете. Нужно уведомить за 30 дней; новые условия начнут действовать после принятия и указанной даты. При отказе сохраняются прежние условия.</p>
    {data?.map((p) => <PlanRow key={p.id} p={p} onSave={(patch) => save(p, patch)} />)}</>);
}
function PlanRow({ p, onSave }: { p: Row; onSave: (patch: Row) => void | Promise<void> }) {
  const [name, setName] = useState<string>(p.name); const [price, setPrice] = useState<string>(String(p.price_kzt)); const [desc, setDesc] = useState<string>(p.description ?? ''); const [editing,setEditing]=useState(false); const [busy,setBusy]=useState(false);
  const [features, setFeatures] = useState<string>((p.features as string[]).join(', '));
  const [limits,setLimits]=useState<Row>(p.limits??{}); const [featureAccess,setFeatureAccess]=useState<Row>(p.feature_access??{telegram:true,export:true,reviews:true});
  const setLimit=(key:string,value:string)=>setLimits((prev:Row)=>({...prev,[key]:value===''?null:Number(value)}));
  const limitFields:[string,string][]=[['employees','Сотрудники'],['services','Услуги'],['branches','Филиалы'],['bookings_per_month','Записи в месяц']];
  const accessFields:[string,string][]=[['telegram','Telegram'],['export','Экспорт ZIP'],['reviews','Отзывы']];
  const patch=()=>({name:name.trim(),price_kzt:Number(price),description:desc.trim(),features:features.split(',').map((x)=>x.trim()).filter(Boolean),limits:Object.fromEntries(limitFields.map(([key])=>[key,limits[key]===''?null:(limits[key]===undefined?(p.limits?.[key]??null):Number(limits[key]))])),feature_access:featureAccess});
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!name.trim()||!Number.isFinite(Number(price))||Number(price)<0||!Number.isInteger(Number(price)))return;setBusy(true);try{await onSave(patch());setEditing(false)}catch{/* ошибка показана в Plans, окно остаётся открытым */}finally{setBusy(false)}};
  return <>
    <section className="card col"><div className="row between wrap"><div><b>{p.code} · {name}</b><p className="muted small">{Number(price).toLocaleString('ru-RU')} ₸ / {p.period_months} мес. · {p.is_active?'Активен':'Выключен'}</p></div><div className="row wrap"><label className="pf-check"><input type="checkbox" checked={p.is_active} onChange={(e) => { void Promise.resolve(onSave({ is_active: e.target.checked })).catch(() => {}); }} /> Активен</label><button className="btn inline" onClick={()=>setEditing(true)}>Изменить тариф</button></div></div></section>
    {editing&&<div className="pf-modal-backdrop"><form className="pf-modal card col" role="dialog" aria-modal="true" aria-labelledby={`plan-title-${p.id}`} onSubmit={e=>void submit(e)}><h2 id={`plan-title-${p.id}`}>Изменить тариф {p.code}</h2><label className="pf-label">Название<input className="field" required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><label className="pf-label">Цена, ₸ за период<input className="field" type="number" min={0} step={1} required value={price} onChange={e=>setPrice(e.target.value)}/></label><label className="pf-label">Описание<textarea className="field" rows={2} maxLength={1000} value={desc} onChange={e=>setDesc(e.target.value)}/></label><label className="pf-label">Возможности через запятую<input className="field" maxLength={1000} value={features} onChange={e=>setFeatures(e.target.value)}/></label><b>Лимиты тарифа</b><p className="muted small">Пустое значение означает «без ограничений».</p><div className="pf-plan-limits">{limitFields.map(([key,label])=><label key={key} className="pf-label">{label}<input className="field" type="number" min={1} step={1} value={limits[key]??''} onChange={e=>setLimit(key,e.target.value)} placeholder="Без ограничений"/></label>)}</div><b>Доступ к функциям</b><div className="row wrap">{accessFields.map(([key,label])=><label key={key} className="pf-check"><input type="checkbox" checked={featureAccess[key]!==false} onChange={e=>setFeatureAccess((prev:Row)=>({...prev,[key]:e.target.checked}))}/>{label}</label>)}</div><div className="row wrap"><button className="pf-action-primary" disabled={busy||!name.trim()||!Number.isInteger(Number(price))||Number(price)<0}>{busy?'Сохраняем…':'Сохранить тариф'}</button><button type="button" className="pf-action-secondary" disabled={busy} onClick={()=>setEditing(false)}>Отмена</button></div></form></div>}
  </>;
}

export function BillingDocuments(){
  const {data:docs,err,loading,reload}=useLoad<Row[]>('billing_documents');
  const tenants=useLoad<Row[]>('tenants',{limit:200});
  const today=new Date().toISOString().slice(0,10);
  const [f,setF]=useState<Row>({tenant_id:'',document_type:'invoice',number:'',issue_date:today,service_from:today,service_to:today,amount_kzt:0,description:'Подписка Renvio',status:'draft',esf_status:'not_issued',esf_number:''});
  const [msg,setMsg]=useState('');
  const save=async(e:FormEvent)=>{e.preventDefault();setMsg('');try{await call('billing_document_save',{document:{...f,amount_kzt:Number(f.amount_kzt),seller:{name:'Renvio',country:'Казахстан'},buyer:{tenant_id:f.tenant_id}}});setMsg('Документ сохранён. Это внутренний документ, не официальная ЭСФ.');await reload()}catch(e){setMsg(errText(e))}};
  const print=(d:Row)=>{const w=window.open('','_blank');if(!w)return;w.document.write(`<meta charset="utf-8"><title>${d.document_type==='invoice'?'Счёт':'Акт'} ${d.number}</title><h1>${d.document_type==='invoice'?'Счёт на оплату':'Акт оказанных услуг'}</h1><p>№ ${d.number} от ${fmtDate(d.issue_date)}</p><p>Исполнитель: Renvio, Казахстан</p><p>Заказчик: ${d.tenant_slug??d.tenant_id}</p><p>Период: ${fmtDate(d.service_from)} — ${fmtDate(d.service_to)}</p><p>${d.description}</p><h2>${kzt(d.amount_kzt)}</h2><p>ЭСФ: ${d.esf_number??'не оформлена'} · ${d.esf_status}</p><small>Печатная форма Renvio не является официальной ЭСФ.</small><script>window.print()</script>`);w.document.close()};
  return <div className="col"><section className="card col"><h2>Счета и акты</h2><p className="muted small">Внутренние документы по подписке. ЭСФ оформляется отдельно в государственной ИС ЭСФ.</p><form className="col" onSubmit={save}><select className="field" required value={f.tenant_id} onChange={e=>setF({...f,tenant_id:e.target.value})}><option value="">Организация</option>{tenants.data?.map(t=><option key={t.id} value={t.id}>{t.name??t.slug}</option>)}</select><select className="field" value={f.document_type} onChange={e=>setF({...f,document_type:e.target.value})}><option value="invoice">Счёт</option><option value="act">Акт</option></select><input className="field" required placeholder="Номер документа" value={f.number} onChange={e=>setF({...f,number:e.target.value})}/><div className="row wrap">{(['issue_date','service_from','service_to'] as const).map((key)=><label className="pf-label" key={key}>{key==='issue_date'?'Дата документа':key==='service_from'?'Услуги с':'Услуги по'}<input className="field" type="date" value={f[key]} onChange={e=>setF({...f,[key]:e.target.value})}/></label>)}</div><input className="field" type="number" min="0" value={f.amount_kzt} onChange={e=>setF({...f,amount_kzt:e.target.value})}/><input className="field" placeholder="Описание услуг" value={f.description} onChange={e=>setF({...f,description:e.target.value})}/><input className="field" placeholder="Номер ЭСФ из ИС ЭСФ (если есть)" value={f.esf_number} onChange={e=>setF({...f,esf_number:e.target.value,esf_status:e.target.value?'issued':'not_issued'})}/><button className="btn">Сохранить документ</button></form>{msg&&<p className="muted small">{msg}</p>}</section><State err={err} loading={loading&&!docs}/>{docs&&<Table head={['Тип / номер','Организация','Период','Сумма','ЭСФ','Действия']}>{docs.map(d=><tr key={d.id}><td>{d.document_type==='invoice'?'Счёт':'Акт'} №{d.number}</td><td>{d.tenant_id}</td><td>{fmtDate(d.service_from)} — {fmtDate(d.service_to)}</td><td>{kzt(d.amount_kzt)}</td><td>{d.esf_number??'—'} · {d.esf_status}</td><td><button onClick={()=>print(d)}>Печать</button></td></tr>)}</Table>}</div>
}

/* ----------------------------------------------------------------------------------- платежи */
export function Payments() {
  const filters = usePlatformFilters('platform-payments-filters', { status: '' });
  const { status } = filters.applied;
  const [page,setPage]=useState(0); const pageSize=50;
  useEffect(()=>setPage(0),[filters.applied]);
  const { data, err, loading, reload } = useLoad<Row[]>('payments',{status:status||undefined,limit:pageSize+1,offset:page*pageSize},[page,filters.applied]);
  const rows=(data??[]).slice(0,pageSize); const hasNext=(data?.length??0)>pageSize;
  const tenants = useAllTenants();
  const [msg, setMsg] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<Row>({ tenant_id: '', amount_kzt: '', period_start: today, period_end: '', method: 'kaspi', received_at: today, note: '' });
  const key = useRef(newKey()); const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setMsg('');
    try {
      await call('payment_create', { tenant_id: f.tenant_id, idempotency_key: key.current, payment: { amount_kzt: Number(f.amount_kzt), period_start: iso(f.period_start), period_end: iso(f.period_end), method: f.method, received_at: iso(f.received_at), note: f.note } });
      key.current = newKey(); await reload();
    } catch (e2) { setMsg(errText(e2)); } finally { setBusy(false); }
  };
  const act = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(errText(e)); } };
  const exportCsv=async()=>{setMsg('');try{const all=await exportAllRows<Row>('payments',{status:status||undefined});downloadCsv('payments.csv',['Дата','Организация','Slug','Сумма KZT','Период с','Период по','Метод','Статус'],all.map(p=>[p.received_at,p.name,p.slug,p.amount_kzt,p.period_start,p.period_end,p.method,p.status]))}catch(e){setMsg(errText(e))}};
  return (<>
    <form className="card col pf-form" onSubmit={create}><h2>Новый платёж</h2>
      <select className="field" value={f.tenant_id} onChange={(e) => setF({ ...f, tenant_id: e.target.value })} required><option value="">Организация…</option>{tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.slug}</option>)}</select>
      <input className="field" type="number" min={1} placeholder="Сумма, ₸" value={f.amount_kzt} onChange={(e) => setF({ ...f, amount_kzt: e.target.value })} required />
      <label className="pf-label">Период с<input className="field" type="date" value={f.period_start} onChange={(e) => setF({ ...f, period_start: e.target.value })} required /></label>
      <label className="pf-label">Период по<input className="field" type="date" value={f.period_end} onChange={(e) => setF({ ...f, period_end: e.target.value })} required /></label>
      <select className="field" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <label className="pf-label">Дата получения<input className="field" type="date" value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} required /></label>
      <button className="btn" disabled={busy}>Создать (статус «Ожидает»)</button></form>
    <FilterBar filters={filters} storageKey="платежей" onExport={()=>void exportCsv()}>
      <select className="field" aria-label="Статус платежа" value={filters.draft.status} onChange={e=>filters.set('status',e.target.value)}><option value="">Все платежи</option><option value="pending">Ожидает</option><option value="paid">Оплачен</option><option value="failed">Не прошёл</option><option value="refunded">Возврат</option></select>
    </FilterBar>
    {msg && <p className="err">{msg}</p>}<State err={err} loading={loading && !data} />
    {data && <Table head={['Дата', 'Организация', 'Сумма', 'Заявка', 'Период', 'Способ', 'Статус', 'Действия']}>{rows.map((p) => (
      <tr key={p.id}><td>{fmtDate(p.received_at)}</td><td>{p.name ?? p.slug}</td><td>{kzt(p.amount_kzt)}</td><td>{p.plan_code ? `${p.plan_code} × ${p.period_months} мес.` : '—'}</td><td>{fmtDate(p.period_start)} — {fmtDate(p.period_end)}</td><td>{METHODS[p.method] ?? p.method}</td>
        <td><Badge phase={p.status} />{p.refund_reason && <div className="muted small">{p.refund_reason}</div>}</td>
        <td className="pf-actions">
          {p.status === 'pending' && <button onClick={() => { if (window.confirm(p.plan_code ? `Подтвердить ${kzt(p.amount_kzt)} и активировать ${p.plan_code} на ${p.period_months} мес.?` : `Подтвердить получение ${kzt(p.amount_kzt)}?`)) void act(() => call('payment_confirm', { payment_id: p.id })); }}>{p.plan_code ? 'Подтвердить и активировать' : 'Подтвердить'}</button>}
          {p.status === 'pending' && <button onClick={() => act(() => call('payment_fail', { payment_id: p.id }))}>Не прошёл</button>}
          {p.status === 'paid' && <button onClick={() => { const r = window.prompt('Причина возврата (обязательно):'); if (r?.trim() && window.confirm('Подтвердить возврат ' + kzt(p.amount_kzt) + '?')) void act(() => call('payment_refund', { payment_id: p.id, reason: r.trim() })); }}>Возврат</button>}
        </td></tr>))}</Table>}{data&&(rows.length>0||page>0)&&<nav className='admin-service-pagination' aria-label='Платежи'><button className='admin-page-button' disabled={page===0||loading} onClick={()=>setPage(page-1)}>Назад</button><span className='muted small'>Страница <b>{page+1}</b></span><button className='admin-page-button' disabled={!hasNext||loading} onClick={()=>setPage(page+1)}>Далее</button></nav>}</>);
}
