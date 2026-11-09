import { GRAPH_HOST, createCloudClient, GraphError, fileMedia, templateParameters, buildTemplateParameters, csvCell } from './cloud-api.js';

const $ = (id) => document.getElementById(id);
const elements = Object.fromEntries(Array.from(document.querySelectorAll('[id]'), (element) => [element.id, element]));
const { parseContacts, personalize } = globalThis.PontoWorkflow;
const files = [];
const log = [];
let cloud;
let templates = [];
let detailed;
let editing;
let pending;
let batch;
let pauseTimer;
let templateBusy = false;
let deleting;
let templateLoad = 0;

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

function status(id, message, error = false) {
  const element = elements[id];
  element.textContent = message;
  element.toggleAttribute('data-error', error);
}

function namedFields(form) {
  return Object.fromEntries(new FormData(form));
}

function translated(template, contact) {
  return personalize(template.replace(/\[number\]/gi, '[telefone]'), contact);
}

function labelInput(title, input) {
  const label = node('label', title);
  label.append(input);
  return label;
}

function fillSelect(select, entries, placeholder) {
  const previous = select.value;
  select.replaceChildren(new Option(placeholder, ''));
  for (const [name, id] of entries) select.add(new Option(name, id));
  if (entries.some(([, id]) => id === previous)) select.value = previous;
}

function definitionList(entries) {
  const list = node('dl');
  for (const [key, value] of entries) if (value !== undefined && value !== null && value !== '') list.append(node('dt', key), node('dd', value));
  return list;
}

function showAccount(account, phones) {
  $('account').replaceChildren(definitionList([
    ['Conta', account.name], ['WABA', account.id], ['Moeda', account.currency],
    ['Fuso', account.timezone_id], ['Namespace', account.message_template_namespace]
  ]));
  for (const phone of phones) $('account').append(definitionList([
    ['Número', phone.display_phone_number], ['Nome', phone.verified_name], ['ID', phone.id],
    ['Qualidade', phone.quality_rating], ['Status', phone.status]
  ]));
  fillSelect($('sender'), phones.map((phone) => [`${phone.display_phone_number || phone.id} · ${phone.verified_name || 'Remetente'}`, String(phone.id)]), 'Selecione o remetente');
  if (phones.length) $('sender').value = String(phones[0].id);
}

$('connect-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (cloud) return;
  const form = event.currentTarget;
  const connectButton = form.querySelector('button');
  if (connectButton.disabled) return;
  const fields = namedFields(form);
  form.elements.token.value = '';
  connectButton.disabled = true;
  let client;
  try {
    if (!await chrome.permissions.request({ origins: [GRAPH_HOST] })) throw new Error('Autorize o acesso à Graph API para conectar.');
    status('connect-status', 'Verificando conta e números na Meta…');
    client = createCloudClient(fields);
    fields.token = '';
    const [account, phones] = await Promise.all([client.account(), client.phones()]);
    cloud = client;
    showAccount(account, phones);
    form.hidden = true;
    $('connected').hidden = false;
    $('workspace').hidden = false;
    $('connection-badge').textContent = 'Conectado';
    status('connect-status', phones.length ? 'Sessão ativa nesta aba.' : 'A conta está conectada. Vincule um número na Meta para enviar.');
    await refreshTemplates();
  } catch (error) {
    client?.close();
    cloud = undefined;
    status('connect-status', error.message, true);
  } finally {
    fields.token = '';
    connectButton.disabled = false;
  }
});

$('disconnect').addEventListener('click', () => {
  if (batch || templateBusy || deleting) return;
  cloud?.close();
  cloud = undefined;
  templates = [];
  templateLoad++;
  detailed = undefined;
  pending = undefined;
  files.length = 0;
  $('message-form').reset();
  $('template-list').replaceChildren();
  $('refresh-templates').disabled = false;
  $('template-params').replaceChildren();
  $('template-detail').hidden = true;
  $('account').replaceChildren();
  $('analytics-result').replaceChildren();
  $('send-status').replaceChildren();
  $('templates-status').replaceChildren();
  resetEditor();
  renderMedia();
  resetLog();
  setMode();
  $('connected').hidden = true;
  $('workspace').hidden = true;
  $('connect-form').hidden = false;
  $('connection-badge').textContent = 'Desconectado';
  status('connect-status', 'Token removido da sessão local.');
});

