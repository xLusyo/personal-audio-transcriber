const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ missingSystemAudio = false, writeFails = false } = {}) {
  const events = [];
  const track = kind => ({ kind, readyState: 'live', stop() { this.readyState = 'ended'; events.push(`stop:${kind}`); } });
  const system = track('system');
  const microphone = track('mic');
  const video = track('video');
  const stream = tracks => ({ getTracks: () => tracks, getAudioTracks: () => tracks.filter(item => item.kind !== 'video') });
  let capture;
  class MockMediaRecorder {
    static isTypeSupported() { return true; }
    constructor(input) { this.state = 'inactive'; this.input = input; capture = this; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob(['last chunk']) });
        this.onstop?.();
      });
    }
  }
  class MockAudioContext {
    constructor() { this.state = 'running'; }
    async resume() {}
    createMediaStreamDestination() { return { stream: stream([track('mixed')]) }; }
    createMediaStreamSource(input) {
      events.push(`mix:${input.getAudioTracks()[0].kind}`);
      return { connect: gain => gain };
    }
    createGain() { return { gain: {}, connect() {} }; }
    async close() { this.state = 'closed'; events.push('close-context'); }
  }
  const api = {
    async start() { events.push('prepare'); },
    async started() { events.push('recording'); },
    async append(data) {
      if (writeFails) throw new Error('Disk full');
      await new Promise(resolve => setTimeout(resolve, 10));
      events.push(`write:${Buffer.from(data).toString()}`);
    },
    async finish() { events.push('finish'); },
    async failed(message) { events.push(`failed:${message}`); },
  };
  const context = vm.createContext({
    navigator: { mediaDevices: {
      async getDisplayMedia() { return stream(missingSystemAudio ? [video] : [system, video]); },
      async getUserMedia() { return stream([microphone]); },
    } },
    AudioContext: MockAudioContext,
    MediaRecorder: MockMediaRecorder,
    MediaStream: function(tracks) { return stream(tracks); },
    Uint8Array,
  });
  const Recorder = vm.runInContext(`${fs.readFileSync(require.resolve('../src/renderer/recorder.js'), 'utf8')}\nMeetingRecorder`, context);
  return { recorder: new Recorder(api), events, system, getCapture: () => capture };
}

test('capture mixes both inputs and drains the final write before processing', async () => {
  const { recorder, events } = setup();
  await recorder.start();
  assert.ok(events.includes('mix:system'));
  assert.ok(events.includes('mix:mic'));
  await recorder.stop();
  assert.ok(events.indexOf('write:last chunk') < events.indexOf('finish'));
  assert.ok(events.includes('stop:video'));
  assert.ok(events.includes('stop:system'));
  assert.ok(events.includes('stop:mic'));
  assert.equal(events.filter(item => item === 'finish').length, 1);
  await recorder.stop();
  assert.equal(events.filter(item => item === 'finish').length, 1);
});

test('missing system audio fails capture and releases screen track', async () => {
  const { recorder, events } = setup({ missingSystemAudio: true });
  await assert.rejects(recorder.start(), /System audio unavailable/);
  assert.ok(events.includes('stop:video'));
  assert.ok(events.some(item => item.startsWith('failed:')));
  assert.ok(!events.includes('finish'));
});

test('disk failures stop capture without processing incomplete audio', async () => {
  const { recorder, events } = setup({ writeFails: true });
  await recorder.start();
  await assert.rejects(recorder.stop(), /Disk full/);
  assert.ok(events.includes('stop:mic'));
  assert.ok(events.some(item => item.startsWith('failed:Audio write failed')));
  assert.ok(!events.includes('finish'));
});

test('revoked system audio automatically stops and saves earlier audio', async () => {
  const { recorder, events, system } = setup();
  let stopped;
  const completion = new Promise(resolve => { stopped = resolve; });
  recorder.api.finish = async () => { events.push('finish'); stopped(); };
  await recorder.start();
  system.readyState = 'ended';
  system.onended();
  await completion;
  assert.ok(events.includes('stop:mic'));
  assert.ok(events.indexOf('write:last chunk') < events.indexOf('finish'));
});
