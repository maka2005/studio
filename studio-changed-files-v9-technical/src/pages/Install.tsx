import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { assetUrl, type Ctx } from '../lib/tenant';
import { ArrowLeft, Copy, Download } from '../lib/icons';
import { installEvent, isStandalone, subscribeInstall } from '../lib/install';
import './install.css';

type Platform = 'ios' | 'android' | 'desktop';
const LABEL: Record<Platform, string> = { ios: 'iPhone / iPad', android: 'Android', desktop: 'Компьютер' };
const detect = (): Platform => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return /Android/.test(ua) ? 'android' : 'desktop';
};
const Ic = ({ d }: { d: string }) => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>);
const SHARE = 'M12 15V3M8 7l4-4 4 4M5 12v8h14v-8', DOTS = 'M12 5h.01M12 12h.01M12 19h.01', PLUS = 'M4 4h16v16H4zM12 8v8M8 12h8', OK = 'M5 12l5 5 9-10', DL = 'M12 4v11M7 11l5 5 5-5M5 20h14', HOME = 'M3 11l9-8 9 8M5 10v10h14V10';
const STEPS: Record<Platform, { icon: ReactNode; title: string; text: string }[]> = {
  ios: [
    { icon: <Ic d={HOME} />, title: 'Откройте сайт в Safari', text: 'Так пункт установки гарантированно есть. В других браузерах на iPhone он может отсутствовать.' },
    { icon: <Ic d={SHARE} />, title: 'Нажмите «Поделиться»', text: 'Значок квадрата со стрелкой на нижней или верхней панели Safari.' },
    { icon: <Ic d={PLUS} />, title: 'Выберите «На экран «Домой»»', text: 'Нажмите «Добавить». Иконка студии появится среди приложений и будет открываться без адресной строки.' },
  ],
  android: [
    { icon: <Ic d={HOME} />, title: 'Откройте сайт в Chrome', text: 'Другие браузеры тоже подойдут, но порядок пунктов меню может отличаться.' },
    { icon: <Ic d={DOTS} />, title: 'Откройте меню браузера', text: 'Три точки в правом верхнем углу.' },
    { icon: <Ic d={PLUS} />, title: 'Нажмите «Установить приложение»', text: 'Если такого пункта нет, выберите «Добавить на главный экран» и подтвердите.' },
  ],
  desktop: [
    { icon: <Ic d={DL} />, title: 'Откройте сайт в Chrome или Edge', text: 'Найдите значок установки справа в адресной строке. Он появляется, когда браузер готов установить приложение.' },
    { icon: <Ic d={PLUS} />, title: 'Подтвердите установку', text: 'Нажмите «Установить» в окне браузера. Если значка нет, проверьте пункт установки в меню браузера.' },
    { icon: <Ic d={OK} />, title: 'Открывайте как приложение', text: 'Студия появится среди ваших приложений и будет открываться в отдельном окне. В Safari на Mac используйте «Файл» → «Добавить в Dock».' },
  ],
};

export function Install() {
  const { b } = useOutletContext<Ctx>();
  const evt = useSyncExternalStore(subscribeInstall, installEvent);
  const [tab, setTab] = useState<Platform>(detect); const [note, setNote] = useState<string | null>(null); const [copied, setCopied] = useState<string | null>(null);
  const steps = useRef<HTMLDivElement>(null); const standalone = isStandalone();
  const install = async () => {
    if (evt) {
      try { await evt.prompt(); const c = await evt.userChoice; setNote(c.outcome === 'accepted' ? 'Установка началась.' : 'Установка отменена. Её можно повторить в любой момент.'); }
      catch { setNote('Не удалось открыть окно установки. Используйте шаги ниже.'); }
      return;
    }
    setNote('Этот браузер не предлагает установку одной кнопкой. Выполните шаги ниже для вашего устройства.'); steps.current?.scrollIntoView();
  };
  const copy = async () => {
    const link = `${window.location.origin}/s/${b.slug}/`;
    try { await navigator.clipboard.writeText(link); setCopied('Ссылка скопирована. Вставьте её в адресную строку Safari или Chrome.'); }
    catch { setCopied(`Не удалось скопировать автоматически. Ссылка: ${link}`); }
  };
  return (<div className="page"><div className="install-wrap">
    <Link to={`/s/${b.slug}`} className="back-link"><ArrowLeft size={18} /> На главную</Link>
    <div className="card install-hero"><div className="row"><img src={assetUrl(b.slug, b.images.logo)} alt="" width={52} height={52} /><div><b>{b.short_name}</b><p className="muted small">Приложение студии</p></div></div>
      <h1>Добавьте студию на главный экран</h1><p className="muted">Своя иконка на устройстве. Быстрый доступ к услугам и вашей записи.</p>
      <button className="btn" disabled={standalone} onClick={() => void install()}><Download /> {standalone ? 'Уже установлено' : 'Установить сейчас'}</button>
      {note && <p className="muted small" role="status">{note}</p>}</div>
    <div ref={steps}><h2 style={{ marginTop: 28 }}>Как установить</h2>
      <div className="seg" role="tablist">{(['ios', 'android', 'desktop'] as Platform[]).map((p) => <button key={p} role="tab" aria-selected={tab === p} onClick={() => setTab(p)}>{LABEL[p]}</button>)}</div>
      {STEPS[tab].map((s, i) => (<div className="step" key={s.title}><span className="num">{i + 1}</span><div><h3>{s.icon}{s.title}</h3><p className="muted">{s.text}</p></div></div>))}</div>
    <div className="card" style={{ marginTop: 20 }}><b>Открыли из Telegram или другого приложения?</b>
      <p className="muted">Через меню «…» откройте страницу в Safari на iPhone или Chrome на Android. Или скопируйте ссылку и вставьте её в браузер.</p>
      <button className="btn ghost" onClick={() => void copy()}><Copy size={16} /> Скопировать ссылку на студию</button>
      {copied && <p className="muted small" role="status" style={{ wordBreak: 'break-all' }}>{copied}</p>}</div></div></div>);
}
