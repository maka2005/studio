import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { owner } from '../../lib/api'
import { errText } from '../../lib/api'
import { fromZonedTime } from 'date-fns-tz'
import type { Business } from '../../lib/tenant'
import { isAutoBusiness } from '../../lib/businessTypes'

export function TeamAccess({ b, canManageManagers = true }: { b: Business; canManageManagers?: boolean }) {
  const isAuto = isAutoBusiness(b.business_type)
  const qc=useQueryClient(); const people=useQuery({queryKey:['owner','team',b.slug],queryFn:()=>owner.team(b.slug,'list')});
  const resources=useQuery({queryKey:['owner','resources',b.slug],queryFn:()=>owner.resources(b.slug)});
  const [email,setEmail]=useState(''); const [role,setRole]=useState<'manager'|'staff'>('staff'); const [resource,setResource]=useState(''); const [notice,setNotice]=useState('');
  const [credentials,setCredentials]=useState<{email:string;password:string}|null>(null);
  const refresh=()=>{void qc.invalidateQueries({queryKey:['owner','team',b.slug]})};
  const create=useMutation({mutationFn:()=>owner.team(b.slug,'create',{email:email.trim(),role,resource_id:role==='staff'?resource:null}),onSuccess:(data)=>{setNotice(data.created?'Аккаунт создан. Передайте сотруднику временный пароль лично.':'Почта уже зарегистрирована: доступ выдан, сотрудник входит со своим паролем.');if(data.temporary_password)setCredentials({email:email.trim(),password:data.temporary_password});setEmail('');refresh()},onError:(e)=>setNotice(errText(e))});
  const save=useMutation({mutationFn:(x:{user_id:string;role:'manager'|'staff';resource_id:string|null})=>owner.team(b.slug,'set_role',x),onSuccess:()=>{setNotice('Доступ обновлён.');refresh()},onError:e=>setNotice(errText(e))});
  const remove=useMutation({mutationFn:(id:string)=>owner.team(b.slug,'remove',{user_id:id}),onSuccess:()=>{setNotice('Доступ сотрудника отозван.');refresh()},onError:e=>setNotice(errText(e))});
  const reset=useMutation({mutationFn:(id:string)=>owner.teamAction(b.slug,'reset_password',{user_id:id}),onSuccess:(data, id)=>{const member=people.data?.members.find(x=>x.user_id===id);if(data.temporary_password&&member)setCredentials({email:member.email,password:data.temporary_password});setNotice('Создан новый временный пароль. Старый пароль больше не действует.')},onError:e=>setNotice(errText(e))});
  return <div className="col"><div className="admin-subheading"><div><h2>Доступ сотрудников</h2><p className="muted small">Сотрудник входит по почте и паролю. Система не отправляет письма и коды.</p></div></div>
    <div className="card col"><b>Добавить сотрудника</b><label className="muted small">Почта сотрудника</label><input className="field" type="email" autoComplete="off" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/>
      <label className="muted small">Роль</label><select className="field" value={role} onChange={e=>setRole(e.target.value as 'manager'|'staff')}><option value="staff">{isAuto ? 'Сотрудник — только свой пост и записи' : 'Сотрудник — только свои записи'}</option>{canManageManagers&&<option value="manager">Менеджер — записи и рабочие разделы</option>}</select>
      {role==='staff'&&<><label className="muted small">{isAuto ? 'Рабочий пост' : 'Специалист'}</label><select className="field" value={resource} onChange={e=>setResource(e.target.value)}><option value="">{isAuto ? 'Выберите пост' : 'Выберите специалиста'}</option>{resources.data?.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></>}
      {notice&&<p className="muted small" role="status">{notice}</p>}
      {credentials&&<div className="card col"><b>Временный пароль — сохраните сейчас</b><span>Логин: {credentials.email}</span><code>{credentials.password}</code><p className="muted small">Показывается только один раз. Передайте пароль лично. При первом входе сотрудник задаст новый.</p><button className="btn ghost mini" onClick={async()=>{try{await navigator.clipboard.writeText(`Логин: ${credentials.email}\nВременный пароль: ${credentials.password}`);setCredentials(null);setNotice('Данные скопированы. Передайте их сотруднику лично.')}catch{setNotice('Скопируйте пароль вручную и передайте сотруднику лично.')}}}>Скопировать и скрыть</button></div>}
      <button className="btn mini" disabled={create.isPending||!email.trim()||(role==='staff'&&!resource)} onClick={()=>{setNotice('');setCredentials(null);create.mutate()}}>{create.isPending?'Создаём аккаунт…':'Создать доступ'}</button>
    </div>
    <div className="admin-list-heading"><div><h2>Сотрудники</h2></div><button className="btn ghost mini" onClick={refresh}>Обновить</button></div>
    {people.isPending?<p className="muted">Загружаем…</p>:people.isError?<p className="err">Не удалось загрузить сотрудников. <button className="link" onClick={()=>void people.refetch()}>Повторить</button></p>:(people.data?.members??[]).length===0?<p className="muted">Пока нет добавленных сотрудников.</p>:(people.data?.members??[]).map(m=><TeamMemberRow key={m.user_id} member={m} resources={resources.data??[]} canManageManagers={canManageManagers} isAuto={isAuto} onSave={x=>save.mutate(x)} onRemove={()=>{if(window.confirm(`Отозвать доступ для ${m.email}?`))remove.mutate(m.user_id)}} onReset={()=>reset.mutate(m.user_id)} busy={save.isPending||remove.isPending||reset.isPending}/>)}
  </div>
}
function TeamMemberRow({member,resources,onSave,onRemove,onReset,canManageManagers,busy,isAuto}:{member:{user_id:string;email:string;role:'manager'|'staff';resource_id:string|null;resource_name:string|null};resources:{id:string;name:string}[];onSave:(x:{user_id:string;role:'manager'|'staff';resource_id:string|null})=>void;onRemove:()=>void;onReset:()=>void;canManageManagers:boolean;busy:boolean;isAuto:boolean}){
  const [role,setRole]=useState(member.role);const [resource,setResource]=useState(member.resource_id??'');
  return <div className="card col"><b>{member.email}</b><div className="row wrap"><select className="field" value={role} onChange={e=>setRole(e.target.value as 'manager'|'staff')}><option value="staff">Сотрудник</option>{canManageManagers&&<option value="manager">Менеджер</option>}</select>{role==='staff'&&<select className="field" value={resource} onChange={e=>setResource(e.target.value)}><option value="">{isAuto ? 'Выберите пост' : 'Выберите специалиста'}</option>{resources.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>}<button className="btn ghost mini" disabled={busy||(role==='staff'&&!resource)} onClick={()=>onSave({user_id:member.user_id,role,resource_id:role==='staff'?resource:null})}>Сохранить</button><button className="btn ghost mini" disabled={busy} onClick={onReset}>Выдать новый пароль</button><button className="btn danger mini" disabled={busy} onClick={onRemove}>Отозвать доступ</button></div></div>
}

export function TeamResources({b}:{b:Business}) {
  const qc=useQueryClient();
  const q=useQuery({queryKey:['owner','resources',b.slug],queryFn:()=>owner.resources(b.slug)});
  const [name,setName]=useState('');
  const [msg,setMsg]=useState<string|null>(null);
  const [saved,setSaved]=useState(false);
  const [blockResource,setBlockResource]=useState('');
  const [blockFrom,setBlockFrom]=useState('');
  const [blockTo,setBlockTo]=useState('');
  const [blockMsg,setBlockMsg]=useState<string|null>(null);
  const [blockOk,setBlockOk]=useState(false);
  const refresh=()=>{void qc.invalidateQueries({queryKey:['owner','resources',b.slug]});void qc.invalidateQueries({queryKey:['owner','bookings',b.slug]});void qc.invalidateQueries({queryKey:['owner','report-bookings',b.slug]});void qc.invalidateQueries({queryKey:['slots',b.slug]})};
  const add=useMutation({mutationFn:()=>owner.upsertResource(b.slug,null,name.trim()),onSuccess:()=>{setName('');setMsg(null);setSaved(true);refresh()},onError:e=>{setSaved(false);setMsg(errText(e))}});
  const block=useMutation({mutationFn:()=>{
    if(!blockResource||!blockFrom||!blockTo) throw new Error('bad_range');
    const start=fromZonedTime(blockFrom,b.timezone).toISOString();
    const end=fromZonedTime(blockTo,b.timezone).toISOString();
    return owner.block(b.slug,blockResource,start,end);
  },onSuccess:()=>{setBlockMsg(null);setBlockOk(true);setBlockFrom('');setBlockTo('');refresh()},onError:e=>{setBlockOk(false);setBlockMsg(errText(e))}});
  const isAuto = isAutoBusiness(b.business_type)
  return <div className="col">
    <div className="admin-subheading"><div><h2>{isAuto ? 'Команда и посты' : 'Команда и специалисты'}</h2><p className="muted small">{isAuto ? 'Рабочие места и мастера, к которым привязываются записи и доступность.' : 'Специалисты, к которым привязываются записи и доступность.'}</p></div></div>
    {q.isPending?<p className="muted">Загрузка…</p>:q.isError?<p className="err">Не удалось загрузить ресурсы. <button className="link" onClick={()=>void q.refetch()}>Повторить</button></p>:q.data.map((r)=><TeamResourceRow key={r.id} b={b} resource={r} onSaved={refresh}/>)}
    <div className="card col">
      <b>{isAuto ? 'Добавить рабочее место' : 'Добавить специалиста'}</b>
      <input className="field" maxLength={80} placeholder={isAuto ? 'Например: Пост 1' : 'Например: Мастер 1'} value={name} onChange={e=>{setName(e.target.value);setSaved(false);setMsg(null)}}/>
      {msg&&<p className="err small">{msg}</p>}
      {saved&&<p className="muted small" role="status">Добавлено.</p>}
      <button className="btn" disabled={add.isPending||!name.trim()} onClick={()=>add.mutate()}>{add.isPending?'Добавление…':'Добавить'}</button>
    </div>
    <div className="card col">
      <b>Отпуск / блокировка времени мастера</b>
      <p className="muted small">Заблокируйте период недоступности мастера/поста (отпуск, выходной, личное время). В это время слоты не предлагаются клиентам.</p>
      <label className="muted small">Мастер / пост</label>
      <select className="field" value={blockResource} onChange={e=>{setBlockResource(e.target.value);setBlockOk(false);setBlockMsg(null)}}>
        <option value="">Выберите ресурс</option>
        {(q.data??[]).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <div className="row wrap" style={{gap:8}}>
        <label className="col muted small">Начало<input className="field" type="datetime-local" value={blockFrom} onChange={e=>{setBlockFrom(e.target.value);setBlockOk(false)}} /></label>
        <label className="col muted small">Конец<input className="field" type="datetime-local" value={blockTo} onChange={e=>{setBlockTo(e.target.value);setBlockOk(false)}} /></label>
      </div>
      {blockMsg&&<p className="err small">{blockMsg}</p>}
      {blockOk&&<p className="muted small" role="status">Блокировка добавлена.</p>}
      <button className="btn ghost" disabled={block.isPending||!blockResource||!blockFrom||!blockTo} onClick={()=>block.mutate()}>{block.isPending?'Сохранение…':'Заблокировать время'}</button>
    </div>
  </div>
}

function TeamResourceRow({b,resource,onSaved}:{b:Business;resource:{id:string;name:string};onSaved:()=>void}) {
  const [name,setName]=useState(resource.name);const [msg,setMsg]=useState<string|null>(null);
  const save=useMutation({mutationFn:()=>owner.upsertResource(b.slug,resource.id,name.trim()),onSuccess:()=>{setMsg(null);onSaved()},onError:e=>setMsg(errText(e))});
  const remove=useMutation({mutationFn:()=>owner.deleteResource(b.slug,resource.id),onSuccess:()=>{setMsg(null);onSaved()},onError:e=>setMsg(errText(e))});
  return <div className="card col"><div className="row wrap"><input className="field" aria-label="Название рабочего ресурса" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/><button className="btn ghost mini" disabled={save.isPending||name.trim()===resource.name||!name.trim()} onClick={()=>save.mutate()}>{save.isPending?'Сохраняем…':'Сохранить'}</button><button className="btn ghost mini" disabled={remove.isPending} onClick={()=>{if(window.confirm(`Удалить «${resource.name}»?`))remove.mutate()}}>{remove.isPending?'Удаляем…':'Удалить'}</button></div>{msg&&<p className="err small" role="alert">{msg}</p>}</div>
}

export function MyAccess({b}:{b:Business}){
 const [key,setKey]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false)
 const create=async()=>{setBusy(true);setMessage('');try{const result=await owner.teamAction(b.slug,'enroll_recovery');setKey(result.recovery_key??'');setMessage('Ключ создан. Сохраните его в надёжном месте — при следующем создании старый ключ перестанет работать.')}catch{setMessage('Не удалось создать ключ восстановления. Повторите позже.')}finally{setBusy(false)}}
 return <div className="col"><div className="admin-subheading"><div><h2>Мой доступ</h2><p className="muted small">Создайте резервный ключ, чтобы восстановить пароль без писем и кодов.</p></div></div><div className="card col"><b>Восстановление аккаунта</b><p className="muted small">Ключ показывается только один раз. Если потеряете пароль и ключ, владелец или менеджер сможет выдать временный пароль. Владельцу без другого администратора поможет администратор проекта.</p>{message&&<p className="muted small" role="status">{message}</p>}{key&&<div className="card col"><code>{key}</code><button className="btn ghost mini" onClick={async()=>{try{await navigator.clipboard.writeText(key);setKey('');setMessage('Ключ скопирован. Сохраните его в надёжном месте.')}catch{setMessage('Скопируйте ключ вручную и сохраните в надёжном месте.')}}}>Скопировать и скрыть</button></div>}<button className="btn mini" disabled={busy} onClick={()=>void create()}>{busy?'Создаём…':'Создать или заменить ключ'}</button></div></div>
}
