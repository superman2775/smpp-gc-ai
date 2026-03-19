This project integrates AI in the Smartschool ++ Global Chat.
Link to Global Chat: https://gc.smpp.be/v1

Uptime: 00:00:00

## Features
- AI-powered responses in the Global Chat.

## Browser Extension (Recommended)
The extension reads messages from the page and sends responses through the page UI.

### Load the extension (Chrome/Chromium)
1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked` and select `extension/`
4. If you update files, click the extension's `Reload` button

### Configure
Open the extension options page and set:
- Hack Club AI API key
- Your bot username (optional, avoids replying to yourself)
- Prefix (default `?ai`)

### How it works
- Watches `#mesgs` for new `.message` nodes
- Reads the message text from `.content`
- If it starts with `?ai`, calls Hack Club AI
- Sends response by filling `#send-input` and clicking `#sendbtn`

## Python Bot (Legacy)
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
