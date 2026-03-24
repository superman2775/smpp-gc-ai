const AI_ENDPOINT = "https://ai.hackclub.com/proxy/v1/chat/completions";

const KEY_DEFAULTS = { apiKey: "", apiKeys: [] };

let apiKeys = [];
let rrIndex = 0;
const inflightByKey = new Map();
let lastKeyLoadAt = 0;

function normalizeKeys(items) {
  const keys = [];
  if (Array.isArray(items?.apiKeys)) {
    for (const k of items.apiKeys) {
      const trimmed = String(k || "").trim();
      if (trimmed) keys.push(trimmed);
    }
  }
  if (keys.length === 0) {
    const legacy = String(items?.apiKey || "").trim();
    if (legacy) keys.push(legacy);
  }
  return [...new Set(keys)].slice(0, 3);
}

function loadKeys() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(KEY_DEFAULTS, (items) => {
      apiKeys = normalizeKeys(items);
      lastKeyLoadAt = Date.now();
      resolve(apiKeys);
    });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (!("apiKeys" in changes) && !("apiKey" in changes)) return;

  const nextApiKeys =
    "apiKeys" in changes
      ? normalizeKeys({ apiKeys: changes.apiKeys.newValue, apiKey: changes.apiKey?.newValue })
      : normalizeKeys({ apiKeys, apiKey: changes.apiKey.newValue });

  apiKeys = nextApiKeys;
  lastKeyLoadAt = Date.now();
});

function pickKey(exclude) {
  if (!apiKeys.length) return null;
  const excluded = exclude ? new Set([exclude]) : null;

  let bestKey = null;
  let bestInflight = Number.POSITIVE_INFINITY;

  for (let offset = 0; offset < apiKeys.length; offset++) {
    const idx = (rrIndex + offset) % apiKeys.length;
    const key = apiKeys[idx];
    if (excluded && excluded.has(key)) continue;

    const inflight = inflightByKey.get(key) || 0;
    if (inflight < bestInflight) {
      bestInflight = inflight;
      bestKey = key;
      if (bestInflight === 0) break;
    }
  }

  if (bestKey) {
    rrIndex = (apiKeys.indexOf(bestKey) + 1) % apiKeys.length;
    inflightByKey.set(bestKey, (inflightByKey.get(bestKey) || 0) + 1);
  }

  return bestKey;
}

function releaseKey(key) {
  if (!key) return;
  const next = (inflightByKey.get(key) || 1) - 1;
  if (next <= 0) inflightByKey.delete(key);
  else inflightByKey.set(key, next);
}

async function doAiFetch({ apiKey, payload }) {
  const resp = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const text = await resp.text();
  if (!resp.ok) {
    return { ok: false, status: resp.status, error: `AI error ${resp.status}: ${text}` };
  }

  try {
    const data = JSON.parse(text);
    return { ok: true, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: resp.status, error: `Invalid JSON: ${e}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "AI_REQUEST") return;

  (async () => {
    const payload = msg.payload;
    const explicitKey = String(msg.apiKey || "").trim();

    if (!explicitKey && (Date.now() - lastKeyLoadAt > 60_000 || apiKeys.length === 0)) {
      await loadKeys();
    }

    const key = explicitKey || pickKey();
    if (!key) {
      sendResponse({ ok: false, error: "Missing API key(s). Set up to 3 keys in extension options." });
      return;
    }

    let result;
    try {
      result = await doAiFetch({ apiKey: key, payload });
    } finally {
      if (!explicitKey) releaseKey(key);
    }

    // Retry once with a different key on rate-limit/auth errors, if available.
    if (
      !explicitKey &&
      !result.ok &&
      (result.status === 401 || result.status === 403 || result.status === 429) &&
      apiKeys.length >= 2
    ) {
      const retryKey = pickKey(key);
      if (retryKey) {
        try {
          result = await doAiFetch({ apiKey: retryKey, payload });
        } finally {
          releaseKey(retryKey);
        }
      }
    }

    if (!result.ok) {
      sendResponse({ ok: false, error: result.error });
      return;
    }

    sendResponse({ ok: true, data: result.data });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err) });
  });

  return true;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "DISCORD_WEBHOOK") return;

  const { webhookUrl, content } = msg;
  if (!webhookUrl || !content) {
    sendResponse({ ok: false, error: "Missing webhookUrl or content" });
    return true;
  }

  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  })
    .then(async (resp) => {
      const text = await resp.text();
      if (!resp.ok) {
        sendResponse({ ok: false, error: `Discord error ${resp.status}: ${text}` });
        return;
      }
      sendResponse({ ok: true });
    })
    .catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });

  return true;
});
