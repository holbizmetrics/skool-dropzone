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

  console.log("\nSECURITY-AUDIT P1 — control-frame sender-binding (static contract):");
  {
    const presentSrc = fs.readFileSync(path.join(__dirname, "..", "content", "present.js"), "utf8");
    const panelSrc = fs.readFileSync(path.join(__dirname, "..", "content", "panel.js"), "utf8");
    const harnessSrc = fs.readFileSync(path.join(__dirname, "harness.js"), "utf8");
    const wbSrc = fs.readFileSync(path.join(__dirname, "..", "content", "whiteboard.js"), "utf8");
    check("present.handleMessage takes fromPeer", /function handleMessage\(obj,\s*fromPeer\)/.test(presentSrc));
    check("viewer overlay records its presenter peer", /presenter: t\.from/.test(presentSrc) && /presenter: fromPeer/.test(presentSrc));
    check("present-control honored only from the presenter", /case "present-control":[\s\S]{0,80}fromPresenter\(fromPeer\)/.test(presentSrc));
    check("present-close honored only from the presenter", /case "present-close":[\s\S]{0,80}fromPresenter\(fromPeer\)/.test(presentSrc));
    check("slide-page honored only from the presenter", /case "slide-page":[\s\S]{0,80}fromPresenter\(fromPeer\)/.test(presentSrc));
    check("panel dispatch passes fromPeer to handleMessage", /SDZPresent\.handleMessage\(obj,\s*fromPeer\)/.test(panelSrc) && /SDZWhiteboard\.handleMessage\(obj,\s*fromPeer\)/.test(panelSrc));
    check("harness dispatch passes fromPeer to handleMessage", /SDZPresent\.handleMessage\(obj,\s*fromPeer\)/.test(harnessSrc) && /SDZWhiteboard\.handleMessage\(obj,\s*fromPeer\)/.test(harnessSrc));
    check("whiteboard caps stroke buffer (flood guard)", /MAX_STROKES/.test(wbSrc) && /strokes\.splice\(0,/.test(wbSrc));
  }

  console.log("\nSECURITY-AUDIT P1 — control-frame sender-binding (behavioral, DOM-stubbed):");
  {
    // Minimal DOM/URL stub so present.js's open()/close() run headless. We only
    // observe the security-relevant state (SDZPresent.active), not rendering.
    const stubEl = () => ({
      className: "", textContent: "", src: "", alt: "", controls: false,
      dataset: {}, style: {},
      appendChild() {}, addEventListener() {}, removeEventListener() {}, remove() {},
      classList: { toggle() {}, add() {}, remove() {} },
    });
    const savedDoc = globalThis.document, savedURL = globalThis.URL;
    globalThis.document = {
      createElement: stubEl,
      documentElement: { appendChild() {} },
      addEventListener() {}, removeEventListener() {},
    };
    globalThis.URL = { createObjectURL: () => "blob:stub", revokeObjectURL() {} };

    const presentSrc2 = fs.readFileSync(path.join(__dirname, "..", "content", "present.js"), "utf8");
    vm.runInThisContext(presentSrc2, { filename: "present.js" });
    const P = globalThis.window.SDZPresent;

    // Peer "A" presents a 1-byte image; viewer overlay opens bound to A.
    P.handleMessage({ kind: "present-start", id: "f1", name: "x.png", type: "image/png", total: 1 }, "A");
    P.handleMessage({ kind: "present-chunk", id: "f1", seq: 0, data: SDZCrypto.toB64(new Uint8Array([65])) }, "A");
    P.handleMessage({ kind: "present-end", id: "f1" }, "A");
    check("viewer overlay opens from presenter A", P.active === true);

    // Foreign peer "B" tries to close A's presentation -> must be IGNORED.
    P.handleMessage({ kind: "present-close" }, "B");
    check("present-close from a NON-presenter peer is rejected", P.active === true);

    // The real presenter "A" closes -> must work.
    P.handleMessage({ kind: "present-close" }, "A");
    check("present-close from the presenter closes the overlay", P.active === false);

    // A peer "B" cannot hijack a presentation you are watching from "A".
    P.handleMessage({ kind: "present-start", id: "f2", name: "y.png", type: "image/png", total: 1 }, "A");
    P.handleMessage({ kind: "present-chunk", id: "f2", seq: 0, data: SDZCrypto.toB64(new Uint8Array([66])) }, "A");
    P.handleMessage({ kind: "present-end", id: "f2" }, "A");
    P.handleMessage({ kind: "present-start", id: "f3", name: "evil.png", type: "image/png", total: 1 }, "B");
    P.handleMessage({ kind: "present-chunk", id: "f3", seq: 0, data: SDZCrypto.toB64(new Uint8Array([67])) }, "B");
    P.handleMessage({ kind: "present-end", id: "f3" }, "B"); // hijack attempt
    check("a different peer cannot hijack the overlay you're watching", P.active === true);
    P.handleMessage({ kind: "present-close" }, "A"); // cleanup

    globalThis.document = savedDoc;
    globalThis.URL = savedURL;
  }

  console.log("\nSECURITY-AUDIT P2 — receiver clamps on attacker-controlled total/seq:");
  {
    const presentSrc3 = fs.readFileSync(path.join(__dirname, "..", "content", "present.js"), "utf8");
    const panelSrc2 = fs.readFileSync(path.join(__dirname, "..", "content", "panel.js"), "utf8");
    check("present.js clamps present-start total", /obj\.total > MAX_CHUNKS/.test(presentSrc3));
    check("present.js bounds present-chunk seq", /obj\.seq < t\.total/.test(presentSrc3));
    check("panel.js clamps file-start total", /obj\.total > MAX_CHUNKS/.test(panelSrc2));
    check("panel.js bounds file-chunk seq", /obj\.seq >= t\.total/.test(panelSrc2));

    // behavioral: an out-of-range total must be rejected (no overlay opens, no alloc).
    const stubEl = () => ({ className: "", textContent: "", src: "", alt: "", controls: false, dataset: {}, style: {}, appendChild() {}, addEventListener() {}, removeEventListener() {}, remove() {}, classList: { toggle() {}, add() {}, remove() {} } });
    const sDoc = globalThis.document, sURL = globalThis.URL;
    globalThis.document = { createElement: stubEl, documentElement: { appendChild() {} }, addEventListener() {}, removeEventListener() {} };
    globalThis.URL = { createObjectURL: () => "blob:stub", revokeObjectURL() {} };
    const P = globalThis.window.SDZPresent;
    P.handleMessage({ kind: "present-start", id: "big", name: "x.png", type: "image/png", total: 1e6 }, "A"); // > MAX_CHUNKS
    P.handleMessage({ kind: "present-chunk", id: "big", seq: 0, data: SDZCrypto.toB64(new Uint8Array([65])) }, "A");
    P.handleMessage({ kind: "present-end", id: "big" }, "A");
    check("present-start with out-of-range total is rejected (no overlay)", P.active === false);
    globalThis.document = sDoc;
    globalThis.URL = sURL;
  }

  console.log("\nSECURITY-AUDIT P4/P5/P6 — service worker, manifest CSP, blob-MIME:");
  {
    const swSrc = fs.readFileSync(path.join(__dirname, "..", "background", "service-worker.js"), "utf8");
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
    const panelSrc = fs.readFileSync(path.join(__dirname, "..", "content", "panel.js"), "utf8");
    const presentSrc = fs.readFileSync(path.join(__dirname, "..", "content", "present.js"), "utf8");
    // P4
    check("SW rejects ports from a foreign extension id", /port\.sender\.id !== chrome\.runtime\.id/.test(swSrc));
    check("SW caps concurrent signaling sockets", /openSockets >= MAX_SOCKETS/.test(swSrc));
    // P5
    check("manifest declares a content_security_policy", !!(manifest.content_security_policy && manifest.content_security_policy.extension_pages));
    check("manifest CSP restricts script-src to self", /script-src 'self'/.test((manifest.content_security_policy || {}).extension_pages || ""));
    // P6 wiring
    check("panel.js sanitizes blob MIME (safeMime)", /new Blob\(\[all\], \{ type: safeMime/.test(panelSrc));
    check("present.js sanitizes blob MIME (safeMime)", /type: safeMime\(type\)/.test(presentSrc));
    // P6 logic — replicate the shared allowlist (kept in lockstep with the source)
    const SAFE_MIME = /^(image\/(png|jpe?g|gif|webp|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|mp4|ogg|wav|webm)|application\/pdf)$/;
    const safeMime = (t) => { t = String(t || "").toLowerCase().split(";")[0].trim(); return SAFE_MIME.test(t) ? t : "application/octet-stream"; };
    check("safeMime: text/html -> octet-stream", safeMime("text/html") === "application/octet-stream");
    check("safeMime: image/svg+xml -> octet-stream (svg can script)", safeMime("image/svg+xml") === "application/octet-stream");
    check("safeMime: image/png preserved", safeMime("image/png") === "image/png");
    check("safeMime: application/pdf preserved", safeMime("application/pdf") === "application/pdf");
    check("safeMime: video/mp4 preserved", safeMime("video/mp4") === "video/mp4");
  }

  console.log("\nSECURITY-AUDIT H2 — convenience-mode confirm (UX; browser-retest owed):");
  {
    const panelSrc = fs.readFileSync(path.join(__dirname, "..", "content", "panel.js"), "utf8");
    check("blank Join requires an explicit convenience confirm", /!passphrase && !convenienceConfirmed/.test(panelSrc));
    check("passphrase placeholder no longer silently invites blank", !/leave blank = convenience mode/.test(panelSrc));
  }

  console.log("\nRoom safe-word (light key-confirmation fingerprint):");
  {
    const fp1 = await SDZCrypto.roomFingerprint("otter", "room-A");
    const fp1b = await SDZCrypto.roomFingerprint("otter", "room-A");
    check("safe-word is deterministic (same passphrase+room)", fp1 === fp1b);
    check("safe-word renders 5 emoji", fp1.split(" ").filter(Boolean).length === 5);
    check("different passphrase -> different safe-word", fp1 !== (await SDZCrypto.roomFingerprint("otterX", "room-A")));
    check("different room -> different safe-word", fp1 !== (await SDZCrypto.roomFingerprint("otter", "room-B")));
    const conv = await SDZCrypto.roomFingerprint("", "room-A");
    check("convenience-mode safe-word deterministic + != passphrase one", conv === (await SDZCrypto.roomFingerprint("", "room-A")) && conv !== fp1);
  }

  console.log("\nManual connect-code signaling (codec — orchestration is browser-test-owed):");
  {
    // manual-signal.js only touches RTCPeerConnection / SDZTransport INSIDE the
    // handshake functions (not called here), so loading + the codec are pure.
    // window shim already set above; btoa/atob are Node 22 globals.
    const manualSrc = fs.readFileSync(path.join(__dirname, "..", "content", "manual-signal.js"), "utf8");
    vm.runInThisContext(manualSrc, { filename: "manual-signal.js" });
    const M = globalThis.window.SDZManual;
    check("SDZManual exposed with codec", !!M && typeof M.encodeConnectCode === "function");

    const offer = { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\na=ice-ufrag:abcd\r\n" };
    const code = M.encodeConnectCode(offer);
    check("offer code carries the SDZ1. marker", /^SDZ1\./.test(code));
    const round = M.decodeConnectCode(code);
    check("encode->decode round-trips type", round.type === "offer");
    check("encode->decode round-trips sdp byte-exactly", round.sdp === offer.sdp);
    check("answer code decodes as answer", M.decodeConnectCode(M.encodeConnectCode({ type: "answer", sdp: "v=0\r\n" })).type === "answer");

    // Tolerates whitespace/line-wraps a chat client may insert mid-paste.
    const wrapped = code.slice(0, 20) + "\n   " + code.slice(20);
    check("decode tolerates injected whitespace/newlines", M.decodeConnectCode(wrapped).sdp === offer.sdp);

    // Rejects malformed input with a clear throw (not a silent bad connection).
    const throws = (fn) => { try { fn(); return false; } catch { return true; } };
    check("decode rejects a non-connect-code", throws(() => M.decodeConnectCode("hello, paste me")));
    check("decode rejects a corrupted code", throws(() => M.decodeConnectCode("SDZ1.!!!notbase64!!!")));
    check("decode rejects a wrong-type payload", throws(() => M.decodeConnectCode("SDZ1." + Buffer.from('{"v":1,"t":"nope","s":"x"}').toString("base64"))));
  }

  console.log("\nF2/F3 room-honesty contracts (verification 2026-07-19):");
  {
    const txSrc = fs.readFileSync(path.join(__dirname, "..", "content", "transcribe.js"), "utf8");
    const panelSrc = fs.readFileSync(path.join(__dirname, "..", "content", "panel.js"), "utf8");
    // F2: transcription must broadcast its on/off status — and ONLY status
    // (no transcript content path may reach the transport).
    check("transcribe.js broadcasts tx-status on/off (F2)", /kind:\s*"tx-status"/.test(txSrc) && /broadcastStatus\(true\)/.test(txSrc) && /broadcastStatus\(false\)/.test(txSrc));
    check("transcribe.js sends NO transcript content over transport (F2)", !/send\(\{[^}]*(body|text|transcript|line)/.test(txSrc));
    check("panel.js renders incoming tx-status (F2)", /case "tx-status":/.test(panelSrc) && /transcription ON/.test(panelSrc));
    // F3: convenience mode must not present the safe-word as a privacy signal.
    check("safe-word relabeled in convenience mode (F3)", /Room check \(no passphrase\)/.test(panelSrc) && /NOTHING about privacy/.test(panelSrc));
  }

  console.log("\nWhiteboard wire protocol (stroke/undo/clear state machine — DOM rendering is browser-test-owed):");
  {
    // whiteboard.js touches the DOM only inside open()/toolbar code paths; the
    // handleMessage state machine is guarded so state accumulates headlessly.
    const wbSrc = fs.readFileSync(path.join(__dirname, "..", "content", "whiteboard.js"), "utf8");
    vm.runInThisContext(wbSrc, { filename: "whiteboard.js" });
    const WB = globalThis.window.SDZWhiteboard;
    check("SDZWhiteboard exposed with handleMessage + undo", !!WB && typeof WB.handleMessage === "function" && typeof WB.undo === "function");

    const seg = (path, n) => ({ x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 + n / 100, color: "#ef4444", width: 4, eraser: false, path });
    check("wb-stroke frames accumulate", WB.handleMessage({ kind: "wb-stroke", stroke: seg("p-aaa", 1) }) && WB.handleMessage({ kind: "wb-stroke", stroke: seg("p-aaa", 2) }) && WB.strokeCount === 2);
    WB.handleMessage({ kind: "wb-stroke", stroke: seg("p-bbb", 3) });
    check("malformed wb-stroke consumed but ignored", WB.handleMessage({ kind: "wb-stroke", stroke: "nope" }) && WB.strokeCount === 3);
    check("wb-undo removes exactly that gesture's segments", WB.handleMessage({ kind: "wb-undo", path: "p-aaa" }) && WB.strokeCount === 1);
    check("wb-undo for unknown path is a no-op", WB.handleMessage({ kind: "wb-undo", path: "p-zzz" }) && WB.strokeCount === 1);
    check("malformed wb-undo consumed but ignored", WB.handleMessage({ kind: "wb-undo", path: 42 }) && WB.handleMessage({ kind: "wb-undo" }) && WB.strokeCount === 1);
    check("undo() with no own gestures is a no-op", (WB.undo(), WB.strokeCount === 1));
    check("wb-clear zeroes the board", WB.handleMessage({ kind: "wb-clear" }) && WB.strokeCount === 0);
    check("non-wb kinds are not consumed", WB.handleMessage({ kind: "text", body: "hi" }) === false);

    // Flood guard (SECURITY-AUDIT P1/P2): cap holds under a stroke flood.
    for (let i = 0; i < 5100; i++) WB.handleMessage({ kind: "wb-stroke", stroke: seg("p-flood", i) });
    check("stroke flood rolls off at the 5000 cap", WB.strokeCount === 5000);
    WB.handleMessage({ kind: "wb-clear" });
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) {
    console.log("FAILURES:", fails.join("; "));
    process.exit(1);
  }
})();
