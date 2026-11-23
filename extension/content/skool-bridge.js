// skool-dropzone — bridge to Skool's in-call message channel (runs in the PAGE's
// own JavaScript world, "MAIN", because Skool's objects are not visible to an
// extension's isolated world).
//
// What it finds: Skool's live-call app (Agora since 2026-11) keeps an in-call
// signaling object inside its React tree. It is recognised by SHAPE, not by name:
// it has publish(topic, text), onMessage(topic, callback) and getState(), and
// getState().status === "connected" once the call is live. Messages arrive as
// { payload, publisher } where publisher is the sender's call id.
// (Technique learned from reading the public "Skool Extensions" 1.9.5 extension,
// which uses the same object with its own topic; this file is our own code.)
//
// What it does, and nothing else:
//   - relays messages on OUR topic ("sdz") to the extension via window.postMessage
//   - publishes on our topic when the extension asks
//   - reports ready (with our call id) / gone
// It never reads or sends on any other topic, and it never touches the call itself.
//
// Honest bound: this depends on Skool's internal structure. When Skool rebuilds,
// the object may not be found; the bridge then reports nothing, the panel says
// "Skool's call channel was not found", and connect-by-code still works.

(function () {
  "use strict";
  if (window.__sdzBridge) return;
  window.__sdzBridge = true;

  const TOPIC = "sdz";
  const ORIGIN = location.origin;
  const MAX_OUT = 26000;
  const SCAN_LIMIT = 40000; // fiber nodes per scan; keeps one scan cheap
  let channel = null;
  let unsubscribe = null;
  let readyId = "";

  function post(msg) {
    try {
      window.postMessage(Object.assign({ __sdz: 1 }, msg), ORIGIN);
    } catch (e) {
      /* the page is going away; nothing to report to */
    }
  }

  function reactRoot() {
    const el = document.getElementById("__next");
    if (!el) return null;
    for (const k of Object.keys(el)) {
      if (k.startsWith("__reactContainer") || k.startsWith("__reactFiber")) return el[k];
    }
    return null;
  }

  function looksLikeChannel(v) {
    return !!v && typeof v === "object" && typeof v.publish === "function" && typeof v.onMessage === "function" && typeof v.getState === "function";
  }

  // Skool's participant data: an object of call id -> { name, ... } that sits
  // next to a `toggles` prop (same shape check as Skool Extensions 1.9.5).
  function looksLikeProfiles(props) {
    return !!props.profiles && typeof props.profiles === "object" && !Array.isArray(props.profiles) && !!props.toggles;
  }

  // One walk finds both things. Returns { channel, profiles } (either may be null).
  function scan() {
    const out = { channel: null, profiles: null };
    const root = reactRoot();
    if (!root) return out;
    const stack = [root];
    let seen = 0;
    while (stack.length && seen < SCAN_LIMIT && !(out.channel && out.profiles)) {
      const node = stack.pop();
      seen++;
      if (!node) continue;
      const props = node.memoizedProps;
      if (props && typeof props === "object") {
        if (!out.channel && looksLikeChannel(props.value)) out.channel = props.value;
        if (!out.profiles && looksLikeProfiles(props)) out.profiles = props.profiles;
      }
      if (node.sibling) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }
    return out;
  }

  // Only NAMES leave the page world, never the rest of a profile. Screen-share
  // pseudo-participants ("screen-<id>") are not people and are dropped.
  const MAX_ROSTER = 500;
  let lastRosterKey = "";
  function postRoster(profiles) {
    const list = [];
    for (const uid of Object.keys(profiles)) {
      if (list.length >= MAX_ROSTER) break;
      if (uid.indexOf("screen-") === 0) continue;
      const p = profiles[uid];
      const name = p && typeof p.name === "string" ? p.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
      list.push({ uid: String(uid).slice(0, 64), name });
    }
    const key = JSON.stringify(list);
    if (key === lastRosterKey) return;
    lastRosterKey = key;
    post({ type: "sdz-roster", list });
  }

  function detach() {
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch (e) {
        /* already detached by Skool */
      }
    }
    unsubscribe = null;
    if (channel) post({ type: "sdz-bus-gone" });
    channel = null;
    readyId = "";
  }

  function onSdzMessage(m) {
    const payload = m && typeof m.payload === "string" ? m.payload : null;
    const from = m && m.publisher != null ? String(m.publisher) : "";
    if (!payload || !from || payload.length > MAX_OUT) return;
    post({ type: "sdz-bus-in", from, payload });
  }

  function tick() {
    if (location.pathname.indexOf("/live/") === -1) {
      detach();
      return;
    }
    let found = null;
    try {
      const s = scan();
      found = s.channel;
      if (s.profiles) postRoster(s.profiles);
    } catch (e) {
      found = null;
    }
    if (found !== channel) {
      detach();
      if (found) {
        channel = found;
        try {
          unsubscribe = channel.onMessage(TOPIC, onSdzMessage);
        } catch (e) {
          post({ type: "sdz-bus-error", reason: "subscribe failed: " + (e && e.message ? e.message : e) });
          channel = null;
          return;
        }
      }
    }
    if (!channel) return;
    let state = null;
    try {
      state = channel.getState();
    } catch (e) {
      state = null;
    }
    const id = channel.uid != null ? String(channel.uid) : "";
    if (state && state.status === "connected" && id && id !== readyId) {
      readyId = id;
      post({ type: "sdz-bus-ready", id });
    }
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== ORIGIN) return;
    const d = ev.data;
    if (!d || d.__sdz !== 1) return;
    if (d.type === "sdz-bus-ask") {
      // the extension (re)loaded and wants to know whether we are ready
      if (readyId) post({ type: "sdz-bus-ready", id: readyId });
      lastRosterKey = ""; // the next tick re-sends the names to the freshly loaded extension
      return;
    }
    if (d.type !== "sdz-bus-out" || typeof d.payload !== "string" || d.payload.length > MAX_OUT) return;
    if (!channel) {
      post({ type: "sdz-bus-error", reason: "not in a call channel" });
      return;
    }
    try {
      const p = channel.publish(TOPIC, d.payload);
      if (p && typeof p.catch === "function") {
        p.catch((e) => post({ type: "sdz-bus-error", reason: "publish failed: " + (e && e.message ? e.message : e) }));
      }
    } catch (e) {
      post({ type: "sdz-bus-error", reason: "publish failed: " + (e && e.message ? e.message : e) });
    }
  });

  setInterval(tick, 1500);
  tick();

})();
