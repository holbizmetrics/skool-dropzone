# Roadmap

Phased so each step is testable on its own and builds toward the killer feature (instant presentation). Critical-path phases marked **★**. Side-quests (whiteboard, polish) come after the spine works.

---

## Phase 0 — Scaffolding ★

**Goal:** Chrome extension loads on Skool and proves the injection path.

- Manifest V3 skeleton (`manifest.json`, `content/`, `background/`, `popup/`)
- Match pattern: `https://*.skool.com/*`
- Content script that adds a visible marker (e.g. tiny `<div id="skool-dropzone-marker">SDZ</div>` in the corner) on every Skool page
- Load unpacked in Chrome, navigate around Skool, confirm marker survives SPA navigation

**Done when:** marker visible across all Skool pages, no console errors.

**Open decisions:**
- License (MIT / GPL / proprietary?)

---

## Phase 1 — Meeting-page detection ★

**Goal:** Extension knows when you're in a meeting and injects a panel only then.

**Strategy update (from competitor reverse-engineering, 2026-05-20):**

The competing "Skool Extensions" extension (`jinaapgibcgkfaffmpkhdikncmfhpfne`) uses **no URL-level gating** — its manifest matches all of `*.skool.com/*` and detects meeting state at runtime via the DOM and WebSocket traffic. We follow the same approach because:

- Skool is a Next.js SPA. The React root is `#__next`.
- Skool meetings render via [Stream.io's Video React SDK](https://getstream.io/video/). The Stream SDK uses a stable CSS class prefix: `str-video__*` (e.g. `.str-video__participant-listing-item`, `.str-video__participant-listing-item__display-name`).
- This means detection is a single DOM check: *is a `.str-video__*` element present?* When yes, we're in a meeting.
- Skool meeting signaling flows as JSON over WebSocket to `stream-io-api.com` (event types like `call.reaction_new` carry per-event payload).

**Implementation:**

- Keep manifest match at `https://*.skool.com/*` (already done in Phase 0).
- Add a runtime meeting-detector that uses a `MutationObserver` to watch for Stream's call container appearing/disappearing in the DOM.
- When detected: remove the SDZ marker, mount an empty side panel docked to the meeting view (right edge, full height).
- When detector says "no longer in meeting" (Stream DOM gone): unmount panel.

**Done when:** open a Skool meeting → panel appears within ~1s; leave the meeting (Stream UI tears down) → panel disappears.

**Open decisions:**
- Which exact Stream selector is the most reliable detection target (the call container vs participant listing — to be verified in a live meeting)
- Where does the panel dock — right edge (default plan) / floating / replacing Skool's own chat sidebar
- Whether to also patch `WebSocket` at `document_start` MAIN world (competitor does this for raise-hand detection) — useful later for presenter-claim coordination, not needed for Phase 1 itself

---

## Phase 2 — E2EE transport ★

**Goal:** Two browsers on the same meeting link can exchange ciphertext. Nothing else yet.

- Generate / derive a per-meeting key from the URL (likely from a fragment `#k=...` added when sharing)
- Pick transport: **default plan = WebRTC mesh** (no server bill, P2P, fits ≤10-participant rooms); signaling via a thin hosted relay (just brokering connection offers, sees no content)
- Encrypt all payloads client-side before sending (AES-GCM or libsodium secretbox)
- Test: two browser windows, same `#k=...` URL fragment → text payload roundtrip, server sees only ciphertext

**Done when:** alice and bob send each other `"hello"` end-to-end, signaling relay logs show ciphertext only.

**Open decisions:**
- Self-hosted relay (cheap VPS, ~€5/mo) or use a free public WebRTC signaling service?
- WebRTC mesh ceiling — fine up to ~10 peers; beyond that need an SFU (defer to later phase)
- Key derivation: URL fragment (never sent to server) is the obvious choice; double-check Skool URL rewriting doesn't strip fragments

---

## Phase 3 — Text chat (multi-user) ★

**Goal:** Multiple people in the room exchange text messages, E2EE.

- Multi-peer connection management (join, leave, reconnect)
- Message list UI in the panel
- Late-joiner gets recent history (in-memory only, ephemeral)
- Participant list (just count + initials)

**Done when:** 3+ browsers on the same link, everyone sees everyone's messages in real-time, joining late shows last N messages.

---

## Phase 4 — Files in chat ★

**Goal:** Drop a file in the panel, others can download it. Same encrypted channel.

- File picker + drag-drop into chat
- Chunked transfer over the data channel (WebRTC supports binary)
- Encrypt chunks, send, decrypt on the other side
- Inline preview for images; download button for everything else
- Size cap (start: 50 MB per file; raise later)

**Done when:** alice drops a 10 MB image, bob and charlie see it inline within seconds, relay sees only ciphertext.

---

## Phase 5 — Instant presentation v1 (file-as-deck) ★

**Goal:** First version of the killer feature. Drop a file → fullscreen takeover for everyone in the room.

- "Present this" button on any file in the chat
- One presenter slot at a time (claim / release semantics)
- File-as-deck rendering:
  - PDF → page navigator, presenter controls page, everyone follows
  - Image → fullscreen for all
  - Video → synchronized playback (presenter controls play/pause/seek)
- Esc / "End presentation" returns everyone to normal view

**Done when:** alice drops a PDF, hits "Present," everyone sees page 1 fullscreen, alice clicks next, everyone advances. Same for image and video.

---

## Phase 6 — Whiteboard

**Goal:** Sketch on a shared canvas. Annotate *over* whatever's being presented.

- Canvas overlay (transparent layer above the current view)
- Pen / eraser / colors (minimum viable toolset)
- Stroke sync over the encrypted channel
- Works on top of: nothing (blank), a presented PDF, an image, a video frame
- Clear button (presenter-only or anyone?)

**Done when:** alice draws an arrow on a presented PDF page, bob sees the same arrow in the same place in real-time.

---

## Phase 7 — Presentation modes v2 (type-as-slides + BYO deck)

**Goal:** Round out the three presentation modes.

- **Type-as-slides:** dedicated "promote to slide" affordance in chat — typed bullets become a styled slide everyone sees
- **Bring-your-own-deck:** PPT / Keynote / PDF upload that loads into the presenter overlay (PPT/Keynote likely converted to PDF first; Office formats are heavy — could defer to "PDF export your deck first")

**Done when:** alice types three bullets, promotes them to a slide, everyone sees the styled slide; alice loads `deck.pdf`, walks through it.

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
