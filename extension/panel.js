(() => {
  if (location.origin !== 'https://web.whatsapp.com') return;
  if (globalThis.pontoPanel?.host.isConnected) {
    globalThis.pontoPanel.toggle();
    return;
  }

  const host = document.createElement('div');
  host.dataset.pontoPanel = '';
  const root = host.attachShadow({ mode: 'closed' });
  const { parseContacts, personalize, runQueue, csvText } = globalThis.PontoWorkflow;
  const { groupId, readRich } = globalThis.PontoRich;
  globalThis.createPontoView(root);
  const controls = Object.fromEntries([...root.querySelectorAll('[id]')].map((element) => [element.id, element]));
  const attachments = [];
  const log = [];
  let parsed = parseContacts('');
  let snapshot;
  let controller;
  let completed = 0;
  let confirmed = 0;

  globalThis.pontoPanel = { host, toggle: () => { if (!controller) host.hidden = !host.hidden; } };
  (document.body ?? document.documentElement).append(host);

  const reasons = {
    adapter: 'O WPPConnect não ficou pronto. Recarregue o WhatsApp Web e confira a compatibilidade.',
    conflict: 'Já existe outra versão do WPPConnect nesta página. Desative a outra extensão e recarregue.',
    login: 'Entre na sua conta no WhatsApp Web antes de enviar.',
    recipient: 'Use um telefone internacional ou um ID de grupo válido.',
    busy: 'Um envio anterior ainda está em andamento.',
    file: 'Falha ao preparar o arquivo. Confira o acesso ao arquivo e tente em um novo lote.',
    bridge: 'O painel perdeu contato com o WhatsApp Web.',
    mediaLimit: 'O arquivo excede o tamanho aceito pelo WhatsApp para esse formato.',
    unconfirmed: 'O WhatsApp não confirmou este item.',
    unsupported: 'Esta versão do WhatsApp Web não disponibilizou um dos tipos de mensagem selecionados.',
    invite: 'Não foi possível consultar o convite. Confira o ID e suas permissões no grupo.',
    contactSource: 'Não foi possível consultar a fonte de contatos selecionada.'
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
    return response.data;
  }

  async function sendItem(item, signal) {
    const { phone } = item.contact;
    if (item.rich) {
      await request('rich', { phone, kind: item.rich.kind, data: item.rich.data });
      return;
    }
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
      parsed = parseContacts(controls.contacts.value, { allowGroups: true });
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
    controls['clear-files'].hidden = !attachments.length;
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
      row.append(name, size);
      if (/^image\/(png|jpeg|webp|gif|bmp)$/.test(entry.file.type)) {
        const preview = document.createElement('button');
        preview.textContent = 'Prévia';
        preview.setAttribute('aria-label', `Visualizar ${entry.file.name}`);
        preview.addEventListener('click', async () => {
          const previous = li.querySelector('canvas');
          if (previous) return previous.remove();
          preview.disabled = true;
          try {
            const image = await createImageBitmap(entry.file);
            const canvas = document.createElement('canvas');
            const ratio = Math.min(1, 200 / image.width, 110 / image.height);
            canvas.width = Math.max(1, Math.round(image.width * ratio));
            canvas.height = Math.max(1, Math.round(image.height * ratio));
            canvas.className = 'thumbnail';
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', entry.file.name);
            try {
              canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
              li.append(canvas);
            } finally {
              image.close();
            }
          } catch {
            report('Não foi possível abrir a prévia deste arquivo.', true);
          } finally {
            preview.disabled = false;
          }
        });
        row.append(preview);
      }
      row.append(remove);
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
    let rich;
    try {
      rich = readRich(root);
    } catch (error) {
      return report(error.message, true);
    }
    if (!text && !attachments.length && !rich.length) return report('Adicione texto, arquivos ou uma mensagem especial.', true);
    if (rich.some(({ kind }) => kind === 'poll') && contacts.some(({ phone }) => !phone.endsWith('@g.us'))) {
      return report('O envio de enquete pelo WPPConnect aceita apenas grupos. Revise os destinatários.', true);
    }
    if (text && contacts.some((contact) => !personalize(text, contact).trim())) {
      return report('A mensagem fica vazia para algum destinatário. Confira os campos de personalização.', true);
    }

    const min = controls['delay-min'].valueAsNumber;
    const max = controls['delay-max'].valueAsNumber;
    if (![min, max].every((value) => Number.isInteger(value) && value >= 0 && value <= 3600) || min > max) {
      return report('Informe um intervalo inteiro de 0 a 3600 segundos, com máximo igual ou maior que o mínimo.', true);
    }

    snapshot = { contacts, text, rich, delay: { min, max }, continueOnError: controls['continue-on-error'].checked,
      attachments: attachments.map((entry) => ({ ...entry })),
      total: contacts.length * (Number(!!text) + attachments.length + rich.length) };
    completed = 0;
    confirmed = 0;
    controls.draft.disabled = true;
    controls.prepare.hidden = true;
    controls.progress.hidden = true;
    controls.consent.checked = false;
    controls.send.disabled = true;
    controls.summary.textContent = `${snapshot.total} item(ns) para ${contacts.length} destinatário(s).`;
    const sample = contacts.slice(0, 4).map(({ name, phone }) => name ? `${name} (${displayRecipient(phone)})` : displayRecipient(phone));
    if (contacts.length > sample.length) sample.push(`e mais ${contacts.length - sample.length}`);
    controls['recipient-preview'].textContent = sample.join(' · ');
    controls.review.hidden = false;
    controls.consent.focus();
    report('Confira a lista e confirme o envio.');
  }

  function displayRecipient(phone) {
    return phone.endsWith('@g.us') ? phone : `+${phone}`;
  }

  function downloadCsv(filename, rows) {
    const url = URL.createObjectURL(new Blob(['\uFEFF', csvText(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function logItem(item, status, detail = '') {
    const { phone, name } = item.contact;
    log.push([new Date().toISOString(), name, phone, item.label, status, detail]);
    const row = document.createElement('li');
    row.textContent = `${displayRecipient(phone)} · ${item.label} · ${status}`;
    const list = controls['report-items'];
    list.prepend(row);
    if (list.childElementCount > 12) list.lastElementChild.remove();
    controls['report-panel'].hidden = false;
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
        await request('prepare', { richKinds: snapshot.rich.map(({ kind }) => kind) });
        if (!snapshot.started && !controller.signal.aborted) {
          log.length = 0;
          controls['report-items'].replaceChildren();
          controls['report-panel'].hidden = true;
          snapshot.started = true;
        }
        return runQueue(snapshot, { startAt: completed, signal: controller.signal, send: sendItem,
          onProgress: (event, item, index, error) => {
            const detail = `${index}/${snapshot.total} · ${displayRecipient(item.contact.phone)} · ${item.label}`;
            if (event === 'waiting') report(`Aguardando o intervalo antes de ${displayRecipient(item.contact.phone)}.`);
            if (event === 'sending') report(`Processando ${detail}`);
            if (event === 'confirmed') {
              completed = index;
              confirmed++;
              controls.progress.value = completed;
              logItem(item, 'Confirmado');
              report(`WhatsApp confirmou ${detail}`);
            }
            if (event === 'failed') {
              completed = index;
              controls.progress.value = completed;
              logItem(item, 'Falha', error.message);
              const prefix = snapshot.continueOnError ? 'Falha em' : 'Fila interrompida em';
              report(`${prefix} ${detail}. ${confirmed} confirmado(s). ${error.message} Confira a conversa antes de reenviar.`, true);
            }
          }
        });
      });
      if (outcome.status === 'stopped') {
        controls.resume.hidden = false;
        controls.discard.hidden = false;
        report(`Lote pausado. ${confirmed} confirmado(s) e ${completed - confirmed} falha(s) de ${snapshot.total} item(ns).`);
      } else {
        if (outcome.status === 'done') {
          const failed = completed - confirmed;
          report(`WhatsApp confirmou ${confirmed} de ${snapshot.total} item(ns).${failed ? ` ${failed} falha(s) no relatório.` : ''}`, !!failed);
        }
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
  for (const mode of ['cloud', 'voice']) {
    controls[`open-${mode}`].addEventListener('click', async (event) => {
      if (!event.isTrusted) return;
      try {
        await request('openMode', { mode });
      } catch (error) {
        report(error.message, true);
      }
    });
  }
  controls['csv-model'].addEventListener('click', () => downloadCsv('ponto-contatos.csv', [
    ['nome', 'telefone', 'cidade'], ['Ana', '5511900000000', 'Recife']
  ]));
  controls.emoji.addEventListener('change', () => {
    const { value } = controls.emoji;
    if (!value) return;
    const input = controls.message;
    input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end');
    controls.emoji.value = '';
    input.focus();
    updatePreview();
  });
  controls['invite-fetch'].addEventListener('click', async (event) => {
    if (!event.isTrusted) return;
    const input = controls['invite-group'];
    const before = input.value;
    const id = groupId(before.trim());
    if (!id) return report('Informe um ID de grupo válido.', true);
    controls['invite-fetch'].disabled = true;
    try {
      await request('prepare');
      const code = await request('groupInviteCode', { groupId: id });
      if (input.value !== before || controls.draft.disabled) return;
      controls['invite-code'].value = code;
      report('Código do convite consultado.');
    } catch (error) {
      report(error.message, true);
    } finally {
      controls['invite-fetch'].disabled = false;
    }
  });
  controls['download-report'].addEventListener('click', () => downloadCsv('ponto-relatorio.csv', [
    ['Data UTC', 'Nome', 'Destinatário', 'Item', 'Status', 'Detalhe'], ...log
  ]));
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
      parseContacts(content, { allowGroups: true });
      controls.contacts.value = content;
      updatePreview();
      report('Lista importada. Revise os telefones antes de enviar.');
    } catch (error) {
      report(`Falha ao importar CSV. ${error.message}`, true);
    }
  });
  controls['add-files'].addEventListener('click', () => controls.files.click());
  controls['clear-files'].addEventListener('click', () => {
    attachments.length = 0;
    renderAttachments();
    controls['add-files'].focus();
    report('Fila de anexos limpa.');
  });
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
    report(`Lote encerrado com ${confirmed} confirmado(s) e ${completed - confirmed} falha(s).`);
  });
  globalThis.setupPontoContacts({ root, request, updatePreview, report });
  updatePreview();
})();
