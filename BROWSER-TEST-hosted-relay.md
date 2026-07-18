# Browser test — hosted relay (cross-internet, two strangers)

This branch (`feat/hosted-relay`) makes the extension **relay-ready** for two
people in two locations. The code is done + the unit suite is green, but the
end-to-end claim ("two strangers connect") is **owed a real browser test**,
because it cannot pass until a relay is actually hosted somewhere public.

## What changed

- `extension/content/transport.js` — STUN servers added (`stun.l.google.com`)
  so peers behind home NAT can discover a direct path. Same-machine two-tab
  still works (additive).
- `extension/background/service-worker.js` — relay URL is no longer hardcoded.
  Resolves at connect time: `chrome.storage.local.relayUrl` override wins, else
  `DEFAULT_RELAY_URL` (still `ws://localhost:8080` until a host is chosen).
- `extension/manifest.json` — added `storage` permission.
- `signaling/Dockerfile` — container image to deploy the existing relay.

## Prerequisites to actually pass this test

1. **MERGE `feat/h1-admission-handshake` FIRST — hard prerequisite, not intent.**
   The audit (SECURITY-AUDIT.md H1, re-affirmed by the 2026-07-19 verification's
   F1) makes peer admission MANDATORY before any non-loopback relay. The relay
   now enforces this mechanically: a non-loopback `HOST` refuses to start unless
   `SDZ_PUBLIC_RELAY_ACK=h1-admission-merged` is set — and that env var is you
   asserting the merge actually happened. Do not set it untruthfully.
2. **Host the relay** on a public TLS endpoint (so the browser reaches it as
   `wss://…`). `signaling/Dockerfile` builds it; set `HOST=0.0.0.0` plus the
   ack env from step 1. Most PaaS
   (Fly.io / Render / Railway) inject `$PORT` and terminate TLS for you.
3. **Add the relay host to `host_permissions`** in the manifest (e.g.
   `"wss://relay.example.com/*"` and/or `"https://relay.example.com/*"`).
4. **Point the extension at it** — either bake it into `DEFAULT_RELAY_URL`, or
   set the override from the extension's service-worker console:
   `chrome.storage.local.set({ relayUrl: "wss://relay.example.com" })`.

## The test (two genuinely separate machines / networks)

- Machine A and Machine B, on **different networks** (e.g. one on home wifi,
  one on a phone hotspot — this is what exercises NAT traversal; same-LAN does
  not prove it).
- Both load the unpacked extension, open the same room + the **same passphrase**.
- Expect: `🔒 E2EE · 1 peer connected` on both. Send a file → arrives + decrypts.
- **Record the result here** (pass/fail, which NAT combo, browser/OS).

## Known gap (call it out, don't hide it)

- **No TURN yet.** Symmetric-NAT pairs that STUN can't traverse will fail to
  connect. Expect a minority of network combos to fail until a TURN server is
  added (TURN relays media → has a bandwidth cost). Log any failures above so
  we know the real-world hit rate before deciding whether TURN is worth it.
- **Open relay.** A public relay with no admission gate routes ciphertext for
  anyone who finds it (content stays private; abuse/DoS is the risk). The
  `feat/h1-admission-handshake` branch is the intended gate to pair with this.
