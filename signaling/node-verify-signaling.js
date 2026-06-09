// skool-dropzone — signaling relay verification (Node, no browser)
//
// Drives server.js with raw ws clients to prove the room-routing contract the
// WebRTC mesh depends on:
//   - a joiner is told who's already in the room ("peers")
//   - existing peers are told someone joined ("peer-joined")
//   - "signal" blobs are relayed only to the addressed peer in the same room
//   - rooms are isolated (a signal in room A never reaches room B)
//   - leaving fires "peer-left" to the rest of the room
//
// Run:  node signaling/node-verify-signaling.js   (starts its own relay on a test port)

const { spawn } = require("child_process");
const path = require("path");
const WebSocket = require("ws");

const PORT = 8099;
let pass = 0,
  fail = 0;
const fails = [];
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    fails.push(name);
    console.log(`  FAIL ${name}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A small ws client that records every message it receives.
function client(peerId) {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const inbox = [];
  ws.on("message", (raw) => {
    try {
      inbox.push(JSON.parse(raw.toString()));
    } catch {}
  });
  const ready = new Promise((res) => ws.on("open", res));
  return {
    peerId,
    inbox,
    ready,
    join: (room) => ws.send(JSON.stringify({ type: "join", room, peerId })),
    signal: (to, data) => ws.send(JSON.stringify({ type: "signal", to, data })),
    close: () => ws.close(),
    seen: (pred) => inbox.some(pred),
  };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  await sleep(500); // let the relay bind

  try {
    console.log("3-peer discovery in one room:");
    const a = client("alice"),
      b = client("bob"),
      c = client("carol");
    await Promise.all([a.ready, b.ready, c.ready]);

    a.join("room-1");
    await sleep(100);
    // alice is first -> her "peers" list is empty
    check("first joiner gets empty peers list", a.seen((m) => m.type === "peers" && m.peers.length === 0));

    b.join("room-1");
    await sleep(100);
    check("2nd joiner sees alice in peers list", b.seen((m) => m.type === "peers" && m.peers.includes("alice")));
    check("alice notified bob joined (peer-joined)", a.seen((m) => m.type === "peer-joined" && m.peerId === "bob"));

    c.join("room-1");
    await sleep(100);
    check(
      "3rd joiner (carol) sees BOTH alice and bob",
      c.seen((m) => m.type === "peers" && m.peers.includes("alice") && m.peers.includes("bob"))
    );
    check("alice notified carol joined", a.seen((m) => m.type === "peer-joined" && m.peerId === "carol"));
    check("bob notified carol joined", b.seen((m) => m.type === "peer-joined" && m.peerId === "carol"));

    console.log("\nsignal relay is targeted (SDP/ICE only to the addressed peer):");
    b.inbox.length = 0;
    c.inbox.length = 0;
    a.signal("bob", { sdp: { type: "offer", sdp: "FAKE_SDP" } });
    await sleep(100);
    check("bob receives the signal addressed to him (from=alice)", b.seen((m) => m.type === "signal" && m.from === "alice" && m.data.sdp));
    check("carol does NOT receive a signal addressed to bob", !c.seen((m) => m.type === "signal"));

    console.log("\nroom isolation:");
    const d = client("dave");
    await d.ready;
    d.join("room-2");
    await sleep(100);
    // assert on the peers list BEFORE clearing the inbox
    check("dave's room-2 peers list does not include room-1 members", d.seen((m) => m.type === "peers" && m.peers.length === 0));
    d.inbox.length = 0;
    a.signal("dave", { sdp: { type: "offer", sdp: "X" } }); // alice in room-1 -> dave in room-2
    await sleep(100);
    check("cross-room signal is NOT delivered (room isolation)", !d.seen((m) => m.type === "signal"));

    console.log("\nleave handling:");
    a.inbox.length = 0;
    b.inbox.length = 0;
    c.close();
    await sleep(150);
    check("alice notified carol left (peer-left)", a.seen((m) => m.type === "peer-left" && m.peerId === "carol"));
    check("bob notified carol left", b.seen((m) => m.type === "peer-left" && m.peerId === "carol"));

    console.log("\nP3 relay hardening (duplicate peerId rejected, original keeps routing):");
    const e1 = client("eve");
    await e1.ready;
    e1.join("room-3");
    await sleep(100);
    const e2 = client("eve"); // same peerId, different socket
    await e2.ready;
    e2.join("room-3");
    await sleep(100);
    check("duplicate peerId join is rejected (join-error)", e2.seen((m) => m.type === "join-error" && /in use/.test(m.reason)));
    const frank = client("frank");
    await frank.ready;
    frank.join("room-3");
    await sleep(100);
    e1.inbox.length = 0;
    frank.signal("eve", { sdp: { type: "offer", sdp: "ROUTE_OK" } });
    await sleep(100);
    check("original peerId holder still receives signals after a dup attempt", e1.seen((m) => m.type === "signal" && m.from === "frank"));
    e1.close();
    e2.close();
    frank.close();
    await sleep(100);

    a.close();
    b.close();
    d.close();
    await sleep(100);
  } finally {
    srv.kill();
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) {
    console.log("FAILURES:", fails.join("; "));
    process.exit(1);
  }
})();
