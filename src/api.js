const ENDPOINTS = { openai: 'https://api.openai.com/v1', groq: 'https://api.groq.com/openai/v1', anthropic: 'https://api.anthropic.com/v1' };

async function requestJson(url, options) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok) {
    // Provider response bodies can echo transcript content; keep errors free of meeting data.
    throw new Error(`Request to ${new URL(url).hostname} failed (${response.status} ${response.statusText}).`);
  }
  return response.json();
}

function authorization(config, provider) {
  const key = config.keys[provider];
  if (!key) throw new Error(`Set ${provider.toUpperCase()}_API_KEY in .env or select local mode.`);
  if (provider === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  return { Authorization: `Bearer ${key}` };
}
module.exports = { ENDPOINTS, requestJson, authorization };
