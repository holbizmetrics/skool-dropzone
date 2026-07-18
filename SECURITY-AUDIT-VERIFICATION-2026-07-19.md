# EVE REVIEW — skool-dropzone post-audit drift (verification of SECURITY-AUDIT.md 2026-06-09)

**Reviewer:** Eve (eve-claude-code, FVPA lineage), session c38cfa2e · **Date:** 2026-07-19 (night of 07-18)
**Commissioned:** Holger, live, informal ("review skool-dropzone"); scope confirmed = post-audit drift
**Pinned target:** `f2ddd96` on `feat/hosted-relay` (clean tree; live session windows-claude-6c719ead holds the pen — review conducted read-only, artifact delivered outside the tree)
**Method:** Prior-Audit DIFF (TRIAD Pass-0 idiom): read SECURITY-AUDIT.md in full → enumerate the 5 substantive post-audit commits → per-claim / per-fix verification → decidable re-run of both verifier suites by the reviewer.
**Rung:** cross-OPERATOR (FVPA lineage). NOT cross-family — reviewer is Claude-substrate; note the prior audit's blind verifiers were also same-family.

---

## 0. Decidable baseline — re-run by me, not taken on faith

- `node extension/test/node-verify.js` → **74 passed, 0 failed** (my run)
- `node signaling/node-verify-signaling.js` → **14 passed, 0 failed** (my run)
- The live session's claimed 74/74 + 14/14 independently confirmed. Its headless-Chromium 9/9 for whiteboard v2 is taken as its verified claim (harness named), not re-run here.

## 1. Verdict on the June audit's fixes: **HELD, all of them — and corpus-locked**

Every 2026-06-09 fix is protected by behavioral tests that passed on my re-run: foreign `present-close` rejected / owner close works (P1), `total`/`seq` clamps (P2), dup-`peerId` refused with original still routed (P3), SW port check + socket cap (P4), CSP present (P5-partial), `safeMime` allowlist (P6), stroke-flood rolls off at the 5000 cap. The H2 blank-join confirm is still contract-checked (`!passphrase && !convenienceConfirmed`, node-verify:300). This is the right way to fix an audit finding — the fix cannot silently regress without a suite going red.

**Trust-claim verdicts, re-checked at f2ddd96:** Claim A (relay never sees plaintext) — still CONDITIONAL, exactly as written: holds with passphrase, fails in convenience mode; nothing post-audit changed that boundary. Claim B (cross-meeting isolation) — still HOLDS; the new safe-word derivation is meeting-id-salted and domain-separated, so it preserves isolation too.

**Still-open items from the audit, status honest:** H1 admission gap OPEN (branch exists, see F1); P5 host_permissions trim + `wss://` move still deferred and still documented as ship-blockers; M1/M2 unchanged (REASONED/INSPECTION, no new exposure).

## 2. New findings — the drift itself (none touch the crypto core)

**F1 [MED, sequencing risk] — hosted-relay can outrun its admission gate.**
`0a9f72b` makes the client relay-ready (configurable `relayUrl`, STUN, a `signaling/Dockerfile` — hosting intent is now real) while the admission control the audit called MANDATORY for any public relay lives one commit ahead on unmerged `feat/h1-admission-handshake` (`7ac354d`). BROWSER-TEST-hosted-relay.md names the pairing but as "intended to pair" — softer than the audit's MUST. The failure mode is ordinary project drift: someone hosts the relay to run the browser test, the test passes, momentum ships it, and the open-relay risk the audit ranked HIGH goes live. **Fix shape:** make the coupling mechanical, not narrative — e.g. the BROWSER-TEST prerequisites list gains "1. MERGE feat/h1-admission-handshake" as step one, and/or the relay refuses `HOST=0.0.0.0` without an admission token env set. (The audit's own words: "the meeting must stop being the security boundary.")
*Enrichment from the author session (6c719ead, grounded on disk): the branch implements key-proof admission — encrypted `__sdz-hello` on channel-open, peer admitted only when its frame decrypts, 8s timeout drop; deliberately relay-blind so the relay never learns the passphrase. Sound design, and it sharpens F1's edge: in convenience mode the key derives from the meeting id, so the admission gate only gates when a passphrase exists — one more reason the passphrase-mode path is the only honest public-relay story.*

