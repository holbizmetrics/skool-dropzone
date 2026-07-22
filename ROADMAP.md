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

## Phase 5 — Instant presentation v1 (file-as-deck) ★ ✅ built + two-tab browser VERIFIED (2026-06-04) — the killer feature

> **Two-tab browser test passed (2026-06-04):** loaded unpacked v0.7.0 + localhost relay; two harness tabs joined → `🔒 E2EE · 1 peer connected` (live WebRTC handshake confirmed). Confirmed against a real peer in the same session: **text both directions** (Phase 2/3 — `peer: Hello` / `you: Hello, back`), **file send** (Phase 4 chunked transfer — `sent "…" ✓`), and **Present a file → fullscreen overlay opened for the viewer** (Phase-5 fix — no longer a chat download). Untouched this pass: real-Skool-meeting detection path, 3+ peers, whiteboard click.

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

## Phase 7 — Presentation modes v2 (type-as-slides + BYO deck) ✅ built + two-tab browser VERIFIED (2026-06-04)

> **Two-tab browser test passed (2026-06-04):** typed title + bullets → **Present slide** → styled fullscreen slide opened for the viewer tab over the live E2EE channel.

**Goal:** Round out the three presentation modes.

**Built — in `content/present.js` (+ `present.css` slide styles, panel + harness UI):**
- **Type-as-slides:** a "▤ Slide" affordance in the panel opens a title + bullets composer; promoting broadcasts the deck as one E2EE `slide-show` frame (pure text, no file transfer). Viewers open the same styled fullscreen slide. A line of `---` in the bullets box separates multiple slides; presenter Prev/Next syncs page turns via `slide-page`. New API: `SDZPresent.presentSlides(slides, transport, startIndex)`; wire kinds `slide-show` / `slide-page` (+ reuses `present-close`).
- **Bring-your-own-deck:** PDF decks already load + page-sync through the Phase-5 file-as-deck path (`Present` on a staged PDF). PPT/Keynote conversion is **deferred by design** — export to PDF first (Office formats are heavy; see cross-phase note).

**Done when:** alice types three bullets, promotes them to a slide, everyone sees the styled slide; alice loads `deck.pdf`, walks through it. ⏳ *two-tab browser test pending (logic + wiring covered by `node extension/test/node-verify.js`).*

**Known limits (v1):** slides are title + flat bullets (no images/markdown in a slide yet); page-turn sync is index-based (a viewer who joins mid-deck gets the current index but not earlier history); PPT/Keynote import not done.

---

## Phase 8 — Polish + security audit — **IN PROGRESS**

**Security audit landed 2026-06-09 → [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md).** Adversarial review (PARALLAX + two blind verifiers + TRIAD/ADEIS) of the crypto + isolation core. Headline: cross-meeting isolation holds; "no third-party read" is real **with a passphrase**, weak in convenience mode (now flagged in the UI). The scariest hypothetical — stored XSS over the E2EE channel — was checked and does **not** exist.

Original checklist, current status:

- Key rotation (per-meeting keys, no persistence) — **open**
- Cross-meeting isolation (link to A gives zero access to B) — **done** (verified; relay room-isolation tested in `node-verify-signaling.js`)
- Replay-after-meeting test — **open**
- File-size + rate limits — **partial** (receiver `total`/`seq` clamps + relay room/peer caps + `maxPayload` landed; per-connection rate-limit deferred)
- Error states (peer dropped, relay down, key wrong) — **partial** (blank-passphrase confirm + relay-down message; full peer-drop UX owed)
- Performance: 8-person room — **open** (needs the browser pass)

Fixes **on master** (CI-green, behaviorally verified where Node allows): relay binds loopback (H1 LAN-reach), present/whiteboard sender-binding (P1), receiver clamps (P2), relay hardening (P3), service-worker port check (P4), CSP (P5 partial), blob-MIME allowlist (P6), convenience-mode confirm (H2). Plus **test + CI + release infra** (early Phase-9 groundwork): `npm test` (syntax gate + 50 extension + 14 signaling checks), GitHub Actions CI on every push, `sdz-v*` tag → packaged release.

**Done when:** a friendly security-aware person can't break it with the obvious attacks. **Not yet** — the two in-flight branches need the browser test, and screen-share needs rework (below).

