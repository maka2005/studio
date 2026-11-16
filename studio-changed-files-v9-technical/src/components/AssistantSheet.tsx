import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Sheet } from './Sheet';
import { ArrowRight } from '../lib/icons';

export const OWNER_EXAMPLES = ['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено?'];
type Msg = { who: 'me' | 'ai'; text: string };

export function AssistantSheet({ slug, onClose }: {
  slug: string; onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const send = async (m: string) => {
    if (!m.trim() || busy) return;
    setMsgs((x) => [...x, { who: 'me', text: m }]); setText(''); setBusy(true);
    const { data, error } = await supabase.functions.invoke('assistant', { body: { slug, message: m, scope: 'owner' } });
    setBusy(false);
    setMsgs((x) => [...x, { who: 'ai', text: error || !data?.reply ? 'Помощник сейчас недоступен. Остальные функции работают как обычно.' : String(data.reply) }]);
  };

  return (
    <Sheet title="Помощник студии" sub="Вопросы по расписанию и работе кабинета" onClose={onClose}>
      {msgs.length === 0 && <div className="chips col">{OWNER_EXAMPLES.map((e) => <button key={e} className="chip wide" onClick={() => void send(e)}>{e}</button>)}</div>}
      <div className="log" aria-live="polite">{msgs.map((m, i) => <p key={i} className={`bubble ${m.who}`}>{m.text}</p>)}{busy && <p className="muted">Думаю…</p>}</div>
      <div className="row"><input className="field" value={text} placeholder="Напишите вопрос" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(text); }} />
        <button className="icon-btn accent" aria-label="Отправить" onClick={() => void send(text)}><ArrowRight /></button></div>
    </Sheet>);
}
