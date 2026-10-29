import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, escapeHtml, isDeadChat, type Data } from './format.ts';
const d: Data = { kind: 'booking_created', studio: 'SGX', service: 'Мойка', startsAt: '2026-10-27T06:00:00Z', timezone: 'Asia/Almaty', customer: 'Айдар', phone: '+7 700 000 00 00', car: 'Camry', priceCents: 350000, currency: '₸' };
test('время показывается в часовом поясе студии', () => { assert.match(buildMessage(d), /27 октября.*11:00/); });
test('сумма и валюта', () => { assert.match(buildMessage(d), /3\s500 ₸/); });
test('имя клиента экранируется', () => {
  const m = buildMessage({ ...d, customer: '<b>x</b> & <a href="e">', car: '<script>' });
  assert.ok(!m.includes('<script>') && !m.includes('<a href')); assert.match(m, /&lt;b&gt;x&lt;\/b&gt; &amp;/);
});
test('отмена имеет понятный заголовок', () => { assert.match(buildMessage({ ...d, kind: 'booking_cancelled' }), /Запись отменена/); });
test('напоминание владельцу имеет свой заголовок', () => { assert.match(buildMessage({ ...d, kind: 'booking_reminder' }), /Напоминание о записи/); });
test('escapeHtml', () => { assert.equal(escapeHtml('a<b>&'), 'a&lt;b&gt;&amp;'); });
test('мёртвые чаты', () => { assert.ok(isDeadChat(403, '')); assert.ok(isDeadChat(400, 'Bad Request: chat not found')); assert.ok(!isDeadChat(429, 'Too Many Requests')); assert.ok(!isDeadChat(500, '')); });
