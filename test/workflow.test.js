import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../extension/workflow.js';

const { parseContacts, personalize, runQueue } = globalThis.PontoWorkflow;

test('imports quoted CSV, reports source lines and deduplicates international numbers', () => {
  const result = parseContacts('\uFEFF\n"Nome";"Telefone";Cidade\r\n"Ana; Lima";+55 (11) 90000-0000;São Paulo\r\nOutra;5511900000000;\r\nInválido;abc;');
  assert.deepEqual(result, {
    contacts: [{ name: 'Ana; Lima', phone: '5511900000000', extra: ['São Paulo'],
      fields: { nome: 'Ana; Lima', telefone: '+55 (11) 90000-0000', cidade: 'São Paulo' } }],
    duplicates: 1,
    invalid: [5]
  });
  assert.equal(personalize('Olá, [nome] ([field2]) de [field3].', result.contacts[0]),
    'Olá, Ana; Lima (5511900000000) de São Paulo.');
  assert.equal(personalize('[number] [cidade] [ausente]', result.contacts[0]), '5511900000000 São Paulo [ausente]');
  assert.throws(() => parseContacts('nome,telefone\n"linha sem fechamento'), /sem fechamento/);
});

test('processes more than 20 attachments in order and resumes after the last confirmation', async () => {
  const { contacts } = parseContacts('Ana,5511900000000');
  const attachments = Array.from({ length: 25 }, (_, index) => ({
    file: { name: `arquivo-${index + 1}` }, caption: '[nome]', asDocument: false
  }));
  const draft = { contacts, text: 'Olá, [name]', attachments };
  const abort = new AbortController();
  const confirmed = [];
  let completed = 0;
  const send = async () => {};
  const onProgress = (stage, item, index) => {
    if (stage !== 'confirmed') return;
    confirmed.push(item);
    completed = index;
    if (index === 4) abort.abort();
  };

  assert.deepEqual(await runQueue(draft, { startAt: 0, signal: abort.signal, send, onProgress }), { status: 'stopped' });
  assert.deepEqual(await runQueue(draft, { startAt: completed, signal: new AbortController().signal, send, onProgress }),
    { status: 'done' });
  assert.equal(confirmed[0].text, 'Olá, Ana');
  assert.deepEqual(confirmed.slice(1).map(({ label }) => label), attachments.map(({ file }) => file.name));
  assert.equal(confirmed.at(-1).caption, 'Ana');
});

test('stops after a failed attachment without replaying or advancing', async () => {
  const { contacts } = parseContacts('5511900000000');
  const draft = { contacts, text: '', attachments: ['primeiro', 'segundo', 'terceiro'].map((name) => ({
    file: { name }, caption: ''
  })) };
  const sent = [];
  const events = [];
  const result = await runQueue(draft, {
    startAt: 0,
    signal: new AbortController().signal,
    send: async ({ label }) => {
      sent.push(label);
      if (label === 'segundo') throw new Error('Sem confirmação');
    },
    onProgress: (stage, item) => events.push([stage, item.label])
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(sent, ['primeiro', 'segundo']);
  assert.deepEqual(events, [['sending', 'primeiro'], ['confirmed', 'primeiro'], ['sending', 'segundo'], ['failed', 'segundo']]);
});
