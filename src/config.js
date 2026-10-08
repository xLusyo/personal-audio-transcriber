const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { parseEnv } = require('node:util');

function expandHome(value) {
  return value?.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

function selectProvider(value, env, stage = 'transcription') {
  const provider = value || 'auto';
  const providers = ['auto', 'local', 'openai', 'groq'];
  if (stage === 'summary') providers.push('anthropic');
  if (!providers.includes(provider)) {
    throw new Error(`Invalid ${stage} provider: ${provider}. Use ${providers.join(', ')}.`);
  }
  if (provider !== 'auto') return provider;
  if (stage === 'summary' && env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.OPENAI_API_KEY ? 'openai' : env.GROQ_API_KEY ? 'groq' : 'local';
}

function loadConfig(envPath) {
  let fileEnv = {};
  try {
    fileEnv = parseEnv(fs.readFileSync(envPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const env = { ...process.env, ...fileEnv };
  const chunkChars = Number(env.SUMMARY_CHUNK_CHARS || 12000);
  if (!Number.isInteger(chunkChars) || chunkChars < 1000 || chunkChars > 50000) {
    throw new Error('SUMMARY_CHUNK_CHARS must be an integer between 1000 and 50000.');
  }
  const ollamaUrl = new URL(env.OLLAMA_URL || 'http://127.0.0.1:11434');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(ollamaUrl.hostname) || ollamaUrl.protocol !== 'http:') {
    throw new Error('OLLAMA_URL must use HTTP on localhost to keep local mode offline.');
  }
  return {
    transcriptionProvider: selectProvider(env.TRANSCRIPTION_PROVIDER, env),
    summaryProvider: selectProvider(env.SUMMARY_PROVIDER, env, 'summary'),
    keys: { openai: env.OPENAI_API_KEY, groq: env.GROQ_API_KEY, anthropic: env.ANTHROPIC_API_KEY },
    summaryModels: {
      openai: env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      groq: env.GROQ_SUMMARY_MODEL || 'llama-3.3-70b-versatile',
      anthropic: env.ANTHROPIC_SUMMARY_MODEL || 'claude-sonnet-4-6',
    },
    ffmpeg: expandHome(env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg'),
    whisper: expandHome(env.WHISPER_BIN || '~/whisper.cpp/build/bin/whisper-cli'),
    whisperModel: expandHome(env.WHISPER_MODEL || '~/whisper.cpp/models/ggml-medium.bin'),
    language: env.WHISPER_LANGUAGE || 'auto',
    ollamaUrl: ollamaUrl.origin,
    ollamaModel: env.OLLAMA_MODEL || 'llama3.1:8b',
    chunkChars,
  };
}
module.exports = { loadConfig, selectProvider, expandHome };