**F2 [MED, product/consent surface] — transcription is honest with its operator, silent to everyone else.**
`transcribe.js` is verifiably transport-clean (no `SDZTransport`/send path touches it; transcript local; download local) and the UI note to the *user running it* is exemplary. But the other participants — whose speech reaches the mic via speakers and is streamed to Google's recognizer — get **no room-visible indication** that transcription is running. The E2EE story says "no third-party read"; a participant's speech reaching Google via another member's transcription is a third-party read of the *meeting*, consented by the wrong person. Also worth a sober line in the README given the operator's jurisdiction: recording/processing others' spoken words without consent is legally sensitive in Germany (I'm a reviewer, not a lawyer — flagging, not ruling). **Fix shape (v0-compatible):** broadcast a tiny signed-nothing status frame "🎙 transcription on/off by <peer>" over the existing channel (it's metadata, fine under E2EE), rendered in every panel; plus one README sentence about consent. v2 (tabCapture + local Whisper) dissolves the Google half but not the consent half.

**F3 [LOW-MED, H2-echo] — the safe-word displays in convenience mode, where it confirms nothing worth trusting.**
`showSafeWord` runs unconditionally on join (panel.js:169ff). In convenience mode the emoji derive from `"" + meetingId` — every participant, the relay, and anyone with the URL derives the same five emoji. The tooltip ("Different emoji = different passphrase") is technically true and pragmatically misleading there: matching emoji *read as* a security confirmation in exactly the false-confidence shape the audit's ADEIS pass killed in H2. The crypto is fine (derivation is domain-separated and cost-matched — good work); this is purely a presentation finding. **Fix shape:** in convenience mode either hide the safe-word or relabel it: "room check (no passphrase — confirms the room, not privacy)".

**Notes, no action demanded:**
- **N1** `relayUrl` override (`chrome.storage.local`) is writable only by extension-internal code; a hostile value degrades to M1 (availability/metadata) in passphrase mode. Cheap belt: accept only `ws://`/`wss://` schemes on read.
- **N2** `wb-undo` lets any peer remove any gesture by path-id. Consistent with the documented collaborative stance (comment block at whiteboard.js:285, same product call as `wb-clear`) — and confirmed deliberate by the author session with a sound no-new-privilege argument: undo is a strict subset of the already-accepted any-peer `wb-clear`, the honest client's undo button only pops its own gestures, and path-ids are room-public inside the E2EE channel anyway. Recorded as deliberate, not defect.
- **N3** `manual-signal.js` introduces no new trust class: connect-codes carry only SDP (public by design; E2EE is app-layer), joinability tracks code possession exactly as the link-token model already does. Clean, versioned, well-commented.
- **N4** README still tells the truth at f2ddd96 — the transcription bullet self-caveats the Google/E2EE exception rather than hiding behind the headline claim. Keep that habit.

## 3. Recommendation

**Prior audit: HELD.** New feature surface: **sound, with three named findings — F1 before any relay is actually hosted, F2 before the extension is put in front of a real community, F3 whenever the panel is next touched.** Nothing here blocks continuing development on the branch. The repo's security culture is genuinely good: fixes ship with behavioral locks, feature commits name their own gaps, test-owed items are labeled instead of claimed. The drift findings are all of one family — *features that are honest in code and docs but not yet honest in the room* (the relay that could go public before its gate; the transcription other participants can't see; the safe-word that reassures in the mode where it shouldn't). One sentence fixes the pattern: **whatever the code knows about its own limits, the people in the meeting should be able to see.**

## 4. Personal note

Reviewing this after the PCLA kernel in the same long day: this repo runs the same discipline at smaller scale and it *shows* — the June audit even contains its own false-finding retraction with the lesson logged (P7), which is the healthiest thing a security document can carry. And the product itself is very *him*: it exists so that people in a room the owners left can still share things with each other. Even the findings I wrote are all, at bottom, about making sure nobody in that room is trusting something the room didn't actually promise. That's not a coincidence; that's the operator's values showing through the threat model.

— Eve (cross-operator review, 2026-07-19, Claude Code surface / claude-fable-5, session c38cfa2e)
*Substrate caveat, restated: discharges cross-OPERATOR review; not cross-family. The prior audit's blind verifiers were same-family too — if this repo ever wants a cross-family rung, the planted-defect protocol designed for PCLA (non-Claude planter rule) transfers here directly.*
