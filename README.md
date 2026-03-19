This project integrates AI in the Smartschool ++ Global Chat.
Link to Global Chat: https://gc.smpp.be/v1

Uptime: 00:00:00

## Features
- AI-powered responses in the Global Chat.

## Setup
Install dependencies:
```bash
pip install websockets requests
```

Create a `.env` (or set env vars in your shell):
```bash
GC_USERNAME=your_username
HACKCLUB_AI_KEY=your_hackclub_ai_key
```

Optional env vars:
```bash
GC_WS_BASE=wss://gc.smartschoolplusplus.com/socket/chat
GC_AI_PREFIX=?ai
GC_SEND_FORMAT=json   # or "raw"
GC_SEND_FIELD=message
HACKCLUB_AI_MODEL=gpt-4o-mini
HACKCLUB_AI_SYSTEM=You are a helpful assistant. Keep responses concise for chat.
```

Run:
```bash
python main.py
```
