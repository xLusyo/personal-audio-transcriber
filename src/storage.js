const fs = require('node:fs/promises');
const path = require('node:path');

function meetingTimestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

async function createRecording(directory, date = new Date()) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const timestamp = meetingTimestamp(date);
  for (let suffix = 0; ; suffix++) {
    const base = path.join(directory, timestamp + (suffix ? `-${suffix + 1}` : ''));
    try {
      const handle = await fs.open(`${base}.webm`, 'wx', 0o600);
      return { base, audioPath: `${base}.webm`, handle };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

function oneLine(value) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function renderMarkdown(notes, transcript) {
  return `# Meeting notes\n\n## Summary\n\n${notes.summary.map(item => `- ${oneLine(item)}`).join('\n')}\n\n## Decisions\n\n${notes.decisions.length ? notes.decisions.map(item => `- ${oneLine(item)}`).join('\n') : '- No decisions recorded.'}\n\n## Action items\n\n${notes.actions.length ? notes.actions.map(item => `- [ ] ${oneLine(item.owner)}: ${oneLine(item.task)}`).join('\n') : '- No action items recorded.'}\n\n---\n\n## Full transcript\n\n${transcript.trim()}\n`;
}

async function saveNotes(base, notes, transcript) {
  const temporary = `${base}.md.tmp`;
  await fs.writeFile(temporary, renderMarkdown(notes, transcript), { mode: 0o600 });
  await fs.rename(temporary, `${base}.md`);
  return `${base}.md`;
}
module.exports = { meetingTimestamp, createRecording, renderMarkdown, saveNotes };
