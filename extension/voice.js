import { Wavoip } from '@wavoip/wavoip-api';
import qrcode from 'qrcode-generator';
import { canCall, createVoiceMedia, parseDevices, placeVoiceCall, voiceCsvRow, voiceDelay } from './voice-api.js';

const permissionOrigin = 'https://devices.wavoip.com/*';
const { parseContacts } = globalThis.PontoWorkflow;
const controls = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id, element]));
const names = new Map();
const subscriptions = new Map();
const log = [];
const outcomeLabels = {
  completed: 'Atendida', unanswered: 'Sem resposta', rejected: 'Recusada',
  stopped: 'Interrompida', failed: 'Falhou', uncertain: 'Confirmação pendente'
};
const deviceLabels = {
  open: 'Conectado', close: 'Aguardando vínculo', connecting: 'Aguardando QR',
  restarting: 'Reiniciando', hibernating: 'Em hibernação', BUILDING: 'Inicializando',
  WAITING_PAYMENT: 'Aguardando pagamento', EXTERNAL_INTEGRATION_ERROR: 'Erro de integração'
};

let sdk;
let context;
let currentMedia;
let qrToken;
let qrValue;
let activeRun;
let uncertain = false;
let connecting = false;

function report(target, message, error = false) {
  controls[target].textContent = message;
  controls[target].toggleAttribute('data-error', error);
}

function makeButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function createSdk() {
  return new Wavoip({
    tokens: [], language: 'pt-BR', platform: 'ponto',
    inputStreamFactory: () => {
      if (!currentMedia) throw new Error('Áudio da chamada indisponível.');
      return currentMedia.stream();
    }
  });
}

function removeDevice(token) {
  if (activeRun) return;
  for (const unsubscribe of subscriptions.get(token) ?? []) unsubscribe();
  subscriptions.delete(token);
  sdk.removeDevices([token]);
  names.delete(token);
  renderDevices();
  report('device-status', 'Dispositivo removido desta aba.');
}

function renderDevices() {
  const devices = sdk?.getDevices() ?? [];
  const rows = devices.map((device) => {
    const row = document.createElement('li');
    const name = document.createElement('strong');
    const status = document.createElement('span');
    const actions = document.createElement('div');
    row.className = 'device';
    name.textContent = names.get(device.token) ?? 'Dispositivo WaVoIP';
    const label = device.connectionStatus === 'connected' ? deviceLabels[device.status] ?? 'Indisponível' : 'Sem conexão';
    const suffix = device.contact?.phone ? ` · ${device.contact.phone}` : '';
    status.textContent = `${label}${suffix}${device.restricted ? ' · restrito' : ''}`;
    actions.className = 'actions';

    if (device.qrCode || device.status === 'connecting') {
      actions.append(makeButton('Mostrar QR', () => {
        qrToken = device.token;
        controls['qr-dialog'].showModal();
        renderQr();
      }));
    }
    const wake = device.status !== 'open';
    const repair = makeButton(wake ? 'Reativar' : 'Reiniciar', async () => {
      if (activeRun || repair.disabled) return;
      repair.disabled = true;
      try {
        if (wake) {
          if (!await device.wakeUp()) throw new Error('unavailable');
        } else {
          await device.restart();
        }
        report('device-status', 'Solicitação enviada ao WaVoIP. Acompanhe o estado do dispositivo.');
      } catch {
        report('device-status', 'O dispositivo não respondeu. Confira a sessão no painel WaVoIP.', true);
      } finally {
        renderDevices();
      }
    });
    repair.disabled = !!activeRun || device.activeCalls > 0;
    const remove = makeButton('Remover', () => removeDevice(device.token));
    remove.disabled = !!activeRun;
    actions.append(repair, remove);
    row.append(name, status, actions);
    return row;
  });
  controls.devices.replaceChildren(...rows);
  controls.start.disabled = uncertain || !devices.some(canCall);
  if (controls['qr-dialog'].open) renderQr();
}

function renderQr() {
  const device = sdk.getDevices().find((entry) => entry.token === qrToken);
  const canvas = controls['qr-canvas'];
  const code = device?.qrCode;
  canvas.hidden = !code;
  if (!code) {
    qrValue = undefined;
    canvas.width = 1;
    controls['qr-status'].textContent = device?.status === 'open' ? 'Dispositivo pareado.' : 'Aguardando QR do WaVoIP.';
    return;
  }
  if (qrValue === code) return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(code);
    qr.make();
    const size = qr.getModuleCount();
    const pixels = 6;
    canvas.width = canvas.height = (size + 8) * pixels;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#112820';
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qr.isDark(row, col)) ctx.fillRect((col + 4) * pixels, (row + 4) * pixels, pixels, pixels);
      }
    }
    qrValue = code;
    controls['qr-status'].textContent = 'Pronto para leitura.';
  } catch {
    canvas.hidden = true;
    controls['qr-status'].textContent = 'Não foi possível exibir o QR. Abra o painel WaVoIP.';
  }
}

