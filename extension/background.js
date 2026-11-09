const origin = 'https://web.whatsapp.com';
const operations = new Set([
  'prepare', 'text', 'rich', 'groupInviteCode', 'begin', 'append', 'file', 'discard',
  'contactSources', 'contactRead', 'contactCheck', 'openMode'
]);
const preparations = new Map();
const modes = { cloud: 'cloud.html', voice: 'voice.html' };

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || new URL(tab.url).origin !== origin) {
    await chrome.tabs.create({ url: `${origin}/` });
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id }, files: ['workflow.js', 'rich.js', 'view.js', 'contacts.js', 'panel.js']
  });
});

chrome.runtime.onMessage.addListener((request, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.documentId || !sender.tab?.id) return;
  const relay = ['cloud-import-contacts', 'voice-import-contacts'].includes(request?.operation);
  if (relay) {
    const mode = request.operation.split('-')[0];
    if (sender.url !== chrome.runtime.getURL(modes[mode])) return;
    importFromOpener(sender.tab.openerTabId, request.recent === true)
      .then(reply, () => reply({ ok: false, reason: 'Abra este modo novamente pelo painel no WhatsApp Web.' }));
    return true;
  }
  if (sender.origin !== origin || !operations.has(request?.operation)) return;

  const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
  let response;
  if (request.operation === 'prepare') {
    response = prepare(target, sender.documentId, request.richKinds);
  } else if (request.operation === 'openMode') {
    if (!Object.hasOwn(modes, request.mode)) return;
    response = chrome.tabs.create({ url: chrome.runtime.getURL(modes[request.mode]), openerTabId: sender.tab.id })
      .then(() => ({ ok: true }));
  } else {
    response = invoke(target, request);
  }
  response.then(reply, () => reply({ ok: false, reason: 'bridge' }));
  return true;
});

async function prepare(target, documentId, richKinds) {
  if (!preparations.has(documentId)) {
    const promise = loadTransport(target).finally(() => preparations.delete(documentId));
    preparations.set(documentId, promise);
  }
  const result = await preparations.get(documentId);
  return result.ok ? invoke(target, { operation: 'prepare', richKinds }) : result;
}

async function loadTransport(target) {
  const [{ result: state }] = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: () => {
      if (globalThis.__pontoTransport) return 'loaded';
      if (typeof globalThis.WPP !== 'undefined') return 'conflict';
      globalThis.WPPConfig = { disableGoogleAnalytics: true, linkPreviewApiServers: [] };
      return 'empty';
    }
  });
  if (state === 'conflict') return { ok: false, reason: 'conflict' };
  if (state === 'empty') {
    await chrome.scripting.executeScript({
      target,
      world: 'MAIN',
      files: ['vendor/wppconnect-wa.js', 'contacts-adapter.js', 'rich-adapter.js', 'transport.js']
    });
  }
  return { ok: state === 'empty' || state === 'loaded', reason: 'adapter' };
}

async function importFromOpener(tabId, recent) {
  if (!Number.isInteger(tabId)) return { ok: false, reason: 'Abra este modo pelo painel no WhatsApp Web.' };
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.origin });
  if (frame?.result !== origin || !frame.documentId) {
    return { ok: false, reason: 'A aba de origem precisa estar no WhatsApp Web.' };
  }
  const target = { tabId, documentIds: [frame.documentId] };
  const ready = await prepare(target, frame.documentId);
  if (!ready.ok) return { ok: false, reason: 'Entre no WhatsApp Web e verifique a conexão do Ponto.' };
  const result = await invoke(target, { operation: 'contactRead', source: recent ? 'recent' : 'chats' });
  if (!result.ok) return { ok: false, reason: 'Não foi possível consultar as conversas do WhatsApp Web.' };
  const contacts = result.data.rows.filter((row) => typeof row?.phone === 'string' && /^[1-9]\d{7,14}$/.test(row.phone))
    .map(({ name, phone }) => ({ name: typeof name === 'string' ? name : '', phone }));
  return { ok: true, contacts };
}

async function invoke(target, request) {
  const [{ result }] = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: (input) => globalThis.__pontoTransport?.(input),
    args: [request]
  });
  return result ?? { ok: false, reason: 'bridge' };
}