### In flight (branches — NOT on master, NOT merged)

- **`feat/h1-admission-handshake`** — key-knowledge admission gate: a wrong/absent-passphrase peer is dropped from the mesh instead of silently receiving ciphertext. Built, CI-green on contract checks; **owed the two-tab browser test** before merge.
- **`feat/screen-share`** — member-side P2P **live screen share** (screen only, no webcam — Skool already provides webcam). Drafted + audited; **found broken**: renegotiation glare-deadlocks for 3+ peers, and a forced-fullscreen abuse with no consent/slot gate (the present.js guards weren't carried over). Needs perfect-negotiation + a consent/slot gate before it's real. See `SECURITY-AUDIT.md` "H-media" + the branch's `BROWSER-TEST.md`.

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

---

## Field-observed UX backlog (2026-07-22, operator in a live Skool meeting, v0.8 on `feat/hosted-relay`)

Found by actually using the panel in a real 8-person meeting — not by review. All three
are pre-conditions for showing this to anyone else.

**U1 — the panel is clipped at the right edge.** The tab row cuts off after `Rooms`
(at least one tab unreachable) and the message composer at the bottom is half-cropped.
Fix direction: the panel host has a fixed width but its children overflow; the tab strip
needs to wrap or scroll, and the composer needs to sit inside the panel's box rather than
past it. Verify at several viewport widths + browser zoom levels, not just the author's.

**U2 — transcription should be per-speaker, not one mic blob.** Today it is mic-only:
one undifferentiated stream of whatever the microphone picks up, so in a real meeting it
mixes every audible participant with no attribution and misses anyone on headphones.
Expected behavior (operator, watching it live): transcribe **the focused speaker** — the
tile Skool highlights — labeled by their display name, **and** the local user, as separate
attributed lines. Technical path that does not need Skool's cooperation: each remote
participant renders an `<audio>` element in the meeting DOM; `HTMLMediaElement.captureStream()`
per element yields separate tracks that can be fed to recognition individually, and the
focused-tile selector already exists in `panel.js` (`.str-video__call-controls` neighbourhood).
Honest bounds to keep: recognition still goes to Google (already labeled not-E2EE), and
per-speaker capture makes that MORE explicit, not less — the consent line must be updated
in the same change.

**U3 — contrast: black text on grey boxes is unreadable.** Worst offenders seen live: the
poll widget (options + vote counts) and the disabled/placeholder input fields. This is an
accessibility defect, not a preference. Fix with a checked contrast ratio (WCAG AA, 4.5:1
for body text) rather than by eye, and check it in both the light Skool shell and the dark
meeting shell — the panel currently inherits from neither consistently.

*Provenance: operator ran v0.8 live during a Skool "Show & Tell" meeting, 2026-07-22, after
the fresh clone landed on `master` (pre-v0.8) and needed a branch switch + a tab reload +
`npm install` in `signaling/` before the panel would connect at all. That setup friction is
its own finding — see U4.*

**U4 — first-run friction on a fresh clone.** Three separate stalls before the panel worked:
(a) `git clone` lands on `master`, which is 11 commits behind `feat/hosted-relay` where all
v0.8 features live — a fresh clone silently gets an old build; (b) content scripts do not
inject into tabs already open at install time, so the panel appears dead until the meeting tab
is reloaded; (c) `signaling/node_modules` is absent on a fresh clone, so the relay cannot start
and the panel reports "Signaling relay not reachable" with no hint that `npm install` is the
missing step. Fix direction: merge `feat/hosted-relay` (or repoint the default branch), and make
the relay error message name the two-step fix (`cd signaling && npm install && npm start`).

**U5 — whiteboard needs real tools: text, shapes, and the rest.** Today it is freehand-only:
the wire carries line segments (`{x0,y0,x1,y1,color,width,eraser,path}`) and nothing else, so
anything that is not a hand-drawn squiggle is impossible — no text labels, no rectangle/ellipse/
arrow, no straight line, no select/move/delete of an existing object.

**The load-bearing consequence: this is a wire-format change, not a toolbar change.** Segments
are anonymous and append-only; text and shapes are *objects* with identity, position and
editable properties. Adding them means introducing a typed object model on the wire
(`{type: "text"|"rect"|"ellipse"|"arrow"|"line"|"path", id, ...props}`) — which then has to stay
compatible with the two mechanisms already built on the segment stream: **per-gesture wire undo**
(undo must remove an object, not N segments) and **late-joiner `wb-sync`** (the catch-up replay
must reconstruct objects, not just repaint strokes). Do the format first, then the tools; doing
tools first means doing the format twice.

Minimum useful set, in the order that pays off fastest for a live meeting: **text label** (by far
the most requested — you cannot annotate a diagram without it), **arrow**, **rectangle/ellipse**,
**straight line**, then **select + move/delete**. Sticky-note is text + rect and comes free once
both exist.

**U3 — ROOT CAUSE FOUND (amends the contrast entry above; 2026-07-22, live).** This is not a
palette-taste problem, it is **an unintended dark inversion of a light-only design**.

`panel.css:38` declares the panel root `background: #ffffff` and the whole stylesheet is a light
palette (`.sdz-msg-poll` `#f9fafb`, `.sdz-poll-opt` `background:#fff`). The operator's live panel
renders **dark**. So the browser/page is inverting it (Chrome auto-dark-mode, or inheritance from
Skool's dark shell), and the inversion is **partial**: backgrounds flip, text rules do not.

The poll widget is the proof and the worst casualty: **option labels are white-on-white — invisible
until the blue selection bar reveals them**, which makes a poll unusable (a voter cannot read the
options). Meanwhile the vote counts ARE readable, because `.sdz-poll-count` is the one rule that
sets an explicit `color: #6b7280`. Every element with an explicit color survived the inversion;
every element relying on a default did not. `.sdz-poll-opt` / `.sdz-poll-opt-label` set none.

Two fix directions, pick deliberately:
- **Cheap + immediate:** declare `color-scheme: only light` on the panel host so the UA stops
  auto-darkening it, and the design renders as authored. One line; verify in the dark Skool shell.
- **Proper:** author a real dark theme — every text element gets an explicit `color`, tested at
  WCAG AA (4.5:1) in BOTH shells. More work, and the right answer if the panel should look native
  inside a dark meeting.

Either way the standing rule this exposes: **no text element may rely on an inherited or UA
default colour.** That is what made the failure selective and invisible to review — it only shows
up on a machine where something else decides the scheme.

**U6 — whiteboard opens with no visibly-selected colour, and (reported) does not draw until one
is clicked.** Two claims, deliberately separated by how well each is grounded.

*PROVEN (code-read, one-line fix):* `markActive(tb)` is invoked only from the three toolbar click
handlers (`whiteboard.js:128,147,157`) and **never after the toolbar is built**. On open, no swatch
carries `.sdz-wb-active`, so the toolbar presents as "nothing selected" and the user reasonably
concludes they must pick a colour before drawing. Fix: call `markActive(tb)` once at the end of
toolbar construction so the initial state (`color = "#ef4444"`, default width, eraser off) is
reflected in the UI it already holds internally.

*REPORTED, NOT YET EXPLAINED:* the operator states drawing did **nothing at all** until a swatch
was clicked. The internal state says it should have drawn red immediately, so the missing highlight
does NOT account for this — there is a second cause. Do not close U6 on the one-liner alone.
Repro candidates to test in this order: (a) canvas size/DPR initialised late, so early strokes land
outside the visible bitmap; (b) an overlay (panel host / meeting DOM) swallowing the first pointer
sequence until a click elsewhere focuses the canvas; (c) `open()` ordering — strokes recorded before
the transport/room is ready being dropped rather than drawn locally.

*Class:* a first-interaction dead spot. Whatever the cause, the user-visible verdict is "the
whiteboard is broken," which is the most expensive possible first impression for the feature this
project leads with. Worth fixing before U5's new tools, since new tools inherit the same entry path.

## U7 — Region capture + OCR ("grab any part of the meeting, including the text inside graphics")

*Operator idea, 2026-07-22, live: drag-select any region of the meeting — a shared slide, a code
snippet someone is presenting, a diagram — and either capture it as an image OR **pull the text out
of it**, even when that text is baked into a graphic. Snagit's grab-text, but inside the meeting.*

**This is the strongest differentiator proposed so far.** Zoom/Meet/Skool all make you screenshot
and re-type. The thing a participant actually wants — *the code on that slide, in my clipboard* —
nobody ships. It also composes with what already exists rather than standing alone.

**Why it is technically reachable (the load-bearing fact):** a remote participant's camera and
**screen share both arrive as `<video>` elements in the meeting DOM**, backed by a WebRTC
MediaStream. Drawing a MediaStream-backed video into a canvas **does NOT taint the canvas** (unlike
a cross-origin `<img>`), so `ctx.drawImage(videoEl, …)` followed by `getImageData()` /
`toDataURL()` works from a content script with no extra permission and no cooperation from Skool.
That single fact is what makes region capture possible at all; verify it first with a 10-line spike
against a live share before designing anything else.

**Shape:**
1. **Region select** — transparent overlay across the meeting area, drag a rect (reuse the
   whiteboard's pointer handling; it already does normalized coords + DPR).
2. **Resolve source** — hit-test which `<video>` (or DOM region) the rect covers; for a screen
   share, map viewport rect → source-video coordinates so the crop is at the SHARE's native
   resolution, not the scaled-down tile. This is the difference between usable OCR and mush.
3. **Capture** — crop to an offscreen canvas → PNG.
4. **OCR — local, not cloud.** `Tesseract.js` (WASM) runs entirely on-device. **Cloud OCR is the
   wrong answer here**: this product's whole claim is E2EE, and the transcription feature already
   had to be labeled "audio goes to Google (not E2EE)". Do not add a second privacy asterisk to
   the feature list. Cost of local: ~2–4 MB WASM + a language model (use the `fast` eng traineddata),
   lazy-loaded on first use, not at extension install.
5. **Destinations** — clipboard (text and/or image), the **whiteboard as a text object** (needs
   U5's object model — natural pairing), the chat, and the **meeting archive** (`archive.js` already
   accepts a PNG data URL for the whiteboard, so the plumbing shape exists).

**Honest bounds to state in the UI, not hide:**
- OCR quality tracks source resolution. A downscaled 720p tile of someone's IDE will produce
  mediocre text; capturing from the share's native track (step 2) is what makes it good.
- Best-effort, never silent: show the OCR result for correction before it lands anywhere. Wrong
  text pasted confidently into a whiteboard is worse than no text.
- **Consent posture:** capturing what a presenter chose to show is what every screenshot already
  does, but OCR-at-scale plus archiving is a different posture from a one-off screenshot. Decide
  deliberately whether captures are local-only by default, and say so in the panel.

**Ordering note:** the capture half (1–3, clipboard image) is a self-contained slice and useful
immediately. OCR (4) is a second slice. Whiteboard-text destination waits on U5's object model.

**U2 — AMENDED (operator, same evening): there is a much cheaper first slice.** The entry above
specs per-speaker *audio* capture (`captureStream()` per participant `<audio>` element). That is
the accurate-but-expensive version. The operator's framing yields a **slice that needs no new audio
plumbing at all**:

> keep the single mic stream exactly as it is, and label each transcript segment with the name on
> the tile that currently holds the **active-speaker focus** (the yellow highlight Skool already
> renders).

Implementation is DOM-only: watch the focused tile (the same MutationObserver `panel.js` already
runs), read its display name, and stamp it onto each recognition result as it arrives. Local user's
own segments attribute to "You" when the local mic is the source. Roughly an afternoon, versus a
multi-day audio-plumbing job — and it produces the thing that actually matters: **a transcript that
says who said what.**

*Honest bounds, to show in the transcript rather than hide:* focus indicators lag and flap, so
attribution is approximate at speaker changes; overlapping speech will misattribute to whoever the
UI happened to highlight; and anyone on headphones is still inaudible to a mic-based capture (the
original limitation, unchanged). Mark uncertain segments rather than asserting a name confidently —
a transcript that confidently misattributes a quote is worse than one that says "(speaker unclear)".

*Ordering:* ship the focus-attribution slice first; promote to per-speaker audio capture only if
the approximation proves too coarse in real meetings. The cheap version may simply be enough.
