# Security Audit — skool-dropzone (Phase 8: crypto + isolation core)

**Date:** 2026-06-09
**Scope (this pass):** the crypto + cross-meeting-isolation core, plus the perimeter immediately around it (signaling relay, service worker, manifest, present/whiteboard control protocol, supply chain). NOT covered: live multi-peer load/perf, a real Skool-meeting detection test (needs a live meeting).
**Method:** adversarial code review (PARALLAX: relay-operator / uninvited-peer / malicious-member / MITM lenses) + execution-verified primitives (`node-verify.js`, `node-verify-signaling.js`, 32/32 green) + two independent blind verifiers (fresh context, never saw the primary reasoning) + GenFlight (assumption surfacing) + ADEIS (user-perspective inhabitation) + KG conformance (render-sink walk against the "E2EE" claim).
**Status legend:** `VERIFIED` = confirmed by execution; `INSPECTION` = high-confidence by code reading, not yet run; `REASONED` = threat-model analysis, not yet reproduced.

---

## Executive summary

The cryptographic core is **sound**: AES-GCM/PBKDF2 usage is correct, IVs are fresh per message, and cross-meeting key isolation holds. The two headline risks are **not** in the crypto — they are (1) the security posture collapses without a passphrase ("convenience mode" is obfuscation, not E2EE), and (2) the **perimeter** around the crypto has the live, exploitable holes: an unauthenticated relay that binds to all interfaces, a presentation/whiteboard control protocol with no sender-binding, and receive-side trust of attacker-controlled length fields.

A blind verifier corrected one of the auditor's own grades: the dev relay was assumed localhost-contained, but it binds `0.0.0.0` and is LAN-reachable — so H1 stays HIGH. The scariest hypothetical (stored XSS over the E2EE channel) was checked sink-by-sink and **does not exist** — render paths consistently escape peer-controlled content.

---

## Trust-claim verdicts

**Claim A — "The signaling relay never sees plaintext." — CONDITIONAL.**
- With a passphrase: **HOLDS.** Content is AES-GCM encrypted with a key derived from a passphrase that never transits the relay (`crypto.js:45-65`, `transport.js:40`). Even a malicious relay that MITMs the WebRTC handshake sees only ciphertext — the app-layer key is the real boundary. This is the design's genuine strength.
- Without a passphrase (convenience mode): **FAILS.** The key is derived from the meeting id alone (`crypto.js:56`), which the relay routes on (`server.js:39`) and which is in the `skool.com/live/<id>` URL. The relay can join its own room (no admission control) and decrypt every frame.

**Claim B — "Knowing meeting A's link gives zero access to meeting B." — HOLDS.** The PBKDF2 salt binds the key to the meeting id (`crypto.js:56`), so different meetings yield different keys in both modes, even with a shared passphrase. The relay also scopes signaling strictly by room (`server.js:54-56`). Cross-meeting isolation is sound at both the key layer and the relay layer (relay isolation `VERIFIED` by `node-verify-signaling.js`).

---

## Findings (merged, ranked)

