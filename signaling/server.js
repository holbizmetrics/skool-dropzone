// skool-dropzone — signaling relay (dev: localhost)
//
// WebRTC peers need a channel to exchange connection offers (SDP) and
// network candidates (ICE) before the P2P link exists. This relay does
// ONLY that. It never sees meeting content — messages and files travel
// over the peer-to-peer data channel, encrypted end-to-end (see
// extension/content/crypto.js). The relay sees connection metadata only.
//
// Rooms are keyed by Skool meeting id (the <id> in skool.com/live/<id>).
//
// Run:  npm install   (once)   then   npm start
// Default port 8080; override with PORT env var.

const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
// Bind loopback by default so the dev relay is NOT reachable from the LAN.
// A bare { port } binds 0.0.0.0 / all interfaces (see SECURITY-AUDIT.md H1).
// Override with HOST=0.0.0.0 ONLY behind a real room-admission check (production).
const HOST = process.env.HOST || "127.0.0.1";
// F1 (SECURITY-AUDIT-VERIFICATION 2026-07-19): the audit made client-side
// admission (feat/h1-admission-handshake key-proof) MANDATORY before any
// non-loopback relay. Narrative coupling drifts, so the coupling is mechanical:
// a non-loopback bind refuses to start unless the operator explicitly asserts
// the admission story with SDZ_PUBLIC_RELAY_ACK=h1-admission-merged. The env
// value is deliberately the assertion itself, not "1" — you type what you claim.
const LOOPBACK = /^(127\.|localhost$|::1$)/;
if (!LOOPBACK.test(HOST) && process.env.SDZ_PUBLIC_RELAY_ACK !== "h1-admission-merged") {
  console.error(
    `[relay] REFUSED: HOST=${HOST} is not loopback. A public relay without peer admission ` +
      `is the open-relay risk SECURITY-AUDIT.md H1 ranks HIGH. Merge feat/h1-admission-handshake ` +
      `(key-proof admission), then start with SDZ_PUBLIC_RELAY_ACK=h1-admission-merged.`
  );
  process.exit(1);
}
// Relay hardening (SECURITY-AUDIT P3): bound resource use + reject impersonation.
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 500;
const MAX_PEERS_PER_ROOM = Number(process.env.MAX_PEERS) || 50;
const MAX_ID_LEN = 200;
const wss = new WebSocketServer({ port: PORT, host: HOST, maxPayload: 256 * 1024 });

// room -> Map(peerId -> ws)
const rooms = new Map();

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  let room = null;
  let peerId = null;
  let joined = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      if (joined) return; // one join per connection
      const r = String(msg.room || "unknown").slice(0, MAX_ID_LEN);
      const pid = String(msg.peerId || "").slice(0, MAX_ID_LEN);
      if (!pid) return;
      if (!rooms.has(r) && rooms.size >= MAX_ROOMS) {
        send(ws, { type: "join-error", reason: "too many rooms" });
        return;
      }
      if (!rooms.has(r)) rooms.set(r, new Map());
      const peers = rooms.get(r);
      if (peers.has(pid)) {
        // Don't overwrite an existing peer's socket — overwriting de-routes the
        // original peer and is a targeted-hijack primitive (SECURITY-AUDIT P3).
        send(ws, { type: "join-error", reason: "peerId in use" });
        return;
      }
      if (peers.size >= MAX_PEERS_PER_ROOM) {
        send(ws, { type: "join-error", reason: "room full" });
        return;
      }
      room = r;
      peerId = pid;
      joined = true;

      // Tell the joiner who's already here (joiner initiates to each).
      send(ws, { type: "peers", peers: [...peers.keys()] });
      // Tell existing peers someone joined.
      for (const [, peerWs] of peers) send(peerWs, { type: "peer-joined", peerId });

      peers.set(peerId, ws);
      console.log(`[join]  room=${room} peer=${peerId} total=${peers.size}`);
    } else if (msg.type === "signal") {
      // Relay an SDP/ICE blob to a specific peer in the same room. `from` is the
      // sender's server-side joined id (not client-supplied) so it can't be spoofed.
      if (!joined || !rooms.has(room)) return;
      const target = rooms.get(room).get(msg.to);
      if (target && target !== ws) send(target, { type: "signal", from: peerId, data: msg.data });
    }
  });

  ws.on("close", () => {
    if (!joined || !rooms.has(room)) return;
    const peers = rooms.get(room);
    peers.delete(peerId);
    for (const [, peerWs] of peers) send(peerWs, { type: "peer-left", peerId });
    if (peers.size === 0) rooms.delete(room);
    console.log(`[leave] room=${room} peer=${peerId} remaining=${peers.size}`);
  });
});

console.log(`skool-dropzone signaling relay listening on ws://${HOST}:${PORT}`);
console.log("Relay sees connection metadata only — meeting content is E2EE over the P2P channel.");
