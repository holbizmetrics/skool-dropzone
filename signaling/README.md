# signaling relay (dev)

Tiny WebSocket relay that lets two browsers find each other for WebRTC. It relays connection offers (SDP) and network candidates (ICE) only — **it never sees meeting content.** Messages and files travel over the peer-to-peer data channel, encrypted end-to-end by the extension.

## Run it

You need [Node.js](https://nodejs.org) installed.

```bash
cd signaling
npm install      # once — pulls the 'ws' package
npm start        # starts ws://localhost:8080
```

You should see:

```
skool-dropzone signaling relay listening on ws://localhost:8080
```

Leave it running while you test. It logs `[join]` / `[leave]` as peers connect.

## Test the transport (two browser windows)

1. Start this relay (`npm start`).
2. Load/reload the extension (`chrome://extensions` → reload skool-dropzone).
3. Open the **same** Skool meeting URL (`https://www.skool.com/live/<id>`) in **two** browser windows (or one normal + one incognito with the extension allowed in incognito).
4. In each panel, type the **same room passphrase** and click **Join room**.
5. The status should show `🔒 1 peer` in each.
6. Type a message in one → it appears in the other.
7. Set a **different** passphrase in a third window → it connects but can't read the messages (decryption fails). That's the E2EE working.

## Production

This same `server.js` runs unchanged on a hosted platform (Cloudflare Workers needs a Durable-Objects variant; Render / Fly / Railway run it as-is). For production you'd point the extension's `background/service-worker.js` `SIGNALING_URL` at the deployed `wss://` URL. That's a later decision — see [`../PHASE2-transport.md`](../PHASE2-transport.md).
