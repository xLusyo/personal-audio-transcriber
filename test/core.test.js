const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRecording, renderMarkdown, meetingTimestamp } = require('../src/storage');
const { selectProvider, loadConfig } = require('../src/config');
const { validateNotes, splitText, summarize } = require('../src/summarize');
const { transcribe } = require('../src/transcribe');
const { processRecording } = require('../src/pipeline');

const notes = { summary: ['First', 'Second', 'Third', 'Fourth', 'Fifth'], decisions: ['Ship Friday'], actions: [{ task: 'Review release', owner: 'Alex' }] };

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-notes-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function mockFetch(t, callback) {
  const previous = global.fetch;
  global.fetch = callback;
  t.after(() => { global.fetch = previous; });
}

async function fakeTools(directory) {
  const ffmpeg = path.join(directory, 'ffmpeg');
  const whisper = path.join(directory, 'whisper');
  await fs.writeFile(ffmpeg, `#!/usr/bin/env node\nconst fs = require('node:fs'); let output=process.argv.at(-1); fs.writeFileSync(output.replace('%05d','00000'), 'test audio');\n`, { mode: 0o700 });
  await fs.writeFile(whisper, `#!/usr/bin/env node\nconst fs = require('node:fs'); const args=process.argv.slice(2); fs.writeFileSync(args[args.indexOf('-of')+1]+'.txt','Alex will review the release. We decided to ship Friday.');\n`, { mode: 0o700 });
  return { ffmpeg, whisper, whisperModel: '/fake/medium.bin', language: 'auto', transcriptionProvider: 'local', summaryProvider: 'local', ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'test', chunkChars: 12000 };
}

test('provider selection is explicit and local without keys', () => {
  assert.equal(selectProvider('auto', {}), 'local');
  assert.equal(selectProvider('auto', { GROQ_API_KEY: 'x' }), 'groq');
  assert.equal(selectProvider('auto', { OPENAI_API_KEY: 'x', GROQ_API_KEY: 'y' }), 'openai');
  assert.equal(selectProvider('local', { OPENAI_API_KEY: 'x' }), 'local');
  assert.throws(() => selectProvider('other', {}), /Invalid transcription provider/);
});

test('config reloads changed keys without retaining old values and enforces local endpoint', async t => {
  const directory = await temporary(t);
  const envPath = path.join(directory, '.env');
  await fs.writeFile(envPath, 'TRANSCRIPTION_PROVIDER=auto\nOPENAI_API_KEY=example\nGROQ_API_KEY=\n');
  assert.equal(loadConfig(envPath).transcriptionProvider, 'openai');
  await fs.writeFile(envPath, 'TRANSCRIPTION_PROVIDER=auto\nOPENAI_API_KEY=\nGROQ_API_KEY=\n');
  assert.equal(loadConfig(envPath).transcriptionProvider, 'local');
  await fs.appendFile(envPath, 'OLLAMA_URL=https://example.com\n');
  assert.throws(() => loadConfig(envPath), /localhost/);
});

test('same-minute recordings preserve existing audio', async t => {
  const directory = await temporary(t);
  const date = new Date(2026, 9, 8, 13, 5);
  const first = await createRecording(directory, date);
  await first.handle.writeFile('first');
  await first.handle.close();
  const second = await createRecording(directory, date);
  await second.handle.close();
  assert.equal(meetingTimestamp(date), '2026-10-08-1305');
  assert.equal(path.basename(second.audioPath), '2026-10-08-1305-2.webm');
  assert.equal(await fs.readFile(first.audioPath, 'utf8'), 'first');
});

test('notes put five bullets and named actions before verbatim transcript', () => {
  const text = renderMarkdown(notes, 'Actual\ntranscript');
  assert.ok(text.indexOf('## Summary') < text.indexOf('\n---\n'));
  assert.match(text, /- \[ \] Alex: Review release/);
  assert.ok(text.endsWith('Actual\ntranscript\n'));
  assert.equal(text.split('## Summary\n\n')[1].split('\n\n')[0].split('\n').length, 5);
  assert.throws(() => validateNotes({ ...notes, summary: ['one'] }), /invalid notes/);
  assert.throws(() => validateNotes({ ...notes, actions: [{ task: 'x' }] }), /invalid notes/);
});

