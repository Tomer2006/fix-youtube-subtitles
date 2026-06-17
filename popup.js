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

function setStatus(level, msg) {
  statusEl.className = "status status-" + level;
  statusText.textContent = msg;
}

// Ask the content script on the active tab what it's currently doing.
function refreshStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const id = tabs[0] && tabs[0].id;
    if (id == null) {
      setStatus("idle", "No active tab.");
      return;
    }
    chrome.tabs.sendMessage(id, { type: "YTFIX_GET_STATUS" }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        setStatus("idle", "Open a YouTube video, then reopen this popup.");
        return;
      }
      setStatus(resp.level, resp.msg);
    });
  });
}

refreshStatus();
setInterval(refreshStatus, 1500);

chrome.storage.sync.get(DEFAULTS, (s) => {
  enabledEl.checked = s.enabled;
  maxEl.value = s.maxWords;
  fontEl.value = s.fontSize;
  leadEl.value = s.lead;
});

// Reflect changes made elsewhere (e.g. toggling the CC button on YouTube).
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "sync" && c.enabled) enabledEl.checked = c.enabled.newValue;
});

function save() {
  const lead = parseFloat(leadEl.value);
  chrome.storage.sync.set({
    enabled: enabledEl.checked,
    maxWords: Math.max(2, Math.min(30, parseInt(maxEl.value, 10) || DEFAULTS.maxWords)),
    fontSize: Math.max(12, Math.min(80, parseInt(fontEl.value, 10) || DEFAULTS.fontSize)),
    lead: Math.max(0, Math.min(2, isNaN(lead) ? DEFAULTS.lead : lead)),
  });
}

enabledEl.addEventListener("change", save);
maxEl.addEventListener("change", save);
fontEl.addEventListener("change", save);
leadEl.addEventListener("change", save);
