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
  rateLimitEnabled: false,
  rateLimitMode: "per_user_day",
  rateLimitMax: 5,
  rateLimitMessage: "Je hebt je limiet voor AI bereikt. Probeer later opnieuw.",
  discordWebhookEnabled: false,
  discordWebhookUrl: ""
};

let settings = { ...DEFAULTS };
let lastSentAt = 0;
let lastTriggerAt = Date.now();
const handled = new Set();
const pendingTimers = new Map();

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (items) => {
      settings = { ...DEFAULTS, ...items };
      resolve();
    });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  for (const key of Object.keys(changes)) {
    settings[key] = changes[key].newValue;
  }
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hourKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}`;
}

function getMessageContent(el) {
  const contentEl = el.querySelector(".content");
  return contentEl ? contentEl.innerText.trim() : "";
}

function getMessageUsername(el) {
  return (el.dataset.username || "").trim();
}

function getMessageRole(el) {
  const roleEl = el.querySelector(".message_top .role");
  if (!roleEl) return "";
  const text = roleEl.textContent ? roleEl.textContent.trim() : "";
  if (text) return text;
  if (roleEl.classList.contains("mod-badge")) return "mod";
  if (roleEl.classList.contains("admin-badge")) return "admin";
  return "";
}

function getMessageId(el) {
  return el.dataset.snowflake || "";
}

function hasAnyApiKey() {
  if (Array.isArray(settings.apiKeys) && settings.apiKeys.some((k) => String(k || "").trim())) {
    return true;
  }
  return Boolean(String(settings.apiKey || "").trim());
}

async function callAI(prompt, authorName, authorRole) {
  if (!hasAnyApiKey()) {
    console.warn("[SMPP AI] Missing API key(s). Set up to 3 keys in extension options.");
    return null;
  }

  const roleSuffix = authorRole ? ` (role: ${authorRole})` : "";
  const payload = {
    model: settings.model,
    messages: [
      { role: "system", content: settings.systemPrompt },
      {
        role: "user",
        content: `User: ${authorName || "unknown"}${roleSuffix}\nMessage: ${prompt}`
      }
    ],
    temperature: 0.7
  };

  const data = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "AI_REQUEST", payload },
      (resp) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) return reject(new Error(lastErr.message));
        if (!resp || !resp.ok) return reject(new Error(resp?.error || "Unknown error"));
        resolve(resp.data);
      }
    );
  });

  const reply = data?.choices?.[0]?.message?.content;
  chrome.storage.sync.get({ requestCount: 0 }, (items) => {
    chrome.storage.sync.set({ requestCount: (items.requestCount || 0) + 1 });
  });
  const mode = settings.rateLimitMode || "per_user_day";
  const isPerUser = mode === "per_user_hour" || mode === "per_user_day";
  if (!isPerUser || authorName) {
    const bucket = mode.includes("hour") ? hourKey() : todayKey();
    const storeKey = mode.includes("hour") ? "rateLimitHourly" : "rateLimitDaily";
    const counterKey = isPerUser ? authorName.toLowerCase() : "__all__";

    chrome.storage.sync.get({ [storeKey]: { bucket, counts: {} } }, (items) => {
      const stored = items[storeKey] || { bucket, counts: {} };
      const counts = stored.bucket === bucket ? stored.counts || {} : {};
      counts[counterKey] = (counts[counterKey] || 0) + 1;
      chrome.storage.sync.set({ [storeKey]: { bucket, counts } });
    });
  }
  return typeof reply === "string" ? reply.trim() : null;
}

function extractDiscordPayload(text) {
  if (!text) return { chatText: "", discordMessage: null };

  const trimmed = text.trim();

  const unescapeJsonString = (s) =>
    s.replace(/\\\\/g, "\\").replace(/\\"/g, "\"").replace(/\\n/g, "\n");

  const tryExtractFromObject = (obj) => {
    const msg = obj && (obj.discord || obj.discord_message || obj.message);
    if (typeof msg === "string" && msg.trim()) {
      return msg.trim();
    }
    return null;
  };

  const tryExtractFromText = (candidate) => {
    try {
      const obj = JSON.parse(candidate);
      return tryExtractFromObject(obj);
    } catch (_) {
      // fallback: regex extraction for escaped or plain JSON
      let m = candidate.match(/"discord"\s*:\s*"([^"]*)"/);
      if (!m) m = candidate.match(/\\"discord\\"\s*:\s*\\"([^"]*)\\"/);
      if (!m) m = candidate.match(/\\+discord\\*"\s*:\s*"([^"]*)"/);
      if (!m) m = candidate.match(/\bdiscord\s*:\s*([^}]+)\}/i);
      if (m && m[1]) {
        return unescapeJsonString(m[1].trim());
      }
    }
    return null;
  };

  // Prefer fenced JSON blocks if present.
  const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    const msg = tryExtractFromText(fenceMatch[1]);
    const chatText = trimmed.replace(fenceMatch[0], "").trim();
    return { chatText, discordMessage: msg };
  }

  // Search for any JSON object with a discord field.
  let depth = 0;
  let start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = trimmed.slice(start, i + 1);
        if (
          /(\"|\\\")(?:discord|discord_message|message)(\"|\\\")\s*:/.test(candidate) ||
          /\\+discord\\*"\s*:/.test(candidate) ||
          /\bdiscord\s*:/.test(candidate)
        ) {
          const msg = tryExtractFromText(candidate);
          const chatText = (trimmed.slice(0, start) + trimmed.slice(i + 1)).trim();
          return { chatText, discordMessage: msg };
        }
        start = -1;
      }
    }
  }

  return { chatText: trimmed, discordMessage: null };
}

async function sendDiscordWebhook(message) {
  if (!settings.discordWebhookEnabled) return;
  if (!settings.discordWebhookUrl) return;

  await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "DISCORD_WEBHOOK", webhookUrl: settings.discordWebhookUrl, content: message },
      (resp) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) return reject(new Error(lastErr.message));
        if (!resp || !resp.ok) return reject(new Error(resp?.error || "Unknown error"));
        resolve();
      }
    );
  });
}

async function canProcessForUser(username) {
  if (!settings.rateLimitEnabled) return true;

  const max = Number(settings.rateLimitMax) || 0;
  if (max <= 0) return true;

  const userKey = (username || "").toLowerCase();
  const mode = settings.rateLimitMode || "per_user_day";

  const isPerUser = mode === "per_user_hour" || mode === "per_user_day";
  if (isPerUser && !userKey) return true;

  const bucket = mode.includes("hour") ? hourKey() : todayKey();
  const storeKey = mode.includes("hour") ? "rateLimitHourly" : "rateLimitDaily";

  const data = await new Promise((resolve) => {
    chrome.storage.sync.get({ [storeKey]: { bucket, counts: {} } }, resolve);
  });

  const stored = data[storeKey] || { bucket, counts: {} };
  let counts = stored.counts || {};

  if (stored.bucket !== bucket) {
    counts = {};
  }

  const counterKey = isPerUser ? userKey : "__all__";
  const count = counts[counterKey] || 0;
  if (count < max) return true;

  sendMessage(settings.rateLimitMessage);
  return false;
}

function sendMessage(text) {
  const input = document.querySelector("#send-input");
  const button = document.querySelector("#sendbtn");
  if (!input || !button) {
    console.warn("[SMPP AI] Send input/button not found.");
    return;
  }

  input.focus();
  input.textContent = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  button.click();
}

function startReminderLoop() {
  setInterval(() => {
    if (!settings.reminderEnabled) return;
    const now = Date.now();
    if (now - lastTriggerAt < settings.reminderIntervalMs) return;
    sendMessage(settings.reminderMessage);
    lastTriggerAt = Date.now();
  }, 10000);
}

async function handleMessage(el) {
  const username = getMessageUsername(el);
  const role = getMessageRole(el);
  if (settings.botUsername && username.toLowerCase() === settings.botUsername.toLowerCase()) {
    return;
  }

  const content = getMessageContent(el);
  if (!content) return;

  const prefix = settings.prefix || "?ai";
  if (!content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  const prompt = content.slice(prefix.length).trim();
  if (!prompt) return;

  const allowed = await canProcessForUser(username);
  if (!allowed) return;

  const now = Date.now();
  const wait = Math.max(0, settings.cooldownMs - (now - lastSentAt));
  if (wait > 0) await sleep(wait);

  let reply;
  try {
    reply = await callAI(prompt, username, role);
  } catch (err) {
    console.warn("[SMPP AI] AI call failed:", err);
    return;
  }
  if (!reply) return;

  const { chatText, discordMessage } = extractDiscordPayload(reply);
  if (chatText) {
    sendMessage(chatText);
  }
  if (discordMessage) {
    try {
      await sendDiscordWebhook(discordMessage);
    } catch (err) {
      console.warn("[SMPP AI] Discord webhook failed:", err);
    }
  }

  lastSentAt = Date.now();
  lastTriggerAt = Date.now();
}

function markExisting() {
  const nodes = document.querySelectorAll("#mesgs .message");
  nodes.forEach((el) => {
    const id = getMessageId(el);
    if (id) handled.add(id);
  });
}

function scheduleProcess(messageEl) {
  const id = getMessageId(messageEl);
  if (!id) return;
  if (handled.has(id)) return;

  if (pendingTimers.has(id)) {
    clearTimeout(pendingTimers.get(id));
  }

  const timer = setTimeout(() => {
    pendingTimers.delete(id);
    if (handled.has(id)) return;
    handled.add(id);
    handleMessage(messageEl);
  }, 400);

  pendingTimers.set(id, timer);
}

function observeMessages() {
  const target = document.querySelector("#mesgs");
  if (!target) {
    console.warn("[SMPP AI] #mesgs not found.");
    return;
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes" && m.target instanceof HTMLElement) {
        const t = m.target;
        if (t.classList.contains("message")) {
          scheduleProcess(t);
        }
      }
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const messageEl = node.classList.contains("message")
          ? node
          : node.querySelector?.(".message");
        if (!messageEl) continue;

        scheduleProcess(messageEl);
      }
    }
  });

  observer.observe(target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-snowflake"]
  });
}

async function init() {
  await loadSettings();
  markExisting();
  observeMessages();
  startReminderLoop();
  console.log("[SMPP AI] Bot loaded.");
}

init();
