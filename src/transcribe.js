const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runCommand } = require('./process');
const { ENDPOINTS, requestJson, authorization } = require('./api');

async function transcribe(audioPath, config) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-notes-'));
  try {
    const wavPath = path.join(temporary, 'audio.wav');
    await runCommand(config.ffmpeg, ['-nostdin', '-y', '-i', audioPath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath]);
    if (config.transcriptionProvider === 'local') {
      const output = path.join(temporary, 'transcript');
      await runCommand(config.whisper, ['-m', config.whisperModel, '-f', wavPath, '-l', config.language, '-otxt', '-of', output]);
      const transcript = (await fs.readFile(`${output}.txt`, 'utf8')).trim();
      if (!transcript) throw new Error('Whisper returned an empty transcript. Check the audio and retry.');
      return transcript;
    }
    // Ten-minute PCM parts stay well below the OpenAI 25 MB upload limit.
    await runCommand(config.ffmpeg, ['-nostdin', '-y', '-i', wavPath, '-f', 'segment', '-segment_time', '600', '-c:a', 'pcm_s16le', path.join(temporary, 'part-%05d.wav')]);
    const files = (await fs.readdir(temporary)).filter(name => name.startsWith('part-')).sort();
    const texts = [];
    for (const name of files) {
      const form = new FormData();
      form.append('file', new Blob([await fs.readFile(path.join(temporary, name))], { type: 'audio/wav' }), name);
      form.append('model', config.transcriptionProvider === 'openai' ? 'whisper-1' : 'whisper-large-v3');
      if (config.language !== 'auto') form.append('language', config.language);
      const result = await requestJson(`${ENDPOINTS[config.transcriptionProvider]}/audio/transcriptions`, {
        method: 'POST', headers: authorization(config, config.transcriptionProvider), body: form,
      });
      if (typeof result.text !== 'string') throw new Error('Transcription provider returned no text.');
      texts.push(result.text.trim());
    }
    const transcript = texts.join('\n\n').trim();
    if (!transcript) throw new Error('No speech was transcribed. Check the audio and retry.');
    return transcript;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
module.exports = { transcribe };
