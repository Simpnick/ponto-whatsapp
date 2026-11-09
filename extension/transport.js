(() => {
  const wpp = globalThis.WPP;
  const options = { waitForAck: true, markIsRead: false, detectMentioned: false };
  let upload;
  let expiry;
  let sending = false;

  function discard() {
    clearTimeout(expiry);
    upload = undefined;
  }

  async function prepare() {
    if (!wpp?.loader?.onReady) return 'adapter';
    const ready = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 15000);
      wpp.loader.onReady(() => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
    if (!ready || typeof wpp.chat?.sendFileMessage !== 'function' ||
        typeof wpp.chat?.sendTextMessage !== 'function' || typeof wpp.conn?.isAuthenticated !== 'function') {
      return 'adapter';
    }
    if (!wpp.conn.isAuthenticated()) return 'login';
    return 'ok';
  }

  async function send(request, file) {
    if (!wpp.conn.isAuthenticated()) return { ok: false, reason: 'login' };
    if (!/^[1-9]\d{7,14}$/.test(request.phone)) return { ok: false, reason: 'recipient' };
    if (sending) return { ok: false, reason: 'busy' };

    const chatId = `${request.phone}@c.us`;
    sending = true;
    // If the acknowledgement times out, the send may still finish in WhatsApp.
    // Keep the lock until the underlying operation settles and never replay it.
    const pending = Promise.resolve().then(async () => {
      const result = file
        ? await wpp.chat.sendFileMessage(chatId, file, {
            ...options,
            type: request.asDocument ? 'document' : 'auto-detect',
            filename: file.name,
            caption: request.caption
          })
        : await wpp.chat.sendTextMessage(chatId, request.text, { ...options, linkPreview: false });
      return result?.id && Number(result.ack) >= 1
        ? { ok: true }
        : { ok: false, reason: 'unconfirmed' };
    }).catch((error) => ({ ok: false, reason: error?.code === 'file_too_large' ? 'mediaLimit' : 'unconfirmed' }))
      .finally(() => { sending = false; });

    let timeout;
    const deadline = new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ ok: false, reason: 'unconfirmed' }), 120000);
    });
    try {
      return await Promise.race([pending, deadline]);
    } finally {
      clearTimeout(timeout);
    }
  }

  globalThis.__pontoTransport = async (request) => {
    if (request.operation === 'prepare') {
      const reason = await prepare();
      return { ok: reason === 'ok', reason };
    }
    if (request.operation === 'text') return send(request);
    if (request.operation === 'begin') {
      if (upload || !Number.isSafeInteger(request.size) || request.size <= 0) {
        return { ok: false, reason: 'file' };
      }
      upload = { id: request.id, size: request.size, received: 0, parts: [] };
      expiry = setTimeout(discard, 120000);
      return { ok: true };
    }
    if (request.operation === 'discard') {
      if (upload?.id === request.id) discard();
      return { ok: true };
    }
    if (!upload || upload.id !== request.id) return { ok: false, reason: 'file' };

    if (request.operation === 'append') {
      if (upload.received !== request.offset || typeof request.data !== 'string' || request.data.length > 1398104) {
        return { ok: false, reason: 'file' };
      }
      const chunk = Uint8Array.fromBase64(request.data);
      if (!chunk.length || upload.received + chunk.length > upload.size) return { ok: false, reason: 'file' };
      upload.parts.push(chunk);
      upload.received += chunk.length;
      clearTimeout(expiry);
      expiry = setTimeout(discard, 120000);
      return { ok: true };
    }
    if (request.operation === 'file' && upload.received === upload.size) {
      const { parts } = upload;
      discard();
      const file = new File(parts, request.name, { type: request.mime });
      return send(request, file);
    }
    return { ok: false, reason: 'file' };
  };
})();