function selectTemplate(value) {
  return templates.find((template) => String(template.id) === value);
}

async function refreshTemplates() {
  const client = cloud;
  if (!client) return;
  const revision = ++templateLoad;
  $('refresh-templates').disabled = true;
  status('templates-status', 'Carregando templates…');
  try {
    const loaded = await client.templates();
    if (cloud !== client || revision !== templateLoad) return;
    templates = loaded;
    detailed = detailed && selectTemplate(String(detailed.id));
    fillSelect($('send-template'), templates.filter(({ status }) => status === 'APPROVED')
      .map((item) => [`${item.name} (${item.language})`, String(item.id)]), 'Selecione um template aprovado');
    fillSelect($('analytics-template'), templates.map((item) => [`${item.name} (${item.language})`, String(item.id)]), 'Selecione um template');
    renderTemplateList();
    showDetail(detailed);
    if ($('template-params').dataset.template !== $('send-template').value) renderSendParameters();
    status('templates-status', `${templates.length} template(s) encontrado(s).`);
  } catch (error) {
    if (cloud === client && revision === templateLoad) status('templates-status', error.message, true);
  } finally {
    if (revision === templateLoad) $('refresh-templates').disabled = false;
  }
}

function renderTemplateList() {
  const query = $('template-search').value.toLowerCase().trim();
  const list = $('template-list');
  list.replaceChildren();
  for (const template of templates) {
    if (![template.name, template.language, template.status, template.category].some((text) => String(text).toLowerCase().includes(query))) continue;
    const item = node('div');
    item.className = 'template-item';
    const title = node('div');
    const name = node('strong', template.name);
    title.append(name, node('div', `${template.language} · ${template.category} · ${template.status}`));
    const detail = node('button', 'Detalhes');
    detail.addEventListener('click', () => showDetail(template));
    item.append(title, detail);
    list.append(item);
  }
  if (!list.children.length) list.append(node('p', 'Nenhum template encontrado.'));
}

function showDetail(template) {
  detailed = template;
  $('template-detail').hidden = !template;
  $('template-details-text').replaceChildren();
  if (!template) return;
  $('choose-template').disabled = template.status !== 'APPROVED';
  const entries = [['Template', template.name], ['ID', template.id]];
  for (const component of template.components ?? []) {
    const description = component.text || component.buttons?.map((item) => item.text || item.type).join(' · ') || component.format;
    entries.push([component.type, description]);
  }
  $('template-details-text').append(definitionList(entries));
}

$('refresh-templates').addEventListener('click', refreshTemplates);
$('template-search').addEventListener('input', renderTemplateList);
$('choose-template').addEventListener('click', () => {
  if (!detailed || batch) return;
  $('send-mode').value = 'template';
  $('send-template').value = String(detailed.id);
  setMode();
  renderSendParameters();
  $('send-template').focus();
});

