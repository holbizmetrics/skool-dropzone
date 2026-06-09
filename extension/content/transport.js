// skool-dropzone — WebRTC transport (Phase 2)
//
// Establishes E2EE peer-to-peer data channels with everyone on the same
// Skool meeting URL. Signaling (SDP/ICE) goes through the background SW →
// localhost relay. Message content is encrypted with SDZCrypto before it
// touches the data channel, so neither the relay nor any TURN can read it.
//
// Glare avoidance: the JOINING peer initiates offers to all existing peers.
// Existing peers wait for the offer. Small-room mesh (fine up to ~10).

(() => {
  // Localhost mesh connects via host candidates — no STUN/TURN needed.
  // (Production over the internet will add a STUN server here.)
  const RTC_CONFIG = { iceServers: [] };

  // Admission handshake (SECURITY-AUDIT H1): a peer must prove it holds the room
  // key (by sending a frame we can decrypt) within this window, or we drop it
  // from the mesh. Until proven, we send it no app content. This makes the
  // passphrase an ADMISSION boundary, not just a confidentiality layer.
  const AUTH_TIMEOUT_MS = 8000;

  const peerId =
    (crypto.randomUUID && crypto.randomUUID()) ||
    "p" + Math.random().toString(36).slice(2);

  const peers = new Map(); // remotePeerId -> { pc, dc }
  let port = null;
  let key = null;
  let room = null;
  let onMessageCb = null;
  let onStatusCb = null;
  let joined = false;

  function meetingId() {
    const m = location.pathname.match(/\/live\/([^/?#]+)/);
    return m ? m[1] : "unknown";
  }

  async function init({ passphrase, onMessage, onStatus, room: roomOverride }) {
    if (joined) return;
    // roomOverride lets the dev test harness use a fixed room without a
    // /live/<id> URL. In production (content script) it derives from the URL.
    room = roomOverride || meetingId();
    onMessageCb = onMessage;
    onStatusCb = onStatus;
    key = await window.SDZCrypto.deriveKey(passphrase || "", room);
    joined = true;
    connectSignaling();
  }

  function connectSignaling() {
    port = chrome.runtime.connect({ name: "sdz-signaling" });
    port.onMessage.addListener(handleSignal);
    port.onDisconnect.addListener(() => emitStatus({ state: "signaling-disconnected" }));
    port.postMessage({ type: "connect" });
  }

  function handleSignal(msg) {
    switch (msg.type) {
      case "ws-open":
        port.postMessage({ type: "join", room, peerId });
        emitStatus({ state: "waiting" });
        break;
      case "ws-closed":
        emitStatus({ state: "signaling-closed" });
        break;
      case "ws-error":
        emitStatus({ state: "signaling-error" });
        break;
      case "peers":
        // Existing peers — we initiate to each.
        (msg.peers || []).forEach((id) => createPeer(id, true));
        break;
      case "peer-joined":
        // They will initiate to us; nothing to do until their offer.
        break;
      case "peer-left":
        removePeer(msg.peerId);
        break;
      case "signal":
        onRemoteSignal(msg.from, msg.data);
        break;
    }
  }

  function createPeer(remoteId, initiator) {
    if (peers.has(remoteId)) return peers.get(remoteId);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const entry = { pc, dc: null, authed: false, authTimer: null };
    peers.set(remoteId, entry);

    pc.onicecandidate = (e) => {
      if (e.candidate) signal(remoteId, { candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        emitStatus({});
      }
    };

    if (initiator) {
      const dc = pc.createDataChannel("sdz");
      setupDataChannel(remoteId, dc);
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() => offer))
        .then((offer) => signal(remoteId, { sdp: offer }))
        .catch((err) => console.error("[SDZTransport] offer failed:", err));
    } else {
      pc.ondatachannel = (e) => setupDataChannel(remoteId, e.channel);
    }
    return entry;
  }

  function setupDataChannel(remoteId, dc) {
    const entry = peers.get(remoteId);
    if (entry) entry.dc = dc;
    dc.onopen = () => {
      // Prove WE hold the key (the peer admits us on its side), and start the
      // clock for the peer to prove the same. Do NOT emit "connected" yet — that
      // waits until the peer is admitted.
      sendRaw(dc, { kind: "__sdz-hello" });
      if (entry) {
        entry.authTimer = setTimeout(() => {
          if (!entry.authed) {
            console.warn("[SDZTransport] peer failed key-proof in time; dropping", remoteId);
            removePeer(remoteId);
          }
        }, AUTH_TIMEOUT_MS);
      }
    };
    dc.onclose = () => emitStatus({});
    dc.onmessage = async (e) => {
      try {
        const payload = JSON.parse(e.data);
        const text = await window.SDZCrypto.decryptText(key, payload);
        const obj = JSON.parse(text);
        // A successful decrypt proves this peer holds the room key — admit it.
        if (entry && !entry.authed) {
          entry.authed = true;
          if (entry.authTimer) {
            clearTimeout(entry.authTimer);
            entry.authTimer = null;
          }
          emitStatus({ state: "connected" });
        }
        if (obj && obj.kind === "__sdz-hello") return; // admission frame, not app content
        onMessageCb && onMessageCb(obj, remoteId);
      } catch (err) {
        // Undecryptable -> the peer does NOT prove the key; it is never admitted
        // and the auth timer will drop it. Benign cause: passphrase mismatch.
        console.warn("[SDZTransport] could not decrypt message (passphrase mismatch?)", err);
        onMessageCb && onMessageCb({ kind: "undecryptable" }, remoteId);
      }
    };
  }

  // Encrypt + send one frame straight to a channel, bypassing the authed gate.
  // Used only for the admission hello — a peer can't be authed before it proves
  // the key, so the hello itself must not be gated on auth.
  async function sendRaw(dc, obj) {
    if (!key || !dc || dc.readyState !== "open") return;
    try {
      const payload = await window.SDZCrypto.encrypt(key, JSON.stringify(obj));
      dc.send(JSON.stringify(payload));
    } catch (err) {
      console.error("[SDZTransport] hello send failed:", err);
    }
  }

  async function onRemoteSignal(remoteId, data) {
    let entry = peers.get(remoteId);
    if (!entry) entry = createPeer(remoteId, false);
    const pc = entry.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signal(remoteId, { sdp: answer });
        }
      } else if (data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (err) {
      console.error("[SDZTransport] signal handling failed:", err);
    }
  }

  function signal(to, data) {
    if (port) port.postMessage({ type: "signal", to, data });
  }

  function removePeer(remoteId) {
    const entry = peers.get(remoteId);
    if (entry) {
      if (entry.authTimer) {
        clearTimeout(entry.authTimer);
        entry.authTimer = null;
      }
      try {
        entry.pc.close();
      } catch {}
      peers.delete(remoteId);
    }
    emitStatus({});
  }

  function connectedCount() {
    let n = 0;
    peers.forEach((e) => {
      // Count only admitted peers — a connected-but-unproven peer isn't "in".
      if (e.authed && e.dc && e.dc.readyState === "open") n++;
    });
    return n;
  }

  function emitStatus(extra) {
    if (onStatusCb) onStatusCb(Object.assign({ peers: connectedCount() }, extra));
  }

  async function send(obj) {
    if (!key) return;
    const payload = await window.SDZCrypto.encrypt(key, JSON.stringify(obj));
    const wire = JSON.stringify(payload);
    peers.forEach((e) => {
      // Only send app content to peers that have proven the room key (H1).
      if (e.authed && e.dc && e.dc.readyState === "open") e.dc.send(wire);
    });
  }

  // === Phase 4: chunked file transfer with backpressure ===

  const CHUNK_BYTES = 16 * 1024; // raw bytes per chunk (base64 ~+33% on the wire)
  const MAX_BUFFERED = 1024 * 1024; // pause sending if a channel buffers > 1MB

  function anyChannelBusy() {
    let busy = false;
    peers.forEach((e) => {
      if (e.dc && e.dc.readyState === "open" && e.dc.bufferedAmount > MAX_BUFFERED) busy = true;
    });
    return busy;
  }

  function waitForDrain() {
    return new Promise((resolve) => {
      const check = () => (anyChannelBusy() ? setTimeout(check, 50) : resolve());
      check();
    });
  }

  // Reads a File, chunks + encrypts + sends it to all peers. Returns the
  // transfer id. onProgress(fraction 0..1) fires per chunk.
  //
  // prefix selects the wire frame family: "file" (default — Phase 4 chat
  // transfer, routed by panel/harness) or "present" (Phase 5 — routed by
  // SDZPresent.handleMessage so viewers open the fullscreen overlay). The
  // receiver discriminates on the kind, so the prefix MUST match what the
  // intended handler listens for, or the file silently lands in the wrong UI.
  async function sendFile(file, onProgress, prefix = "file") {
    const id =
      (crypto.randomUUID && crypto.randomUUID()) || "f" + Math.random().toString(36).slice(2);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const total = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));

    await send({ kind: prefix + "-start", id, name: file.name, size: file.size, type: file.type, total });
    for (let i = 0; i < total; i++) {
      if (anyChannelBusy()) await waitForDrain();
      const slice = bytes.subarray(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, bytes.length));
      await send({ kind: prefix + "-chunk", id, seq: i, data: window.SDZCrypto.toB64(slice) });
      if (onProgress) onProgress((i + 1) / total);
    }
    await send({ kind: prefix + "-end", id });
    return id;
  }

  window.SDZTransport = {
    init,
    send,
    sendFile,
    get peerId() {
      return peerId;
    },
    get count() {
      return connectedCount();
    },
    get joined() {
      return joined;
    },
  };
})();
