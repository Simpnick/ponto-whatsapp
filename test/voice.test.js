import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { canCall, createVoiceMedia, parseDevices, placeVoiceCall, voiceCsvRow } from '../extension/voice-api.js';

function mockCall(status) {
  const events = new EventEmitter();
  return {
    status,
    on(event, listener) {
      events.on(event, listener);
      return () => events.off(event, listener);
    },
    emit: (...args) => events.emit(...args)
  };
}

function callOptions(overrides) {
  return { phone: '5511900000000', token: 'device-alpha', signal: new AbortController().signal,
    ringMs: 500, talkMs: 500, endMs: 50, onAnswer: () => {}, ...overrides };
}

test('separates device names from path-safe tokens and protects exported spreadsheet cells', () => {
  assert.deepEqual([...parseDevices('Comercial,device-alpha\n device-beta\nDuplicado,device-alpha')],
    [['device-alpha', 'Comercial'], ['device-beta', 'Dispositivo 2']]);
  assert.throws(() => parseDevices('Operações,../../outro'), /linha 1/);
  assert.equal(voiceCsvRow(['=2+2', 'Ana "Lima"', '5511900000000'], true),
    `"'=2+2";"Ana ""Lima""";"5511900000000"`);
  assert.equal(canCall({ status: 'open', connectionStatus: 'reconnecting' }), false);
});

test('plays only after answer and waits for the call terminal event before advancing', async () => {
  const outgoing = mockCall('RINGING');
  const active = mockCall('ACTIVE');
  let ended = 0;
  active.end = async () => { ended++; return { err: null }; };
  let complete = false;
  let audioFinished;
  const pending = placeVoiceCall({ async startCall(payload) {
    assert.deepEqual(payload, { to: '+5511900000000', fromTokens: ['device-alpha'] });
    return { call: outgoing };
  } }, callOptions({ onAnswer: (finish) => { audioFinished = finish; } })).then((result) => {
    complete = true;
    return result;
  });

  await setImmediate();
  assert.equal(audioFinished, undefined);
  outgoing.emit('peerAccept', active);
  audioFinished();
  await setImmediate();
  assert.equal(ended, 1);
  assert.equal(complete, false);
  active.status = 'ENDED';
  active.emit('ended');
  assert.deepEqual(await pending, { status: 'completed', answered: true, duration: 0 });
});

test('ends an answered call when a stop races with outgoing cancellation', async () => {
  const abort = new AbortController();
  const outgoing = mockCall('RINGING');
  const active = mockCall('ACTIVE');
  outgoing.cancel = async () => ({ err: 'IS_NOT_OFFER' });
  active.end = async () => {
    active.status = 'ENDED';
    active.emit('ended');
    return { err: null };
  };
  const pending = placeVoiceCall({ startCall: async () => ({ call: outgoing }) }, callOptions({
    signal: abort.signal,
    onAnswer: () => assert.fail('stopped call must stay silent')
  }));
  await setImmediate();
  abort.abort();
  await setImmediate();
  outgoing.emit('peerAccept', active);
  assert.deepEqual(await pending, { status: 'stopped', answered: true, duration: 0 });
});

test('marks a missing start acknowledgement as uncertain and cancels a late outgoing call', async () => {
  const start = Promise.withResolvers();
  const pending = placeVoiceCall({ startCall: () => start.promise }, callOptions({ startMs: 5 }));
  assert.deepEqual(await pending, { status: 'uncertain', answered: false, duration: 0 });
  const outgoing = mockCall('RINGING');
  let cancels = 0;
  outgoing.cancel = async () => {
    cancels++;
    outgoing.status = 'CANCELLED';
    outgoing.emit('ended');
    return { err: null };
  };
  start.resolve({ call: outgoing });
  await setImmediate();
  assert.equal(cancels, 1);
});

test('passes only local synthetic tracks and cleans originals and clones', () => {
  const events = [];
  const makeTrack = (name) => ({ stop() { events.push(name); } });
  const clone = { getTracks: () => [makeTrack('clone')] };
  const context = { createMediaStreamDestination: () => ({
    stream: { getTracks: () => [makeTrack('original')], clone: () => clone }
  }) };
  const media = createVoiceMedia(context);
  assert.equal(media.stream(), clone);
  media.play(() => assert.fail('silence has no playback callback'));
  media.dispose();
  media.dispose();
  assert.deepEqual(events, ['original', 'clone']);
  assert.throws(() => media.stream(), /encerrado/);
});