| # | Finding | Sev | Provenance | Status |
|---|---------|-----|-----------|--------|
| H1 | No relay admission control; **relay binds `0.0.0.0` → LAN-reachable** | **HIGH** | primary; reach upgraded by blind-verify | LAN-reach FIXED 2026-06-09; admission gap OPEN |
| P1 | Present/whiteboard control frames accept no sender-binding | **HIGH** | both verifiers converged | FIXED 2026-06-09 (behavior-verified; browser UX owed) |
| H2 | Convenience mode = obfuscation; privacy promise the user can't verify | **HIGH** | primary; reframed by ADEIS | VERIFIED (mode), REASONED (UX) |
| P2 | Receiver trusts `obj.total`/`obj.seq` off the wire -> one-frame OOM | **MED-HIGH** | both verifiers converged | FIXED 2026-06-09 (behavior-verified) |
| M1 | Malicious-relay handshake MITM (fatal only in convenience mode) | MED | primary | REASONED |
| M2 | Shared-key group: any member forges/replays (no per-sender identity) | MED | primary | INSPECTION |
| P3 | Relay: unbounded rooms, client-asserted `peerId`, spoofable `signal.from` | MED | completeness critic | INSPECTION |
| P4 | Service worker accepts any runtime port; no `port.sender` check / socket cap | MED | completeness critic | INSPECTION |
| P5 | Manifest: dead `host_permissions`, no CSP, hardcoded cleartext `ws://` | MED | completeness critic | INSPECTION |
| L1 | Deterministic salt -> precomputation (FORCED by no-key-exchange design) | LOW | primary | VERIFIED |
| P6 | Peer-set blob MIME -> download-then-open renders as HTML | LOW-MED | completeness critic | INSPECTION |
| P7 | ~~No `package-lock.json`~~ — **FALSE FINDING** (lockfile present since `aa9c4fe`) | LOW | completeness critic (ungrounded absence) | REFUTED 2026-06-09 |
| L2 | AES-GCM IV — fresh per message, fine at meeting volumes | CLEAR | primary | VERIFIED |

---

## Detailed findings

### H1 [HIGH] No relay admission control + binds all interfaces
- **Where:** `signaling/server.js:17` (`new WebSocketServer({ port })` — no `host`), `:38-50` (`join` accepts any room/peerId, no auth/token).
- **Attacker:** anyone who can reach the relay and knows the meeting id (in the URL; known to all participants and to Skool). Because `ws` defaults to binding all interfaces, "reach the relay" is **same-LAN**, not just same-host.
- **Impact:** the attacker joins the room as a peer, receives all frames over the established data channels. Convenience mode -> full plaintext read + inject. Passphrase mode -> all ciphertext for offline brute-force of a weak passphrase.
- **Fix:** `new WebSocketServer({ port, host: "127.0.0.1" })` for dev; for production add a room-join token / membership check. The meeting must stop being the security boundary — the passphrase is.
- **Note:** the auditor first softened this to "localhost-contained"; blind-verify corrected that (no host binding). The code fact is certain; a live cross-interface connect upgrades it to demonstration-grade.
- **Resolved (LAN-reach) 2026-06-09:** pre-fix bind demonstrated as `::` (all interfaces); fixed to loopback (`HOST` env, default `127.0.0.1`), real-process bind netstat-confirmed `127.0.0.1:8080`; 12+20 tests green. **This closes the LAN-reach only.** The admission-control gap stays OPEN — any same-host process can still join the room, and production binding a public interface MUST add a room-join token first.

### P1 [HIGH] Control protocol has no sender-binding (one-line root cause)
- **Where:** `panel.js:177` receives `onRemoteMessage(obj, fromPeer)` but `:180-181` dispatch to `SDZPresent.handleMessage(obj)` / `SDZWhiteboard.handleMessage(obj)` **without `fromPeer`** — the sender id is thrown away. Same in `harness.js:58-59`. `present.js:356-388` and `whiteboard.js:191-197` apply control frames with no check that the sender is the presentation's opener.
- **Attacker:** any admitted room peer.
- **Impact:** force-open a fullscreen overlay on every viewer (`present.js:373`); force-close the legitimate presenter's deck for everyone (`present.js:381`); drive another member's video play/pause/seek (`present.js:378` -> `:142-151`) or flip their slide page (`slide-page :388`); flood `wb-stroke` (auto-opens the whiteboard on every peer, `whiteboard.js:191`) and grow `strokes[]` unbounded; `wb-clear` wipes the shared board for everyone (`whiteboard.js:197`).
- **Fix:** thread `fromPeer` into `handleMessage`; bind `active` to its opener's peerId; reject control/close frames from any other peer; rate-limit and cap `strokes[]`.
- **Convergence:** independently found by both verifiers.
- **Resolved 2026-06-09:** `fromPeer` now threaded through both dispatch sites (`panel.js`, `harness.js`); each viewer overlay records its opening peer (`active.presenter`); `present-control` / `present-close` / `slide-page` honored **only** from that peer; `present-end` / `slide-show` refuse to hijack a presentation you're watching from a different peer; whiteboard buffer capped (`MAX_STROKES`) against stroke-flood. Behaviorally verified in `node-verify.js` (foreign `present-close` rejected, owner close works, hijack blocked) — 4 new behavioral + 8 static contract checks. **Browser UX retest still owed** (the security gate is verified; legitimate presenter rendering/video-PDF sync needs the two-tab test). **Left as a product decision:** the whiteboard is collaborative (no single owner), so `wb-clear`-by-any-peer and auto-open-on-peer-stroke are unchanged — owner-gating those changes the product.

