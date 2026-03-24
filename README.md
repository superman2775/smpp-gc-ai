# SMARTSCHOOL ++ GC AI

This project adds AI to the Smartschool ++ Global Chat
Read this whole guide, and don't skip a part, or else you might not understand stuff.

## 1. Installing the extension

The extension only works for Chromium browsers, so not for Firefox or something.

1. Download a ZIP of the extension [here](https://github.com/superman2775/smpp-gc-ai/archive/refs/heads/main.zip).
2. Unpack it
3. Go to chrome://extensions, edge://extensions, brave://extensions or whatever other browser.
4. Enable developer mode 
5. Click the "Load Unpacked" button
6. Select the extension folder
7. Done!

## 2. Configuring the extension

### Opening configure menu

When you installed the extension, it isn't ready to use yet. You need to configure some stuff first. To do that, click on the extension details button in the chrome://extensions menu, scroll down and click something like *extension options*.

You should get a menu, that's opened from a new tab. Now, the special thing about this menu is that when you edit something here, you don't need to reload the extension or the web page. Changes immediatly affect.

### Editing stuff

What can you edit?
- API key, get it from https://ai.hackclub.com (you can choose 3 different api key slots, idk why)
- Model ID (get this from https://ai.hackclub.com/models)
- Trigger prefix (on what word should ai be triggered)
- Bot username (avoids replying to your own answers, optional)
- System prompt (say here how ai needs to behave)
- Cooldown (How much time has to be in between requests)
- Reminder message (let people know your ai is online after a certain amount of time where the ai has been inactive)
- Rate limit mode (avoid high costs/too much usage with this)
- Discord forwarding (let ai send optional messages using a webhook. Configure in the system prompt what messages should be forwarded (eg. people asking for a moderator, people saying ai is great, etc.))

**Don't forget to click the save button**

## 3. Letting the AI chat

Join the chat [here](https://gc.smpp.be), and use the name you configured in settings. Now people can chat with the AI. You can change settings and click the save button, and changes will affect in real time.

Have fun!