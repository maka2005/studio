import { useCallback, useEffect, useState } from 'react';
import { RecoveryPassword } from '../components/RecoveryPassword';
import { Toaster } from '../components/Toaster';
import { recoveryLink, supabase } from '../lib/supabase';
import '../styles.css';
import './platform.css';
import { Login, MfaEnroll, MfaVerify } from './platform-admin/auth';
import { Console } from './platform-admin/console';
import { call, errText, platformAuth } from './platform-admin/shared';

// Админка платформы. Все данные приходят из Edge Function platform-admin, которая на сервере
// проверяет JWT, запись в platform_admins и (если включено) MFA. Проверки здесь — только удобство интерфейса.

/* ----------------------------------------------------------------------------------- вход, MFA */
type Step = 'loading' | 'login' | 'mfa' | 'enroll' | 'denied' | 'ready';

export function PlatformAdmin() {
  const [step, setStep] = useState<Step>('loading');
  const [msg, setMsg] = useState('');
  const [role, setRole] = useState('read_only');
  const [accountEmail, setAccountEmail] = useState('');
  const [recovery, setRecovery] = useState(recoveryLink.active || recoveryLink.failed);

  const check = useCallback(async () => {
    try {
      let me = await platformAuth('session');
      if(!me.user){
        const legacy=(await supabase.auth.getSession()).data.session;
        if(!legacy){setStep('login');return}
        try{await platformAuth('migrate',{access_token:legacy.access_token,refresh_token:legacy.refresh_token});await supabase.auth.signOut({scope:'local'});me=await platformAuth('session')}catch{await supabase.auth.signOut({scope:'local'});setStep('login');return}
      }
      if(!me.authorized){try{await call('bootstrap');void check();return}catch{setStep('denied');return}}
      setRole(String(me.role ?? 'read_only'));
      setAccountEmail(String(me.user.email ?? ''));
      if(me.mfa_required){const factors=await platformAuth('factors');if((factors?.factors?.totp??factors?.totp??[]).length){setStep('mfa');return}setStep('enroll');return}
      setStep('ready');
    } catch (e) {
      if ((e as Error).message === 'forbidden') {
        // Первый вход: сервер сам сверяет PLATFORM_SUPERADMIN_EMAIL и разрешает
        // bootstrap только пока platform_admins пустая.
        try {
          await call('bootstrap');
          setStep('loading');
          void check();
        } catch {
          setStep('denied');
        }
      }
      else { setMsg(errText(e)); setStep('login'); }
    }
  }, []);
  useEffect(() => { if (!recovery) void check(); }, [check, recovery]);

  if (recovery) {
    return <RecoveryPassword failed={!recoveryLink.active} signIn={(email, password) => platformAuth('login', { email, password })} onDone={() => {
      recoveryLink.active = false; recoveryLink.failed = false;
      window.history.replaceState(null, '', window.location.pathname);
      setStep('loading'); setRecovery(false);
    }} />;
  }

  if (step === 'loading') return <main className="page"><p className="muted">Загрузка…</p></main>;
  if (step === 'denied') return (
    <main className="page"><section className="card col"><h1>403</h1><p className="muted">У этого аккаунта нет доступа к платформе.</p>
      <button className="btn ghost" onClick={async () => { await platformAuth('logout'); setStep('login'); }}>Выйти</button></section></main>);
  if (step === 'login') return <Login msg={msg} onDone={check} />;
  if (step === 'mfa') return <MfaVerify onDone={check} />;
  if (step === 'enroll') return <MfaEnroll onDone={check} />;
  return <><Toaster /><Console role={role} accountEmail={accountEmail} onLogout={async () => { await platformAuth('logout'); setStep('login'); }} onMfa={() => setStep('mfa')} /></>;
}
