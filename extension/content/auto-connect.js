// skool-dropzone — automatic connecting over Skool's own in-call message channel.
//
// The connect codes of manual-signal.js, carried automatically instead of by
// copy-paste. Everyone in the Skool call who runs skool-dropzone AND typed the
// same passphrase finds each other with no server of ours and no clicks beyond
// "Join room".
//
// Rules this owns (each one is tested in node-verify.js):
//   1. Only peers with the same ROOM TAG pair. The tag is the room safe-word
//      (derived from passphrase + meeting id, the 5 emoji people already compare
//      out loud), so a different passphrase never even gets an offer.
//   2. Exactly ONE side of every pair makes the offer: the lower bus id. Without
//      this both sides offer at once ("glare") and neither connection completes.
//   3. Messages addressed to someone else, malformed messages, and codes larger
//      than MAX_CODE are ignored without side effects.
//   4. A peer we are already connected or connecting to is not offered to again.
//
// What travels over Skool's channel: the hello and the connect codes (network
// addresses + session parameters). Chat, files, whiteboard never do: they go
// over the direct WebRTC link, encrypted with the passphrase key.
//
// Transport-agnostic on purpose: `publish` and the `manual` handshake are
// injected, so the protocol runs in node with fakes and in the page with the
// real bridge (skool-bridge.js) + SDZManual.

(function () {
  "use strict";

  const TOPIC = "sdz";
  const VERSION = 1;
  const MAX_CODE = 24000; // chars; a real code is a few KB. Larger = refuse, never forward.
  const MAX_MSG = 26000;

  function parse(raw) {
    if (typeof raw !== "string" || raw.length > MAX_MSG) return null;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!msg || msg.v !== VERSION || typeof msg.t !== "string" || typeof msg.tag !== "string") return null;
    if (!["hello", "offer", "answer"].includes(msg.t)) return null;
    if (msg.t !== "hello") {
      if (typeof msg.to !== "string" || typeof msg.code !== "string" || msg.code.length > MAX_CODE) return null;
    }
    return msg;
  }

  // deps: { myId, tag, publish(string), manual: { offer(peerId) -> Promise<code>,
  //         accept(peerId, offerCode) -> Promise<answerCode>, finish(peerId, answerCode) -> Promise },
  //         log?(text) }
  function create(deps) {
    const { myId, tag, publish, manual } = deps;
    const log = deps.log || function () {};
    const peers = new Map(); // peerId -> "offering" | "answering" | "connected" | "failed"
    let stopped = false;

    function send(obj) {
      if (stopped) return;
      publish(JSON.stringify(Object.assign({ v: VERSION, tag }, obj)));
    }

    function hello() {
      send({ t: "hello" });
    }

    async function offerTo(peerId) {
      peers.set(peerId, "offering");
      try {
        const code = await manual.offer(peerId);
        send({ t: "offer", to: peerId, code });
      } catch (e) {
        peers.set(peerId, "failed");
        log("offer to " + peerId + " failed: " + (e && e.message ? e.message : e));
      }
    }

    async function handle(raw, from) {
      if (stopped || typeof from !== "string" || !from || from === myId) return;
      const msg = parse(raw);
      if (!msg || msg.tag !== tag) return; // rule 1 + 3
      if (msg.t !== "hello" && msg.to !== myId) return; // rule 3: not for us
      const state = peers.get(from);

      if (msg.t === "hello") {
        if (state && state !== "failed") return; // rule 4
        if (myId < from) {
          await offerTo(from); // rule 2: lower id offers
        } else {
          hello(); // make sure the lower side knows we exist (it may have joined first)
        }
        return;
      }

      if (msg.t === "offer") {
        if (myId < from) return; // rule 2: we are the offerer for this pair; ignore a glare offer
        if (state === "answering" || state === "connected") return;
        peers.set(from, "answering");
        try {
          const answer = await manual.accept(from, msg.code);
          send({ t: "answer", to: from, code: answer });
          peers.set(from, "connected");
        } catch (e) {
          peers.set(from, "failed");
          log("answering " + from + " failed: " + (e && e.message ? e.message : e));
        }
        return;
      }

      if (msg.t === "answer") {
        if (state !== "offering") return; // an answer we never asked for
        try {
          await manual.finish(from, msg.code);
          peers.set(from, "connected");
        } catch (e) {
          peers.set(from, "failed");
          log("finishing " + from + " failed: " + (e && e.message ? e.message : e));
        }
      }
    }

    function stop() {
      stopped = true;
    }

    return { hello, handle, stop, peers, TOPIC };
  }

  const api = { create, parse, TOPIC, VERSION, MAX_CODE };
  if (typeof window !== "undefined") window.SDZAuto = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
