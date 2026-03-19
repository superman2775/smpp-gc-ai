const AI_ENDPOINT = "https://ai.hackclub.com/proxy/v1/chat/completions";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "AI_REQUEST") return;

  const { apiKey, payload } = msg;
  if (!apiKey) {
    sendResponse({ ok: false, error: "Missing API key" });
    return true;
  }

  fetch(AI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  })
    .then(async (resp) => {
      const text = await resp.text();
      if (!resp.ok) {
        sendResponse({ ok: false, error: `AI error ${resp.status}: ${text}` });
        return;
      }
      try {
        const data = JSON.parse(text);
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: `Invalid JSON: ${e}` });
      }
    })
    .catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });

  return true;
});
