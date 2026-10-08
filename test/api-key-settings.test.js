const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { saveApiKey, getApiKeySettings } = require('../src/api-key-settings');
const { loadConfig } = require('../src/config');

async function configurationPath(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-notes-keys-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'config', '.env');
}

test('saves keys privately, selects providers, and returns no secrets', async t => {
  const envPath = await configurationPath(t);
  const settings = await saveApiKey(envPath, 'openai', 'test-openai-key');
  assert.equal(settings.configured.openai, true);
  assert.equal(settings.transcriptionProvider, 'openai');
  assert.equal(loadConfig(envPath).keys.openai, 'test-openai-key');
  assert.equal((await fs.stat(envPath)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(settings).includes('test-openai-key'), false);
  await saveApiKey(envPath, 'anthropic', 'test-anthropic-key');
  assert.equal(getApiKeySettings(envPath).summaryProvider, 'anthropic');
});

test('replaces duplicate and quoted keys while preserving unrelated configuration', async t => {
  const envPath = await configurationPath(t);
  await fs.mkdir(path.dirname(envPath));
  await fs.writeFile(envPath, '# Keep this comment\nSUMMARY_PROVIDER=local\nexport GROQ_API_KEY="old\nkey"\nGROQ_API_KEY=duplicate\nWHISPER_LANGUAGE=en\n');
  await saveApiKey(envPath, 'groq', 'replacement-key');
  const contents = await fs.readFile(envPath, 'utf8');
  assert.equal(contents.match(/GROQ_API_KEY=/g).length, 1);
  assert.ok(contents.includes('# Keep this comment'));
  assert.ok(contents.includes('WHISPER_LANGUAGE=en'));
  assert.equal(loadConfig(envPath).summaryProvider, 'local');
  assert.equal(loadConfig(envPath).keys.groq, 'replacement-key');
  assert.equal(contents.includes('old'), false);
});

test('rejects unsupported providers and invalid keys without writing configuration', async t => {
  const envPath = await configurationPath(t);
  for (const [provider, key] of [['unknown', 'key'], ['openai', ''], ['openai', 'key\nSUMMARY_PROVIDER=local'], ['groq', null]]) {
    await assert.rejects(saveApiKey(envPath, provider, key));
  }
  await assert.rejects(fs.stat(envPath), { code: 'ENOENT' });
});
