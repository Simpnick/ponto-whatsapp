const origin = 'https://web.whatsapp.com';
const operations = new Set(['prepare', 'text', 'begin', 'append', 'file', 'discard']);
const preparations = new Map();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || new URL(tab.url).origin !== origin) {
    await chrome.tabs.create({ url: `${origin}/` });
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id }, files: ['workflow.js', 'view.js', 'panel.js']
  });
});

chrome.runtime.onMessage.addListener((request, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.origin !== origin || sender.frameId !== 0 ||
      !sender.documentId || !sender.tab?.id || !operations.has(request?.operation)) return;

  const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
  const response = request.operation === 'prepare' ? prepare(target, sender.documentId) : invoke(target, request);
  response.then(reply, () => reply({ ok: false, reason: 'bridge' }));
  return true;
});

function prepare(target, documentId) {
  if (!preparations.has(documentId)) {
    const promise = loadTransport(target).finally(() => preparations.delete(documentId));
    preparations.set(documentId, promise);
  }
  return preparations.get(documentId);
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
      files: ['vendor/wppconnect-wa.js', 'transport.js']
    });
  }
  return invoke(target, { operation: 'prepare' });
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
