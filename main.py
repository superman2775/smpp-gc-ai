import asyncio
import json
import os
import time
from typing import Any, Dict, Optional

import requests
import websockets


AI_ENDPOINT = "https://ai.hackclub.com/proxy/v1/chat/completions"


def env(name: str, default: Optional[str] = None) -> str:
    value = os.getenv(name, default)
    if value is None or value == "":
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def get_message_text(payload: Any) -> Optional[str]:
    if isinstance(payload, dict):
        for key in ("message", "content", "text"):
            val = payload.get(key)
            if isinstance(val, str):
                return val
    if isinstance(payload, str):
        return payload
    return None


def get_author(payload: Any) -> Optional[str]:
    if isinstance(payload, dict):
        for key in ("username", "author", "user"):
            val = payload.get(key)
            if isinstance(val, str):
                return val
    return None


def build_reply_payload(text: str) -> str:
    send_format = os.getenv("GC_SEND_FORMAT", "json").lower()
    if send_format == "raw":
        return text
    field = os.getenv("GC_SEND_FIELD", "message")
    return json.dumps({field: text})


def call_hackclub_ai(api_key: str, prompt: str) -> str:
    model = os.getenv("HACKCLUB_AI_MODEL", "gpt-4o-mini")
    system_prompt = os.getenv(
        "HACKCLUB_AI_SYSTEM",
        "You are a helpful assistant. Keep responses concise for chat.",
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    resp = requests.post(AI_ENDPOINT, headers=headers, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except Exception:
        raise RuntimeError(f"Unexpected AI response: {data}")


async def run_bot() -> None:
    username = env("GC_USERNAME")
    ws_base = os.getenv("GC_WS_BASE", "wss://gc.smartschoolplusplus.com/socket/chat")
    api_key = env("HACKCLUB_AI_KEY")
    prefix = os.getenv("GC_AI_PREFIX", "?ai").lower()

    ws_url = f"{ws_base}?username={username}"

    print(f"[bot] connecting to {ws_url}")
    while True:
        try:
            async with websockets.connect(ws_url) as ws:
                print("[bot] connected")
                async for raw in ws:
                    payload: Any = raw
                    try:
                        payload = json.loads(raw)
                    except Exception:
                        pass

                    author = get_author(payload)
                    if author and author.lower() == username.lower():
                        continue

                    text = get_message_text(payload)
                    if not text:
                        continue

                    stripped = text.strip()
                    if not stripped.lower().startswith(prefix):
                        continue

                    user_prompt = stripped[len(prefix) :].strip()
                    if not user_prompt:
                        continue

                    print(f"[bot] ?ai from {author or 'unknown'}: {user_prompt}")
                    try:
                        reply = call_hackclub_ai(api_key, user_prompt)
                    except Exception as e:
                        print(f"[bot] AI error: {e}")
                        continue

                    send_payload = build_reply_payload(reply)
                    await ws.send(send_payload)
                    print("[bot] sent reply")
        except Exception as e:
            print(f"[bot] disconnected: {e}")
            time.sleep(3)


if __name__ == "__main__":
    asyncio.run(run_bot())
