const phonePattern = /^[1-9]\d{7,14}$/;
const tokenPattern = /^[A-Za-z0-9_-]+$/;

export function parseDevices(input) {
  const devices = new Map();
  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const separator = line.indexOf(',');
    const token = line.slice(separator + 1).trim();
    if (!tokenPattern.test(token)) throw new Error(`Token inválido na linha ${index + 1}.`);
    if (!devices.has(token)) {
      const name = separator < 0 ? '' : line.slice(0, separator).trim();
      devices.set(token, name || `Dispositivo ${devices.size + 1}`);
    }
  }
  return devices;
}

export function voiceCsvRow(values, protectFormulas = false) {
  return values.map((value) => {
    let text = String(value ?? '');
    if (protectFormulas && /^\s*[=+\-@]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(';');
}

export function canCall(device) {
  return device.status === 'open' && device.connectionStatus === 'connected';
}

export function createVoiceMedia(context, buffer) {
  const output = context.createMediaStreamDestination();
  const source = buffer ? context.createBufferSource() : undefined;
  if (source) {
    source.buffer = buffer;
    source.connect(output);
  }
  const tracks = new Set(output.stream.getTracks());
  let playing = false;
  let silenced = false;
  let disposed = false;

  function silence() {
    if (!source || silenced) return;
    silenced = true;
    source.onended = null;
    if (playing) source.stop();
  }

  return {
    stream() {
      if (disposed) throw new Error('O áudio da chamada foi encerrado.');
      const clone = output.stream.clone();
      for (const track of clone.getTracks()) tracks.add(track);
      return clone;
    },
    play(onEnded) {
      if (!source || playing || silenced || disposed) return;
      playing = true;
      source.onended = onEnded;
      source.start();
    },
    silence,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (source) {
        silence();
        source.disconnect();
      }
      for (const track of tracks) track.stop();
    }
  };
}

export function voiceDelay(milliseconds, signal) {
  if (signal.aborted || !milliseconds) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

function result(status, answeredAt) {
  return { status, answered: answeredAt !== undefined,
    duration: answeredAt === undefined ? 0 : Math.round((performance.now() - answeredAt) / 1000) };
}

function observeCall(outgoing, { signal, ringMs, talkMs, endMs, onAnswer }) {
  return new Promise((resolve) => {
    let active;
    let answeredAt;
    let ending;
    let endRequestedFor;
    let deadline;
    let talkTimer;
    let finished = false;
    const listeners = [];
    const ringTimer = setTimeout(() => requestEnd('unanswered'), ringMs);

    function finish(status) {
      if (finished) return;
      finished = true;
      clearTimeout(ringTimer);
      clearTimeout(talkTimer);
      clearTimeout(deadline);
      signal.removeEventListener('abort', abort);
      for (const unsubscribe of listeners) unsubscribe();
      resolve(result(status, answeredAt));
    }

    function requestEnd(status) {
      if (finished) return;
      ending ??= status;
      deadline ??= setTimeout(() => finish('uncertain'), endMs);
      const target = active ?? outgoing;
      if (endRequestedFor === target) return;
      endRequestedFor = target;
      // Wait for the terminal event, including if cancel races with peerAccept.
      void Promise.resolve().then(() => target === active ? active.end() : outgoing.cancel()).catch(() => {});
    }

    function ended(call) {
      if (call.status === 'FAILED' || call.status === 'DISCONNECTED') finish('failed');
      else if (call.status === 'REJECTED') finish('rejected');
      else if (call.status === 'NOT_ANSWERED') finish('unanswered');
      else finish(ending ?? (active ? 'completed' : 'unanswered'));
    }

    function abort() { requestEnd('stopped'); }
    function subscribe(call, event, listener) {
      listeners.push(call.on(event, listener));
    }

    subscribe(outgoing, 'peerAccept', (call) => {
      active = call;
      answeredAt = performance.now();
      clearTimeout(ringTimer);
      subscribe(call, 'ended', () => ended(call));
      if (ending || signal.aborted) requestEnd(ending ?? 'stopped');
      else {
        talkTimer = setTimeout(() => requestEnd('completed'), talkMs);
        try {
          onAnswer(() => requestEnd('completed'));
        } catch {
          requestEnd('failed');
        }
      }
    });
    subscribe(outgoing, 'ended', () => ended(active ?? outgoing));
    subscribe(outgoing, 'peerReject', () => finish('rejected'));
    subscribe(outgoing, 'unanswered', () => finish('unanswered'));
    subscribe(outgoing, 'status', (status) => { if (status === 'FAILED') finish('failed'); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function placeVoiceCall(sdk, options) {
  const { phone, token, signal, startMs = 30000, endMs = 15000 } = options;
  if (signal.aborted) return result('stopped');
  if (!phonePattern.test(phone) || !tokenPattern.test(token)) return result('failed');

  const pending = Promise.resolve().then(() => sdk.startCall({ to: `+${phone}`, fromTokens: [token] }));
  let deadline;
  const timeout = new Promise((resolve) => { deadline = setTimeout(() => resolve(undefined), startMs); });
  let response;
  try {
    response = await Promise.race([pending, timeout]);
  } catch {
    return result('uncertain');
  } finally {
    clearTimeout(deadline);
  }

  if (!response) {
    // A late acknowledgement can still return a live call. Try to end it, never redial it.
    void pending.then(({ call }) => {
      if (call) return observeCall(call, { ...options, signal: AbortSignal.abort(), endMs });
    }).catch(() => {});
    return result('uncertain');
  }
  if (response.err || !response.call) return result(signal.aborted ? 'stopped' : 'failed');
  return observeCall(response.call, { ...options, endMs });
}
