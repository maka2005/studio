import { useState } from 'react'
import { ownerRequest } from '../../lib/ownerSession'
import { supabase } from '../../lib/supabase'
import { PasswordInput } from '../../components/PasswordInput'

export function SetInitialPassword() {
  const [password,setPassword]=useState(''); const [confirm,setConfirm]=useState(''); const [msg,setMsg]=useState(''); const [busy,setBusy]=useState(false)
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setMsg('');if(password.length<10){setMsg('Придумайте пароль не короче 10 символов.');return}if(password!==confirm){setMsg('Пароли не совпадают.');return}setBusy(true);try{await ownerRequest('password',{password});window.location.reload()}catch{setMsg('Не удалось изменить пароль. Проверьте соединение и повторите.')}finally{setBusy(false)}}
  return <div className="page admin-login-page"><form className="login-wrap admin-login" onSubmit={(e)=>void submit(e)}><div className="login-ico"><LockIcon/></div><h1>Задайте свой пароль</h1><p className="muted">Это нужно сделать при первом входе. Временный пароль больше не понадобится.</p><label className="muted small">Новый пароль</label><PasswordInput className="field" minLength={10} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required/><label className="muted small">Повторите пароль</label><PasswordInput className="field" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/>{msg&&<p className="err" role="alert">{msg}</p>}<button className="btn" disabled={busy}>{busy?'Сохраняем…':'Сохранить пароль'}</button></form></div>
}

const LockIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor" />
    <circle cx="12" cy="15.5" r="1.4" fill="#141518" />
    <path d="M12 16v2" stroke="#141518" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

export function Login({ slug }: { slug: string }) {
  const [orgs, setOrgs] = useState<{ slug: string; name: string }[] | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recovering,setRecovering]=useState(false)
  const [mailMessage,setMailMessage]=useState('');const [mailBusy,setMailBusy]=useState(false);const [recoveryEmail,setRecoveryEmail]=useState('')
  const sendResetMail = async () => {
    setMailMessage(''); setMailBusy(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail.trim(), { redirectTo: `${window.location.origin}${window.location.pathname}` })
      setMailMessage(error && /rate|seconds|limit/i.test(error.message) ? 'Слишком часто. Подождите минуту и повторите.' : 'Если такая почта есть в системе, мы отправили на неё ссылку для установки пароля. Проверьте входящие и папку «Спам».')
    } catch { setMailMessage('Не удалось отправить письмо. Проверьте соединение и повторите.') } finally { setMailBusy(false) }
  }
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const body = await ownerRequest<{error?:string}>('login',{email:email.trim(),password,slug})
      if (body?.error === 'rate_limited') setErr('Слишком много попыток входа. Подождите 15 минут и попробуйте снова.')
      else if (body?.error === 'bad_credentials') setErr('Неверная почта или пароль.')
      else if (!body || body.error) setErr('Не удалось войти. Проверьте соединение и повторите позже.')
      else {
        const oldSession = (await supabase.auth.getSession()).data.session
        if (oldSession?.user.email?.toLowerCase() === email.trim().toLowerCase()) await supabase.auth.signOut({ scope: 'local' })
        window.dispatchEvent(new Event('owner-session-changed'))
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : ''
      if (reason === 'wrong_organization') {
        const list = (error as { payload?: { organizations?: { slug: string; name: string }[] } }).payload?.organizations
        setOrgs(Array.isArray(list) ? list : [])
        setErr('Эта почта не привязана к данной организации.')
      }
      else if (reason === 'bad_credentials') setErr('Неверная почта или пароль.')
      else if (reason === 'rate_limited') setErr('Слишком много попыток входа. Подождите 15 минут и попробуйте снова.')
      else setErr('Не удалось связаться с сервером. Проверьте интернет и повторите.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page admin-login-page">
      <form className="login-wrap admin-login" onSubmit={(e) => { e.preventDefault(); if(recovering)void sendResetMail(); else void submit() }}>
        <div className="login-ico">
          <LockIcon />
        </div>
        <h1>Кабинет студии</h1>
        <p className="muted">Войдите, чтобы управлять записями</p>
        <label className="muted small" htmlFor="em">
          Почта
        </label>
        <input
          id="em"
          className="field"
          type="email"
          required
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="muted small" htmlFor="pw">
          Пароль
        </label>
        <PasswordInput
          id="pw"
          className="field"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && (
          <p role="alert" className="err">
            {err}
          </p>
        )}
        {orgs && orgs.length > 0 && (
          <div className="col" role="status">
            <p className="muted small">Ваш аккаунт привязан к:</p>
            {orgs.map((o) => <a key={o.slug} className="link" href={`/s/${encodeURIComponent(o.slug)}/owner`}>{o.name} →</a>)}
          </div>
        )}
        <button
          className="btn"
          disabled={busy || !email || !password}
          type="submit"
        >
          {busy ? 'Входим…' : 'Войти'}
        </button>
        <button type="button" className="link forgot-link" onClick={()=>{setRecovering(!recovering);setMailMessage('');if(!recovering&&email&&!recoveryEmail)setRecoveryEmail(email)}}>{recovering?'← Назад ко входу':'Забыли пароль?'}</button>
        {recovering&&<div className="col reset-panel"><p className="muted small">Укажите почту аккаунта — мы отправим на неё ссылку для установки нового пароля.</p><input className="field" type="email" required autoComplete="email" placeholder="Почта аккаунта" value={recoveryEmail} onChange={e=>setRecoveryEmail(e.target.value)}/><button type="button" onClick={()=>void sendResetMail()} className="btn" disabled={!recoveryEmail||mailBusy}>{mailBusy?'Отправляем…':'Отправить ссылку на почту'}</button>{mailMessage&&<p className="muted small" role="status">{mailMessage}</p>}</div>}
      </form>
    </div>
  )
}