test('chunk splitting retains all transcript characters', () => {
  const original = 'A meaningful conversation. '.repeat(100);
  const parts = splitText(original, 100);
  assert.equal(parts.join(''), original);
  assert.ok(parts.every(part => part.length <= 100));
});

test('local pipeline saves transcript and notes; retries skip transcription', async t => {
  const directory = await temporary(t);
  const config = await fakeTools(directory);
  const recording = await createRecording(directory);
  await recording.handle.writeFile('audio');
  await recording.handle.close();
  const stages = [];
  mockFetch(t, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.stream, false);
    assert.match(body.messages[1].content, /Alex will review/);
    return { ok: true, json: async () => ({ message: { content: JSON.stringify(notes) } }) };
  });
  const notePath = await processRecording(recording, config, message => stages.push(message));
  assert.match(await fs.readFile(notePath, 'utf8'), /Ship Friday/);
  assert.equal(stages.length, 2);
  await fs.unlink(config.whisper);
  await processRecording(recording, config, () => {});
  assert.equal(await fs.readFile(recording.audioPath, 'utf8'), 'audio');
});

test('summary failure preserves cached transcript and audio', async t => {
  const directory = await temporary(t);
  const config = await fakeTools(directory);
  const recording = await createRecording(directory);
  await recording.handle.writeFile('audio');
  await recording.handle.close();
  mockFetch(t, async () => ({ ok: false, status: 503, statusText: 'Unavailable' }));
  await assert.rejects(processRecording(recording, config, () => {}), /503/);
  assert.match(await fs.readFile(`${recording.base}.transcript.txt`, 'utf8'), /Alex/);
  assert.equal(await fs.readFile(recording.audioPath, 'utf8'), 'audio');
  await assert.rejects(fs.access(`${recording.base}.md`), { code: 'ENOENT' });
});

test('API transcription uses authenticated multipart WAV upload', async t => {
  const directory = await temporary(t);
  const config = { ...await fakeTools(directory), transcriptionProvider: 'openai', keys: { openai: 'test-key' } };
  mockFetch(t, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.equal(options.body.get('model'), 'whisper-1');
    assert.equal(options.body.get('file').type, 'audio/wav');
    return { ok: true, json: async () => ({ text: 'Transcribed meeting.' }) };
  });
  assert.equal(await transcribe('/fake/audio.webm', config), 'Transcribed meeting.');
});

test('long transcripts retain all excerpt decisions and actions during merges', async t => {
  let call = 0;
  mockFetch(t, async () => {
    call++;
    const content = { ...notes, decisions: [`Decision ${call}`], actions: [{ owner: 'Unassigned', task: `Task ${call}` }] };
    return { ok: true, json: async () => ({ message: { content: JSON.stringify(content) } }) };
  });
  const result = await summarize('a'.repeat(300), { chunkChars: 100, summaryProvider: 'local', ollamaUrl: 'http://localhost:11434', ollamaModel: 'test' });
  assert.equal(result.summary.length, 5);
  assert.deepEqual(result.decisions, ['Decision 1', 'Decision 2', 'Decision 3']);
  assert.equal(result.actions.length, 3);
});

test('real FFmpeg decodes recorded Opus to 16 kHz mono PCM for whisper', async t => {
  const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  let ffmpeg;
  for (const candidate of candidates) {
    try { await fs.access(candidate); ffmpeg = candidate; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!ffmpeg) { t.skip('FFmpeg is not installed'); return; }
  const { runCommand } = require('../src/process');
  const directory = await temporary(t);
  const config = await fakeTools(directory);
  const audioPath = path.join(directory, 'tone.webm');
  await runCommand(ffmpeg, ['-nostdin', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', audioPath]);
  await fs.writeFile(config.whisper, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const wav = fs.readFileSync(args[args.indexOf('-f') + 1]);
if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== 16000 || wav.readUInt16LE(34) !== 16) process.exit(2);
if (!args.includes('-otxt') || args[args.indexOf('-m') + 1] !== '/fake/medium.bin') process.exit(3);
fs.writeFileSync(args[args.indexOf('-of') + 1] + '.txt', 'Verified real PCM conversion.');
`, { mode: 0o700 });
  config.ffmpeg = ffmpeg;
  assert.equal(await transcribe(audioPath, config), 'Verified real PCM conversion.');
});
