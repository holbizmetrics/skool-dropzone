# Roadmap

Phased so each step is testable on its own and builds toward the killer feature (instant presentation). Critical-path phases marked **★**. Side-quests (whiteboard, polish) come after the spine works.

---

## Phase 0 — Scaffolding ★ ✅ shipped (commit `18b1eda`, verified in browser 2026-05-20)

**Goal:** Chrome extension loads on Skool and proves the injection path.

- Manifest V3 skeleton (`manifest.json`, `content/`, `background/`, `popup/`)
- Match pattern: `https://*.skool.com/*`
- Content script that adds a visible marker (e.g. tiny `<div id="skool-dropzone-marker">SDZ</div>` in the corner) on every Skool page
- Load unpacked in Chrome, navigate around Skool, confirm marker survives SPA navigation

**Done when:** marker visible across all Skool pages, no console errors. ✅

**Open decisions:**
- License — MIT (decided 2026-05-20, see `LICENSE`)

---

## Phase 0.5 — Clickable panel shell ★ ✅ shipped (commit pending push)

**Goal:** Make the extension *do something* visibly. SDZ chip becomes a button that opens a docked side panel with the chat-with-files UI surface. Local-only — no transport yet.

- Replace static marker `<div>` with an interactive button
- Build a docked side panel (right-edge, full-height, 360px wide) that slides in/out
- Panel UI: header (title + close button) + amber "local-only" banner + scrolling message list + composer (file-attach + text input + send)
- Local-only message state — typed messages and attached file metadata appear in the list, never leave the browser
- Survive Skool SPA navigation: MutationObserver re-mounts the host element if Skool wipes the DOM during route changes; messages from the current tab session persist visually

**Done when:** click SDZ → panel slides in → type a message → it appears → click × → panel closes; navigate to another Skool page → marker still there, panel still openable. ✅

**What this unblocks:**
- Phase 1's auto-open behavior just calls `openPanel()` — UI is already built
- Phase 2's E2EE transport plugs into the existing `addMessage()` rendering pipeline

---

## Phase 1 — Meeting auto-detect ★ ✅ shipped (commit pending push)

**Goal:** Extension knows when you're in a meeting and the panel auto-opens.

**Findings from a live meeting (2026-05-20):**

