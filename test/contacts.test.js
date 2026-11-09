import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../extension/contacts-adapter.js';
import '../extension/contacts.js';
import '../extension/workflow.js';

const groupId = '120363012345678901@g.us';
const firstPhone = '5511900000000';
const secondPhone = '5521900000000';
const asWid = (_serialized) => ({ _serialized });
const { PontoContactsAdapter: dispatch, PontoContactsCsv: csv,
  PontoWorkflow: { parseContacts, rewriteContacts, personalize } } = globalThis;

function fixtures() {
  const now = Math.floor(Date.now() / 1000);
  return {
    conn: { isAuthenticated: () => true },
    chat: {
      getActiveChat: () => ({ id: asWid(groupId) }),
      getMessageById: async () => ({ t: now - 3600, id: { fromMe: false } }),
      list: async ({ withLabels } = {}) => {
        if (withLabels) assert.deepEqual(withLabels, ['1']);
        return [
          { id: asWid(`${firstPhone}@c.us`), t: now - 50, lastMessage: { fromMe: true, timestamp: now - 50 },
            lastReceivedKey: { _serialized: 'recent-inbound' }, contact: { name: 'Ana', isMyContact: true } },
          { id: asWid('100000001@lid'), t: now - 172800, contact: { pushname: 'Beto', isMyContact: false } },
          { id: asWid('100000002@lid'), t: now - 50 },
          { id: asWid('status@broadcast') },
          { id: asWid(groupId) }
        ];
      }
    },
    group: {
      getAllGroups: async () => [{ id: asWid(groupId), formattedTitle: 'Projeto' }, undefined],
      getParticipants: async (id) => {
        assert.equal(id, groupId);
        return [{ id: asWid(`${secondPhone}@c.us`), contact: { name: 'Beto', isMyContact: false } }];
      },
      iAmMember: async (id) => id === groupId
    },
    labels: { getAllLabels: async () => [{ id: '1', name: 'Clientes', count: 2 }] },
    contact: {
      getPnLidEntry: async (jid) => jid === '100000001@lid' ? { phoneNumber: asWid(`${secondPhone}@c.us`) } : {},
      queryWidExists: async (id) => {
        if (id === `${firstPhone}@c.us`) return { wid: asWid('551100000000@c.us') };
        if (id === `${secondPhone}@c.us`) return null;
        throw new Error('transient provider failure');
      }
    }
  };
}

test('imports group and label selections without exposing contact models', async () => {
  const wpp = fixtures();
  const sourceOptions = await dispatch(wpp, { operation: 'contactSources' });
  assert.deepEqual(sourceOptions.data.groups, [{ id: groupId, name: 'Projeto' }]);
  assert.deepEqual(sourceOptions.data.labels, [{ id: '1', name: 'Clientes' }]);

  const groups = await dispatch(wpp, { operation: 'contactRead', source: 'groups' });
  assert.deepEqual(groups.data.rows, [{ name: 'Projeto', phone: groupId }]);
  const members = await dispatch(wpp, { operation: 'contactRead', source: 'members', id: 'active', onlyUnsaved: true, prefix: 'WA_' });
  assert.deepEqual(members.data.rows, [{ name: 'WA_Beto', phone: secondPhone }]);

  const label = await dispatch(wpp, { operation: 'contactRead', source: 'label', id: '1' });
  assert.deepEqual(label.data, { rows: [{ name: 'Ana', phone: firstPhone }, { name: 'Beto', phone: secondPhone }], omitted: 1 });
});

test('finds a recent incoming message even after an outgoing reply', async () => {
  const wpp = fixtures();
  const result = await dispatch(wpp, { operation: 'contactRead', source: 'recent' });
  assert.deepEqual(result.data, { rows: [{ name: 'Ana', phone: firstPhone }], omitted: 0 });
});

test('distinguishes a confirmed correction and missing registration from provider errors', async () => {
  const wpp = fixtures();
  const check = (phone) => dispatch(wpp, { operation: 'contactCheck', phone });
  assert.deepEqual((await check(groupId)).data, { phone: groupId, status: 'registered' });
  assert.deepEqual((await check(firstPhone)).data, { phone: '551100000000', status: 'registered' });
  assert.deepEqual((await check(secondPhone)).data, { phone: secondPhone, status: 'missing' });
  assert.deepEqual((await check('5541911111111')).data, { phone: '5541911111111', status: 'unknown' });
  assert.deepEqual(await check('arbitrary@c.us'), { ok: false, reason: 'recipient' });
  assert.deepEqual(await dispatch({ conn: { isAuthenticated: () => false } }, { operation: 'contactSources' }),
    { ok: false, reason: 'login' });
});

test('preserves draft data and neutralizes spreadsheet formulas in the export', () => {
  const rows = [{ name: ' =1+1', phone: firstPhone, extra: ['Ana; "teste"', '@arquivo', '=HIPERLINK("x")'] }];
  const { contacts } = parseContacts(csv(rows));
  assert.equal(contacts[0].name, '=1+1');
  assert.deepEqual(contacts[0].extra, rows[0].extra);
  const exported = csv(rows, { spreadsheetSafe: true });
  assert.match(exported, /"' =1\+1"/);
  assert.match(exported, /"'@arquivo"/);
  assert.match(exported, /"'=HIPERLINK\(""x""\)"/);
  assert.equal(csv(rows, { onlyNumbers: true }), `"telefone"\r\n"${firstPhone}"`);
});

test('applying checks preserves named CSV headers, positions, and duplicate rows', () => {
  const input = 'Cidade;Telefone;Nome;Bairro;Cidade\n' +
    'Norte;+55 (11) 90000-0000;Ana;Centro;Recife\n' +
    'Norte;5511900000000;Nome alternativo;Sul;Recife\n' +
    'Nordeste;5521900000000;Beto;Campo;Natal\n' +
    'Interior;120363012345678901;Equipe;Filial;Bahia';
  const corrections = new Map([[firstPhone, '551100000000'], [secondPhone, null]]);
  const output = rewriteContacts(input, corrections, { allowGroups: true });
  assert.match(output, /^"Cidade";"Telefone";"Nome";"Bairro";"Cidade"/);
  assert.match(output, /"551100000000";"Nome alternativo"/);
  const result = parseContacts(output, { allowGroups: true });
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.contacts.map(({ phone }) => phone), ['551100000000', groupId]);
  assert.equal(personalize('[cidade] [bairro] [field3]', result.contacts[0]), 'Recife Centro Norte');
});
