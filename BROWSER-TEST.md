# Two-tab browser test checklist

The unit suites (`npm test`) cover pure logic and stubbed behavior. They cannot
drive WebRTC, the DOM, or the MV3 service worker. This is the manual pass that
covers what they can't — run it after the Phase-8 security changes before
trusting them in a real meeting.

## Setup

```bash
cd signaling && npm ci && npm start      # relay on ws://127.0.0.1:8080
```

Load the unpacked extension (or open `extension/test/harness.html` in two tabs).
Join both tabs to the same room with the **same passphrase**.

## Regression — the spine must still work (was green 2026-06-04)

- [ ] Two tabs connect: status reaches `🔒 E2EE · 1 peer connected` in both
- [ ] Text both directions
- [ ] File send → received + downloadable, byte-identical
- [ ] Present a file → fullscreen overlay opens for the viewer
- [ ] Type-as-slides → styled slide opens for the viewer
- [ ] Whiteboard → strokes appear in the other tab in the same relative place

## H1 — admission handshake (branch `feat/h1-admission-handshake`)

The load-bearing new behavior. **This is why the branch isn't merged yet.**

- [ ] Same passphrase both tabs → they connect normally (the hello handshake is
      invisible; "connected" still appears within ~1s)
- [ ] First message after connect is **not** dropped (no auth race)
- [ ] **Wrong passphrase** in tab 2 → tab 2 is **dropped from the mesh** within
      ~8s (the auth timeout), not left silently receiving ciphertext; tab 1's
      peer count returns to 0
- [ ] No content is delivered to the wrong-passphrase tab (only the undecryptable
      notice, then drop)
- [ ] 3-peer: a third correct-passphrase tab still joins and is admitted

## P1 — presenter sender-binding (on master)

- [ ] Legit presenter's video play/pause/seek and PDF/slide page-turns still sync
      to viewers (the gate must not block the real presenter)
- [ ] (If reproducible) a non-presenting peer cannot drive/close another's deck

## H2 — convenience-mode confirm (on master)

- [ ] Join with a **blank** passphrase → first click shows the "host can read
      this" warning and relabels the button "Join without a passphrase"
- [ ] Second click joins in convenience mode (`⚠ convenience mode`)
- [ ] Join with a passphrase → no warning, goes straight to `🔒 E2EE`

## P4 — service worker (on master)

- [ ] Content-script ports still connect to the SW (signaling works at all) —
      this confirms the `port.sender` check didn't reject legitimate ports

## Notes

- If H1 breaks the legit flow (deadlock, dropped first message, or a correct peer
  getting kicked), the bug is in the `setupDataChannel` hello/auth path in
  `transport.js` — do not merge until this checklist is clean.
- `AUTH_TIMEOUT_MS` (8s) is the wrong-passphrase drop window; tune if needed.