controls['device-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!event.isTrusted || activeRun || connecting) return;
  let newDevices;
  try {
    newDevices = parseDevices(controls.tokens.value);
    if (!newDevices.size) throw new Error('Adicione pelo menos um token WaVoIP.');
  } catch (error) {
    report('device-status', error.message, true);
    return;
  }

  connecting = true;
  try {
    if (!await chrome.permissions.request({ origins: [permissionOrigin] })) {
      report('device-status', 'Permita a conexão com o WaVoIP para carregar os dispositivos.', true);
      return;
    }
    sdk ??= createSdk();
    for (const [token, name] of newDevices) names.set(token, name);
    for (const device of sdk.addDevices([...newDevices.keys()])) {
      const events = ['statusChanged', 'qrCodeChanged', 'contactChanged', 'connectionStatusChanged', 'restrictedChanged', 'activeCallsChanged'];
      subscriptions.set(device.token, events.map((name) => device.on(name, renderDevices)));
    }
    controls.tokens.value = '';
    renderDevices();
    report('device-status', 'Dispositivos adicionados. Acompanhe a conexão abaixo.');
  } catch {
    report('device-status', 'Não foi possível iniciar a conexão com o WaVoIP.', true);
  } finally {
    connecting = false;
  }
});

function updateContactCount() {
  try {
    const { contacts, invalid, duplicates } = parseContacts(controls.contacts.value);
    controls['contact-count'].textContent = `${contacts.length} válido(s) · ${duplicates} duplicado(s) · ${invalid.length} linha(s) inválida(s)`;
  } catch (error) {
    controls['contact-count'].textContent = error.message;
  }
}

function updateContactText(value) {
  if (activeRun) return;
  controls.contacts.value = value;
  updateContactCount();
}

controls['pick-csv'].addEventListener('click', () => controls['contact-file'].click());
controls['contact-file'].addEventListener('change', async () => {
  const file = controls['contact-file'].files[0];
  const before = controls.contacts.value;
  try {
    if (file) {
      const value = await file.text();
      if (controls.contacts.value === before) updateContactText(value);
    }
  } catch {
    report('call-status', 'Não foi possível ler o CSV.', true);
  } finally {
    controls['contact-file'].value = '';
  }
});
controls['from-chats'].addEventListener('click', async () => {
  const before = controls.contacts.value;
  try {
    report('call-status', 'Importando conversas do WhatsApp Web…');
    const response = await chrome.runtime.sendMessage({ operation: 'voice-import-contacts', recent: false });
    if (!response?.ok || !Array.isArray(response.contacts)) {
      report('call-status', 'Abra esta central a partir da aba do WhatsApp Web para importar conversas.', true);
      return;
    }
    const rows = response.contacts.map(({ name, phone }) => voiceCsvRow([name, phone]));
    if (controls.contacts.value === before && !activeRun) {
      if (rows.length) updateContactText(['nome;telefone', ...rows].join('\n'));
      report('call-status', `${rows.length} contato(s) encontrado(s).`);
    }
  } catch {
    report('call-status', 'Não foi possível importar conversas do WhatsApp Web.', true);
  }
});
controls.contacts.addEventListener('input', updateContactCount);

function appendCall(contact, token) {
  const entry = { name: contact.name, phone: contact.phone, device: names.get(token), status: 'Discando', duration: '' };
  const row = document.createElement('tr');
  const cells = ['name', 'phone', 'device', 'status', 'duration'].map((key) => {
    const cell = document.createElement('td');
    cell.textContent = entry[key];
    row.append(cell);
    return cell;
  });
  log.push(entry);
  controls.log.append(row);
  return {
    answered: () => { cells[3].textContent = entry.status = 'Em ligação'; },
    finish: (result) => {
      cells[3].textContent = entry.status = outcomeLabels[result.status];
      cells[4].textContent = entry.duration = `${result.duration} s`;
    }
  };
}

function configureRun() {
  const { contacts, invalid } = parseContacts(controls.contacts.value);
  if (invalid.length) throw new Error(`Corrija os telefones nas linhas ${invalid.slice(0, 8).join(', ')}${invalid.length > 8 ? ' e seguintes' : ''}.`);
  if (!contacts.length) throw new Error('Adicione ao menos um destinatário válido.');
  const devices = sdk?.getDevices().filter(canCall) ?? [];
  if (!devices.length) throw new Error('Aguarde um dispositivo WaVoIP ficar conectado.');
  const min = controls['min-delay'].valueAsNumber;
  const max = controls['max-delay'].valueAsNumber;
  if (max < min) throw new Error('O intervalo máximo deve ser maior ou igual ao mínimo.');
  return {
    contacts, tokens: devices.map((device) => device.token), min, max,
    ringMs: controls.ring.valueAsNumber * 1000, autoEnd: controls['auto-end'].checked,
    file: controls.recording.files[0]
  };
}

