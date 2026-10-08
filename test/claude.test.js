const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { selectProvider, loadConfig } = require('../src/config');
const { summarize } = require('../src/summarize');

const config = {
  summaryProvider: 'anthropic', keys: { anthropic: 'test-key' },
  summaryModels: { anthropic: 'claude-sonnet-4-6' }, chunkChars: 12000,
};
const notes = {
  summary: ['One', 'Two', 'Three', 'Four', 'Five'],
  decisions: ['Launch Friday'], actions: [{ task: 'Review release', owner: 'Alex' }],
};

function mockFetch(t, callback) {
  const previous = global.fetch;
  global.fetch = callback;
  t.after(() => { global.fetch = previous; });
}

test('Claude-only auto configuration transcribes locally and summarizes with Anthropic', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-notes-claude-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, '.env');
  await fs.writeFile(envPath, 'OPENAI_API_KEY=\nGROQ_API_KEY=\nANTHROPIC_API_KEY=example\nTRANSCRIPTION_PROVIDER=auto\nSUMMARY_PROVIDER=auto\nANTHROPIC_SUMMARY_MODEL=claude-sonnet-4-6\n');
  const loaded = loadConfig(envPath);
  assert.equal(loaded.transcriptionProvider, 'local');
  assert.equal(loaded.summaryProvider, 'anthropic');
  assert.equal(loaded.keys.anthropic, 'example');
  assert.equal(loaded.summaryModels.anthropic, 'claude-sonnet-4-6');
  assert.equal(selectProvider('auto', { ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' }, 'summary'), 'anthropic');
  assert.equal(selectProvider('local', { ANTHROPIC_API_KEY: 'x' }, 'summary'), 'local');
  assert.equal(selectProvider('openai', { ANTHROPIC_API_KEY: 'x' }, 'summary'), 'openai');
  assert.throws(() => selectProvider('anthropic', {}, 'transcription'), /Invalid transcription provider/);
});

test('Claude notes use Messages API headers, system prompt, and structured output', async t => {
  mockFetch(t, async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(options.headers['x-api-key'], 'test-key');
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    assert.equal(options.headers.Authorization, undefined);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'claude-sonnet-4-6');
    assert.equal(body.max_tokens, 4096);
    assert.match(body.system, /untrusted data/);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Transcript:\nAlex will review the release.' }]);
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.deepEqual(body.output_config.format.schema.required, ['summary', 'decisions', 'actions']);
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [
      { type: 'thinking', thinking: 'Ignored non-text block' },
      { type: 'text', text: JSON.stringify(notes) },
    ] }) };
  });
  assert.deepEqual(await summarize('Alex will review the release.', config), notes);
});

test('missing Anthropic key fails before sending meeting data', async t => {
  mockFetch(t, async () => { assert.fail('Must not send a request without a key'); });
  await assert.rejects(summarize('Private meeting.', { ...config, keys: {} }), /ANTHROPIC_API_KEY/);
});

test('Claude refusal and truncation produce explicit recoverable errors', async t => {
  let stopReason = 'refusal';
  mockFetch(t, async () => ({ ok: true, json: async () => ({ stop_reason: stopReason, content: [{ type: 'text', text: JSON.stringify(notes) }] }) }));
  await assert.rejects(summarize('Meeting.', config), /declined/);
  stopReason = 'max_tokens';
  await assert.rejects(summarize('Meeting.', config), /truncated/);
});

test('Claude failures do not silently switch provider or accept invalid notes', async t => {
  let response = { ok: false, status: 401, statusText: 'Unauthorized' };
  let calls = 0;
  mockFetch(t, async url => {
    calls++;
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    return response;
  });
  await assert.rejects(summarize('Meeting.', config), /401/);
  assert.equal(calls, 1);
  response = { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ...notes, summary: ['Only one'] }) }] }) };
  await assert.rejects(summarize('Meeting.', config), /invalid notes/);
});
