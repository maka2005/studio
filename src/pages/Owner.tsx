import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { ownerRequest, type OwnerUser } from '../lib/ownerSession'
import { recoveryLink } from '../lib/supabase'
import type { Ctx } from '../lib/tenant'
import { LoadingScreen } from '../components/LoadingScreen'
import { RecoveryPassword } from '../components/RecoveryPassword'
import { Login, SetInitialPassword } from './owner/auth'
import { Cabinet } from './owner/cabinet'
import './owner-login.css'
import './owner-media.css'
import './owner-admin.css'

export function Owner() {
  const { b } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const [recovery, setRecovery] = useState(recoveryLink.active || recoveryLink.failed)
  const sess = useQuery({
    queryKey: ['owner', 'session'],
    queryFn: async () => ownerRequest<{user:OwnerUser|null;impersonation?:{reason:string;expires_at:string;tenant_slug:string}}>('session',undefined,'GET'),
  })
  useEffect(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ['owner'] })
    }
    window.addEventListener('owner-session-changed', refresh)
    return () => window.removeEventListener('owner-session-changed', refresh)
  }, [qc])
  const logout = async () => {
    try {
      await ownerRequest('logout')
    } catch {
      // Перезагружаем кабинет и при временной ошибке ответа; серверная сессия
      // будет проверена заново на странице входа.
    } finally {
      qc.removeQueries({ queryKey: ['owner'] })
      window.location.assign(`/s/${encodeURIComponent(b.slug)}/owner`)
    }
  } // Завершаем сессию и возвращаем пользователя к форме входа.
  if (recovery) {
    return <RecoveryPassword failed={!recoveryLink.active} signIn={(email, password) => ownerRequest('login', { email, password, slug: b.slug })} onDone={() => {
      recoveryLink.active = false
      recoveryLink.failed = false
      window.history.replaceState(null, '', window.location.pathname)
      void qc.invalidateQueries({ queryKey: ['owner'] })
      setRecovery(false)
    }} />
  }
  if (sess.isPending) return <LoadingScreen label="Открываем кабинет…" />
  if (!sess.data?.user) return <Login slug={b.slug} />
  if (sess.data.user.user_metadata?.must_change_password === true) return <SetInitialPassword />
  return <Cabinet b={b} onLogout={logout} impersonation={sess.data.impersonation} />
}
