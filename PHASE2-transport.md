# Phase 2 — E2EE transport architecture

**Goal:** two browsers on the same `https://www.skool.com/live/<id>` URL exchange messages and files through an end-to-end-encrypted channel. The host that relays bytes never sees plaintext.

This doc records the architecture and the **one decision needed before writing the network code**.

---

## What's already built (this commit)

- **`content/crypto.js`** — the E2EE core. PBKDF2 key derivation (250k iterations, SHA-256) + AES-GCM encrypt/decrypt. Transport-agnostic; whatever carries bytes only sees ciphertext. Has a `selfTest()` for dev verification.
- **Fork B staging UI** — files stage, then per-file **Share** / **Present** / **Remove**. Share currently moves the file to the local log; Phase 2 will make Share actually encrypt + transmit.

To verify the crypto core works, open the console on a `/live/*` page and run:

```javascript
await SDZCrypto.selfTest()   // → true means encrypt/decrypt round-trips and wrong key fails
```

---

## The two hard problems

### 1. Signaling (the one infrastructure decision)

WebRTC peers can't find each other on their own. They need a **signaling channel** to swap connection offers (SDP) and network candidates (ICE) *before* the peer-to-peer link exists. Signaling carries no meeting content — just "here's how to reach me." But it needs *somewhere* to live.

| Option | How | Cost | Tradeoff |
|---|---|---|---|
| **A. Self-hosted relay** | Tiny WebSocket server (~60 lines Node) on a cheap VPS or Cloudflare Workers. Rooms keyed by meeting id. | ~€5/mo VPS, or free tier on Cloudflare/Render/Fly | Full control. One thing to keep running. Recommended for production. |
| **B. Localhost relay (dev only)** | Same server, run on `ws://localhost:8080` on your machine. | Free | Perfect for building + testing the two-browser flow now. Not usable by real users. |
| **C. Ride Skool's Stream.io channel** | Send WebRTC signaling as Stream custom events through Skool's existing call. | Free | No server at all. But requires hijacking Skool's Stream client instance (buried in their React app) — fragile, breaks when Skool changes their bundle. |
| **D. Public signaling service** | Use an existing free WebRTC signaling/PeerJS broker. | Free tier | No server to run, but a third party sees signaling metadata + you depend on their uptime. |

**Recommendation:** **B for now, A for production.** Build the signaling server once (it's the same code for B and A — just a different host URL). Test locally with two browser windows pointing at `ws://localhost`. When it works, deploy the same server to a free Cloudflare/Render tier and flip the URL. This avoids both the fragility of C and the third-party dependency of D.

**CSP note:** Skool's page is HTTPS with a Content-Security-Policy. A content script's own `WebSocket`/`fetch` is subject to that CSP. To avoid being blocked, signaling traffic is routed through the **extension's background service worker** (which uses the extension's CSP + `host_permissions`, not Skool's). So Phase 2 adds a `background/service-worker.js`.

### 2. Key derivation (the "no third-party read" guarantee)

The meeting id (`TgzjxszWRTp`) is in the URL — **Skool knows it, and so would our signaling relay** (it routes rooms by it). So the encryption key must **not** be derivable from the meeting id alone, or the relay operator could decrypt.

| Mode | Key source | Who can read | UX |
|---|---|---|---|
| **Passphrase (relay-proof)** | PBKDF2(passphrase, salt=meetingId). Passphrase agreed out-of-band (spoken in the call). | Only people who know the passphrase. Relay + Skool **cannot**. | One extra step: someone says "passphrase is `otter`," everyone types it. |
| **ID-only (convenience)** | PBKDF2("", salt=meetingId). | Anyone who knows the meeting id, including the relay operator. Protects only against passive network sniffers. | Zero steps — just works. |

`crypto.js` already supports both (pass a passphrase or pass `""`). The UI will offer a "room passphrase" field; empty = convenience mode with a clear in-panel warning that it's not private from the relay.

**Recommendation:** ship both, default to **passphrase mode** for the privacy story (it's the whole point), with convenience mode one click away for low-stakes use. The amber banner becomes a green "🔒 end-to-end encrypted (passphrase)" or amber "⚠ convenience mode" indicator.

---

## Phase 2 build order (once signaling is decided)

1. `background/service-worker.js` — opens the signaling WebSocket, relays offer/answer/ICE between this tab and the relay. (CSP bypass.)
2. `content/transport.js` — WebRTC peer-connection setup, data channel, join/leave/reconnect, multi-peer (mesh up to ~10).
3. Wire `crypto.js` into the message pipeline — encrypt on Share/send, decrypt on receive, render via the existing `addMessage()`.
4. Room passphrase UI + encryption-status indicator.
5. Two-browser test: same `/live/<id>` URL + same passphrase → "hello" round-trips; relay logs show ciphertext only.

**Done when:** two browser windows on the same meeting URL exchange a text message end-to-end, and a third window with the wrong passphrase cannot read it.

---

## The decision I need from you

**For building + testing Phase 2 right now, is a localhost Node signaling server OK?** (Option B.)

- If **yes** → I'll write `signaling/server.js` (you run `node signaling/server.js`, needs Node installed) + the service worker + transport, and we test with two browser windows.
- If you'd rather **not run anything locally** → tell me and we go straight to a free hosted relay (Cloudflare Workers / Render), which I can scaffold for deploy.
- Production hosting is a later decision — it doesn't block building, since the code is identical.
