// skool-dropzone — background service worker
//
// Bridges content scripts to the signaling relay. Content scripts can't
// reliably open a WebSocket to the relay (subject to Skool's page CSP),
// so the SW holds the WebSocket and relays messages over a runtime port.
//
// One content-script port = one signaling WebSocket = one peer.
// The SW never sees meeting content — only SDP/ICE signaling passes here.

const SIGNALING_URL = "ws://localhost:8080";

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sdz-signaling") return;

  let ws = null;
  let queue = [];

  port.onMessage.addListener((msg) => {
    if (msg.type === "connect") {
      try {
        ws = new WebSocket(SIGNALING_URL);
      } catch (e) {
        port.postMessage({ type: "ws-error", error: String(e) });
        return;
      }
      ws.onopen = () => {
        port.postMessage({ type: "ws-open" });
        queue.forEach((m) => ws.send(JSON.stringify(m)));
        queue = [];
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
      ws.onclose = () => port.postMessage({ type: "ws-closed" });
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
      ws = null;
    }
  });
});
