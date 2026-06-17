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

chrome.storage.sync.get(DEFAULTS, (s) => {
  enabledEl.checked = s.enabled;
  maxEl.value = s.maxWords;
  fontEl.value = s.fontSize;
  leadEl.value = s.lead;
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
