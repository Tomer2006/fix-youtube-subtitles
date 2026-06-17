const DEFAULTS = {
  enabled: true,
  maxWords: 14,
  fontSize: 30,
  lead: 0.3,
};

const enabledEl = document.getElementById("enabled");
const maxEl = document.getElementById("maxWords");
const fontEl = document.getElementById("fontSize");
const leadEl = document.getElementById("lead");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");

let currentSettings = { ...DEFAULTS };
let hydrated = false;
let saveTimer = null;

function setStatus(level, msg) {
  statusEl.className = "status status-" + level;
  statusText.textContent = msg;
}

function withActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs && tabs[0] && tabs[0].id;
    callback(tabId == null ? null : tabId);
  });
}

function refreshStatus() {
  withActiveTab((tabId) => {
    if (tabId == null) {
      setStatus("idle", "No active tab.");
      return;
    }
    chrome.tabs.sendMessage(tabId, { type: "YTFIX_GET_STATUS" }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        setStatus("idle", "Open a YouTube video, then reopen this popup.");
        return;
      }
      setStatus(resp.level, resp.msg);
    });
  });
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  currentSettings = normalizeSettings(s);
  writeSettings(currentSettings);
  hydrated = true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !hydrated) return;
  if (changes.enabled) {
    currentSettings.enabled = Boolean(changes.enabled.newValue);
    enabledEl.checked = currentSettings.enabled;
    refreshStatus();
  }
});

function normalizeSettings(settings) {
  const lead = parseFloat(settings.lead);
  return {
    enabled: Boolean(settings.enabled),
    maxWords: clampInt(settings.maxWords, DEFAULTS.maxWords, 2, 30),
    fontSize: clampInt(settings.fontSize, DEFAULTS.fontSize, 12, 80),
    lead: Math.max(0, Math.min(2, isNaN(lead) ? DEFAULTS.lead : lead)),
  };
}

function clampInt(value, fallback, min, max) {
  return Math.max(min, Math.min(max, parseInt(value, 10) || fallback));
}

function readSettings() {
  return normalizeSettings({
    enabled: enabledEl.checked,
    maxWords: maxEl.value === "" ? currentSettings.maxWords : maxEl.value,
    fontSize: fontEl.value === "" ? currentSettings.fontSize : fontEl.value,
    lead: leadEl.value === "" ? currentSettings.lead : leadEl.value,
  });
}

function writeSettings(settings) {
  enabledEl.checked = settings.enabled;
  maxEl.value = settings.maxWords;
  fontEl.value = settings.fontSize;
  leadEl.value = settings.lead;
}

function notifyActiveTab(settings) {
  withActiveTab((tabId) => {
    if (tabId == null) return;
    chrome.tabs.sendMessage(tabId, { type: "YTFIX_SETTINGS", settings }, () => {
      // Ignore tabs where the content script is not present.
      void chrome.runtime.lastError;
      refreshStatus();
    });
  });
}

function save(options = {}) {
  if (!hydrated) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  currentSettings = readSettings();
  chrome.storage.sync.set(currentSettings);
  notifyActiveTab(currentSettings);

  if (options.normalizeInputs) writeSettings(currentSettings);
}

function scheduleSave() {
  if (!hydrated) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 120);
}

refreshStatus();
setInterval(refreshStatus, 1500);

enabledEl.addEventListener("change", () => save());
maxEl.addEventListener("input", scheduleSave);
fontEl.addEventListener("input", scheduleSave);
leadEl.addEventListener("input", scheduleSave);
maxEl.addEventListener("change", () => save({ normalizeInputs: true }));
fontEl.addEventListener("change", () => save({ normalizeInputs: true }));
leadEl.addEventListener("change", () => save({ normalizeInputs: true }));
