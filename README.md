# Meeting Notes for macOS

A menu bar app that records system audio and your microphone, transcribes the conversation, and produces five summary bullets, decisions, and action items with owners. Markdown, the original Opus/WebM audio, and a recovery transcript stay in `~/MeetingNotes`. No accounts, telemetry, cloud storage, or automatic uploads beyond explicitly configured inference APIs.

## Requirements

- macOS **14.2 Sonoma or newer**, Apple Silicon or Intel.
- Node.js 22+ and npm for building.
- FFmpeg for decoding audio, in both local and API modes.
- Offline mode: whisper.cpp with the **medium** model, and Ollama with a downloaded text model.
- API mode: an Anthropic (Claude), OpenAI, or Groq API key for notes. API transcription requires OpenAI or Groq; Claude-only setups use local whisper.cpp. Keys may incur provider charges.

## Install and build

```sh
brew install node ffmpeg cmake
npm install
cp .env.example .env
```

Edit `.env`. On Intel Macs, change `FFMPEG_BIN` to `/usr/local/bin/ffmpeg` (check `which ffmpeg`). Use absolute executable paths; apps launched from Finder do not inherit your terminal's PATH.

For reliable macOS permission attribution, build and launch the `.app`:

```sh
npm run pack
```

Open `dist/mac-arm64/Meeting Notes.app` on Apple Silicon, or `dist/mac/Meeting Notes.app` on Intel. You can move it to Applications. The packaged app reads `.env` from:

```text
~/Library/Application Support/meeting-notes/.env
```

Use **API key settings** in the app to choose Anthropic, OpenAI, or Groq and save a key. Keys are stored in this local `.env` file with owner-only permissions and are never displayed back in the window. Existing provider choices are preserved; the panel shows the active transcription and notes providers. Keys apply to the next recording or retry. For other configuration, create that directory and copy your edited `.env` there. The app window also shows the exact config path. Configuration is reloaded each time you start a recording or retry processing. `.env` is excluded from the app bundle and version control.

```sh
mkdir -p "$HOME/Library/Application Support/meeting-notes"
cp .env "$HOME/Library/Application Support/meeting-notes/.env"
chmod 600 "$HOME/Library/Application Support/meeting-notes/.env"
```

`npm start` launches a development session. System audio permission may be attributed to Terminal/your IDE; those apps can lack the required `NSAudioCaptureUsageDescription`, resulting in an ended audio track. Use the packaged app for capture testing.

`npm run dist` creates a DMG for the current machine's architecture. Distribution to other Macs requires Apple signing/notarization credentials and electron-builder signing configuration; a local unsigned build does not establish a trusted distributed release.

## macOS permissions

On first recording, allow **Microphone** and **Screen & System Audio Recording / System Audio Recording** (labels vary by macOS version). Enable Meeting Notes in **System Settings → Privacy & Security** if you previously denied them, then quit and reopen the app. The package includes microphone, system audio, and screen capture usage descriptions.

Electron's native loopback capture uses Apple's CoreAudio Tap API on macOS 14.2+. A screen source is selected to establish capture, but **only mixed audio is encoded and saved**. No screen frames are saved or sent to APIs. No BlackHole driver or virtual audio device is required. Audio from all playing applications can be included; close unrelated audio sources before recording. Headphones reduce duplicated voice/echo caused by your mic picking up speaker playback.

## Fully offline setup

Install whisper.cpp and download the multilingual medium model (approximately 1.5 GB):

```sh
cd "$HOME"
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build --config Release -j
bash models/download-ggml-model.sh medium
```

Install Ollama from https://ollama.com, start it, and download a local text model:

```sh
ollama pull llama3.1:8b
```

Set in `.env`:

```dotenv
TRANSCRIPTION_PROVIDER=local
SUMMARY_PROVIDER=local
WHISPER_BIN=~/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL=~/whisper.cpp/models/ggml-medium.bin
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
```

With dependencies and models installed, recording and processing work without an internet connection. The app does not download models. Local mode only allows a loopback HTTP Ollama endpoint and makes no provider requests. Models need substantial memory; an 8B model plus medium transcription runs sequentially, but Ollama may retain its model in memory. Choose a smaller Ollama model on memory-constrained Macs.

