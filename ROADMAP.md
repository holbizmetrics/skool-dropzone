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
