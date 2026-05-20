// skool-dropzone — transport test harness logic
// (MV3 extension pages disallow inline scripts, so this is a separate file.)

(() => {
  const $ = (id) => document.getElementById(id);
  let connected = false;
  let convenience = false;
  let lastPeers = 0;

  // Run the crypto self-test on load so we know the core works here.
  (async () => {
    try {
      const ok = await window.SDZCrypto.selfTest();
      $("crypto-result").textContent = ok ? "PASS ✓" : "FAIL ✗";
      $("crypto-result").className = ok ? "ok" : "bad";
    } catch (e) {
      $("crypto-result").textContent = "ERROR: " + e;
      $("crypto-result").className = "bad";
    }
  })();

  function setStatus(mode, text) {
    const el = $("status");
    el.dataset.mode = mode;
    el.textContent = text;
  }

  function addLine(cls, text) {
    const li = document.createElement("li");
    li.className = "line " + cls;
    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    li.textContent = `[${t}] ${text}`;
    $("log").appendChild(li);
    $("log").scrollTop = $("log").scrollHeight;
  }

  function onStatus(s) {
    const n = s.peers || 0;
    if (["signaling-error", "signaling-disconnected", "signaling-closed"].includes(s.state)) {
      setStatus("error", "Signaling relay not reachable — is it running? (cd signaling && npm start)");
      return;
    }
    if (n !== lastPeers) {
      if (n > lastPeers) addLine("sys", `a peer connected (${n} now connected)`);
      else addLine("sys", `a peer left (${n} connected)`);
      lastPeers = n;
    }
    const lock = convenience ? "⚠ convenience mode" : "🔒 E2EE";
    if (n > 0) setStatus("connected", `${lock} · ${n} peer${n === 1 ? "" : "s"} connected`);
    else setStatus("waiting", `${lock} · waiting for another tab…`);
  }

  const incoming = new Map(); // id -> { name, type, total, parts[], received }

  function onMessage(obj, fromPeer) {
    if (!obj || !obj.kind) return;
    // Phase 5: presentation messages handled by the shared module.
    if (window.SDZPresent && window.SDZPresent.handleMessage(obj)) return;
    switch (obj.kind) {
      case "undecryptable":
        addLine("sys", "⚠ a message arrived that couldn't be decrypted (passphrase mismatch)");
        break;
      case "text":
        addLine("them", "peer: " + obj.body);
        break;
      case "file-start":
        incoming.set(obj.id, { name: obj.name, type: obj.type, total: obj.total, parts: new Array(obj.total), received: 0 });
        addLine("sys", `receiving "${obj.name}" (0%)`);
        break;
      case "file-chunk": {
        const t = incoming.get(obj.id);
        if (!t) break;
        if (t.parts[obj.seq] === undefined) {
          t.parts[obj.seq] = obj.data;
          t.received++;
        }
        break;
      }
      case "file-end": {
        const t = incoming.get(obj.id);
        if (!t) break;
        const bufs = t.parts.map((b) => window.SDZCrypto.fromB64(b || ""));
        let len = 0;
        bufs.forEach((b) => (len += b.length));
        const all = new Uint8Array(len);
        let off = 0;
        bufs.forEach((b) => {
          all.set(b, off);
          off += b.length;
        });
        const blob = new Blob([all], { type: t.type || "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const li = document.createElement("li");
        li.className = "line them";
        const a = document.createElement("a");
        a.href = url;
        a.download = t.name;
        a.textContent = `⬇ download "${t.name}" (${len} bytes)`;
        li.appendChild(a);
        document.getElementById("log").appendChild(li);
        incoming.delete(obj.id);
        break;
      }
    }
  }

  $("join").addEventListener("click", async () => {
    if (connected) return;
    const room = $("room").value.trim() || "test-room";
    const passphrase = $("pass").value;
    convenience = !passphrase;
    if (!window.SDZTransport) {
      setStatus("error", "Transport unavailable — open this via the extension (chrome-extension://…), not file://");
      return;
    }
    setStatus("connecting", "Connecting…");
    try {
      await window.SDZTransport.init({ passphrase, room, onMessage, onStatus });
      connected = true;
      $("join").disabled = true;
      $("join").textContent = "Joined";
      $("room").disabled = true;
      $("pass").disabled = true;
      addLine("sys", `joined room "${room}" as ${window.SDZTransport.peerId.slice(0, 8)}`);
    } catch (e) {
      setStatus("error", "Join failed: " + (e && e.message ? e.message : e));
    }
  });

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("msg").value.trim();
    if (!text) return;
    addLine("me", "you: " + text);
    if (connected) window.SDZTransport.send({ kind: "text", body: text });
    $("msg").value = "";
  });

  $("file").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (!connected) {
      addLine("sys", "join a room first, then send a file");
      return;
    }
    const li = document.createElement("li");
    li.className = "line me";
    li.textContent = `sending "${f.name}" 0%`;
    document.getElementById("log").appendChild(li);
    try {
      await window.SDZTransport.sendFile(f, (p) => {
        li.textContent = `sending "${f.name}" ${Math.round(p * 100)}%`;
      });
      li.textContent = `sent "${f.name}" ✓`;
    } catch (err) {
      li.textContent = `send failed: ${err}`;
    }
  });

  $("present").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (!connected) {
      addLine("sys", "join a room first, then present a file");
      return;
    }
    addLine("me", `presenting "${f.name}" to the room…`);
    window.SDZPresent.presentFile(f, window.SDZTransport);
  });
})();
