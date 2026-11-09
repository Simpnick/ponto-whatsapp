(() => {
  if (location.origin !== 'https://web.whatsapp.com') return;
  if (globalThis.pontoPanel?.host.isConnected) {
    globalThis.pontoPanel.toggle();
    return;
  }

  const host = document.createElement('div');
  host.dataset.pontoPanel = '';
  const root = host.attachShadow({ mode: 'closed' });
  const { parseContacts, personalize, runQueue } = globalThis.PontoWorkflow;
  globalThis.createPontoView(root);
  const controls = Object.fromEntries([...root.querySelectorAll('[id]')].map((element) => [element.id, element]));
  const attachments = [];
  let parsed = parseContacts('');
  let snapshot;
  let controller;
  let completed = 0;

  globalThis.pontoPanel = { host, toggle: () => { if (!controller) host.hidden = !host.hidden; } };
  (document.body ?? document.documentElement).append(host);

  const reasons = {
    adapter: 'O WPPConnect não ficou pronto. Recarregue o WhatsApp Web e confira a compatibilidade.',
    conflict: 'Já existe outra versão do WPPConnect nesta página. Desative a outra extensão e recarregue.',
    login: 'Entre na sua conta no WhatsApp Web antes de enviar.',
    recipient: 'O telefone precisa incluir o código do país e o DDD.',
    busy: 'Um envio anterior ainda está em andamento.',
    file: 'Falha ao preparar o arquivo. Confira o acesso ao arquivo e tente em um novo lote.',
    bridge: 'O painel perdeu contato com o WhatsApp Web.',
    mediaLimit: 'O arquivo excede o tamanho aceito pelo WhatsApp para esse formato.',
    unconfirmed: 'O WhatsApp não confirmou este item.'
  };

  function report(message, error = false) {
    controls.status.textContent = message;
    controls.status.toggleAttribute('data-error', error);
  }

  async function request(operation, data = {}) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ operation, ...data });
    } catch {
      throw new Error(reasons.bridge);
    }
    if (!response?.ok) throw new Error(reasons[response?.reason] ?? reasons.bridge);
  }

  async function sendItem(item, signal) {
    const { phone } = item.contact;
    if (!item.file) {
      await request('text', { phone, text: item.text });
      return;
    }

    const { file, asDocument, caption } = item;
    const id = crypto.randomUUID();
    const chunkSize = 1024 * 1024;
    await request('begin', { id, size: file.size });
    try {
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        signal.throwIfAborted();
        const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
        signal.throwIfAborted();
        await request('append', { id, offset, data: bytes.toBase64() });
      }
      signal.throwIfAborted();
      await request('file', { id, phone, asDocument, caption, name: file.name, mime: file.type });
    } finally {
      await request('discard', { id }).catch(() => {});
    }
  }

  function updatePreview() {
    try {
      parsed = parseContacts(controls.contacts.value);
      const { contacts, duplicates, invalid } = parsed;
      const details = [`${contacts.length} contato(s) válido(s)`];
      if (duplicates) details.push(`${duplicates} duplicado(s) ignorado(s)`);
      if (invalid.length) details.push(`confira ${invalid.length} linha(s) inválida(s)`);
      controls['contact-count'].textContent = details.join(' · ');
    } catch (error) {
      parsed = { error: error.message, contacts: [] };
      controls['contact-count'].textContent = error.message;
    }
    const contact = parsed.contacts[0];
    const text = controls.message.value.trim();
    controls.preview.hidden = !contact || !text;
    controls.preview.textContent = contact && text ? personalize(text, contact) : '';
  }

  function renderAttachments() {
    controls['file-count'].textContent = `${attachments.length} ${attachments.length === 1 ? 'arquivo' : 'arquivos'}`;
    const list = controls.attachments;
    list.replaceChildren();
    for (const entry of attachments) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      const name = document.createElement('span');
      const size = document.createElement('span');
      const remove = document.createElement('button');
      const caption = document.createElement('input');
      const mode = document.createElement('label');
      const checkbox = document.createElement('input');
      row.className = 'row';
      name.className = 'file-label';
      name.textContent = entry.file.name;
      size.className = 'file-size';
      const scale = Math.min(3, Math.floor(Math.log(entry.file.size) / Math.log(1024)));
      const formatted = (entry.file.size / (1024 ** scale)).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      size.textContent = `${formatted} ${['B', 'KB', 'MB', 'GB'][scale]}`;
      remove.textContent = 'Remover';
      remove.setAttribute('aria-label', `Remover ${entry.file.name}`);
      remove.addEventListener('click', () => {
        attachments.splice(attachments.indexOf(entry), 1);
        renderAttachments();
        controls['add-files'].focus();
      });
      caption.type = 'text';
      caption.placeholder = 'Legenda opcional';
      caption.value = entry.caption;
      caption.setAttribute('aria-label', `Legenda de ${entry.file.name}`);
      caption.addEventListener('input', () => { entry.caption = caption.value; });
      mode.className = 'check';
      checkbox.type = 'checkbox';
      checkbox.checked = entry.asDocument;
      checkbox.addEventListener('change', () => { entry.asDocument = checkbox.checked; });
      mode.append(checkbox, 'Enviar como documento');
      row.append(name, size, remove);
      li.append(row, caption, mode);
      list.append(li);
    }
  }

  function addFiles(files) {
    if (controls.draft.disabled) return;
    let empty = 0;
    for (const file of files) {
      if (!file.size) {
        empty++;
        continue;
      }
      attachments.push({ file, caption: '', asDocument: false });
    }
    renderAttachments();
    report(empty ? `${empty} arquivo(s) vazio(s) ignorado(s).` : `${attachments.length} arquivo(s) na fila.`, !!empty);
  }

  function showReview() {
    updatePreview();
    if (parsed.error) return report(parsed.error, true);
    if (parsed.invalid.length) {
      const lines = parsed.invalid.slice(0, 8).join(', ');
      return report(`Corrija os telefones nas linhas ${lines}${parsed.invalid.length > 8 ? ' e seguintes' : ''}.`, true);
    }
    const { contacts } = parsed;
    const text = controls.message.value.trim();
    if (!contacts.length) return report('Adicione pelo menos um destinatário válido.', true);
    if (!text && !attachments.length) return report('Escreva uma mensagem ou adicione arquivos.', true);
    if (text && contacts.some((contact) => !personalize(text, contact).trim())) {
      return report('A mensagem fica vazia para algum destinatário. Confira os campos de personalização.', true);
    }

    snapshot = { contacts, text, attachments: attachments.map((entry) => ({ ...entry })),
      total: contacts.length * (Number(!!text) + attachments.length) };
    completed = 0;
    controls.draft.disabled = true;
    controls.prepare.hidden = true;
    controls.progress.hidden = true;
    controls.consent.checked = false;
    controls.send.disabled = true;
    controls.summary.textContent = `${snapshot.total} item(ns) para ${contacts.length} destinatário(s).`;
    const sample = contacts.slice(0, 4).map(({ name, phone }) => name ? `${name} (+${phone})` : `+${phone}`);
    if (contacts.length > sample.length) sample.push(`e mais ${contacts.length - sample.length}`);
    controls['recipient-preview'].textContent = sample.join(' · ');
    controls.review.hidden = false;
    controls.consent.focus();
    report('Confira a lista e confirme o envio.');
  }

  function resetReview() {
    snapshot = undefined;
    controls.review.hidden = true;
    controls.resume.hidden = true;
    controls.discard.hidden = true;
    controls.draft.disabled = false;
    controls.prepare.hidden = false;
  }

  async function start() {
    if (controller || !snapshot) return;
    controller = new AbortController();
    controls.close.disabled = true;
    controls.review.hidden = true;
    controls.resume.hidden = true;
    controls.discard.hidden = true;
    controls.stop.hidden = false;
    controls.stop.disabled = false;
    controls.progress.max = snapshot.total;
    controls.progress.value = completed;
    controls.progress.hidden = false;
    report('Verificando a conexão com o WhatsApp Web…');

    try {
      const outcome = await navigator.locks.request('ponto-whatsapp-batch', { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('Já existe um lote em execução em outra aba.');
        await request('prepare');
        return runQueue(snapshot, { startAt: completed, signal: controller.signal, send: sendItem,
          onProgress: (event, item, index, error) => {
            const detail = `${index}/${snapshot.total} · +${item.contact.phone} · ${item.label}`;
            if (event === 'sending') report(`Processando ${detail}`);
            if (event === 'confirmed') {
              completed = index;
              controls.progress.value = completed;
              report(`WhatsApp confirmou ${detail}`);
            }
            if (event === 'failed') {
              report(`Fila interrompida em ${detail}. ${completed} confirmado(s). ${error.message} Confira a conversa antes de iniciar outro lote.`, true);
            }
          }
        });
      });
      if (outcome.status === 'stopped') {
        controls.resume.hidden = false;
        controls.discard.hidden = false;
        report(`Lote pausado. ${completed} de ${snapshot.total} item(ns) confirmados.`);
      } else {
        if (outcome.status === 'done') report(`WhatsApp confirmou ${completed} de ${snapshot.total} item(ns).`);
        resetReview();
      }
    } catch (error) {
      if (completed) {
        controls.resume.hidden = false;
        controls.discard.hidden = false;
      } else {
        resetReview();
      }
      report(error.message, true);
    } finally {
      controller = undefined;
      controls.stop.hidden = true;
      controls.close.disabled = false;
    }
  }

  controls.close.addEventListener('click', () => { host.hidden = true; });
  controls.contacts.addEventListener('input', updatePreview);
  controls.message.addEventListener('input', updatePreview);
  controls.import.addEventListener('click', () => controls.csv.click());
  controls.csv.addEventListener('change', async () => {
    const file = controls.csv.files[0];
    controls.csv.value = '';
    if (!file) return;
    const before = controls.contacts.value;
    try {
      const content = await file.text();
      if (controls.draft.disabled || controls.contacts.value !== before) return;
      parseContacts(content);
      controls.contacts.value = content;
      updatePreview();
      report('Lista importada. Revise os telefones antes de enviar.');
    } catch (error) {
      report(`Falha ao importar CSV. ${error.message}`, true);
    }
  });
  controls['add-files'].addEventListener('click', () => controls.files.click());
  controls.files.addEventListener('change', () => {
    addFiles(controls.files.files);
    controls.files.value = '';
  });
  controls.drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!controls.draft.disabled) controls.drop.dataset.drag = '';
  });
  controls.drop.addEventListener('dragleave', () => { delete controls.drop.dataset.drag; });
  controls.drop.addEventListener('drop', (event) => {
    event.preventDefault();
    delete controls.drop.dataset.drag;
    addFiles(event.dataTransfer.files);
  });
  controls.prepare.addEventListener('click', showReview);
  controls['cancel-review'].addEventListener('click', () => {
    resetReview();
    controls.prepare.focus();
    report('Rascunho aberto para revisão.');
  });
  controls.consent.addEventListener('change', () => { controls.send.disabled = !controls.consent.checked; });
  controls.send.addEventListener('click', (event) => {
    if (event.isTrusted && controls.consent.checked) void start();
  });
  controls.stop.addEventListener('click', () => {
    controller?.abort();
    controls.stop.disabled = true;
    report('Pausando o lote. Aguardando qualquer envio que já começou.');
  });
  controls.resume.addEventListener('click', (event) => { if (event.isTrusted) void start(); });
  controls.discard.addEventListener('click', () => {
    resetReview();
    report(`Lote encerrado com ${completed} item(ns) confirmados.`);
  });
  updatePreview();
})();
