const DEFAULTS = {
  apiKey: "",
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
  perUserDailyMaxMessage: "Je hebt je dagelijkse limiet voor AI bereikt. Probeer morgen opnieuw.",
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

function getMessageContent(el) {
  const contentEl = el.querySelector(".content");
  return contentEl ? contentEl.innerText.trim() : "";
}

function getMessageUsername(el) {
  return (el.dataset.username || "").trim();
}

function getMessageId(el) {
  return el.dataset.snowflake || "";
}

async function callAI(prompt, authorName) {
  if (!settings.apiKey) {
    console.warn("[SMPP AI] Missing API key. Set it in extension options.");
    return null;
  }

  const payload = {
    model: settings.model,
    messages: [
      { role: "system", content: settings.systemPrompt },
      { role: "user", content: `User: ${authorName || "unknown"}\nMessage: ${prompt}` }
    ],
    temperature: 0.7
  };

  const data = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "AI_REQUEST", apiKey: settings.apiKey, payload },
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
  if (authorName) {
    const key = authorName.toLowerCase();
    chrome.storage.sync.get({ perUserDailyCounts: { date: todayKey(), counts: {} } }, (items) => {
      const stored = items.perUserDailyCounts || { date: todayKey(), counts: {} };
      const date = stored.date === todayKey() ? stored.date : todayKey();
      const counts = stored.date === todayKey() ? stored.counts || {} : {};
      counts[key] = (counts[key] || 0) + 1;
      chrome.storage.sync.set({ perUserDailyCounts: { date, counts } });
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
        if (/(\"|\\\")(?:discord|discord_message|message)(\"|\\\")\s*:/.test(candidate)) {
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
  if (!settings.perUserDailyMaxEnabled) return true;
  if (!username) return true;

  const key = username.toLowerCase();
  const max = Number(settings.perUserDailyMax) || 0;
  if (max <= 0) return true;

  const data = await new Promise((resolve) => {
    chrome.storage.sync.get({ perUserDailyCounts: { date: todayKey(), counts: {} } }, resolve);
  });

  const stored = data.perUserDailyCounts || { date: todayKey(), counts: {} };
  if (stored.date !== todayKey()) {
    await new Promise((resolve) => {
      chrome.storage.sync.set({ perUserDailyCounts: { date: todayKey(), counts: {} } }, resolve);
    });
    return true;
  }

  const count = (stored.counts && stored.counts[key]) || 0;
  if (count < max) return true;

  // Send one standard message per user per day when limit is reached.
  const notifiedData = await new Promise((resolve) => {
    chrome.storage.sync.get(
      { perUserDailyLimitNotified: { date: todayKey(), users: {} } },
      resolve
    );
  });

  const notified = notifiedData.perUserDailyLimitNotified || { date: todayKey(), users: {} };
  if (notified.date !== todayKey()) {
    await new Promise((resolve) => {
      chrome.storage.sync.set(
        { perUserDailyLimitNotified: { date: todayKey(), users: {} } },
        resolve
      );
    });
  }

  const users = notified.date === todayKey() ? notified.users || {} : {};
  if (!users[key]) {
    sendMessage(settings.perUserDailyMaxMessage);
    users[key] = true;
    chrome.storage.sync.set({ perUserDailyLimitNotified: { date: todayKey(), users } });
  }

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
    reply = await callAI(prompt, username);
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
