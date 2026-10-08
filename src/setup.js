const fs = require('node:fs/promises');
const { constants } = require('node:fs');

async function checkFile(filePath, name, permission, instruction) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    await fs.access(filePath, permission);
  } catch (error) {
    throw new Error(`${name} is missing or inaccessible at ${filePath}. ${instruction} (${error.code || error.message})`);
  }
}

async function validateRecordingSetup(config) {
  await checkFile(config.ffmpeg, 'FFmpeg', constants.X_OK, 'Install FFmpeg and set FFMPEG_BIN to its absolute executable path in .env.');
  if (config.transcriptionProvider !== 'local') return;
  await checkFile(config.whisper, 'whisper.cpp executable', constants.X_OK,
    'Install and build whisper.cpp, then set WHISPER_BIN in .env to the built whisper-cli. See README.md → Fully offline setup.');
  await checkFile(config.whisperModel, 'Whisper model', constants.R_OK,
    'Download the medium model and set WHISPER_MODEL in .env to ggml-medium.bin.');
}

module.exports = { validateRecordingSetup };
