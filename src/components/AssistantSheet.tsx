import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { fetchServices, type Svc } from '../lib/api';
import { duration, money } from '../lib/format';
import { Sheet } from './Sheet';
import { ArrowRight } from '../lib/icons';

export const CLIENT_EXAMPLES = ['Очистить салон', 'Помыть кузов', 'Защитить покрытие', 'Не знаю, что выбрать'];
export const OWNER_EXAMPLES = ['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено?'];
type Msg = { who: 'me' | 'ai'; text: string };
const GOALS = [
  { title: 'Почистить салон', keywords: ['салон', 'химчист', 'чистк', 'уборк'] },
  { title: 'Помыть кузов', keywords: ['мойк', 'кузов', 'комплекс', 'внешн'] },
  { title: 'Вернуть блеск кузову', keywords: ['полир', 'царап', 'блеск', 'глянец'] },
  { title: 'Защитить покрытие', keywords: ['керамик', 'защит', 'покрыт', 'воск'] },
  { title: 'Не знаю, что выбрать', keywords: [] },
];

function suggest(services: Svc[], goal: number | null) {
  if (goal === null || GOALS[goal]?.keywords.length === 0) return { items: services.slice(0, 4), exact: true };
  const keywords = GOALS[goal]!.keywords;
  const ranked = services.map((service) => {
    const name = service.name.toLocaleLowerCase('ru').replaceAll('ё', 'е');
    return { service, score: keywords.reduce((sum, term) => sum + Number(name.includes(term)), 0) };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map((x) => x.service);
  return ranked.length ? { items: ranked, exact: true } : { items: services.slice(0, 4), exact: false };
}

export function AssistantSheet({ slug, currency = '₸', onClose, onSelectService, scope = 'client' }: {
  slug: string; currency?: string; onClose: () => void; onSelectService?: (serviceId: string) => void; scope?: 'client' | 'owner';
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [goal, setGoal] = useState<number | null>(null);
  const servicesQ = useQuery({ queryKey: ['services', slug], queryFn: () => fetchServices(slug), enabled: scope === 'client' });
  const recommendations = useMemo(() => suggest(servicesQ.data ?? [], goal), [servicesQ.data, goal]);
  const send = async (m: string) => {
    if (!m.trim() || busy) return;
    setMsgs((x) => [...x, { who: 'me', text: m }]); setText(''); setBusy(true);
    const { data, error } = await supabase.functions.invoke('assistant', { body: { slug, message: m, scope } });
    setBusy(false);
    setMsgs((x) => [...x, { who: 'ai', text: error || !data?.reply ? 'Помощник сейчас недоступен. Остальные функции работают как обычно.' : String(data.reply) }]);
  };

  if (scope === 'client') return (
    <Sheet title="Подберём услугу для автомобиля" sub="Выберите, что хотите сделать — покажем подходящие варианты из прайса." onClose={onClose}>
      <div className="guide-options">{GOALS.map((item, i) => <button key={item.title} className={`chip wide ${goal === i ? 'sel' : ''}`} aria-pressed={goal === i} onClick={() => setGoal(i)}>{item.title}</button>)}</div>
      {goal !== null && <section className="guide-results" aria-live="polite">
        {servicesQ.isPending ? <p className="muted">Загружаем прайс…</p> : servicesQ.isError ? <p className="err">Не удалось загрузить услуги. <button className="link" onClick={() => void servicesQ.refetch()}>Повторить</button></p>
          : servicesQ.data?.length ? <>
            <p className="muted small">{recommendations.exact ? 'Вам могут подойти:' : 'Похожего варианта в прайсе нет. Посмотрите другие услуги:'}</p>
            {recommendations.items.map((s) => <div className="card col guide-service" key={s.id}>
              <div><b>{s.name}</b><p className="muted small">{duration(s.duration_minutes)} · {money(s.price_cents / 100, currency)}</p></div>
              <button className="btn mini" onClick={() => onSelectService?.(s.id)}>Записаться <ArrowRight size={16} /></button>
            </div>)}
          </> : <p className="muted">Услуги пока не добавлены в прайс.</p>}
        <p className="muted small guide-note">Подбор ориентируется на названия услуг в прайсе. Если нужна помощь, свяжитесь со студией.</p>
      </section>}
    </Sheet>
  );

  return (
    <Sheet title="Помощник студии" sub="Вопросы по расписанию и работе кабинета" onClose={onClose}>
      {msgs.length === 0 && <div className="chips col">{OWNER_EXAMPLES.map((e) => <button key={e} className="chip wide" onClick={() => void send(e)}>{e}</button>)}</div>}
      <div className="log" aria-live="polite">{msgs.map((m, i) => <p key={i} className={`bubble ${m.who}`}>{m.text}</p>)}{busy && <p className="muted">Думаю…</p>}</div>
      <div className="row"><input className="field" value={text} placeholder="Напишите вопрос" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(text); }} />
        <button className="icon-btn accent" aria-label="Отправить" onClick={() => void send(text)}><ArrowRight /></button></div>
    </Sheet>);
}
