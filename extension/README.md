# skool-dropzone — extension

The Chrome MV3 extension. Currently **Phase 0.5** (clickable panel shell, local-only): the SDZ chip opens a side panel with the chat-with-files UI surface. No network, no E2EE yet — Phase 0.5 just validates the UI shell.

## Install (developer mode)

1. Open `chrome://extensions` in Chrome / Brave / Edge.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `extension/` folder (this folder).
5. Visit any page on `https://*.skool.com/*` — the `SDZ` chip appears in the bottom-right corner.
6. Click the chip → side panel slides in from the right.

## What you can do

- **Click SDZ** → panel opens / closes
- **Type a message** + Enter → message shows in the list (local only — disappears on tab close)
- **Attach a file** (＋ button) → file name + size shows as a message tile (also local only — file is never read or sent)
- **Click ×** in the panel header → panel closes (or click the SDZ chip again)

The amber banner inside the panel reminds: nothing leaves your browser yet.

## What Phase 0.5 proves

- Manifest V3 + content script load path works
- Panel docking + open/close lifecycle works
- Panel and marker survive Skool's SPA navigation (MutationObserver re-asserts the host element if Skool tears down the DOM)
- Chat-with-files UI surface is right-sized

## What's next

See [`../ROADMAP.md`](../ROADMAP.md). Phase 1 wires the meeting-detector so the panel auto-opens when a Stream.io call is active in the page. Phase 2 wires the E2EE transport so messages and files actually travel between participants.

## Files

```
extension/
  manifest.json            — MV3 manifest, matches *.skool.com/*
  content/panel.js         — marker chip + panel mount/render/lifecycle
  content/panel.css        — marker + panel styling
  popup/popup.html         — minimal popup (toolbar icon click)
```
