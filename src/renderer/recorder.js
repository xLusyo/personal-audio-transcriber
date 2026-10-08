class MeetingRecorder {
  constructor(api) {
    this.api = api;
    this.streams = [];
    this.recorder = null;
    this.context = null;
    this.pending = Promise.resolve();
    this.writeError = null;
    this.stopping = false;
    this.starting = false;
  }

  async start() {
    if (this.starting || this.recorder) return;
    this.starting = true;
    this.stopping = false;
    this.writeError = null;
    this.pending = Promise.resolve();
    let prepared = false;
    try {
      await this.api.start();
      prepared = true;
      const desktop = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1, height: 1, frameRate: 1 }, audio: true });
      this.streams.push(desktop);
      const systemTracks = desktop.getAudioTracks();
      if (!systemTracks.length || systemTracks[0].readyState !== 'live') {
        throw new Error('System audio unavailable. Grant Screen & System Audio Recording permission, then restart the app.');
      }
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      this.streams.push(mic);
      if (systemTracks[0].readyState !== 'live') throw new Error('System audio permission is missing or capture ended.');
      this.context = new AudioContext();
      await this.context.resume();
      const destination = this.context.createMediaStreamDestination();
      for (const stream of [new MediaStream(systemTracks), mic]) {
        const source = this.context.createMediaStreamSource(stream);
        const gain = this.context.createGain();
        gain.gain.value = 0.5;
        source.connect(gain).connect(destination);
      }
      if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) throw new Error('Opus audio recording is unavailable.');
      this.recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 });
      this.recorder.ondataavailable = event => {
        if (!event.data.size) return;
        this.pending = this.pending.then(async () => {
          if (!this.writeError) await this.api.append(new Uint8Array(await event.data.arrayBuffer()));
        }).catch(error => {
          this.writeError = error;
          if (!this.stopping) this.stop().catch(failure => this.onError?.(failure));
        });
      };
      this.recorder.onerror = event => {
        this.writeError = event.error || new Error('Audio recorder failed.');
        this.stop().catch(error => this.onError?.(error));
      };
      await this.api.started();
      for (const track of [...systemTracks, ...mic.getAudioTracks()]) {
        track.onended = () => {
          if (!this.stopping) this.stop().catch(error => this.onError?.(error));
        };
      }
      if (systemTracks[0].readyState !== 'live' || mic.getAudioTracks()[0].readyState !== 'live') {
        throw new Error('Audio input ended before capture could start. Check macOS permissions.');
      }
      this.recorder.start(1000);
      this.onStarted?.();
    } catch (error) {
      if (this.recorder?.state !== 'inactive' && this.recorder) this.recorder.stop();
      await this.pending;
      await this.cleanup();
      if (prepared) await this.api.failed(error.message);
      throw error;
    } finally {
      this.starting = false;
    }
  }

  async stop() {
    if (!this.recorder || this.stopping) return;
    this.stopping = true;
    this.onStopped?.();
    try {
      if (this.recorder.state !== 'inactive') {
        await new Promise(resolve => {
          this.recorder.onstop = resolve;
          this.recorder.stop();
        });
      }
      await this.pending;
      await this.cleanup();
      if (this.writeError) {
        await this.api.failed(`Audio write failed: ${this.writeError.message}`);
        throw this.writeError;
      }
      return await this.api.finish();
    } finally {
      await this.cleanup();
    }
  }

  async cleanup() {
    for (const stream of this.streams) for (const track of stream.getTracks()) {
      track.onended = null;
      track.stop();
    }
    this.streams = [];
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
    this.recorder = null;
  }
}