$('delete-template').addEventListener('click', () => {
  if (!detailed || batch || templateBusy || deleting) return;
  deleting = detailed;
  $('delete-summary').textContent = `Excluir ${deleting.name} (${deleting.language}) da conta Meta?`;
  $('delete-dialog').showModal();
});
$('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
$('delete-dialog').addEventListener('close', () => { deleting = undefined; });
$('confirm-delete').addEventListener('click', async () => {
  if (!deleting || !cloud || templateBusy) return;
  const template = deleting;
  templateBusy = true;
  $('delete-dialog').close();
  try {
    const result = await cloud.deleteTemplate(template);
    if (!result.success) throw new Error('A Meta não confirmou a exclusão do template.');
    if (editing?.id === template.id) resetEditor();
    await refreshTemplates();
  } catch (error) {
    status('templates-status', error.message, true);
  } finally {
    templateBusy = false;
  }
});

function setEditorFields() {
  const otp = $('category').value === 'AUTHENTICATION';
  $('otp-form').hidden = !otp;
  $('standard-form').hidden = otp;
  const format = $('header-format').value;
  $('editor-header-text').hidden = format !== 'TEXT';
  $('editor-header-media').hidden = !['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format);
}

function resetEditor() {
  const form = $('template-form');
  editing = undefined;
  form.reset();
  form.elements.name.disabled = false;
  form.elements.language.disabled = false;
  $('template-buttons').replaceChildren();
  $('editor-title').textContent = 'Criar template';
  $('reset-editor').hidden = true;
  setEditorFields();
}

function addTemplateButton(initial = {}) {
  const row = node('div');
  row.className = 'button-row';
  const kind = node('select');
  for (const [title, value] of [['Resposta rápida', 'QUICK_REPLY'], ['URL', 'URL'], ['Telefone', 'PHONE_NUMBER']]) kind.add(new Option(title, value));
  kind.value = initial.type || 'QUICK_REPLY';
  const text = node('input');
  text.value = initial.text || '';
  const target = node('input');
  target.value = initial.url || initial.phone_number || '';
  const example = node('input');
  example.value = initial.example?.[0] || '';
  const targetLabel = labelInput('URL ou telefone', target);
  const exampleLabel = labelInput('Exemplo para URL com variável', example);
  const remove = node('button', 'Remover botão');
  remove.type = 'button';
  remove.addEventListener('click', () => row.remove());
  const update = () => {
    targetLabel.hidden = kind.value === 'QUICK_REPLY';
    exampleLabel.hidden = kind.value !== 'URL' || !target.value.includes('{{1}}');
  };
  kind.addEventListener('change', update);
  target.addEventListener('input', update);
  row.append(labelInput('Tipo de botão', kind), labelInput('Texto', text), targetLabel, exampleLabel, remove);
  $('template-buttons').append(row);
  update();
}

function editSelectedTemplate() {
  if (!detailed || batch || templateBusy) return;
  if (detailed.category !== 'AUTHENTICATION' && (detailed.components ?? []).some((component) =>
    !['HEADER', 'BODY', 'FOOTER', 'BUTTONS'].includes(component.type) ||
    (component.type === 'HEADER' && !['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(component.format)) ||
    component.buttons?.some((button) => !['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(button.type)))) {
    return status('templates-status', 'Este template contém componentes que devem ser editados no Gerenciador da Meta.', true);
  }
  resetEditor();
  editing = detailed;
  const form = $('template-form');
  form.elements.name.value = editing.name;
  form.elements.name.disabled = true;
  form.elements.language.value = editing.language;
  form.elements.language.disabled = true;
  form.elements.category.value = editing.category;
  for (const component of editing.components ?? []) {
    if (component.type === 'HEADER') {
      form.elements.headerFormat.value = component.format;
      form.elements.headerText.value = component.text || '';
      form.elements.headerExample.value = component.example?.header_text?.[0] || component.example?.header_text_named_params?.[0]?.example || '';
      form.elements.headerHandle.value = component.example?.header_handle?.[0] || '';
    }
    if (component.type === 'BODY') {
      form.elements.body.value = component.text || '';
      form.elements.bodyExamples.value = (component.example?.body_text?.[0] || component.example?.body_text_named_params?.map((item) => item.example) || []).join('\n');
      form.elements.security.checked = component.add_security_recommendation ?? true;
    }
    if (component.type === 'FOOTER') {
      form.elements.footer.value = component.text || '';
      form.elements.expiry.value = component.code_expiration_minutes || '';
    }
    if (component.type === 'BUTTONS' && editing.category !== 'AUTHENTICATION') component.buttons?.forEach(addTemplateButton);
  }
  $('editor-title').textContent = `Editar ${editing.name}`;
  $('reset-editor').hidden = false;
  $('template-editor').open = true;
  setEditorFields();
  $('template-editor').scrollIntoView({ block: 'nearest' });
}

$('edit-template').addEventListener('click', editSelectedTemplate);
$('reset-editor').addEventListener('click', resetEditor);
$('category').addEventListener('change', setEditorFields);
$('header-format').addEventListener('change', setEditorFields);
$('add-template-button').addEventListener('click', () => addTemplateButton());

async function templateComponents(fields) {
  if (fields.category === 'AUTHENTICATION') {
    const components = [{ type: 'BODY', add_security_recommendation: Boolean(fields.security) }];
    if (fields.expiry) components.push({ type: 'FOOTER', code_expiration_minutes: Number(fields.expiry) });
    components.push({ type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copiar código' }] });
    return components;
  }
  const components = [];
  if (fields.headerFormat === 'TEXT') {
    const header = { type: 'HEADER', format: 'TEXT', text: fields.headerText.trim() };
    if (!header.text) throw new Error('Informe o texto do cabeçalho.');
    if (/\{\{/.test(header.text)) {
      if (!fields.headerExample.trim()) throw new Error('Informe um exemplo para a variável do cabeçalho.');
      const variable = templateParameters({ components: [header] })[0]?.fields[0];
      if (!variable) throw new Error('Confira o formato da variável do cabeçalho.');
      header.example = /^\d+$/.test(variable) ? { header_text: [fields.headerExample.trim()] } :
        { header_text_named_params: [{ param_name: variable, example: fields.headerExample.trim() }] };
    }
    components.push(header);
  }
  const body = { type: 'BODY', text: fields.body.trim() };
  if (!body.text) throw new Error('Informe o corpo do template.');
  const variables = templateParameters({ components: [body] })[0]?.fields || [];
  if (variables.length) {
    const samples = fields.bodyExamples.split('\n').map((value) => value.trim()).filter(Boolean);
    if (samples.length !== variables.length) throw new Error(`Informe ${variables.length} exemplo(s) para as variáveis do corpo.`);
    body.example = variables.every((value) => /^\d+$/.test(value)) ? { body_text: [samples] } :
      { body_text_named_params: variables.map((param_name, index) => ({ param_name, example: samples[index] })) };
  }
  components.push(body);
  if (fields.footer.trim()) components.push({ type: 'FOOTER', text: fields.footer.trim() });
  const buttons = [];
  for (const row of $('template-buttons').children) {
    const [kind, text, target, example] = row.querySelectorAll('select, input');
    const item = { type: kind.value, text: text.value.trim() };
    if (!item.text) throw new Error('Preencha o texto dos botões.');
    if (item.type === 'URL') {
      if (!/^https?:\/\/\S+$/.test(target.value.trim())) throw new Error('Preencha a URL dos botões.');
      item.url = target.value.trim();
      if (item.url.includes('{{1}}')) {
        if (!example.value.trim()) throw new Error('Preencha um exemplo para a URL variável.');
        item.example = [example.value.trim()];
      }
    }
    if (item.type === 'PHONE_NUMBER') {
      if (!/^\+?[1-9]\d{7,14}$/.test(target.value.trim())) throw new Error('Informe o telefone internacional do botão.');
      item.phone_number = target.value.trim();
    }
    buttons.push(item);
  }
  if (buttons.length) components.push({ type: 'BUTTONS', buttons });
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(fields.headerFormat)) {
    const file = $('header-file').files[0];
    const handle = file ? await cloud.uploadTemplateExample(fields.appId, file, fields.headerFormat.toLowerCase()) : fields.headerHandle.trim();
    if (!handle) throw new Error('Informe o identificador ou o arquivo de exemplo para o cabeçalho.');
    components.unshift({ type: 'HEADER', format: fields.headerFormat, example: { header_handle: [handle] } });
  }
  return components;
}

$('template-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (batch || templateBusy || !cloud) return;
  const form = event.currentTarget;
  const fields = namedFields(form);
  const previous = editing;
  const submit = form.querySelector('[type=submit]');
  templateBusy = true;
  submit.disabled = true;
  status('templates-status', 'Enviando template para revisão da Meta…');
  try {
    const components = await templateComponents(fields);
    const parameterFormat = components.some((component) => component.example?.body_text_named_params || component.example?.header_text_named_params) ? 'NAMED' : 'POSITIONAL';
    const draft = { category: fields.category, components };
    const response = previous ? await cloud.editTemplate(previous.id, draft) :
      await cloud.createTemplate({ ...draft, name: fields.name, language: fields.language, parameter_format: parameterFormat });
    if (!response.success && !response.id) throw new Error('A Meta não confirmou a solicitação.');
    resetEditor();
    await refreshTemplates();
    status('templates-status', response.status ? `Template recebido pela Meta. Status ${response.status}.` : 'A Meta confirmou a atualização do template.');
  } catch (error) {
    status('templates-status', error.message, true);
  } finally {
    templateBusy = false;
    submit.disabled = false;
  }
});

function renderSendParameters() {
  const container = $('template-params');
  const templateId = $('send-template').value;
  container.replaceChildren();
  container.dataset.template = templateId;
  templateParameters(selectTemplate(templateId)).forEach(({ type, kind, fields, index }, group) => {
    fields.forEach((field, position) => {
      const input = node('input');
      input.dataset.parameter = `${group}-${position}`;
      const label = type === 'button' ? `Botão ${Number(index) + 1}` : type === 'header' ? 'Cabeçalho' : 'Corpo';
      input.placeholder = ['image', 'video', 'document'].includes(kind) ? 'URL HTTPS pública ou ID de mídia' : '[nome]';
      container.append(labelInput(`${label} · ${field}`, input));
    });
  });
}

function setMode() {
  const template = $('send-mode').value === 'template';
  $('template-message').hidden = !template;
  $('free-message').hidden = template;
}

$('send-mode').addEventListener('change', setMode);
$('send-template').addEventListener('change', renderSendParameters);

function renderMedia() {
  const list = $('media-list');
  list.replaceChildren();
  for (const item of files) {
    const row = node('li');
    const actions = node('div');
    actions.className = 'actions';
    const remove = node('button', 'Remover');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remover ${item.file.name}`);
    remove.addEventListener('click', () => {
      files.splice(files.indexOf(item), 1);
      renderMedia();
      $('media-files').focus();
    });
    actions.append(node('strong', item.file.name), remove);
    row.append(actions);
    if (['image', 'video', 'document'].includes(item.kind)) {
      const input = node('input');
      input.value = item.caption;
      input.addEventListener('input', () => { item.caption = input.value; });
      row.append(labelInput('Legenda', input));
    }
    list.append(row);
  }
}

function addMedia(selected) {
  if (batch) return;
  const errors = [];
  for (const file of selected) {
    try {
      files.push({ file, ...fileMedia(file), caption: '' });
    } catch (error) {
      errors.push(error.message);
    }
  }
  renderMedia();
  const rejected = errors.length ? ` ${errors.slice(0, 3).join(' ')}${errors.length > 3 ? ` Mais ${errors.length - 3} rejeitado(s).` : ''}` : '';
  status('send-status', `${files.length} arquivo(s) selecionado(s).${rejected}`, Boolean(errors.length));
}

$('media-files').addEventListener('change', (event) => {
  addMedia(event.target.files);
  event.target.value = '';
});
$('drop-zone').addEventListener('dragover', (event) => {
  event.preventDefault();
  if (!batch) $('drop-zone').classList.add('drag');
});
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('drag'));
$('drop-zone').addEventListener('drop', (event) => {
  event.preventDefault();
  $('drop-zone').classList.remove('drag');
  addMedia(event.dataTransfer.files);
});

$('recipients-csv').addEventListener('change', async (event) => {
  const input = event.target;
  const file = input.files[0];
  input.value = '';
  if (!file || batch) return;
  const before = $('recipients').value;
  try {
    const text = await file.text();
    parseContacts(text);
    if (batch || $('recipients').value !== before) return;
    $('recipients').value = text;
    status('send-status', 'Lista importada. Confira os destinatários.');
  } catch (error) {
    status('send-status', error.message, true);
  }
});

function importCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

$('import-wa').addEventListener('click', async () => {
  if (batch) return;
  const before = $('recipients').value;
  const button = $('import-wa');
  button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ operation: 'cloud-import-contacts', recent: $('recent-only').checked });
    if (!result?.ok) throw new Error('Abra a API oficial pelo Ponto em uma aba conectada ao WhatsApp Web.');
    if (batch || $('recipients').value !== before) return;
    $('recipients').value = ['nome;telefone', ...result.contacts.map(({ name, phone }) => `${importCell(name)};${importCell(phone)}`)].join('\n');
    status('send-status', `${result.contacts.length} contato(s) importado(s). Confira os destinatários.`);
  } catch (error) {
    status('send-status', error.message, true);
  } finally {
    button.disabled = false;
  }
});

function prepareBatch() {
  const sender = $('sender').value;
  if (!sender) throw new Error('Selecione um número remetente.');
  const { contacts, invalid, duplicates } = parseContacts($('recipients').value);
  if (invalid.length) throw new Error(`Confira os telefones nas linhas ${invalid.slice(0, 8).join(', ')}${invalid.length > 8 ? ' e seguintes' : ''}.`);
  if (!contacts.length) throw new Error('Adicione ao menos um destinatário.');
  const minimum = $('delay-min').valueAsNumber * 1000;
  const maximum = $('delay-max').valueAsNumber * 1000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum < minimum || maximum > 900000) {
    throw new Error('Informe um intervalo entre 0 e 900 segundos, com o máximo maior ou igual ao mínimo.');
  }

  let items;
  let components;
  if ($('send-mode').value === 'template') {
    const template = selectTemplate($('send-template').value);
    if (!template || template.status !== 'APPROVED') throw new Error('Selecione um template aprovado pela Meta.');
    const parameters = new Map(Array.from($('template-params').querySelectorAll('input'), (input) => [input.dataset.parameter, input.value]));
    const groups = templateParameters(template);
    components = contacts.map((contact) => buildTemplateParameters(groups, (group, position) =>
      translated(parameters.get(`${group}-${position}`) || '', contact)));
    items = [{ type: 'template', label: template.name, template }];
  } else {
    const text = $('message-text').value.trim();
    items = files.map((item) => ({ type: 'media', label: item.file.name, ...item }));
    if (text) {
      if (contacts.some((contact) => !translated(text, contact).trim())) throw new Error('A personalização deixou a mensagem vazia para um destinatário.');
      items.unshift({ type: 'text', label: 'Texto', text });
    }
    if (!items.length) throw new Error('Escreva uma mensagem ou selecione arquivos.');
  }
  return { sender, contacts, items, components, duplicates, minimum, maximum,
    total: contacts.length * items.length, cursor: 0, nextAt: 0, uploads: new Map() };
}

$('message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (batch || pending || templateBusy || !cloud) return;
  try {
    pending = prepareBatch();
    $('review-summary').textContent = `${pending.total} item(ns) para ${pending.contacts.length} destinatário(s)${pending.duplicates ? ` · ${pending.duplicates} duplicado(s) ignorado(s)` : ''}.`;
    const sample = pending.contacts.slice(0, 4).map(({ name, phone }) => name ? `${name} (+${phone})` : `+${phone}`);
    if (pending.contacts.length > sample.length) sample.push(`e mais ${pending.contacts.length - sample.length}`);
    $('review-contacts').textContent = sample.join(' · ');
    $('send-consent').checked = false;
    $('confirm-send').disabled = true;
    $('review-dialog').showModal();
  } catch (error) {
    status('send-status', error.message, true);
  }
});

$('review-dialog').addEventListener('close', () => { pending = undefined; });
$('cancel-review').addEventListener('click', () => $('review-dialog').close());
$('send-consent').addEventListener('change', () => { $('confirm-send').disabled = !$('send-consent').checked; });
$('confirm-send').addEventListener('click', (event) => {
  if (!event.isTrusted || !$('send-consent').checked || !pending || batch || !cloud) return;
  batch = pending;
  pending = undefined;
  $('review-dialog').close();
  resetLog();
  $('progress').max = batch.total;
  $('progress').value = 0;
  $('progress').hidden = false;
  $('draft').disabled = true;
  $('sender').disabled = true;
  $('disconnect').disabled = true;
  void executeBatch();
});

function resetLog() {
  log.length = 0;
  $('log-rows').replaceChildren();
  $('log-table').hidden = true;
  $('log-download').hidden = true;
  $('progress').hidden = true;
}

function appendLog(contact, item, outcome, details) {
  log.push({ at: new Date().toISOString(), name: contact.name, phone: contact.phone, item: item.label, outcome, details });
  const row = node('tr');
  row.append(node('td', `${contact.name || 'Contato'} · +${contact.phone}`), node('td', item.label), node('td', `${outcome}${details ? ` · ${details}` : ''}`));
  const body = $('log-rows');
  body.append(row);
  if (body.children.length > 80) body.firstElementChild.remove();
  $('log-table').hidden = false;
  $('log-download').hidden = false;
}

$('log-download').addEventListener('click', () => {
  if (!log.length) return;
  const table = [['Horário UTC', 'Nome', 'Telefone', 'Item', 'Resultado', 'Detalhes'], ...log.map((row) => Object.values(row))];
  const content = '\uFEFF' + table.map((row) => row.map(csvCell).join(';')).join('\r\n');
  const link = node('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  link.download = 'ponto-meta-relatorio.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

function pauseFor(ms) {
  if (ms <= 0) return Promise.resolve();
  pauseTimer = new AbortController();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    pauseTimer.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  }).finally(() => { pauseTimer = undefined; });
}

async function sendItem(current, contact, contactIndex, item) {
  const { sender } = current;
  if (item.type === 'text') return cloud.sendText(sender, contact.phone, translated(item.text, contact));
  if (item.type === 'template') return cloud.sendTemplate(sender, contact.phone, item.template, current.components[contactIndex]);
  if (!current.uploads.has(item)) current.uploads.set(item, await cloud.upload(sender, item.file));
  if (current.stop || current.paused) return undefined;
  return cloud.sendMedia(sender, contact.phone, current.uploads.get(item), translated(item.caption, contact), item.file.name);
}

async function runBatch(current) {
  while (current.cursor < current.total && !current.paused && !current.stop) {
    await pauseFor(current.nextAt - Date.now());
    if (current.paused || current.stop) return;
    const contactIndex = Math.floor(current.cursor / current.items.length);
    const contact = current.contacts[contactIndex];
    const item = current.items[current.cursor % current.items.length];
    status('send-status', `Processando ${current.cursor + 1}/${current.total} · +${contact.phone} · ${item.label}`);
    try {
      const response = await sendItem(current, contact, contactIndex, item);
      if (response === undefined && (current.paused || current.stop)) return;
      const id = response?.messages?.[0]?.id;
      if (!id) throw new Error('A Meta não retornou um ID para o envio.');
      appendLog(contact, item, 'Aceito pela Meta', id);
    } catch (error) {
      appendLog(contact, item, error instanceof GraphError && error.canSkipItem ? 'Rejeitado pela Meta' : 'Interrompido', error.message);
      if (!(error instanceof GraphError && error.canSkipItem)) throw error;
    }
    $('progress').value = ++current.cursor;
    current.nextAt = Date.now() + current.minimum + Math.round(Math.random() * (current.maximum - current.minimum));
  }
}

async function executeBatch() {
  const current = batch;
  if (!current || current.running) return;
  current.running = true;
  current.paused = false;
  $('pause').hidden = false;
  $('pause').disabled = false;
  $('resume').hidden = true;
  $('stop').hidden = false;
  $('stop').disabled = false;
  try {
    await navigator.locks.request(`ponto-cloud-${current.sender}`, { ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error('Já existe um lote em execução para este remetente.');
      await runBatch(current);
    });
    if (current.stop) {
      endBatch(`Lote encerrado. ${current.cursor}/${current.total} item(ns) processado(s).`);
    } else if (current.cursor === current.total) {
      const accepted = log.filter(({ outcome }) => outcome === 'Aceito pela Meta').length;
      endBatch(`${accepted}/${current.total} item(ns) aceito(s) pela Meta. A aceitação não confirma entrega.`);
    } else {
      $('pause').hidden = true;
      $('resume').hidden = false;
      status('send-status', `Lote pausado. ${current.cursor}/${current.total} item(ns) processado(s).`);
    }
  } catch (error) {
    endBatch(`Fila interrompida. ${error.message} Confira o relatório antes de iniciar outro lote.`, true);
  } finally {
    current.running = false;
  }
}

function endBatch(message, error = false) {
  batch = undefined;
  $('pause').hidden = true;
  $('resume').hidden = true;
  $('stop').hidden = true;
  $('draft').disabled = false;
  $('sender').disabled = false;
  $('disconnect').disabled = false;
  status('send-status', message, error);
}

$('pause').addEventListener('click', () => {
  if (!batch || !batch.running) return;
  batch.paused = true;
  pauseTimer?.abort();
  $('pause').disabled = true;
  status('send-status', 'Pausando após o item em processamento…');
});
$('resume').addEventListener('click', (event) => { if (event.isTrusted) void executeBatch(); });
$('stop').addEventListener('click', () => {
  if (!batch) return;
  if (!batch.running) {
    endBatch(`Lote encerrado. ${batch.cursor}/${batch.total} item(ns) processado(s).`);
    return;
  }
  batch.stop = true;
  pauseTimer?.abort();
  $('stop').disabled = true;
  $('pause').disabled = true;
  status('send-status', 'Encerrando após o item em processamento…');
});

$('analytics-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const client = cloud;
  if (!client) return;
  const button = event.currentTarget.querySelector('button');
  if (button.disabled) return;
  const template = selectTemplate($('analytics-template').value);
  const start = Date.parse(`${$('analytics-start').value}T00:00:00Z`) / 1000;
  const end = Date.parse(`${$('analytics-end').value}T23:59:59Z`) / 1000;
  if (!template || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return status('analytics-result', 'Selecione um template e um período válido.', true);
  }
  button.disabled = true;
  status('analytics-result', 'Carregando métricas…');
  try {
    const { data } = await client.analytics({ start, end, ids: [template.id] });
    if (client !== cloud) return;
    const points = data?.flatMap((entry) => entry.data_points ?? []) || [];
    if (!points.length) return status('analytics-result', 'Sem dados para o período selecionado.');
    const sum = (key) => points.reduce((total, point) => total + (Number(point[key]) || 0), 0);
    const clicked = points.reduce((total, point) => total + (Array.isArray(point.clicked)
      ? point.clicked.reduce((count, item) => count + (Number(item.count) || 0), 0) : Number(point.clicked) || 0), 0);
    $('analytics-result').removeAttribute('data-error');
    $('analytics-result').replaceChildren(definitionList([
      ['Enviados', sum('sent')], ['Entregues', sum('delivered')], ['Lidos', sum('read')], ['Cliques', clicked]
    ]));
  } catch (error) {
    if (client === cloud) status('analytics-result', error.message, true);
  } finally {
    button.disabled = false;
  }
});

const now = Date.now();
$('analytics-end').value = new Date(now).toISOString().slice(0, 10);
$('analytics-start').value = new Date(now - 6 * 86400000).toISOString().slice(0, 10);
