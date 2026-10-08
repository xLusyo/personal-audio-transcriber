const keyForm = document.getElementById('api-key-form');
const keyProvider = document.getElementById('api-provider');
const keyInput = document.getElementById('api-key');
const keyStatus = document.getElementById('api-key-status');
let keySettings;
let isSavingKey = false;

function displayKeySettings() {
  if (!keySettings) return;
  const configured = keySettings.configured[keyProvider.value];
  keyStatus.textContent = `${configured ? 'Key configured. Enter a new key to replace it.' : 'No key configured for this provider.'} Transcription: ${keySettings.transcriptionProvider}. Notes: ${keySettings.summaryProvider}.`;
}

keyProvider.addEventListener('change', () => {
  keyInput.value = '';
  displayKeySettings();
});
keyForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (isSavingKey) return;
  isSavingKey = true;
  const saveButton = keyForm.querySelector('button');
  saveButton.disabled = true;
  try {
    keySettings = await window.meetingNotes.saveApiKey(keyProvider.value, keyInput.value);
    keyInput.value = '';
    displayKeySettings();
    keyStatus.textContent = `API key saved. ${keyStatus.textContent}`;
  } catch (error) {
    keyStatus.textContent = error.message;
  } finally {
    isSavingKey = false;
    saveButton.disabled = false;
  }
});
window.meetingNotes.getApiKeySettings().then(settings => {
  keySettings = settings;
  displayKeySettings();
}).catch(error => { keyStatus.textContent = error.message; });
