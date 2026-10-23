// Событие установки приходит один раз за загрузку страницы, поэтому его ловим глобально и храним.
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let evt: BIP | null = null;
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); evt = e as BIP; subs.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { evt = null; subs.forEach((f) => f()); });
}
export const installEvent = () => evt;
export const subscribeInstall = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
