# skool-dropzone

Member-side companion for Skool meetings — when the admins/owners aren't there and members still want to share.

## The gap

Skool community meetings often run without admins or owners present. Members on the call want to share pictures, videos, files, type things at each other, sketch on a whiteboard. The current Skool meeting flow has no built-in side-channel for that. So people fall back to Discord, WhatsApp, or just shrug.

## What this is

A Chrome extension, Skool-optimized, that injects a member-side meeting companion into the Skool meeting page. The meeting link is the access token — whoever has it gets the companion. No admin setup, no separate account.

In one place:

- **Chat with files** — type messages or drop pics, videos, files; same stream, everyone on the link sees it (the "drop zone" and the "chat" are one surface, not two)
- **Whiteboard** — sketch together
- **Video share** — share clips during the meeting
- **Instant presentation** — anyone in the room can grab the presenter slot in one click. No "host promotes you," no screen-share dance. Three modes, stacked:
  - **File-as-deck** — drop a PDF / image / video, it takes over the shared view; you control pages or playback for everyone
  - **Type-as-slides** — type into chat, promote it to a slide everyone sees
  - **Bring-your-own-deck** — load existing slides (PPT / Keynote / PDF) into the overlay and walk through them
  - Whiteboard annotation works *over* whatever's being shown — sketch on top of slides, the PDF, the video frame

Scope = whoever has *this* meeting link, *right now*. Ephemeral by default.

## Security (load-bearing, not optional)

Files, chat, video shared during member-only meetings are private by intent — the whole point of this is that admins/owners aren't even on the call. So:

- **Client-side encryption before transport.** Content encrypted in the extension before it leaves the browser. Whoever hosts the bytes (server or peer) cannot read them. SecuredChat (E2EE git-file-bus) is the precedent — same shape works here.
- **Link as access + readability token.** The meeting link carries (or derives) the symmetric key. Without the link, ciphertext is useless. With the link, you're in.
- **No cross-meeting bleed.** Each meeting's key is scoped to that meeting. Knowing one link doesn't grant access to any other.
- **Ephemeral default.** Content evaporates when the meeting ends, unless explicitly saved (and even then, encrypted at rest).
- **No third-party read.** The host (whoever runs the media relay) sees only ciphertext + traffic metadata. No content access. No "trust us."

This is the standard the rest of the design has to clear, not a nice-to-have.

### Why this matters for Skool specifically

Skool's own live meetings run on **[Stream.io](https://getstream.io/video/)** (a hosted commercial video infrastructure provider). Stream.io sees all video, audio, and signaling for every Skool meeting. The Skool meeting itself is *not* end-to-end encrypted — it has to pass through Stream's servers to work.

So skool-dropzone's value proposition crystallizes:

> Skool already trusts Stream.io with your video and audio.
> skool-dropzone adds an E2EE side-channel for what you *share*
> (files, chat, presentations, whiteboard) — content that neither
> Skool, nor Stream.io, nor we can read.

For member-only meetings, where the whole point is "admins aren't here" — that's the right boundary. The video itself is a known compromise (Stream sees it). The artifacts shared during the meeting don't have to be.

**Honest status of these properties** (verified in [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md)): cross-meeting isolation holds, and "no third-party read" holds **when you set a room passphrase**. Without one ("convenience mode") the key derives from the meeting id the relay already knows — so the UI now warns before you join without a passphrase. Live screen share (in development) rides DTLS-SRTP, **not** the passphrase layer — labelled as such, so it's offered without being dressed up as passphrase-E2EE.

## Status

**Working extension, Phases 0–7 built (v0.7.0).** The spine is in place:

