// skool-dropzone — engagement module: reactions + polls (Phase 9)
//
// Pure state machine, DOM-free — panel.js owns all rendering and subscribes
// via SDZEngage.onEvent. Keeping the logic here makes vote-dedup, sender-bound
// close, and the flood caps verifiable in the node harness.
//
// Wire protocol (via SDZTransport.send, E2EE):
//   react      {emoji}                       — transient reaction (allowlist)
//   poll-start {id, q, opts:[...]}           — open a poll
//   poll-vote  {id, opt}                     — vote; one live vote per peer,
//                                              re-vote replaces (last wins)
//   poll-close {id}                          — CREATOR-BOUND (same rule as
//                                              present-close, SECURITY-AUDIT P1)
//
// Public API (window.SDZEngage):
//   REACTIONS                                — the emoji allowlist
//   handleMessage(obj, fromPeer) -> bool
//   createPoll(q, opts) -> frame|null        — caller sends frame; state updated
//   vote(id, opt)       -> frame|null        —   "
//   closePoll(id)       -> frame|null        — null unless the poll is mine
//   getPoll(id) / list()                     — render-friendly snapshots
//   onEvent = (ev) => {}                     — {type:"react"|"poll-new"|"poll-update"|"poll-closed", ...}

(() => {
  const REACTIONS = ["👍", "❤️", "😂", "🎉", "👏", "🤯"];

  // Receive-side clamps (SECURITY-AUDIT P2 spirit: never trust wire counts).
  const MAX_POLLS = 50;
  const MAX_OPTS = 6;
  const MIN_OPTS = 2;
  const MAX_Q_LEN = 200;
  const MAX_OPT_LEN = 80;
  const SELF = "me"; // local voter/creator key — never travels on the wire

  const polls = new Map(); // id -> {q, opts, votes:Map(voter->optIdx), creator, open, mine}
  let pollSeq = 0;

  function emit(ev) {
    try {
      if (typeof api.onEvent === "function") api.onEvent(ev);
    } catch {
      /* renderer errors never corrupt state */
    }
  }

  function snapshot(id) {
    const p = polls.get(id);
    if (!p) return null;
    const counts = new Array(p.opts.length).fill(0);
    p.votes.forEach((optIdx) => counts[optIdx]++);
    return {
      id,
      q: p.q,
      opts: p.opts.slice(),
      counts,
      total: p.votes.size,
      open: p.open,
      mine: p.mine,
      myVote: p.votes.has(SELF) ? p.votes.get(SELF) : null,
    };
  }

  function validPollShape(q, opts) {
    return (
      typeof q === "string" &&
      q.trim().length > 0 &&
      q.length <= MAX_Q_LEN &&
      Array.isArray(opts) &&
      opts.length >= MIN_OPTS &&
      opts.length <= MAX_OPTS &&
      opts.every((o) => typeof o === "string" && o.trim().length > 0 && o.length <= MAX_OPT_LEN)
    );
  }

  // === local actions (caller broadcasts the returned frame) ===

  function createPoll(q, opts) {
    q = String(q || "").trim();
    opts = (opts || []).map((o) => String(o || "").trim()).filter(Boolean);
    if (!validPollShape(q, opts) || polls.size >= MAX_POLLS) return null;
    const id = "poll-" + ++pollSeq + "-" + Math.random().toString(36).slice(2, 8);
    polls.set(id, { q, opts, votes: new Map(), creator: SELF, open: true, mine: true });
    emit({ type: "poll-new", poll: snapshot(id) });
    return { kind: "poll-start", id, q, opts };
  }

  function vote(id, opt) {
    const p = polls.get(id);
    if (!p || !p.open || !Number.isInteger(opt) || opt < 0 || opt >= p.opts.length) return null;
    p.votes.set(SELF, opt);
    emit({ type: "poll-update", poll: snapshot(id) });
    return { kind: "poll-vote", id, opt };
  }

  function closePoll(id) {
    const p = polls.get(id);
    if (!p || !p.mine || !p.open) return null; // only the creator closes (local side)
    p.open = false;
    emit({ type: "poll-closed", poll: snapshot(id) });
    return { kind: "poll-close", id };
  }

  // === wire handler ===

  function handleMessage(obj, fromPeer) {
    if (!obj || !obj.kind) return false;
    const voter = fromPeer || "peer-unknown";

    if (obj.kind === "react") {
      // Allowlist, not escape: a reaction is one of six glyphs or nothing.
      if (REACTIONS.includes(obj.emoji)) emit({ type: "react", emoji: obj.emoji });
      return true;
    }

    if (obj.kind === "poll-start") {
      if (typeof obj.id !== "string" || !obj.id || polls.has(obj.id)) return true; // dup/malformed: ignore
      if (!validPollShape(obj.q, obj.opts)) return true;
      if (polls.size >= MAX_POLLS) return true;
      polls.set(obj.id, {
        q: obj.q,
        opts: obj.opts.slice(0, MAX_OPTS),
        votes: new Map(),
        creator: voter,
        open: true,
        mine: false,
      });
      emit({ type: "poll-new", poll: snapshot(obj.id) });
      return true;
    }

    if (obj.kind === "poll-vote") {
      const p = polls.get(obj.id);
      if (!p || !p.open) return true;
      if (!Number.isInteger(obj.opt) || obj.opt < 0 || obj.opt >= p.opts.length) return true;
      p.votes.set(voter, obj.opt); // Map keying = dedup; re-vote replaces
      emit({ type: "poll-update", poll: snapshot(obj.id) });
      return true;
    }

    if (obj.kind === "poll-close") {
      const p = polls.get(obj.id);
      if (!p || !p.open) return true;
      // Sender-bound: only the peer that STARTED the poll may close it —
      // same ownership rule the P1 audit fix gave present-close.
      if (p.creator !== voter) return true;
      p.open = false;
      emit({ type: "poll-closed", poll: snapshot(obj.id) });
      return true;
    }

    return false;
  }

  const api = {
    REACTIONS: REACTIONS.slice(),
    handleMessage,
    createPoll,
    vote,
    closePoll,
    getPoll: snapshot,
    list: () => Array.from(polls.keys()).map(snapshot),
    onEvent: null,
  };
  window.SDZEngage = api;
})();
