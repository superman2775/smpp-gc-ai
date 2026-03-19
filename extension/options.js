const DEFAULTS = {
  apiKey: "",
  model: "google/gemini-2.5-flash",
  prefix: "?ai",
  botUsername: "Smartschool AI Assistent",
  systemPrompt: "You are a helpful assistant. Keep responses concise for chat.",
  cooldownMs: 2500
};

function byId(id) {
  return document.getElementById(id);
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (items) => {
    byId("apiKey").value = items.apiKey || "";
    byId("model").value = items.model || "";
    byId("prefix").value = items.prefix || "";
    byId("botUsername").value = items.botUsername || "";
    byId("systemPrompt").value = items.systemPrompt || "";
    byId("cooldownMs").value = items.cooldownMs || 0;
  });
}

function save() {
  const data = {
    apiKey: byId("apiKey").value.trim(),
    model: byId("model").value.trim() || DEFAULTS.model,
    prefix: byId("prefix").value.trim() || DEFAULTS.prefix,
    botUsername: byId("botUsername").value.trim(),
    systemPrompt: byId("systemPrompt").value.trim() || DEFAULTS.systemPrompt,
    cooldownMs: Number(byId("cooldownMs").value) || 0
  };

  chrome.storage.sync.set(data, () => {
    const status = byId("status");
    status.textContent = "Saved.";
    setTimeout(() => (status.textContent = ""), 1500);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  byId("saveBtn").addEventListener("click", save);
});
