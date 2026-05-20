# skool-dropzone — extension

The Chrome MV3 extension. Currently **Phase 0** (scaffolding): proves the extension loads on Skool pages and survives SPA navigation.

## Install (developer mode)

1. Open `chrome://extensions` in Chrome / Brave / Edge.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `extension/` folder (this folder).
5. Visit any page on `https://*.skool.com/*` — a small `SDZ` chip should appear in the bottom-right corner.

## What Phase 0 proves

- Manifest V3 + content script load path works
- The chip survives navigation between Skool pages (SPA route changes)
- No console errors

## What's next

See [`../ROADMAP.md`](../ROADMAP.md). Phase 1 narrows injection to meeting pages only and replaces the marker with a real side panel.

## Files

```
extension/
  manifest.json            — MV3 manifest, matches *.skool.com/*
  content/marker.js        — injects SDZ marker, re-asserts on SPA nav
  content/marker.css       — marker styling (fixed bottom-right chip)
  popup/popup.html         — minimal popup (toolbar icon click)
```
