import { useState, type FormEvent } from 'react';
import { Logo } from '../../components/BrandMark';
import { PasswordInput } from '../../components/PasswordInput';
import { supabase } from '../../lib/supabase';
import { platformAuth } from './shared';

export function Login({ msg, onDone }: { msg: string; onDone: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(msg); const [busy, setBusy] = useState(false); const [info, setInfo] = useState('');
  const forgot = async () => {
    setErr(''); setInfo('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Введите свой email в поле выше, и мы отправим ссылку для нового пароля.'); return; }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/platform/admin` });
      if (error && /rate|seconds|limit/i.test(error.message)) setErr('Слишком часто. Подождите минуту и повторите.');
      else setInfo('Если такой аккаунт есть, мы отправили на почту ссылку для установки пароля. Проверьте входящие и папку «Спам».');
    } catch { setErr('Не удалось отправить письмо. Проверьте соединение и повторите.'); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try{await platformAuth('login',{email:email.trim(),password})}catch{setBusy(false);setErr('Неверный email или пароль.');return}
    setBusy(false);
    onDone();
  };
  return (
    <main className="page pf-login-page"><form className="card col pf-narrow" onSubmit={submit}><div className="pf-login-brand"><span><b className="pf-wordmark"><Logo height={12} /></b><small>Команда платформы</small></span></div><h1>Вход для команды</h1><p className="muted small">Здесь можно управлять организациями, оплатой и обращениями.</p>
      <input className="field" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <PasswordInput className="field" autoComplete="current-password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {err && <p className="err">{err}</p>}{info && <p className="muted small" role="status">{info}</p>}
      <button className="btn" disabled={busy}>Войти</button>
      <button type="button" className="link forgot-link" onClick={() => void forgot()}>Забыли пароль?</button></form></main>);
}

export function MfaVerify({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    const factors = await platformAuth('factors');
    const factor = factors?.factors?.totp?.[0]??factors?.totp?.[0];
    if (!factor) { setErr('Не удалось найти подтверждение для этого аккаунта.'); return; }
    try{await platformAuth('mfa_verify',{factor_id:factor.id,code:code.trim()});onDone()}catch{setErr('Неверный код.')}
  };
  return (
    <main className="page pf-login-page"><form className="card col pf-narrow" onSubmit={submit}><div className="pf-login-brand"><span><b className="pf-wordmark"><Logo height={12} /></b><small>Google Authenticator</small></span></div><h1>Подтвердите вход</h1><p className="muted small">Откройте Google Authenticator и введите шестизначный код для сервиса Renvio.</p>
      <input className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 цифр" value={code} onChange={(e) => setCode(e.target.value)} required />
      {err && <p className="err">{err}</p>}<button className="btn">Подтвердить</button></form></main>);
}

export function MfaEnroll({ onDone }: { onDone: () => void }) {
  const [info, setInfo] = useState<{ id: string; qr: string; secret: string } | null>(null); const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const start = async () => {
    try{const data=await platformAuth('mfa_enroll',{friendly_name:'renvio-'+Date.now()});setInfo({id:data.id,qr:data.totp.qr_code,secret:data.totp.secret})}catch{setErr('Не удалось начать настройку MFA.')}
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault(); if (!info) return; setErr('');
    try{await platformAuth('mfa_verify',{factor_id:info.id,code:code.trim()});onDone()}catch{setErr('Неверный код.')}
  };
  return (
    <main className="page pf-login-page"><section className="card col pf-narrow"><div className="pf-login-brand"><span><b className="pf-wordmark"><Logo height={12} /></b><small>Защищённый вход</small></span></div><h1>Защитите аккаунт</h1>
      <p className="muted">Чтобы защитить аккаунт, подключите приложение для кодов входа, например Google Authenticator или 1Password.</p>
      {!info ? <button className="btn" onClick={start}>Настроить</button> : (
        <form className="col" onSubmit={verify}><img src={info.qr} alt="QR-код для приложения-аутентификатора" width={200} height={200} />
          <p className="muted small">Или введите ключ вручную: <code>{info.secret}</code></p>
          <input className="field" inputMode="numeric" maxLength={6} placeholder="Код из приложения" value={code} onChange={(e) => setCode(e.target.value)} required />
          <button className="btn">Подтвердить</button></form>)}
      {err && <p className="err">{err}</p>}</section></main>);
}
