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

const SIGNALING_URL = "ws://localhost:8080";

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
      try {
        ws = new WebSocket(SIGNALING_URL);
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