### H2 [HIGH] Convenience mode is obfuscation, and the user can't tell
- **Where:** `crypto.js:45-65` (empty passphrase -> key = f(meetingId)); `panel.js:123` (`convenienceMode = !passphrase`); `panel.js:64` placeholder invites blank; `panel.js:162` flags it only as a short "convenience mode" status string.
- **Impact (crypto):** against the relay/host, convenience mode provides no confidentiality (see Claim A). VERIFIED by inspection of the deterministic derivation.
- **Impact (UX / ADEIS, see below):** the product presents an "encrypted" affordance that a non-technical user cannot tell is unmet in the default (blank) path. The harm is false confidence, not just a weak mode.
- **Fix (product decision — owner's call):** gate the lock affordance behind a real passphrase; add a point-of-decision warning on blank Join ("No passphrase = the meeting host can read this. Add one / Continue"); never show E2EE semantics in convenience mode.

### P2 [MED-HIGH] Receiver trusts attacker-controlled length fields
- **Where:** `panel.js:211` and `present.js:359` do `new Array(obj.total)` on a self-asserted count; chunk writes `t.parts[obj.seq]` (`panel.js:228`, `present.js:363`) with no bound on `seq`. The only size guard (`panel.js:204`, `obj.size > MAX_FILE`) is on a self-asserted field and is not enforced against actual bytes received.
- **Attacker:** any room peer. **Impact:** a single `*-start` frame with `total: 2e9` allocates a multi-billion-element array -> instant tab OOM for every viewer; high/negative `seq` balloons sparse arrays and desyncs reassembly.
- **Fix:** clamp `0 < total <= ceil(MAX_FILE/CHUNK)` and `0 <= seq < total` before allocating/indexing, in both `panel.js` and `present.js`.
- **Convergence:** both verifiers (extends the auditor's M3).
- **Resolved 2026-06-09:** receive paths now reject a non-integer / `<1` / `> MAX_CHUNKS` `total` before allocating, and bound `0 <= seq < total` before indexing — in both `panel.js` (file-*) and `present.js` (present-*). Behaviorally verified in `node-verify.js` (a `total: 1e6` `present-start` opens no overlay). Note: the dev test harness (`harness.js`) is a chrome-extension-only test surface and was left unguarded; only the production receive paths are hardened.

### M1 [MED] Malicious-relay WebRTC MITM
- **Where:** unauthenticated signaling; DTLS fingerprints ride inside SDP relayed verbatim (`transport.js:100,137`; `server.js:56`).
- **Impact:** a malicious relay can sit in the DTLS/data path. Non-fatal in passphrase mode (app-layer key still protects content; enables only DoS/drop/selective-forward); fatal in convenience mode. **Fix:** authenticate signaling, or an out-of-band fingerprint/identity check; mandatory passphrase neutralizes the confidentiality impact.

### M2 [MED] Shared-key group: forgery + replay
- **Where:** one symmetric key per room (`transport.js:22,40`); no per-sender signature; `remoteId` is the self-asserted signaling id, not cryptographically bound. No anti-replay on text frames (GCM authenticates integrity, not freshness).
- **Impact:** any admitted member can encrypt a frame that decrypts for all and cannot be cryptographically attributed; captured frames replay (notably control frames — re-trigger page turns, board clears). **Fix:** per-sender signing/identity if member-level trust is required; an app-layer sequence/nonce window for replay.

### P3 [MED] Relay process hardening (availability)
- **Where:** `server.js:20` (`rooms` grows unbounded — no cap on rooms or peers/room); `:40,:50` (`peerId` client-asserted, no uniqueness — a duplicate `peerId` overwrites the map entry and silently de-routes the original peer); `:52-56` (`signal` carries a sender-claimed `from` -> signaling-layer impersonation, pre-E2EE DoS). **Fix:** cap rooms/peers-per-room, reject duplicate `peerId`, validate `to` is a known distinct peer, per-connection rate limit.

### P4 [MED] Service worker port trust
- **Where:** `service-worker.js:36-37` accepts any `chrome.runtime.connect({name:"sdz-signaling"})` with no `port.sender` check and opens a real relay socket per port; no concurrent-socket cap (`:67`); `:79-87` forwards every relay frame to the content port unvalidated.
- **Mitigating fact (positive):** `externally_connectable` is **absent**, so random skool.com page scripts cannot reach the SW — the gap is contained to in-extension callers. **Fix:** validate `port.sender.id === chrome.runtime.id`; cap sockets per sender.

### P5 [MED] Manifest / MV3 gaps
- **Where:** `manifest.json` — no `content_security_policy` (declare `script-src 'self'`); `host_permissions: [http/https://localhost/*]` is **dead scope** (the SW uses `new WebSocket("ws://localhost:8080")`, not gated by host_permissions) — broadens the install warning for nothing; hardcoded cleartext `ws://localhost:8080` (`service-worker.js:15`) is a **ship-blocker for any non-localhost deployment** (must be `wss://`). `web_accessible_resources` absent = good.

### L1 [LOW] Deterministic salt
- **Where:** `crypto.js:56`, salt = `"skool-dropzone:" + meetingId`, no random component. Enables precomputation against a known meeting id + weak passphrase; **FORCED** by the derive-independently/no-key-exchange design (peers can't agree a random salt without a key exchange). Mitigated by 250k PBKDF2 iterations + strong passphrases. Real fix is a group key-agreement (architectural, not a Phase-8 patch).

### P6 [LOW-MED] Peer-set blob MIME
- **Where:** peer-controlled file names flow to `dl.download = item.name` (`panel.js:471`) and blob `type` to `new Blob([...], {type})` (`panel.js:247`, `present.js:48,373`). A peer-set `text/html` MIME + `URL.createObjectURL` means a downloaded, then-opened file renders as HTML in the blob context. Social-engineered (requires download + open), not auto-exec. **Fix:** allowlist non-executable blob `type`; sanitize the download extension.

### P7 [LOW] Supply chain
- **Where:** `signaling/package.json:11` pins `ws: ^8.18.0`. The declared floor is **past** the CVE-2024-37890 fix (8.17.1), so the version itself is clean — but there is **no `package-lock.json`**, so `^8.18.0` floats at install time with no integrity pinning. **Fix:** commit a lockfile. ([CVE-2024-37890 / Snyk SNYK-JS-WS-7266574])
- **REFUTED 2026-06-09 (false finding):** `package-lock.json` has existed since commit `aa9c4fe` (2026-05-20), pinning `ws` **8.20.1** with integrity present (verified via `git cat-file -p HEAD:signaling/package-lock.json`). The completeness-critic's "glob found none" was an **ungrounded absence claim** — the file was tracked in git all along. No fix was needed; `npm install --package-lock-only` this session produced no diff, confirming. Lesson (logged): the absence claim was acted on before being re-grounded from a fixed vantage — the exact failure class the kernel's grounding discipline guards against; even a spawned blind verifier's negative claim must be verified before action.

### L2 [CLEAR] AES-GCM IV — verified fine
- `crypto.js:69` uses `crypto.getRandomValues(new Uint8Array(12))` fresh per `encrypt`, including per file chunk. Random 96-bit IV collision risk is negligible at meeting volumes. No action.

---

## Verified clean (do not re-walk)

1. **No stored-XSS-over-E2EE.** `panel.js`, `present.js`, `whiteboard.js` consistently use `escapeHtml()` / `textContent` for every peer-controlled string (message bodies `panel.js:572/578/582`, file names `panel.js:372/451`, slide title/bullets `present.js:219/228`, presenter name `present.js:72`). The completeness critic walked each sink. The "E2EE" claim holds against the injection vector. (Residual: P6, the download-then-open blob path.)
2. **Cross-meeting isolation** (Claim B) — holds at both layers; relay isolation VERIFIED by `node-verify-signaling.js` (cross-room signal not delivered).
3. **`externally_connectable` absent** — random web pages cannot reach the service worker (contains P4).
4. **Crypto primitives** — round-trip + wrong-passphrase-fails VERIFIED (`node-verify.js`); file chunk reassembly byte-exact VERIFIED.

---

## ADEIS — the user's-eye reframe of H2

Inhabiting the non-technical Skool participant (agency: they *can-only-receive* the security posture; the community owner *can-act* — that split is the problem): they click **Join** with the passphrase box blank because they don't know what it's for, see "encrypted" chrome, and share a file. Their honest complaint on later learning the truth: *"It told me it was encrypted. I didn't know 'convenience mode' meant the host could read it."* The status quo (Skool's own chat) makes no privacy promise; SDZ makes one and, in the default path, the user cannot tell it's unmet. This is why H2's fix is a point-of-decision warning + gating the lock on a real passphrase, not a louder label.

---

## Honesty calibration

- **VERIFIED by execution:** crypto round-trip / wrong-passphrase-fail, file reassembly, relay room-isolation, AES-GCM IV freshness, the deterministic convenience-key derivation, no-XSS sink walk.
- **INSPECTION-grade (high confidence, not yet run):** the `0.0.0.0` LAN-exposure (H1) — code fact certain, live cross-interface connect not yet done; all P-findings (code-located, attack reasoned).
- **REASONED (threat model, not reproduced):** M1 relay-MITM, the UX-harm half of H2.
- The single most consequential item to upgrade to demonstration-grade is **H1's LAN exposure** (start relay, connect from a non-loopback interface).

---

## Prioritized remediation plan

1. **Relay `host: "127.0.0.1"`** (H1 reach) — fold the demo in: connect from the LAN IP to confirm exposure, apply, reconnect to confirm refusal.
2. **P1 — restore `fromPeer` at `panel.js:180`** + sender-binding (bind `active` to opener, reject foreign control/close, cap whiteboard). Highest-leverage; the dropped argument is the prerequisite for all sender-binding.
3. **P2 — clamp `total`/`seq` on receive** (`panel.js`, `present.js`).
4. **P7 — commit `package-lock.json`.**
5. **Owner's product decision:** mandatory-passphrase / gate-the-lock / convenience-mode interstitial (H1+H2 UX half, M1 confidentiality). Changes the deliberately-built convenience mode — not auto-applied.
6. **Non-localhost ship-blockers (when the relay leaves the box):** `wss://`, relay admission token, STUN/TURN.

Each code fix is execution-verified (`node extension/test/node-verify.js` + `node signaling/node-verify-signaling.js`) before it is called done; nothing is claimed working without being run.

---

*Audit method appendix: PARALLAX (4 lenses) + execution-verified primitives + 2 independent blind verifiers (grade-refuter `REVISE`, completeness critic) + GenFlight (surfaced the H1 deployment assumption, later corrected by blind-verify) + ADEIS (H2 reframe) + KG conformance (render-sink walk). Two findings (P1, P2) reached by independent convergence of both verifiers. No primary grade was overturned; the run found the core sound-but-narrow and relocated risk to the perimeter.*
