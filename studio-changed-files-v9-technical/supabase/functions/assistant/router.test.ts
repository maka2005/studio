import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, runRouter, toolsFor, type LlmCall, type Msg } from './router.ts';
const call = (name: string, args = {}): Msg => ({ role: 'assistant', tool_calls: [{ id: 'c1', function: { name, arguments: JSON.stringify(args) } }] });
const text = (t: string): Msg => ({ role: 'assistant', content: t });
const seq = (...items: (Msg | Error)[]): LlmCall => async () => { const x = items.shift(); if (!x) throw new Error('llm: нет ответа'); if (x instanceof Error) throw x; return x; };
const base = { system: 's', message: 'q' };

test('клиентский scope не содержит инструменты владельца', () => {
  assert.equal(toolsFor('client').some((t) => t.name === 'get_stats'), false);
  assert.equal(toolsFor('owner').some((t) => t.name === 'get_stats'), true);
});
test('tools: инструмент выполняется до ответа', async () => {
  const log: string[] = [];
  const r = await runRouter({ ...base, scope: 'client', llm: seq(call('get_services'), text('Полировка 18000')), exec: async (n) => { log.push(n); return [{ name: 'p' }]; } });
  assert.deepEqual(log, ['get_services']); assert.equal(r.mode, 'tools'); assert.equal(r.reply, 'Полировка 18000');
});
test('клиент не может вызвать owner-инструмент, exec не вызывается', async () => {
  let n = 0; const sent: Msg[][] = [];
  const llm: LlmCall = async (m) => { sent.push([...m]); return sent.length === 1 ? call('get_stats', { from: 'a', to: 'b' }) : text('нет доступа'); };
  await runRouter({ ...base, scope: 'client', llm, exec: async () => { n++; return 1; } });
  assert.equal(n, 0); assert.match(sent[1]!.at(-1)!.content!, /tool_not_allowed/);
});
test('fallback: модель проигнорировала tool_choice -> JSON-intent', async () => {
  const log: string[] = [];
  const r = await runRouter({ ...base, scope: 'client', llm: seq(text('Привет'), text('{"intent":"get_services","args":{}}'), text('ответ')), exec: async (n) => { log.push(n); return []; } });
  assert.deepEqual(log, ['get_services']); assert.equal(r.mode, 'json');
});
test('fallback при HTTP 400 (инструменты не поддерживаются)', async () => {
  const e = Object.assign(new Error('x'), { status: 400 });
  const r = await runRouter({ ...base, scope: 'client', llm: seq(e, text('```json\n{"intent":"get_studio_info"}\n```'), text('ok')), exec: async () => ({}) });
  assert.equal(r.mode, 'json'); assert.deepEqual(r.toolsUsed, ['get_studio_info']);
});
test('ошибка 500 не маскируется fallback-ом', async () => {
  await assert.rejects(runRouter({ ...base, scope: 'client', llm: seq(Object.assign(new Error('boom'), { status: 500 })), exec: async () => 1 }));
});
test('parseIntent: чужой intent, мусор и clarify', () => {
  assert.equal(parseIntent('{"intent":"get_stats"}', 'client'), null);
  assert.equal(parseIntent('не json', 'owner'), null);
  assert.equal(parseIntent('{"intent":"get_stats","args":{"from":"1"}}', 'owner')?.intent, 'get_stats');
  assert.equal(parseIntent('{"intent":"clarify","question":"Какая услуга?"}', 'client')?.question, 'Какая услуга?');
});
test('ограниченный цикл: модель вечно просит инструменты', async () => {
  let n = 0, calls = 0;
  const llm: LlmCall = async (_m, tools) => { calls++; return tools ? call('get_services') : text('итог'); };
  const r = await runRouter({ ...base, scope: 'client', llm, exec: async () => { n++; return 1; }, maxRounds: 3 });
  assert.equal(r.reply, 'итог'); assert.ok(n <= 3); assert.ok(calls <= 5);
});
