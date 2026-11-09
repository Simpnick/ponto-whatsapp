import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateParameters, createCloudClient, csvCell, fileMedia, GraphError, templateParameters } from '../extension/cloud-api.js';

test('Graph pagination stays on the original endpoint and credentials use headers', async () => {
  const calls = [];
  const client = createCloudClient({ wabaId: '123', token: 'fixture-credential', fetcher: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return Response.json({ data: [{ id: '1' }], paging: {
      next: 'https://elsewhere.example/items?after=page2&access_token=fixture-credential'
    } });
    return Response.json({ data: [{ id: '2' }] });
  } });
  assert.deepEqual(await client.templates(), [{ id: '1' }, { id: '2' }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get('after'), 'page2');
  for (const { url, options } of calls) {
    assert.equal(url.origin, 'https://graph.facebook.com');
    assert.match(url.pathname, /\/v\d+\.0\/123\/message_templates/);
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal(options.headers.Authorization, 'Bearer fixture-credential');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
  }
  client.close();
  await assert.rejects(client.phones(), /desconectada/);
  assert.equal(calls.length, 2);
});

test('uploads a local file and sends it as media with the filename and caption', async () => {
  const file = new File(['dados'], 'arquivo.pdf', { type: 'application/pdf' });
  const calls = [];
  const client = createCloudClient({ wabaId: '123', token: 'fixture-credential', fetcher: async (url, options) => {
    calls.push({ url, options });
    return url.pathname.endsWith('/media') ? Response.json({ id: '444' }) : Response.json({ messages: [{ id: 'wamid.mock' }] });
  } });
  const media = await client.upload('789', file);
  assert.deepEqual(media, { id: '444', kind: 'document' });
  const form = calls[0].options.body;
  assert.equal(form.get('messaging_product'), 'whatsapp');
  assert.equal(form.get('type'), 'application/pdf');
  assert.equal(form.get('file').name, file.name);
  const response = await client.sendMedia('789', '5511900000000', media, 'Olá, Ana', file.name);
  assert.equal(response.messages[0].id, 'wamid.mock');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511900000000', type: 'document',
    document: { id: '444', caption: 'Olá, Ana', filename: 'arquivo.pdf' }
  });
  assert.throws(() => fileMedia(new File(['x'], 'setup.exe')), /formato/);
});

test('encodes template media, positional and named variables, and dynamic URL button indices', () => {
  const components = [
    { type: 'HEADER', format: 'IMAGE' },
    { type: 'BODY', text: 'Olá {{nome}}, de {{cidade}}. {{nome}}?' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY' }, { type: 'URL', url: 'https://example.org/{{1}}' }] }
  ];
  const groups = templateParameters({ components });
  const values = [['1234'], ['Ana', 'Recife'], ['pedido']];
  assert.deepEqual(buildTemplateParameters(groups, (group, position) => values[group][position]), [
    { type: 'header', parameters: [{ type: 'image', image: { id: '1234' } }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Ana', parameter_name: 'nome' }, { type: 'text', text: 'Recife', parameter_name: 'cidade' }] },
    { type: 'button', index: '1', sub_type: 'url', parameters: [{ type: 'text', text: 'pedido' }] }
  ]);
  assert.deepEqual(templateParameters({ components: [{ type: 'BODY', text: '{{2}}, {{1}}, {{2}}' }] })[0].fields, ['1', '2']);
  assert.throws(() => buildTemplateParameters(groups, () => 'javascript:alert(1)'), /HTTPS/);
  assert.equal(csvCell(' =SUM(1,2)'), '"\' =SUM(1,2)"');
});

test('redacts reflected tokens and distinguishes deterministic recipient rejection', async () => {
  const client = createCloudClient({ wabaId: '123', token: 'fixture-credential', fetcher: async () =>
    Response.json({ error: { message: 'Unsupported recipient with fixture-credential', code: 131026 } }, { status: 400 })
  });
  await assert.rejects(client.sendText('789', '5511900000000', 'Teste'), (error) => {
    assert(error instanceof GraphError);
    assert.equal(error.canSkipItem, true);
    assert.match(error.message, /\[token oculto\]/);
    assert.doesNotMatch(error.message, /fixture-credential/);
    return true;
  });
});
