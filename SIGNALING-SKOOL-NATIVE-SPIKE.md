# Spike — serverless signaling via the Skool/Stream meeting (verdict)

**Question:** Can a Chrome MV3 extension piggyback WebRTC signaling (SDP/ICE) on
the Skool/Stream meeting itself, so two participants connect peer-to-peer with
**no signaling server we run** (and therefore no traffic cost to us)?

**Date:** 2026-06-24. **Spiked by:** desk session (no live Skool meeting available
→ feasibility analysis + doc/competitor grounding, NOT a live confirm).

## Decision rule (fixed before looking)

- **FEASIBLE** → a concrete in-page channel all participants' extensions can
  read+write in near-real-time, reachable from an MV3 content script, without
  depending on auth we can't get.
- **NOT FEASIBLE / FRAGILE** → no such channel, or it needs private auth/protocol
  reverse-engineering that breaks on every Skool deploy, or it's same-browser-only.

## Verdict: CONDITIONALLY FEASIBLE

The **channel** clears the bar. The **bridge to reach it** is the risk, and is
**owed a live test**.

### What's confirmed (strong — Stream's own docs)

- Skool's meetings run on the **Stream.io Video React SDK** (`str-video__*` DOM,
  WS to `stream-io-api.com` — see `NOTES-skool-stack.md`).
- Stream exposes **custom events** as a first-class API:
  `await call.sendCustomEvent({...})` → delivered in real-time to all clients
  watching the call; received via `call.on("custom", e => e.custom)`.
  Source: https://getstream.io/video/docs/react/guides/custom-events/
- **Payload limit 5KB** (web). SDP offers are ~1–4KB; ICE is trickled as tiny
  per-candidate messages (transport.js already does this). Fits, with chunking
  as a fallback for an oversized SDP.
- **Auth is free** — it rides the participant's already-authenticated call. No
  token to obtain. The relay would also be Stream's (Skool pays for it), and it
  only carries KB of handshake, never our files (those stay P2P on the data
  channel). So **zero infrastructure cost to us.**
- **Reading** Stream events from an extension is **already proven in production**:
  the competitor "Skool Extensions" patches `WebSocket` in MAIN world and reads
  `custom.skt_raise_hand` / `custom.skt_force_lower` payloads (`NOTES-skool-stack.md`).

### The risk (named, not hidden) — the bridge, UNTESTED here

`sendCustomEvent` is a method on the Stream **`call` instance**, which lives in
Skool's React app (page MAIN world), not the extension's isolated content-script
world. To call it we need one of:

- **(A)** MAIN-world injection that locates Skool's live `call` object and calls
  `sendCustomEvent` on it — cleanest, but the instance is buried in a minified
  React bundle → **fragile to Skool redeploys.**
- **(B)** Patch the page WebSocket (competitor-proven for *reading*) and inject a
  custom-event frame onto Stream's authed socket — avoids finding `call`, but
  needs Stream's wire-frame for a send → also protocol-fragile.

Both are MAIN-world bundle hooks. Fragility is **real but bounded**: a shipping
commercial competitor maintains exactly this class of hook today, so it's
"needs ongoing upkeep," not "impossible." **Neither write path has been tested
live by us** — that is the true gate.

## Recommendation

Build **Skool-native signaling as the happy path, with manual connect-code as an
automatic fallback** — so we get zero-infra + graceful degradation:

1. Try the Skool-native bridge (custom events). If the hook can't find the call
   object (Skool changed their bundle) → 
2. Fall back to **manual connect-code**: extension emits a short offer code, the
   user pastes it via the Skool chat they're already in, peer pastes back. $0,
   always works, a bit manual.

This composes with the work already on `feat/hosted-relay`: the relay path stays
a third selectable backend (for communities who'd rather run one). The signaling
backend becomes pluggable: `skool-native | manual | relay`.

### Bonus: this fits the operator's constraints exactly

- **Peer-to-peer** ✅ (data was always P2P; now signaling is serverless too)
- **No traffic cost to us** ✅ (rides Stream's existing infra; KB of handshake only)
- **Only works on skool.com** ✅ (bound to the Skool meeting by construction —
  the "what if it spreads outside Skool" worry dissolves)

## Owed before building (the true gate)

A **live test in a real Skool meeting**: from an extension content script, reach
the Stream `call` object (or its socket), `sendCustomEvent` a probe, and confirm
a *second* participant's extension receives it via `call.on("custom")`. If yes →
Skool-native is the path. If the bridge proves too fragile → manual fallback is
the floor, still $0.
