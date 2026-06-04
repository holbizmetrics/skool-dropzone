// skool-dropzone — headless verification harness (Node)
//
// Verifies the parts of the spine that DON'T need a browser:
//   1. crypto.js E2EE round-trip (real AES-GCM via Node's webcrypto)
//   2. full send -> wire -> receive path for a text message
//   3. file chunk -> base64 -> reassemble byte-exactness (edge cases)
//   4. the present-* wire-prefix contract (regression guard for the
//      Phase-5 viewer bug: presenter file must go out as present-start,
//      not file-start, or viewers never open the fullscreen overlay)
//
// What it CANNOT verify (needs a real/headless browser with WebRTC):
//   - RTCPeerConnection offer/answer/ICE handshake
//   - data-channel open + live mesh
//   - DOM overlay rendering
// Those are covered by extension/test/harness.html (two-tab manual test)
// and the signaling test (node-verify-signaling.js).
//
// Run:  node extension/test/node-verify.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// --- tiny test rig ---
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

// --- load crypto.js with a browser-ish global (window) shim ---
// Node 22 already provides crypto.subtle, btoa/atob, TextEncoder/Decoder as
// globals; crypto.js only additionally needs `window` to hang its export on.
globalThis.window = globalThis;
const cryptoSrc = fs.readFileSync(
  path.join(__dirname, "..", "content", "crypto.js"),
  "utf8"
);
vm.runInThisContext(cryptoSrc, { filename: "crypto.js" });
const SDZCrypto = globalThis.window.SDZCrypto;

// --- replicate transport.js chunking (kept in lockstep with the real file) ---
const CHUNK_BYTES = 16 * 1024;
function chunkToWire(bytes) {
  // mirrors transport.sendFile's chunk loop: subarray -> toB64 per chunk
  const total = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  const out = [];
  for (let i = 0; i < total; i++) {
    const slice = bytes.subarray(
      i * CHUNK_BYTES,
      Math.min((i + 1) * CHUNK_BYTES, bytes.length)
    );
    out.push({ seq: i, data: SDZCrypto.toB64(slice) });
  }
  return { total, chunks: out };
}
function reassemble(total, chunks) {
  // mirrors panel.js endIncoming / present.js reassemble
  const parts = new Array(total);
  chunks.forEach((c) => {
    if (parts[c.seq] === undefined) parts[c.seq] = c.data;
  });
  const bufs = parts.map((b) => SDZCrypto.fromB64(b || ""));
  let len = 0;
  bufs.forEach((b) => (len += b.length));
  const all = new Uint8Array(len);
  let off = 0;
  bufs.forEach((b) => {
    all.set(b, off);
    off += b.length;
  });
  return all;
}
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

