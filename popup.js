const DEFAULTS = {
  enabled: true,
  maxWords: 14,
  fontSize: 30,
  fontScale: 100,
  lead: 0.3,
};

const enabledEl = document.getElementById("enabled");
const maxEl = document.getElementById("maxWords");
const fontEl = document.getElementById("fontScale");
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

chrome.storage.sync.get(null, (s) => {
  currentSettings = normalizeSettings(withStoredDefaults(s));
  writeSettings(currentSettings);
  hydrated = true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !hydrated) return;
  let shouldWrite = false;
  const next = { ...currentSettings };
  for (const key in changes) {
    next[key] = changes[key].newValue;
    shouldWrite = true;
  }
  if (shouldWrite) {
    currentSettings = normalizeSettings(next);
    if (changes.enabled && document.activeElement !== enabledEl) enabledEl.checked = currentSettings.enabled;
    if (changes.maxWords && document.activeElement !== maxEl) maxEl.value = currentSettings.maxWords;
    if (changes.fontScale && document.activeElement !== fontEl) fontEl.value = currentSettings.fontScale;
    if (changes.lead && document.activeElement !== leadEl) leadEl.value = currentSettings.lead;
    refreshStatus();
  }
});

function normalizeSettings(settings) {
  const lead = parseFloat(settings.lead);
  const fontScale =
    "fontScale" in settings
      ? settings.fontScale
      : Math.round((clampInt(settings.fontSize, DEFAULTS.fontSize, 12, 80) / DEFAULTS.fontSize) * 100);
  return {
    enabled: Boolean(settings.enabled),
    maxWords: clampInt(settings.maxWords, DEFAULTS.maxWords, 2, 30),
    fontScale: clampInt(fontScale, DEFAULTS.fontScale, 50, 200),
    lead: Math.max(0, Math.min(2, isNaN(lead) ? DEFAULTS.lead : lead)),
  };
}

function withStoredDefaults(stored) {
  const raw = stored || {};
  const out = { ...DEFAULTS, ...raw };
  if (!Object.prototype.hasOwnProperty.call(raw, "fontScale") && Object.prototype.hasOwnProperty.call(raw, "fontSize")) {
    delete out.fontScale;
  }
  return out;
}

function clampInt(value, fallback, min, max) {
  return Math.max(min, Math.min(max, parseInt(value, 10) || fallback));
}

function readSettings() {
  return normalizeSettings({
    enabled: enabledEl.checked,
    maxWords: maxEl.value === "" ? currentSettings.maxWords : maxEl.value,
    fontScale: fontEl.value === "" ? currentSettings.fontScale : fontEl.value,
    lead: leadEl.value === "" ? currentSettings.lead : leadEl.value,
  });
}

function writeSettings(settings) {
  enabledEl.checked = settings.enabled;
  maxEl.value = settings.maxWords;
  fontEl.value = settings.fontScale;
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
  chrome.storage.sync.set(currentSettings, () => chrome.storage.sync.remove("fontSize"));
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
