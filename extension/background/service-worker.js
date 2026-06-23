// skool-dropzone — background service worker
//
// Bridges content scripts to the signaling relay. Content scripts can't
// reliably open a WebSocket to the relay (subject to Skool's page CSP),
// so the SW holds the WebSocket and relays messages over a runtime port.
//
// One content-script port = one signaling WebSocket = one peer.
// The SW never sees meeting content — only SDP/ICE signaling passes here.
//
// MV3 lifecycle: Chrome suspends an idle service worker after ~30s, which
// would close the signaling socket mid-call. While any socket is open we
// run a 20s heartbeat (a trivial async chrome API call resets the idle
// timer) plus an app-level WS ping so the connection stays warm.

// Default signaling relay. `ws://localhost:8080` is the dev / same-machine
// two-tab default. For cross-internet use (two strangers, two locations), point
// this at a HOSTED relay (a `wss://…` address, added to host_permissions) — or
// let a user override it per-install via chrome.storage.local key `relayUrl`.
// The relay only ever sees ciphertext + SDP/ICE, so a public relay is safe by
// design (untrusted-relay model — see SECURITY-AUDIT.md).
const DEFAULT_RELAY_URL = "ws://localhost:8080";
const MAX_SOCKETS = 8; // cap concurrent signaling sockets (SECURITY-AUDIT P4)

// Resolve the relay URL at connect time: a user-set override wins, else default.
function resolveRelayUrl() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get("relayUrl", (r) => {
        const u = r && typeof r.relayUrl === "string" && r.relayUrl.trim();
        resolve(u || DEFAULT_RELAY_URL);
      });
    } catch {
      resolve(DEFAULT_RELAY_URL);
    }
  });
}

let openSockets = 0;
let keepAliveTimer = null;

function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    // Any async API call resets the SW idle timer. Keeps us alive while
    // a signaling socket is open.
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
}

function maybeStopKeepAlive() {
  if (keepAliveTimer && openSockets <= 0) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sdz-signaling") return;
  // Only accept ports from our own extension contexts (SECURITY-AUDIT P4).
  // (externally_connectable is absent, so web pages already can't reach us;
  // this is defense-in-depth against any in-extension caller.)
  if (port.sender && port.sender.id && port.sender.id !== chrome.runtime.id) return;

  let ws = null;
  let queue = [];
  let counted = false; // did this port's socket increment openSockets?
  let wsPing = null;

  function cleanup() {
    if (wsPing) {
      clearInterval(wsPing);
      wsPing = null;
    }
    if (counted) {
      openSockets = Math.max(0, openSockets - 1);
      counted = false;
      maybeStopKeepAlive();
    }
    ws = null;
  }

  port.onMessage.addListener((msg) => {
    if (msg.type === "connect") {
      if (openSockets >= MAX_SOCKETS) {
        port.postMessage({ type: "ws-error", error: "too many signaling sockets" });
        return;
      }
      resolveRelayUrl().then((relayUrl) => {
        try {
          ws = new WebSocket(relayUrl);
        } catch (e) {
          port.postMessage({ type: "ws-error", error: String(e) });
          return;
        }
        ws.onopen = () => {
          counted = true;
          openSockets++;
          startKeepAlive();
          port.postMessage({ type: "ws-open" });
          queue.forEach((m) => ws.send(JSON.stringify(m)));
          queue = [];
          // App-level ping keeps the socket warm; relay ignores unknown types.
          wsPing = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }));
            }
          }, 20000);
        };
        ws.onmessage = (e) => {
          let parsed;
          try {
            parsed = JSON.parse(e.data);
          } catch {
            return;
          }
          port.postMessage(parsed);
        };
        ws.onclose = () => {
          cleanup();
          port.postMessage({ type: "ws-closed" });
        };
        ws.onerror = () => port.postMessage({ type: "ws-error" });
      });
      return;
    }

    // Any other message is destined for the relay (join / signal).
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      queue.push(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    if (ws) {
      try {
        ws.close();
      } catch {}
    }
    cleanup();
  });
});