- **Phases 0–1** — MV3 extension loads on `skool.com/live/*`, auto-opens a docked panel when a Stream.io call starts.
- **Phase 2–3** — E2EE WebRTC mesh (PBKDF2 → AES-GCM), localhost signaling relay, multi-peer presence.
- **Phase 4** — chunked E2EE file transfer with backpressure.
- **Phase 5** — instant presentation (file-as-deck): image/PDF/video take over everyone's screen; presenter controls sync.
- **Phase 6** — shared whiteboard overlay (normalized coords, per-segment broadcast).
- **Phase 7** — type-as-slides (promote typed bullets to a styled slide everyone sees); bring-your-own-deck for PDF rides the Phase-5 file-as-deck path (PPT/Keynote → export to PDF first, by design).
- **Phase 8 (in progress)** — security audit + hardening on master ([`SECURITY-AUDIT.md`](SECURITY-AUDIT.md)): relay bound to loopback, presentation/whiteboard sender-binding, receiver-side clamps, relay hardening, blob-MIME allowlist, and a confirm before joining without a passphrase. Plus `npm test` + GitHub Actions CI + a `sdz-v*` tag-driven release pipeline.

**In development (branches, not merged):** a key-knowledge admission gate (`feat/h1-admission-handshake`) and a member-side **live screen share** (`feat/screen-share`, screen only — distinct from the file-clip "video share" above; audited and currently being reworked). Both owed a two-tab browser test before merge.

**Verification.** The browser-independent layers are covered by headless harnesses that run in CI-style:

- `npm test` — runs the syntax gate + both suites below; GitHub Actions CI runs it on every push (see [Development](#development)).
- `node extension/test/node-verify.js` — crypto E2EE round-trip, cross-passphrase isolation, byte-exact file chunk/reassembly, plus wire-frame + sender-binding + receiver-clamp contract guards (50 checks).
- `node signaling/node-verify-signaling.js` — relay room-routing, targeted SDP/ICE relay, room isolation, leave handling, P3 hardening (14 checks).
- `extension/test/harness.html` — two-tab manual test of the live WebRTC mesh, file transfer, presentation, whiteboard, and slides (no Skool meeting needed).

**Still needs a real browser** to confirm end-to-end: the RTCPeerConnection handshake, data-channel mesh, and the fullscreen overlays. Load the unpacked extension (or open the harness in two tabs) for that pass.

Remaining roadmap: PPT/Keynote import (Phase 7 stretch), Phase 8 security audit, Phase 9 beta + Chrome Web Store. See [`ROADMAP.md`](ROADMAP.md).

## Open questions

- Hosted media vs peer-to-peer (server bill vs WebRTC complexity)
- Persistence: ephemeral only, or optional "save this meeting's drops"
- Detection: which Skool URL patterns count as "in a meeting"
- Auth: link-as-token is the design; does Skool's meeting URL stay stable enough across the meeting to use it that way

## Development

The extension is zero-dependency vanilla JS — no build step. The only npm
dependency is `ws`, used by the signaling relay and its test rig.

One-time setup (for the signaling tests):

```bash
cd signaling && npm ci && cd ..
```

Run the tests (syntax gate + unit suites):

```bash
npm test                 # syntax check, then extension + signaling suites
npm run check            # syntax gate only (node --check on every .js)
npm run test:extension   # crypto, file-chunking, present sender-binding, blob-MIME
npm run test:signaling   # real relay: room routing, isolation, P3 hardening
```

The suites cover pure logic and stubbed-behavioral paths (AES-GCM round-trip,
chunk reassembly, control-frame sender-binding, receiver clamps, relay routing).
They do **not** exercise WebRTC, the DOM, or the MV3 service-worker runtime —
that stays the two-tab browser test (`extension/test/harness.html`, or load the
unpacked extension).

**CI** — `.github/workflows/ci.yml` runs `npm test` on every push and PR.

**Release** — push a tag `sdz-v<version>` (e.g. `sdz-v0.7.0`):
`.github/workflows/release.yml` runs the tests, packages `extension/` into a
versioned zip, and attaches it to a GitHub Release. It does not auto-publish to
the Chrome Web Store (that's Phase 9).

See [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md) for the Phase-8 review these tests guard.

## License

MIT — see [`LICENSE`](LICENSE).
