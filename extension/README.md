# skool-dropzone — extension

The Chrome MV3 extension. Currently **Phase 1** (meeting auto-detect, local-only): the extension only loads on Skool live-meeting pages, detects when you're in an active Stream.io call, and auto-opens the side panel.

## Install (developer mode)

1. Open `chrome://extensions` in Chrome / Brave / Edge.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `extension/` folder (this folder).
5. Visit a Skool live meeting (URL like `https://www.skool.com/live/<id>`) — the `SDZ` chip appears in the bottom-right corner; the panel auto-opens within ~1s of Stream's controls rendering. Status dot in the header is **green** while you're in the call, **grey** otherwise.

## What you can do

- **The panel auto-opens** when you join a Skool live meeting
- **Click SDZ** → toggle panel manually (overrides auto behavior for the rest of this call)
- **Click ×** → close the panel; it stays closed for this call
- **Type a message** + Enter → message shows in the list (local only — disappears on tab close)
- **Add a file** — click ＋ or **drag-and-drop onto the panel** → file goes to the **staging tray**
- **Per staged file** (Fork B):
  - **Share** → moves it into the message log (Phase 2 will encrypt + actually transmit)
  - **Present** → opens a local fullscreen preview (images / video / PDF); Phase 5 will sync this to everyone
  - **✕** → remove from staging

The banner inside the panel reminds: nothing leaves your browser yet (transport lands in Phase 2).

## Crypto core (Phase 2 foundation, shipped)

`content/crypto.js` is the E2EE core — PBKDF2 key derivation + AES-GCM. To verify it works, open DevTools console on a `/live/*` page:

```javascript
await SDZCrypto.selfTest()   // → true
```

`true` means encrypt/decrypt round-trips correctly and a wrong passphrase fails to decrypt. See [`../PHASE2-transport.md`](../PHASE2-transport.md) for the full transport architecture.

## What Phase 1 proves

- Manifest V3 narrow URL-gate at `https://www.skool.com/live/*` works (no injection on non-meeting Skool pages)
- `MutationObserver` reliably tracks Stream.io call lifecycle via `.str-video__call-controls` (verified in a live meeting 2026-05-20)
- Panel auto-mounts on call start, auto-unmounts on call end
- User intent is honored — if you manually close the panel, Phase 1 doesn't fight you and re-open it
- All UI work for the chat-with-files surface (Phase 0.5) carries over cleanly

## What's next

See [`../ROADMAP.md`](../ROADMAP.md). Phase 2 wires the E2EE transport — two browsers on the same `/live/<id>` URL exchange ciphertext through a thin signaling relay, so messages and files actually travel between participants.

## Files

```
extension/
  manifest.json            — MV3 manifest, matches *.skool.com/*
  content/panel.js         — marker chip + panel mount/render/lifecycle
  content/panel.css        — marker + panel styling
  popup/popup.html         — minimal popup (toolbar icon click)
```
