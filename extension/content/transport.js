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
  // STUN lets peers behind NAT / home routers discover a publicly reachable
  // address so they can form a DIRECT peer-to-peer link. Public Google STUN is
  // free and stateless — it sees only address-discovery traffic, never content.
  // Same-machine two-tab still works without it (host candidates), so this is
  // additive, not a behavior change for the local case.
  //
  // NOT covered: symmetric-NAT pairs that STUN can't traverse need a TURN
  // server, which RELAYS the media/data (a real bandwidth cost). TURN is not
  // bundled yet — a small fraction of strict-NAT users won't connect until it
  // is. See feat/hosted-relay notes / ROADMAP.
  const RTC_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  const peerId =
    (crypto.randomUUID && crypto.randomUUID()) ||
    "p" + Math.random().toString(36).slice(2);

  const peers = new Map(); // remotePeerId -> { pc, dc }
  let port = null;
  let key = null;
  let room = null;
  let baseRoom = null; // the meeting-level room; breakout rooms derive from it
  let passphraseSaved = null; // reused on switchRoom so breakouts inherit the room key input
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
    baseRoom = room;
    passphraseSaved = passphrase || "";
    onMessageCb = onMessage;
    onStatusCb = onStatus;
    key = await window.SDZCrypto.deriveKey(passphrase || "", room);
    joined = true;
    connectSignaling();
  }

  // === Phase 10: breakout rooms ===
  // A breakout is a DERIVED room: signaling room = base + "#b:" + name, and the
  // crypto key re-derives with that salted room id (deriveKey binds room into
  // the KDF), so breakout traffic is undecryptable to the main room and vice
  // versa — a real mesh split, not a filter. Honest scope: breakouts are
  // SEPARATION, not secrecy — every main-room member holds the same passphrase
  // and can join any breakout, exactly like walking into a physical breakout
  // room. suffix=null returns to the main room.
  async function switchRoom({ suffix }) {
    if (!joined) return false;
    const nextRoom = suffix ? baseRoom + "#b:" + suffix : baseRoom;
    if (nextRoom === room) return false;
    // teardown: close every peer + the signaling port for the old room
    peers.forEach((e) => {
      try {
        e.pc.close();
      } catch {}
    });
    peers.clear();
    if (port) {
      try {
        port.disconnect();
      } catch {}
      port = null;
    }
    room = nextRoom;
    key = await window.SDZCrypto.deriveKey(passphraseSaved, room);
    emitStatus({ state: "waiting" });
    connectSignaling();
    return true;
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
    const entry = { pc, dc: null };
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
    dc.onopen = () => emitStatus({ state: "connected" });
    dc.onclose = () => emitStatus({});
    dc.onmessage = async (e) => {
      try {
        const payload = JSON.parse(e.data);
        const text = await window.SDZCrypto.decryptText(key, payload);
        const obj = JSON.parse(text);
        onMessageCb && onMessageCb(obj, remoteId);
      } catch (err) {
        // Most common cause: peers used different passphrases.
        console.warn("[SDZTransport] could not decrypt message (passphrase mismatch?)", err);
        onMessageCb && onMessageCb({ kind: "undecryptable" }, remoteId);
      }
    };
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

  // Manual ("connect-code") signaling reuses this transport's E2EE + data-channel
  // + file-transfer machinery. manual-signal.js builds the RTCPeerConnection and
  // runs the copy-paste SDP exchange, then hands the peer here so send() /
  // sendFile() / message decryption all work identically to the relay path.
  async function attachManualPeer({ pc, dc, remoteId, passphrase, room: roomOverride, onMessage, onStatus }) {
    if (onMessage) onMessageCb = onMessage;
    if (onStatus) onStatusCb = onStatus;
    if (!key) {
      room = roomOverride || meetingId();
      key = await window.SDZCrypto.deriveKey(passphrase || "", room);
    }
    const id = remoteId || "manual-" + Math.random().toString(36).slice(2);
    const entry = { pc, dc: null };
    peers.set(id, entry);
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) emitStatus({});
    };
    setupDataChannel(id, dc); // sets entry.dc + dc.onopen/onmessage (emits "connected")
    joined = true;
  }

  function removePeer(remoteId) {
    const entry = peers.get(remoteId);
    if (entry) {
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
      if (e.dc && e.dc.readyState === "open") n++;
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
      if (e.dc && e.dc.readyState === "open") e.dc.send(wire);
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
    switchRoom,
    attachManualPeer,
    get rtcConfig() {
      return RTC_CONFIG; // shared so the manual signaling path uses the same STUN config
    },
    get room() {
      return room; // the resolved room/meetingId actually used (for the safe-word)
    },
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
