// skool-dropzone — manual ("connect-code") signaling — NO SERVER.
//
// The zero-infrastructure signaling backend. Two browsers form a direct,
// E2EE peer-to-peer link by copy-pasting two short codes to each other through
// any channel they already share (the Skool meeting chat, a DM, anything):
//
//   Peer A (initiator):  createOffer()        -> OFFER code   --hand to B-->
//   Peer B (joiner):     acceptOffer(offer)   -> ANSWER code  --hand to A-->
//   Peer A:              acceptAnswer(answer)  -> connected, P2P
//
// No relay, no STUN-server-we-run, no cost to anyone. (Public STUN from
// transport.js's RTC_CONFIG is still used for NAT discovery — it's free and
// only sees address-discovery traffic.) Symmetric-NAT pairs that STUN can't
// traverse still won't connect without TURN; that's the accepted trade.
//
// Unlike the relay path, this is NON-TRICKLE: we wait for ICE gathering to
// finish and bake all candidates into the single SDP that the code carries,
// because there's no channel to trickle later candidates over.
//
// Once the channel is open this hands the peer to SDZTransport.attachManualPeer,
// so the existing E2EE send / file-transfer / message pipeline is reused as-is.

(() => {
  const PREFIX = "SDZ1."; // human-recognizable connect-code marker + version
  let pendingPc = null; // initiator holds its pc between createOffer + acceptAnswer

  function rtcConfig() {
    return (window.SDZTransport && window.SDZTransport.rtcConfig) || { iceServers: [] };
  }

  // --- connect-code codec (pure; unit-tested in node-verify.js) ---

  function encodeConnectCode(desc) {
    // desc: { type: "offer"|"answer", sdp: string }. SDP is ASCII, so btoa is safe.
    const json = JSON.stringify({ v: 1, t: desc.type, s: desc.sdp });
    return PREFIX + btoa(json);
  }

  function decodeConnectCode(code) {
    // Tolerate whitespace/line-wraps a chat client may have inserted.
    const cleaned = String(code || "").replace(/\s+/g, "");
    if (!cleaned.startsWith(PREFIX)) {
      throw new Error("That doesn't look like a skool-dropzone connect code.");
    }
    let obj;
    try {
      obj = JSON.parse(atob(cleaned.slice(PREFIX.length)));
    } catch {
      throw new Error("Connect code is corrupted or incomplete — copy the whole thing.");
    }
    if (!obj || (obj.t !== "offer" && obj.t !== "answer") || typeof obj.s !== "string") {
      throw new Error("Connect code is not a valid offer/answer.");
    }
    return { type: obj.t, sdp: obj.s };
  }

  // --- ICE gathering: wait for "complete", but never hang forever ---

  function waitForIce(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      let timer = null;
      const finish = () => {
        pc.removeEventListener("icegatheringstatechange", onChange);
        if (timer) clearTimeout(timer);
        resolve();
      };
      const onChange = () => {
        if (pc.iceGatheringState === "complete") finish();
      };
      pc.addEventListener("icegatheringstatechange", onChange);
      // Some networks never report "complete"; ship the candidates we have after 3s.
      timer = setTimeout(finish, 3000);
    });
  }

  function newRemoteId() {
    return (
      "manual-" +
      ((crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2))
    );
  }

  // --- the three-step handshake ---

  // Initiator step 1 — returns the OFFER code to hand to the other person.
  async function createOffer({ passphrase, room, onMessage, onStatus } = {}) {
    const pc = new RTCPeerConnection(rtcConfig());
    pendingPc = pc;
    const dc = pc.createDataChannel("sdz");
    await window.SDZTransport.attachManualPeer({
      pc,
      dc,
      remoteId: newRemoteId(),
      passphrase,
      room,
      onMessage,
      onStatus,
    });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);
    return encodeConnectCode(pc.localDescription);
  }

  // Joiner — paste the OFFER code, get back an ANSWER code to send to the initiator.
  async function acceptOffer(offerCode, { passphrase, room, onMessage, onStatus } = {}) {
    const { type, sdp } = decodeConnectCode(offerCode);
    if (type !== "offer") {
      throw new Error("That's an ANSWER code — the OFFER goes here. Swap who pastes what.");
    }
    const pc = new RTCPeerConnection(rtcConfig());
    // The joiner RECEIVES the data channel the initiator created.
    pc.ondatachannel = (e) => {
      window.SDZTransport.attachManualPeer({
        pc,
        dc: e.channel,
        remoteId: newRemoteId(),
        passphrase,
        room,
        onMessage,
        onStatus,
      });
    };
    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc);
    return encodeConnectCode(pc.localDescription);
  }

  // Initiator step 2 — paste the ANSWER code to finish connecting.
  async function acceptAnswer(answerCode) {
    if (!pendingPc) {
      throw new Error("No pending connection — create an offer first.");
    }
    const { type, sdp } = decodeConnectCode(answerCode);
    if (type !== "answer") {
      throw new Error("That's an OFFER code — the ANSWER goes here.");
    }
    await pendingPc.setRemoteDescription({ type: "answer", sdp });
    pendingPc = null;
  }

  window.SDZManual = {
    createOffer,
    acceptOffer,
    acceptAnswer,
    // exported for tests
    encodeConnectCode,
    decodeConnectCode,
  };
})();
