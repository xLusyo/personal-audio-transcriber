const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadConfig } = require('./config');

const KEY_NAMES = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
};

function getApiKeySettings(envPath) {
  const config = loadConfig(envPath);
  return {
    configured: Object.fromEntries(Object.keys(KEY_NAMES).map(provider => [provider, Boolean(config.keys[provider])])),
    transcriptionProvider: config.transcriptionProvider,
    summaryProvider: config.summaryProvider,
  };
}

async function saveApiKey(envPath, provider, value) {
  if (!Object.hasOwn(KEY_NAMES, provider)) throw new Error('Choose a supported API provider.');
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\s"'`#\\]/.test(value.trim())) {
    throw new Error('Enter an API key without spaces or special quoting characters.');
  }
  let contents = '';
  try {
    contents = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Could not read API key configuration: ${error.message}`);
  }
  const name = KEY_NAMES[provider];
  const assignment = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*(?:"[^"]*"|'[^']*'|[^\\r\\n]*)(?:[^\\r\\n]*)`, 'gm');
  contents = contents.replace(assignment, '');
  const updated = `${contents}${contents.endsWith('\n') || !contents ? '' : '\n'}${name}=${value.trim()}\n`;
  await fs.mkdir(path.dirname(envPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${envPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, updated, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporaryPath, envPath);
  } catch (error) {
    throw new Error(`Could not save API key configuration: ${error.message}`);
  }
  return getApiKeySettings(envPath);
}

module.exports = { getApiKeySettings, saveApiKey };
