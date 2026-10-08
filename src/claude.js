const { ENDPOINTS, requestJson, authorization } = require('./api');

const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'array', items: { type: 'string' }, description: 'Exactly five concise summary bullets.' },
    decisions: { type: 'array', items: { type: 'string' } },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { task: { type: 'string' }, owner: { type: 'string' } },
        required: ['task', 'owner'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'decisions', 'actions'],
  additionalProperties: false,
};

async function generateClaudeNotes(content, systemPrompt, config) {
  const response = await requestJson(`${ENDPOINTS.anthropic}/messages`, {
    method: 'POST',
    headers: { ...authorization(config, 'anthropic'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.summaryModels.anthropic,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: NOTES_SCHEMA } },
    }),
  });
  if (response.stop_reason === 'max_tokens') throw new Error('Claude notes were truncated. Reduce SUMMARY_CHUNK_CHARS and retry.');
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to generate meeting notes.');
  if (!Array.isArray(response.content)) throw new Error('Claude returned no content.');
  const text = response.content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
  if (!text) throw new Error('Claude returned no note text.');
  return text;
}

module.exports = { generateClaudeNotes };
