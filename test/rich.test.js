import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../extension/workflow.js';
import '../extension/rich.js';
import '../extension/rich-adapter.js';

const { readRich } = globalThis.PontoRich;
const { parseContacts, runQueue } = globalThis.PontoWorkflow;
const adapter = globalThis.PontoRichAdapter;

test('builds all Web special message types and maps them to the pinned WA-JS calls', async () => {
  const fields = {
    vcard: 'Ana,5511900000000,5511900000001',
    'location-lat': '0', 'location-lng': '-47.1', 'location-name': 'Escritório',
    'poll-question': 'Qual?', 'poll-choices': 'Um\nDois', 'poll-count': '1',
    'list-button': 'Abrir', 'list-description': 'Escolha', 'list-sections': '# Serviços\nA | Descrição\n# Outros\nB',
    'pix-type': 'EMAIL', 'pix-key': 'ana@example.com', 'pix-name': 'Ana',
    'event-name': 'Reunião', 'event-start': '2026-11-09T13:00', 'event-place': 'Sala 2', 'event-call': 'voice',
    'invite-group': '120363000000000001', 'invite-code': 'https://chat.whatsapp.com/abcDEF01234?mode=gi'
  };
  const root = { getElementById: (id) => ({ value: fields[id] ?? '', checked: id.endsWith('-on') }) };
  const items = readRich(root);
  assert.deepEqual(items.map(({ kind }) => kind), ['vcard', 'location', 'poll', 'list', 'pix', 'event', 'invite']);
  assert.deepEqual(items[0].data.map(({ id }) => id), ['5511900000000@c.us', '5511900000001@c.us']);
  assert.equal(items[1].data.lat, 0);
  assert.equal(items[3].data.sections[1].rows[0].title, 'B');
  assert.equal(items[5].data.description, 'Sala 2');
  assert.equal(items[6].data.inviteCode, 'abcDEF01234');
  const calls = [];
  const methods = ['sendVCardContactMessage', 'sendLocationMessage', 'sendCreatePollMessage', 'sendListMessage',
    'sendPixKeyMessage', 'sendEventMessage', 'sendGroupInviteMessage'];
  const chat = Object.fromEntries(methods.map((name) => [name, (...args) => { calls.push([name, args]); }]));
  for (const { kind, data } of items) {
    assert.equal(adapter.supports(chat, kind), true);
    await adapter.send(chat, '120363000000000001@g.us', kind, data, { waitForAck: true });
  }
  assert.deepEqual(calls.map(([name]) => name), methods);
  assert.deepEqual(calls[2][1].slice(1), ['Qual?', ['Um', 'Dois'], { waitForAck: true, selectableCount: 1 }]);
  assert.equal(calls[6][1][1].groupId, '120363000000000001@g.us');
  assert.equal(adapter.supports(chat, 'constructor'), false);
});

test('recognizes legacy group IDs only in Web and does not replay failed rich items', async () => {
  const list = 'Nome;Telefone\nEquipe;120363000000000001\nAna;5511900000000';
  assert.deepEqual(parseContacts(list).invalid, [2]);
  const { contacts } = parseContacts(list, { allowGroups: true });
  assert.deepEqual(contacts.map(({ phone }) => phone), ['120363000000000001@g.us', '5511900000000']);

  const draft = { contacts, text: 'Olá [nome]', attachments: [], continueOnError: true,
    rich: [{ kind: 'location', label: 'Localização' }] };
  const signal = new AbortController().signal;
  const attempts = [];
  const send = async (item) => {
    attempts.push([item.contact.phone, item.label]);
    if (item.contact === contacts[0] && item.rich) throw new Error('sem confirmação');
  };
  const events = [];
  const result = await runQueue(draft, { startAt: 0, signal, send,
    onProgress: (event, _item, index) => { if (event !== 'sending') events.push([event, index]); } });
  assert.equal(result.status, 'done');
  assert.deepEqual(attempts.map(([, label]) => label), ['Texto', 'Localização', 'Texto', 'Localização']);
  assert.deepEqual(events, [['confirmed', 1], ['failed', 2], ['confirmed', 3], ['confirmed', 4]]);
});