(async () => {
  console.log("crypto round-trip:");
  const selfOk = await SDZCrypto.selfTest();
  check("SDZCrypto.selfTest() (AES-GCM round-trip + wrong-passphrase fails)", selfOk);

  // cross-passphrase isolation: same room id, different passphrase -> undecryptable
  {
    const room = "TgzjxszWRTp";
    const k1 = await SDZCrypto.deriveKey("alpha", room);
    const k2 = await SDZCrypto.deriveKey("beta", room);
    const sealed = await SDZCrypto.encrypt(k1, "secret");
    let isolated = false;
    try {
      await SDZCrypto.decryptText(k2, sealed);
    } catch {
      isolated = true;
    }
    check("different passphrase, same room id -> cannot decrypt", isolated);
  }

  // id-only convenience mode still round-trips (weaker, but functional)
  {
    const k = await SDZCrypto.deriveKey("", "room-xyz");
    const sealed = await SDZCrypto.encrypt(k, "conv");
    check("convenience mode (empty passphrase) round-trips", (await SDZCrypto.decryptText(k, sealed)) === "conv");
  }

  console.log("\nfull text send -> wire -> receive:");
  {
    const key = await SDZCrypto.deriveKey("pw", "room1");
    const obj = { kind: "text", body: "hello 🔒 dropzone" };
    // sender (transport.send): encrypt(JSON.stringify(obj)) -> JSON wire
    const wire = JSON.stringify(await SDZCrypto.encrypt(key, JSON.stringify(obj)));
    // receiver (transport.setupDataChannel.onmessage): parse -> decrypt -> parse
    const got = JSON.parse(await SDZCrypto.decryptText(key, JSON.parse(wire)));
    check("text obj survives encrypt->JSON->decrypt->parse", got.kind === "text" && got.body === obj.body);
  }

  console.log("\nfile chunk -> base64 -> reassemble byte-exactness:");
  const sizes = [
    ["empty (0 B)", 0],
    ["1 byte", 1],
    ["under one chunk (1000 B)", 1000],
    ["exactly one chunk (16384 B)", CHUNK_BYTES],
    ["one chunk + 1 (16385 B)", CHUNK_BYTES + 1],
    ["multi-chunk w/ partial tail (100003 B)", 100003],
    ["several whole chunks (49152 B)", CHUNK_BYTES * 3],
  ];
  for (const [label, n] of sizes) {
    const src = new Uint8Array(n);
    for (let i = 0; i < n; i++) src[i] = (i * 31 + 7) & 0xff; // deterministic pattern
    const { total, chunks } = chunkToWire(src);
    const back = reassemble(total, chunks);
    check(`reassemble ${label} [total=${total}]`, bytesEqual(src, back));
  }

  // out-of-order chunk delivery must still reassemble (parts[seq] is positional)
  {
    const src = new Uint8Array(100003);
    for (let i = 0; i < src.length; i++) src[i] = (i * 13 + 5) & 0xff;
    const { total, chunks } = chunkToWire(src);
    const shuffled = [...chunks].reverse();
    check("reassemble with out-of-order chunk delivery", bytesEqual(src, reassemble(total, shuffled)));
  }

  console.log("\nPhase-5 present-* wire-prefix contract (regression guard):");
  // This documents the REQUIRED behavior. Before the fix, transport.sendFile
  // ignored its prefix argument and always emitted file-start, so viewers
  // (which route on present-start) never opened the overlay. We load the real
  // transport.js source and assert it honors a prefix parameter.
  {
    const transportSrc = fs.readFileSync(
      path.join(__dirname, "..", "content", "transport.js"),
      "utf8"
    );
    // Static contract checks against the real source — no WebRTC needed.
    const sendFileSig = /async function sendFile\(([^)]*)\)/.exec(transportSrc);
    const params = sendFileSig ? sendFileSig[1].split(",").map((s) => s.trim()) : [];
    const hasPrefixParam = params.length >= 3;
    check("transport.sendFile accepts a 3rd (prefix/kind) parameter", hasPrefixParam);
    // It must be able to emit present-start (not only the hardcoded file-start).
    check("transport.sendFile can emit a present-start frame", /present-start|\$\{?\w*prefix|`\$\{prefix\}-start`|prefix \+ "-start"|prefix\s*\+\s*'-start'/.test(transportSrc) || /-start`/.test(transportSrc));
  }

  console.log("\nPhase-7 type-as-slides wiring (static contract — DOM paths need the two-tab test):");
  {
    const presentSrc = fs.readFileSync(path.join(__dirname, "..", "content", "present.js"), "utf8");
    check("present.js exports presentSlides", /presentSlides,/.test(presentSrc) && /function presentSlides\(/.test(presentSrc));
    check("present.js routes incoming slide-show", /case "slide-show":/.test(presentSrc));
    check("present.js routes incoming slide-page", /case "slide-page":/.test(presentSrc));
    check("presentSlides broadcasts a slide-show frame", /kind: "slide-show"/.test(presentSrc));
    check("presenter slot guard: busyAsPresenter swallows peer present/slide", /busyAsPresenter\(\)\) return true/.test(presentSrc));
    check("presenter slot guard: refuses to present over a presentation you're watching", /watchingSomeoneElse\(\)/.test(presentSrc));
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) {
    console.log("FAILURES:", fails.join("; "));
    process.exit(1);
  }
})();
