# Two-tab browser test — screen share (branch `feat/screen-share`)

`npm test` covers logic + structure; it cannot drive `getDisplayMedia`,
MediaStreams, WebRTC renegotiation, or the DOM. This is the manual pass that
does. Screen share is **100% browser-only** — none of it is Node-verified.

## Setup

```bash
cd signaling && npm ci && npm start      # relay on ws://127.0.0.1:8080
```

Open `extension/test/harness.html` in **two** tabs (or load the unpacked
extension in a real meeting). Join both to the same room + **same passphrase**.

## Regression — I touched the proven connection path *additively*, re-verify it

The screen-share work added an `ontrack` handler and a late-joiner branch in
`dc.onopen`, and changed the `init()` signature. The initial offer/answer and
`onRemoteSignal` were **left untouched**, but confirm the spine still works:

- [ ] Two tabs connect → `connected`, peer count 1
- [ ] Text both directions
- [ ] File send → received, byte-identical
- [ ] Present a file → fullscreen for the viewer
- [ ] Whiteboard strokes sync

## Screen share — the new feature (REWORKED after the H-media audit)

The audit found the first cut broken (glare-deadlock + forced-fullscreen abuse);
this is the reworked flow — **perfect negotiation + consent prompt**. Verify all:

**Pre-share confirm (sharer):**
- [ ] Click **🖥 Share screen** → button changes to **Share screen anyway** + a
      system line warns "encrypted in transit but NOT under your room passphrase"
- [ ] Click again → browser screen-picker appears → pick a screen/window →
      button flips to **■ Stop sharing**

**Consent (viewer — NOT auto-fullscreen):**
- [ ] Viewer gets a small **"A member wants to share their screen — View / Dismiss"**
      banner, NOT an instant fullscreen takeover
- [ ] **Dismiss** → banner closes, nothing seizes the screen
- [ ] **View** → fullscreen opens, shows the live screen + the passphrase note

**Abuse must be defeated:**
- [ ] While a share from A is active/prompting, a second member B sharing does
      **not** seize your screen (single-presenter slot)
- [ ] Stop/start in a loop → you are NOT pinned to an unclosable fullscreen

**Negotiation (the blocker that was broken):**
- [ ] **3-peer:** A, B, C all in the room; A shares → both B and C get the share
      (no deadlock — this is the case that failed before)
- [ ] **Late joiner:** A sharing, then C joins → C gets the ongoing share
- [ ] **Two near-simultaneous shares** don't deadlock the mesh (glare handled)
- [ ] **Chat still works during a share** — send text while sharing, it arrives

**Teardown:**
- [ ] Presenter **Stop sharing** (panel button OR browser's own bar) → every
      viewer's overlay closes, all buttons reset (`__sdz-screen-stop`)
- [ ] Presenter **disconnects mid-share** → viewers' overlays close (track end),
      don't hang on a frozen frame

## Known limits (by design)

- Screen share is **DTLS-encrypted, not passphrase-E2EE** (SECURITY-AUDIT.md
  "H-media"): a malicious relay that MITMs the handshake could intercept the
  video — unlike chat/files, which the passphrase still protects.
- No webcam (intentional — the Skool meeting already provides webcam video).
- Follow-ups (not blockers): the consent prompt doesn't yet name *who* is
  sharing; the screen-share and file-present overlays are still two separate
  systems (Esc/stacking quirks if both open).

## If it breaks

- Viewer never sees the screen → check `pc.ontrack` fires, `onTrack(stream,
  fromPeer)` is wired into `init()` (panel.js / harness.js), and `showRemote`
  reaches `showConsent` (screenshare.js).
- 3-peer deadlock / "have-local-offer" errors in console → the perfect-negotiation
  collision handling in `onRemoteSignal` (politeness / `ignoreOffer`) is the place
  to look.
- Viewer overlay hangs after Stop → the `__sdz-screen-stop` message isn't
  routing to `SDZScreenShare.handleMessage` (panel.js / harness.js dispatch).
