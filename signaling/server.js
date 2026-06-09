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
const wss = new WebSocketServer({ port: PORT, host: HOST });

// room -> Map(peerId -> ws)
const rooms = new Map();

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  let room = null;
  let peerId = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      room = String(msg.room || "unknown");
      peerId = String(msg.peerId || "");
      if (!peerId) return;
      if (!rooms.has(room)) rooms.set(room, new Map());
      const peers = rooms.get(room);

      // Tell the joiner who's already here (joiner initiates to each).
      send(ws, { type: "peers", peers: [...peers.keys()] });
      // Tell existing peers someone joined.
      for (const [, peerWs] of peers) send(peerWs, { type: "peer-joined", peerId });

      peers.set(peerId, ws);
      console.log(`[join]  room=${room} peer=${peerId} total=${peers.size}`);
    } else if (msg.type === "signal") {
      // Relay an SDP/ICE blob to a specific peer in the same room.
      if (!room || !rooms.has(room)) return;
      const target = rooms.get(room).get(msg.to);
      if (target) send(target, { type: "signal", from: peerId, data: msg.data });
    }
  });

  ws.on("close", () => {
    if (!room || !rooms.has(room)) return;
    const peers = rooms.get(room);
    peers.delete(peerId);
    for (const [, peerWs] of peers) send(peerWs, { type: "peer-left", peerId });
    if (peers.size === 0) rooms.delete(room);
    console.log(`[leave] room=${room} peer=${peerId} remaining=${peers.size}`);
  });
});

console.log(`skool-dropzone signaling relay listening on ws://${HOST}:${PORT}`);
console.log("Relay sees connection metadata only — meeting content is E2EE over the P2P channel.");