function setRunning(running) {
  controls['call-draft'].disabled = running;
  controls.tokens.disabled = running;
  controls['device-form'].querySelector('button[type=submit]').disabled = running;
  controls['run-actions'].hidden = !running;
  controls.pause.textContent = 'Pausar após esta ligação';
  controls.pause.disabled = false;
  controls.stop.disabled = false;
  controls.export.disabled = running || !log.length;
  controls['clear-log'].disabled = running || !log.length;
  renderDevices();
}

async function dispatch(settings, run) {
  const signal = run.controller.signal;
  context ??= new AudioContext();
  await context.resume();
  let buffer;
  if (settings.file) {
    try {
      buffer = await context.decodeAudioData(await settings.file.arrayBuffer());
    } catch {
      throw new Error('Não foi possível decodificar o áudio escolhido.');
    }
  }
  try {
    await sdk.preparePontoMedia();
  } catch {
    throw new Error('Não foi possível preparar o áudio local do WaVoIP.');
  }

  const progress = controls.progress;
  const total = settings.contacts.length;
  let answered = 0;
  let processed = 0;
  progress.max = total;
  progress.value = 0;
  progress.hidden = false;

  for (const [index, contact] of settings.contacts.entries()) {
    while (run.paused && !signal.aborted) await voiceDelay(120, signal);
    if (signal.aborted) break;
    const token = settings.tokens[index % settings.tokens.length];
    const media = createVoiceMedia(context, buffer);
    const row = appendCall(contact, token);
    currentMedia = media;
    report('call-status', `Ligando ${index + 1} de ${total}…`);
    let result;
    try {
      result = await placeVoiceCall(sdk, {
        phone: contact.phone, token, signal, ringMs: settings.ringMs,
        talkMs: buffer ? Math.ceil(buffer.duration * 1000) + 20000 : 120000,
        onAnswer: (end) => {
          row.answered();
          media.play(settings.autoEnd ? end : undefined);
        }
      });
    } finally {
      media.dispose();
      currentMedia = undefined;
    }
    row.finish(result);
    if (result.answered) answered++;
    progress.value = ++processed;
    if (result.status === 'uncertain') {
      uncertain = true;
      report('call-status', 'O WaVoIP não confirmou o encerramento. Confira o painel WaVoIP antes de abrir outro lote.', true);
      return;
    }
    if (index + 1 < total) {
      const delay = (settings.min + Math.random() * (settings.max - settings.min)) * 1000;
      await voiceDelay(delay, signal);
    }
  }

  const status = signal.aborted ? 'Lote interrompido' : 'Lote concluído';
  report('call-status', `${status}. ${processed} de ${total} processado(s) e ${answered} atendida(s).`);
}

controls['call-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!event.isTrusted || activeRun || connecting || uncertain || !controls.consent.checked) return;
  let settings;
  try {
    settings = configureRun();
  } catch (error) {
    report('call-status', error.message, true);
    return;
  }

  const run = { controller: new AbortController(), paused: false };
  activeRun = run;
  setRunning(true);
  report('call-status', 'Preparando o áudio e a fila…');
  try {
    await navigator.locks.request('ponto-wavoip-batch', { ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error('Outra aba do Ponto já está processando um lote WaVoIP.');
      await dispatch(settings, run);
    });
  } catch (error) {
    report('call-status', error.message, true);
  } finally {
    activeRun = undefined;
    controls.consent.checked = false;
    setRunning(false);
  }
});

controls.pause.addEventListener('click', () => {
  if (!activeRun) return;
  activeRun.paused = !activeRun.paused;
  controls.pause.textContent = activeRun.paused ? 'Retomar lote' : 'Pausar após esta ligação';
  report('call-status', activeRun.paused ? 'Pausa solicitada para depois da ligação atual.' : 'Fila retomada.');
});
controls.stop.addEventListener('click', () => {
  if (!activeRun) return;
  currentMedia?.silence();
  activeRun.controller.abort();
  controls.stop.disabled = controls.pause.disabled = true;
  report('call-status', 'Aguardando o encerramento da ligação atual…');
});

controls.export.addEventListener('click', () => {
  const csv = [voiceCsvRow(['Contato', 'Telefone', 'Dispositivo', 'Resultado', 'Duração']),
    ...log.map(({ name, phone, device, status, duration }) => voiceCsvRow([name, phone, device, status, duration], true))];
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ponto-ligacoes.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
controls['clear-log'].addEventListener('click', () => {
  log.length = 0;
  controls.log.replaceChildren();
  controls.export.disabled = controls['clear-log'].disabled = true;
});
controls['close-qr'].addEventListener('click', () => controls['qr-dialog'].close());
controls['qr-dialog'].addEventListener('close', () => {
  qrToken = qrValue = undefined;
  controls['qr-canvas'].width = 1;
});
window.addEventListener('beforeunload', (event) => {
  if (!activeRun) return;
  event.preventDefault();
  event.returnValue = true;
});
renderDevices();
updateContactCount();