- **Meeting URL pattern:** `https://www.skool.com/live/<id>` — directly usable for manifest gating. (Cleaner than the competitor extension's all-of-skool.com match + runtime detection.)
- **Skool meetings use Stream.io Video React SDK.** Live probe found 59 elements with `str-video*` CSS classes; 36 distinct class names. See [`NOTES-skool-stack.md`](NOTES-skool-stack.md#dom-selectors--verified-in-a-live-meeting-2026-05-20).
- **Best detection target:** `.str-video__call-controls` (the bottom controls bar — always present in an active call, fires immediately on join).

**Shipped:**

- Manifest matches narrowed to `https://www.skool.com/live/*` (was `*.skool.com/*`) — content script no longer loads on non-meeting Skool pages
- `MutationObserver` on `document.documentElement` (subtree) watches `.str-video__call-controls` lifecycle
- Auto-open on call detected; auto-close on call ended
- User intent respected: clicking SDZ / × marks the panel as user-toggled and Phase 1 won't re-auto-open during the same call
- Status dot in the panel header: grey (idle) / green with pulse ring (in-call)
- Version bumped 0.0.2 → 0.1.0

**Done when:** open a Skool meeting → SDZ chip appears, panel auto-opens within ~1s of Stream's controls bar rendering, status dot turns green. Leave the meeting → panel auto-closes, dot goes grey. ✅

**Open decisions:**
- Should the panel dock differently when in a meeting vs not? (Currently: right edge for both — fine.)
- Whether to also patch `WebSocket` at `document_start` MAIN world for Stream's signaling channel — useful later for presenter-claim coordination, **not needed for the spine** (Phase 2's own E2EE WebRTC data channel is the cleaner path).

---

## Phase 2 — E2EE text transport ★ ✅ built (commit pending push) — awaiting two-browser test

**Goal:** Two browsers on the same meeting link exchange E2EE text messages. The relay never sees plaintext.

**Decisions made:**
- Transport: **WebRTC mesh** (P2P, no media server, fits ≤10 peers). Signaling = **localhost Node relay** for dev (operator-approved 2026-05-20); same code deploys to a free hosted tier for production.
- Key derivation: **passphrase-based** (PBKDF2). Room = meeting id (relay routes by it); key = derived from a passphrase the relay never sees → relay-operator-proof. Empty passphrase = convenience mode (weaker, flagged in UI).
- CSP: signaling WebSocket lives in the **background service worker**, not the content script, to dodge Skool's page CSP.

**Built:**
- `signaling/server.js` + `package.json` + `README.md` — the dev relay (`ws://localhost:8080`, rooms by meeting id, relays SDP/ICE only)
- `extension/background/service-worker.js` — bridges content script ↔ relay over a runtime port
- `extension/content/transport.js` — WebRTC peer mesh; joiner-initiates glare avoidance; encrypt-on-send / decrypt-on-receive via `crypto.js`
- `extension/content/panel.js` — connect bar (passphrase + Join), status line (offline / connecting / waiting / 🔒 N peers / error), own-vs-peer message bubbles, undecryptable-message notice
- Manifest: background SW + `host_permissions` for localhost + transport.js in content scripts; v0.2.0 → 0.3.0

**Done when:** two browser windows on the same `/live/<id>` URL with the same passphrase exchange a text message E2EE; a third window with a different passphrase connects but cannot read the messages. ⏳ *needs operator to run the relay + test two windows.*

**Verified so far:** all 5 JS files pass `node --check`; `SDZCrypto.selfTest()` returns `true` (crypto round-trips, wrong passphrase fails). The WebRTC + signaling flow is written to standard patterns but **not yet run end-to-end** — that's the operator test.

**Deferred to later phases:** file *bytes* transfer (Phase 4 — chunked; Phase 2 sends only the share *notice*). STUN/TURN for cross-internet peers (Phase 2 uses host candidates, fine for localhost; production adds STUN).

---

## Phase 3 — Multi-user ★ ✅ built (commit pending push) — 3-peer discovery verified in Node

**Goal:** Multiple people in the room exchange messages/files, E2EE, with presence.

**Built / verified:**
- Mesh broadcast was already in place (`send()` loops all peers; `sendFile()` too) — multi-user messaging + file transfer work for N peers by construction.
- Joiner-initiates glare avoidance scales: a 3rd peer offers to both existing peers; existing peers learn the newcomer via `peer-joined`. **Verified in Node** (3 peers: C learns A&B via peers-list; A&B learn C via peer-joined → full mesh).
- Presence: panel + harness now post a system line when a member joins/leaves (count delta).

**Done when:** 3+ browsers on the same room all see each other's messages in real-time, with join/leave notices. ⏳ *3-window browser test pending (signaling verified in Node).*

**Deferred:** late-joiner history (you see messages from when you joined — acceptable for a live meeting; revisit if wanted); participant roster with names (currently a count); reconnect-after-drop.

---

## Phase 4 — Files in chat ★ ✅ built (commit pending push) — awaiting two-browser test

**Goal:** Share a staged file; peers receive it, preview images, download anything. Same E2EE channel.

**Built:**
- `transport.sendFile(file, onProgress)` — reads file → 16KB chunks → base64 → each chunk rides inside the AES-GCM envelope → sent to all peers. Backpressure: pauses when any data channel buffers >1MB, resumes on drain. `file-start` / `file-chunk` / `file-end` control protocol.
- Panel receive: reassembles chunks in order → Blob → object URL. Progress line updates live (`receiving 42%`). On complete: image thumbnail inline + Download button for everything.
- Sender side: Share shows `sending %`, then `sent ✓` + a local Download.
- 50 MB cap (oversize → system message, not sent).

**Verified (Node):** chunk → base64 → reassemble is byte-exact across a 100,003-byte payload (7 chunks incl. partial tail). JS passes `node --check`. **Browser two-window transfer not yet operator-tested.**

**Done when:** alice drops a 10 MB image, bob sees it inline + can download an identical file, relay sees only ciphertext. ⏳ *operator test pending.*

**Deferred:** streaming reassembly for very large files (current path holds the file in memory); resumable transfers; multiple concurrent transfers UI polish.

---

## Phase 5 — Instant presentation v1 (file-as-deck) ★ ✅ built (commit pending push) — the killer feature

**Goal:** Drop a file → fullscreen takeover for everyone in the room.

**Built — shared module `content/present.js` (used by both panel and harness):**
- Presenter clicks **Present** on a staged file → local fullscreen overlay opens AND the file is broadcast to all peers (reuses `sendFile` with a `present-*` wire prefix).
- Viewers auto-open the same fullscreen overlay when the file arrives.
- Sync per type:
  - **Image** → shown fullscreen for all.
  - **Video** → presenter's play / pause / seek broadcast as `present-control`; viewers follow (viewer controls hidden).
  - **PDF** → presenter Prev/Next broadcasts `pdf-page`; viewers' iframe follows via `#page=N` (best-effort — Chrome PDF viewer).
- **End ✕** / Esc (presenter) broadcasts `present-close` → everyone's overlay closes. Viewers get a **Leave ✕**.
- Overlay styles extracted to shared `content/present.css` (loaded as content CSS on `/live/*` and via `<link>` in the harness).
- Harness gained a **Present a file** button → Phase 5 is testable with two tabs, no meeting.

**Done when:** alice presents an image/PDF/video, everyone sees it fullscreen; alice's video play/pause and PDF page-turns sync to all. ⏳ *two-tab browser test pending.*

**Bug found + fixed (2026-06-04, by the verification pass):** the presenter broadcast was **broken** — `present.js` called `transport.sendFile(file, null, "present")` expecting a `present-*` wire prefix, but `transport.sendFile` only took two params and hardcoded `file-start`/`file-chunk`/`file-end`. So a presented file went out as a plain Phase-4 transfer and viewers (which route on `present-start`) never opened the fullscreen overlay — it landed as a chat download instead. Fixed by adding the `prefix` parameter to `sendFile`; guarded by `node extension/test/node-verify.js` so it can't silently regress.

**Slot-lock added (2026-06-04, Phase-8 hardening pulled forward):** a soft presenter lock now covers the two common races — you can't start presenting over a presentation you're *watching*, and an incoming presentation can't hijack *your* screen while you present. The remaining race (two people hit Present in the same instant, before either sees the other) still resolves last-wins among viewers; a true global lock needs a peerId-tiebreak claim token — deferred to Phase 8.

**Known limits (v1):** viewer video autoplay may need a click on some browsers (autoplay policy); PDF page-sync is best-effort via `#page` (reloads the frame); large presentation files transfer fully before the overlay opens for viewers.

---

## Phase 6 — Whiteboard ★ ✅ built (commit pending push)

**Goal:** Sketch on a shared canvas. Annotate *over* whatever's underneath.

**Built — shared module `content/whiteboard.js` (+ `whiteboard.css`):**
- Transparent fullscreen canvas overlay; toggle from the panel ("🖊 Whiteboard") or the harness.
- Toolbar: 6-color palette, eraser, clear, close.
- Strokes broadcast per segment over the E2EE channel as `wb-stroke`; `wb-clear` clears for everyone.
- **Coordinates normalized 0..1** so drawings align across different window sizes; strokes stored + replayed on resize.
- Auto-opens on a peer's first stroke (so you see someone else drawing).
- Sits above content → annotates over a presentation, image, or blank.
- Harness gained a Whiteboard button → testable with two tabs, no meeting.

**Done when:** alice draws, bob sees the same strokes in the same relative place in real-time; clear syncs. ⏳ *two-tab browser test pending.*

**Known limits (v1):** segment-per-pointermove is chatty (fine for small rooms); no per-user cursor; eraser is a fixed multiple of pen width; whiteboard vs presentation overlay stacking is DOM-order (last opened wins).

---

## Phase 7 — Presentation modes v2 (type-as-slides + BYO deck) ✅ built (2026-06-04) — awaiting two-tab test

**Goal:** Round out the three presentation modes.

**Built — in `content/present.js` (+ `present.css` slide styles, panel + harness UI):**
- **Type-as-slides:** a "▤ Slide" affordance in the panel opens a title + bullets composer; promoting broadcasts the deck as one E2EE `slide-show` frame (pure text, no file transfer). Viewers open the same styled fullscreen slide. A line of `---` in the bullets box separates multiple slides; presenter Prev/Next syncs page turns via `slide-page`. New API: `SDZPresent.presentSlides(slides, transport, startIndex)`; wire kinds `slide-show` / `slide-page` (+ reuses `present-close`).
- **Bring-your-own-deck:** PDF decks already load + page-sync through the Phase-5 file-as-deck path (`Present` on a staged PDF). PPT/Keynote conversion is **deferred by design** — export to PDF first (Office formats are heavy; see cross-phase note).

**Done when:** alice types three bullets, promotes them to a slide, everyone sees the styled slide; alice loads `deck.pdf`, walks through it. ⏳ *two-tab browser test pending (logic + wiring covered by `node extension/test/node-verify.js`).*

**Known limits (v1):** slides are title + flat bullets (no images/markdown in a slide yet); page-turn sync is index-based (a viewer who joins mid-deck gets the current index but not earlier history); PPT/Keynote import not done.

---

## Phase 8 — Polish + security audit

- Key rotation (per-meeting keys, no persistence across meetings)
- Cross-meeting isolation tests (knowing meeting A's link must give zero access to meeting B)
- Replay-after-meeting test (does the link still work tomorrow? should it?)
- File-size + rate limits
- Error states (peer dropped, signaling relay down, key wrong)
- Performance: 8-person room with whiteboard + PDF + chat — does it hold up?

**Done when:** a friendly security-aware person can't break it with the obvious attacks.

---

## Phase 9 — Beta + Distribution

- Beta with 5-10 friendly Skool community owners
- Collect: what breaks, what they actually use, what they ask for
- Decide pricing model (free / freemium / one-time / subscription)
- Chrome Web Store listing (icon, screenshots, description, privacy policy)
- Submit for review
- Cross-link from related personal queue items if relevant

**Done when:** listed on Chrome Web Store and installable by anyone.

---

## Cross-phase open questions

These don't block any single phase but need decisions before Phase 8:

- Persistence: ephemeral-only forever, or optional "save this meeting's content" (encrypted, stored where)?
- Identity: just pseudonymous initials, or login (and if login — how, without an admin-controlled account system)?
- Monetization: free forever to drive adoption, or freemium (basic features free, presentation / large files / save-meeting paid)?
- Open source vs proprietary: SecuredChat is open; this could be too. Open source increases trust on the "we can't read your data" claim.

---

## Pacing

Each phase is sized to a session or two for someone working on this as a side-project. Critical-path-only path to the killer feature: **Phase 0 → 1 → 2 → 3 → 4 → 5**. Whiteboard and the remaining presentation modes come after the spine works.

Suggested first sit-down: Phase 0 (scaffolding) end-to-end in one go. It's load-bearing and unlocks everything else.