## API setup

### With only a Claude API key

Install FFmpeg and whisper.cpp with the medium model as described above. You do not need Ollama when Claude generates the notes. Set these values in your app's `.env`:

```dotenv
TRANSCRIPTION_PROVIDER=local
SUMMARY_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-anthropic-api-key
ANTHROPIC_SUMMARY_MODEL=claude-sonnet-4-6
```

Audio remains local and whisper.cpp transcribes it. Claude receives the transcript excerpts and intermediate summaries to generate notes. The integration uses Anthropic's Messages API with structured JSON output; the default model supports it. If you change the model, choose one supporting structured outputs. No additional npm dependency is needed.

### Provider selection

Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GROQ_API_KEY` in `.env`. With `auto` (the default), **summary** priority is Anthropic, OpenAI, Groq, then local Ollama. **Transcription** priority remains OpenAI, Groq, then local whisper.cpp; an Anthropic key alone selects local transcription.

Select each stage independently: `TRANSCRIPTION_PROVIDER` supports `auto`, `local`, `openai`, or `groq`; `SUMMARY_PROVIDER` additionally supports `anthropic`. Anthropic is not a transcription provider in this app.

- OpenAI transcription uses `whisper-1`; Groq uses `whisper-large-v3`.
- Summary models default to `claude-sonnet-4-6`, `gpt-4o-mini`, and `llama-3.3-70b-versatile`, configurable in `.env`.
- API transcription sends mono 16 kHz WAV in ten-minute parts, below OpenAI's 25 MB limit.
- API summarization sends transcript excerpts and intermediate summaries. Local transcription + API summaries sends text only.
- Failures **never silently switch providers**. Clear keys or select both local providers to force offline operation.

## Use and recovery

1. Click **Start Recording** in the tray menu or window; grant access.
2. Close the window to keep recording in the menu bar. A red recording indicator and timer show capture state.
3. Click **Stop Recording**. Audio is closed, transcribed, then summarized.
4. Use **Open last note** or **Open notes folder**.

Files use the local recording start time: `YYYY-MM-DD-HHMM.md`, `.webm`, and `.transcript.txt`. Multiple starts in the same minute get `-2`, `-3`, etc., rather than overwriting recordings. Notes place the summary, decisions, and actions above a divider, followed by the full transcript. Whisper does not identify speakers; owners are taken only from explicitly named assignments, otherwise `Unassigned`.

Audio is written every second, so long meetings do not accumulate their entire recording in memory. Processing can take time; quitting and new capture are disabled until it finishes. If transcription or summarization fails, audio remains on disk. Use **Retry saved audio** and choose its `.webm`. A saved `.transcript.txt` is reused, avoiding duplicate transcription calls; delete it manually if you want to transcribe again. Retrying replaces the corresponding Markdown note. An app/system crash can leave the last audio chunk incomplete; FFmpeg may recover earlier chunks, but crash recovery is not guaranteed.

Long transcripts are summarized in excerpts with a bounded merge of summaries; decisions and actions from each excerpt are retained. This avoids sending one oversized prompt but may repeat similar actions or lose nuance across excerpt boundaries. Notes are model-generated and should be reviewed.

## Validation

```sh
npm test
```

Tests cover storage collisions, Markdown output, provider selection, structured notes, local pipeline integration with test executables, mocked API requests, and capture lifecycle with mocked media devices. A real Opus-to-PCM conversion test also runs when FFmpeg is installed. Actual system audio, permission prompts, and model inference require a Mac and installed models/keys. For a capture smoke test, play spoken audio through headphones, record while speaking, stop, and check that the saved audio and transcript contain both sources. Deny each permission once to check failure handling; retry a recording after a model/API failure.

## Implementation references

- [Electron desktop capture and macOS caveats](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [whisper.cpp build and CLI](https://github.com/ggml-org/whisper.cpp)
- [OpenAI transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Groq transcription](https://console.groq.com/docs/speech-to-text)
- [Ollama local chat API](https://docs.ollama.com/api/chat)
- [Claude structured outputs and supported models](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
