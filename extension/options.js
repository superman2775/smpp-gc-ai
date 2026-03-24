const DEFAULTS = {
  apiKey: "",
  apiKeys: [],
  model: "google/gemini-2.5-flash",
  prefix: "?ai",
  botUsername: "Smartschool AI Assistent",
  systemPrompt: "You are a helpful assistant. Keep responses concise for chat. If something must be forwarded to Discord, append a JSON object at the end like: {\"discord\":\"message\"}.",
  cooldownMs: 2500,
  reminderEnabled: true,
  reminderIntervalMs: 5 * 60 * 1000,
  reminderMessage: "Reminder: you can use ?ai to ask the AI a question.",
  requestCount: 0,
  perUserDailyMaxEnabled: false,
  perUserDailyMax: 5,
  discordWebhookEnabled: false,
  discordWebhookUrl: ""
};

function byId(id) {
  return document.getElementById(id);
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (items) => {
    const keysFromArray = Array.isArray(items.apiKeys) ? items.apiKeys : [];
    const keys =
      keysFromArray.length > 0
        ? keysFromArray
        : items.apiKey
          ? [items.apiKey]
          : [];

    byId("apiKey1").value = keys[0] || "";
    byId("apiKey2").value = keys[1] || "";
    byId("apiKey3").value = keys[2] || "";
    byId("model").value = items.model || "";
    byId("prefix").value = items.prefix || "";
    byId("botUsername").value = items.botUsername || "";
    byId("systemPrompt").value = items.systemPrompt || "";
    byId("cooldownMs").value = items.cooldownMs || 0;
    byId("reminderEnabled").checked = Boolean(items.reminderEnabled);
    byId("reminderIntervalMs").value = items.reminderIntervalMs || 0;
    byId("reminderMessage").value = items.reminderMessage || "";
    byId("requestCount").textContent = String(items.requestCount || 0);
    byId("perUserDailyMaxEnabled").checked = Boolean(items.perUserDailyMaxEnabled);
    byId("perUserDailyMax").value = items.perUserDailyMax || 0;
    byId("discordWebhookEnabled").checked = Boolean(items.discordWebhookEnabled);
    byId("discordWebhookUrl").value = items.discordWebhookUrl || "";
  });
}

function save() {
  const apiKeys = [byId("apiKey1").value, byId("apiKey2").value, byId("apiKey3").value]
    .map((k) => String(k || "").trim())
    .filter(Boolean);
  const uniqueApiKeys = [...new Set(apiKeys)].slice(0, 3);

  const data = {
    apiKey: uniqueApiKeys[0] || "",
    apiKeys: uniqueApiKeys,
    model: byId("model").value.trim() || DEFAULTS.model,
    prefix: byId("prefix").value.trim() || DEFAULTS.prefix,
    botUsername: byId("botUsername").value.trim(),
    systemPrompt: byId("systemPrompt").value.trim() || DEFAULTS.systemPrompt,
    cooldownMs: Number(byId("cooldownMs").value) || 0,
    reminderEnabled: byId("reminderEnabled").checked,
    reminderIntervalMs: Number(byId("reminderIntervalMs").value) || DEFAULTS.reminderIntervalMs,
    reminderMessage: byId("reminderMessage").value.trim() || DEFAULTS.reminderMessage,
    perUserDailyMaxEnabled: byId("perUserDailyMaxEnabled").checked,
    perUserDailyMax: Number(byId("perUserDailyMax").value) || DEFAULTS.perUserDailyMax,
    discordWebhookEnabled: byId("discordWebhookEnabled").checked,
    discordWebhookUrl: byId("discordWebhookUrl").value.trim()
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
  byId("resetCountBtn").addEventListener("click", () => {
    chrome.storage.sync.set({ requestCount: 0 }, () => {
      byId("requestCount").textContent = "0";
    });
  });
});
