import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { PasswordInput } from './PasswordInput'
import '../pages/owner-login.css'

const Lock = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor" />
  </svg>
)

// Экран по ссылке из письма «Задать пароль» / «Забыли пароль» (кабинет владельца и админка платформы).
export function RecoveryPassword({ failed, signIn, onDone }: { failed: boolean; signIn: (email: string, password: string) => Promise<unknown>; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg('')
    if (password.length < 10) { setMsg('Придумайте пароль не короче 10 символов.'); return }
    if (password !== confirm) { setMsg('Пароли не совпадают.'); return }
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const email = session?.user.email
      if (!email) { setMsg('Ссылка устарела или уже использована. Вернитесь ко входу и запросите новую через «Забыли пароль?».'); return }
      const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } })
      if (error) {
        setMsg(/different|same/i.test(error.message) ? 'Новый пароль должен отличаться от прежнего.' : 'Не удалось задать пароль. Запросите новую ссылку через «Забыли пароль?».')
        return
      }
      try { await signIn(email, password) } catch { /* войдёт вручную */ }
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      window.dispatchEvent(new Event('owner-session-changed'))
      onDone()
    } catch {
      setMsg('Не удалось сохранить пароль. Проверьте соединение и повторите.')
    } finally { setBusy(false) }
  }

  if (failed) {
    return (
      <div className="page admin-login-page"><div className="login-wrap admin-login">
        <div className="login-ico"><Lock /></div>
        <h1>Ссылка недействительна</h1>
        <p className="muted">Ссылка из письма устарела или уже использовалась. Перейдите ко входу и нажмите «Забыли пароль?», чтобы получить новую.</p>
        <button className="btn" type="button" onClick={onDone}>Перейти ко входу</button>
      </div></div>
    )
  }
  return (
    <div className="page admin-login-page"><form className="login-wrap admin-login" onSubmit={(e) => void submit(e)}>
      <div className="login-ico"><Lock /></div>
      <h1>Задайте пароль</h1>
      <p className="muted">Придумайте пароль для входа в Renvio. Он должен быть не короче 10 символов.</p>
      <label className="muted small" htmlFor="np1">Новый пароль</label>
      <PasswordInput id="np1" className="field" minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <label className="muted small" htmlFor="np2">Повторите пароль</label>
      <PasswordInput id="np2" className="field" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      {msg && <p className="err" role="alert">{msg}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить пароль и войти'}</button>
    </form></div>
  )
}
