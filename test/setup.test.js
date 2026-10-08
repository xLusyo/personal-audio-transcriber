const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateRecordingSetup } = require('../src/setup');

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-notes-setup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const ffmpeg = path.join(directory, 'ffmpeg');
  await fs.writeFile(ffmpeg, 'executable', { mode: 0o700 });
  return { ffmpeg, whisper: path.join(directory, 'whisper-cli'), whisperModel: path.join(directory, 'ggml-medium.bin'), transcriptionProvider: 'local' };
}

test('missing local whisper executable gives installation and config guidance', async t => {
  const config = await setup(t);
  await assert.rejects(validateRecordingSetup(config), /whisper.cpp executable.*WHISPER_BIN.*README/s);
});

test('local recording requires a readable model as well as an executable', async t => {
  const config = await setup(t);
  await fs.writeFile(config.whisper, 'executable', { mode: 0o700 });
  await assert.rejects(validateRecordingSetup(config), /Whisper model.*WHISPER_MODEL/s);
  await fs.writeFile(config.whisperModel, 'model');
  await validateRecordingSetup(config);
});

test('API transcription needs FFmpeg but does not require local Whisper', async t => {
  const config = { ...await setup(t), transcriptionProvider: 'openai' };
  await validateRecordingSetup(config);
  await fs.unlink(config.ffmpeg);
  await assert.rejects(validateRecordingSetup(config), /FFMPEG_BIN/);
});
