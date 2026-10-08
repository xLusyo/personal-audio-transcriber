const api = window.meetingNotes;
const recorder = new MeetingRecorder(api);
const start = document.getElementById('start');
const stop = document.getElementById('stop');
const retry = document.getElementById('retry');
let startedAt;
let timer;

function showError(error) {
  document.getElementById('status').textContent = error.message;
}

function updateStatus({ state, message, lastNote }) {
  document.body.dataset.state = state;
  document.getElementById('state').textContent = state.charAt(0).toUpperCase() + state.slice(1);
  document.getElementById('status').textContent = message;
  const busy = ['starting', 'recording', 'stopping', 'processing'].includes(state);
  start.hidden = state === 'recording';
  start.disabled = busy;
  stop.hidden = state !== 'recording';
  stop.disabled = state !== 'recording';
  retry.disabled = busy;
  document.getElementById('api-key-fields').disabled = busy;
  document.getElementById('note').disabled = !lastNote;
}

recorder.onStarted = () => {
  startedAt = Date.now();
  document.getElementById('timer').textContent = '00:00';
  timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    document.getElementById('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }, 1000);
};
recorder.onStopped = () => { clearInterval(timer); stop.disabled = true; };
recorder.onError = showError;
start.addEventListener('click', () => recorder.start().catch(showError));
stop.addEventListener('click', () => recorder.stop().catch(showError));
retry.addEventListener('click', () => api.retry().catch(showError));
document.getElementById('folder').addEventListener('click', () => api.openFolder().catch(showError));
document.getElementById('note').addEventListener('click', () => api.openNote().catch(showError));
api.onStatus(updateStatus);
api.onStop(() => recorder.stop().catch(showError));
api.onCaptureError(message => showError(new Error(message)));
api.getStatus().then(status => {
  updateStatus(status);
  document.getElementById('config').textContent = `Configuration: ${status.envPath}`;
}).catch(showError);
