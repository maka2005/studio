import { useEffect, useState } from 'react'
import './toaster.css'

type Kind = 'ok' | 'warn' | 'err'
type Toast = { id: number; text: string; kind: Kind }

const EVENT = 'servio-toast'
let counter = 0

/** Показать всплывающее уведомление (в правом верхнем углу). */
export function notify(text: string, kind: Kind = 'ok') {
  window.dispatchEvent(new CustomEvent<Toast>(EVENT, { detail: { id: ++counter, text, kind } }))
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    const onToast = (e: Event) => {
      const toast = (e as CustomEvent<Toast>).detail
      setItems((list) => [...list.slice(-3), toast])
      window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== toast.id)), toast.kind === 'err' ? 9000 : 6000)
    }
    window.addEventListener(EVENT, onToast)
    return () => window.removeEventListener(EVENT, onToast)
  }, [])
  if (!items.length) return null
  return (
    <div className="sv-toasts" role="region" aria-label="Уведомления" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`sv-toast sv-toast--${t.kind}`} role={t.kind === 'err' ? 'alert' : 'status'}>
          <span className="sv-toast__text">{t.text}</span>
          <button type="button" className="sv-toast__close" aria-label="Закрыть" onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  )
}
