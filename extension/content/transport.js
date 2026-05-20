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

  async function init({ passphrase, onMessage, onStatus }) {
    if (joined) return;
    room = meetingId();
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

  window.SDZTransport = {
    init,
    send,
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
