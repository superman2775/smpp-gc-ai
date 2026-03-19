const DEFAULTS = {
  apiKey: "",
  model: "gpt-4o-mini",
  prefix: "?ai",
  botUsername: "",
  systemPrompt: "You are a helpful assistant. Keep responses concise for chat.",
  cooldownMs: 2500
};

let settings = { ...DEFAULTS };
let lastSentAt = 0;
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

async function callAI(prompt) {
  if (!settings.apiKey) {
    console.warn("[SMPP AI] Missing API key. Set it in extension options.");
    return null;
  }

  const payload = {
    model: settings.model,
    messages: [
      { role: "system", content: settings.systemPrompt },
      { role: "user", content: prompt }
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
  return typeof reply === "string" ? reply.trim() : null;
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

  const now = Date.now();
  const wait = Math.max(0, settings.cooldownMs - (now - lastSentAt));
  if (wait > 0) await sleep(wait);

  let reply;
  try {
    reply = await callAI(prompt);
  } catch (err) {
    console.warn("[SMPP AI] AI call failed:", err);
    return;
  }
  if (!reply) return;

  sendMessage(reply);
  lastSentAt = Date.now();
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
  console.log("[SMPP AI] Bot loaded.");
}

init();
