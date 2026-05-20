// skool-dropzone — transport test harness logic
// (MV3 extension pages disallow inline scripts, so this is a separate file.)

(() => {
  const $ = (id) => document.getElementById(id);
  let connected = false;
  let convenience = false;

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
    const lock = convenience ? "⚠ convenience mode" : "🔒 E2EE";
    if (n > 0) setStatus("connected", `${lock} · ${n} peer${n === 1 ? "" : "s"} connected`);
    else setStatus("waiting", `${lock} · waiting for another tab…`);
  }

  function onMessage(obj, fromPeer) {
    if (!obj || !obj.kind) return;
    if (obj.kind === "undecryptable") {
      addLine("sys", "⚠ a message arrived that couldn't be decrypted (passphrase mismatch)");
      return;
    }
    if (obj.kind === "text") addLine("them", "peer: " + obj.body);
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
})();
