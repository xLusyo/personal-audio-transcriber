const fs = require('node:fs/promises');
const { transcribe } = require('./transcribe');
const { summarize } = require('./summarize');
const { saveNotes } = require('./storage');

async function processRecording(recording, config, update) {
  const transcriptPath = `${recording.base}.transcript.txt`;
  let transcript;
  try {
    transcript = await fs.readFile(transcriptPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    update('Transcribing audio…');
    transcript = await transcribe(recording.audioPath, config);
    await fs.writeFile(transcriptPath, transcript, { mode: 0o600 });
  }
  update('Writing meeting notes…');
  const notes = await summarize(transcript, config);
  return saveNotes(recording.base, notes, transcript);
}
module.exports = { processRecording };
