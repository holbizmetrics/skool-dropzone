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

## Screen share — the new feature

- [ ] Presenter clicks **🖥 Share screen** → browser screen-picker appears →
      pick a screen/window → button flips to **■ Stop sharing**
- [ ] Viewer tab auto-opens a fullscreen view of the presenter's screen, live
- [ ] The viewer overlay shows the "encrypted in transit — not under your room
      passphrase" note
- [ ] Presenter clicks **Stop sharing** (or the browser's own "Stop sharing"
      bar) → the viewer's view closes, button flips back
- [ ] **Late joiner:** start sharing, THEN a third tab joins → it sees the
      ongoing share (the `dc.onopen` renegotiation path)
- [ ] **Renegotiation didn't break chat:** while sharing, send a text message →
      it still arrives (the renegotiation offer/answer didn't disrupt the data
      channel)

## Known limits (by design, MVP)

- One presenter at a time. Two members hitting Share at the same instant is an
  unhandled glare edge (additive renegotiation, not full perfect-negotiation).
- Screen share is **DTLS-encrypted, not passphrase-E2EE** (see SECURITY-AUDIT.md
  "H-media"). A malicious relay that MITMs the handshake could intercept the
  video — unlike chat/files, which the passphrase still protects.
- No webcam (intentional — the Skool meeting already provides webcam video).

## If it breaks

- Viewer never sees the screen → check `pc.ontrack` fires and `onTrack` is wired
  into `init()` (panel.js / harness.js), and that `renegotiate()` actually sent
  a fresh offer (`transport.js`).
- Chat breaks after a share starts → the renegotiation offer collided with the
  data channel; this is the additive-renegotiation limitation — may need the
  full perfect-negotiation pattern after all.
