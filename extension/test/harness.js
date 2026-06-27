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

  // The room "safe-word": everyone with the same passphrase+room sees the same
  // emoji. Different emoji = different passphrase or room (i.e. you're not in the
  // same protected session). Compare it out loud / in the call.
  async function showSafeWord(passphrase, room) {
    try {
      const fp = await window.SDZCrypto.roomFingerprint(passphrase, room);
      const el = $("safeword");
      el.textContent = "Room safe-word:  " + fp;
      el.title = "Everyone here should see the SAME emoji. Different emoji = different passphrase/room.";
      el.style.display = "";
    } catch {
      /* non-fatal — the safe-word is a confirmation aid, not required to connect */
    }
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
    // Phase 5/6: presentation + whiteboard handled by their shared modules.
    if (window.SDZPresent && window.SDZPresent.handleMessage(obj, fromPeer)) return;
    if (window.SDZWhiteboard && window.SDZWhiteboard.handleMessage(obj, fromPeer)) return;
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
      showSafeWord(passphrase, room);
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

  $("whiteboard").addEventListener("click", () => {
    if (!connected) {
      addLine("sys", "join a room first, then open the whiteboard");
      return;
    }
    window.SDZWhiteboard.toggle(window.SDZTransport);
  });

  // --- Manual connect-code signaling (serverless P2P; no relay) ---
  // Reuses the Room + Passphrase fields and the same onMessage/onStatus, so once
  // a manual peer attaches, the composer / file / present controls work as-is.
  function manualReady() {
    if (!window.SDZManual) {
      addLine("sys", "manual signaling unavailable — open via chrome-extension://…, not file://");
      return false;
    }
    return true;
  }
  function manualOpts() {
    const room = $("room").value.trim() || "test-room";
    const passphrase = $("pass").value;
    convenience = !passphrase;
    return { passphrase, room, onMessage, onStatus };
  }
  function lockControls(note) {
    connected = true;
    $("join").disabled = true;
    $("join").textContent = "Joined";
    $("room").disabled = true;
    $("pass").disabled = true;
    addLine("sys", note);
  }
  function selectAll(el) {
    el.focus();
    el.select();
  }

  $("m-offer").addEventListener("click", async () => {
    if (!manualReady()) return;
    setStatus("connecting", "Creating offer code…");
    try {
      const opts = manualOpts();
      $("m-offer-out").value = await window.SDZManual.createOffer(opts);
      selectAll($("m-offer-out"));
      showSafeWord(opts.passphrase, opts.room);
      addLine("sys", "offer created — send the code to the other person, then paste their answer below");
    } catch (e) {
      setStatus("error", "offer failed: " + (e && e.message ? e.message : e));
    }
  });

  $("m-answer").addEventListener("click", async () => {
    if (!manualReady()) return;
    const offer = $("m-offer-in").value.trim();
    if (!offer) {
      addLine("sys", "paste the offer code into Side B first");
      return;
    }
    setStatus("connecting", "Making answer code…");
    try {
      const opts = manualOpts();
      $("m-answer-out").value = await window.SDZManual.acceptOffer(offer, opts);
      selectAll($("m-answer-out"));
      showSafeWord(opts.passphrase, opts.room);
      lockControls("answer created — send it back to Side A; you'll connect once they finish");
    } catch (e) {
      setStatus("error", "answer failed: " + (e && e.message ? e.message : e));
    }
  });

  $("m-finish").addEventListener("click", async () => {
    if (!manualReady()) return;
    const answer = $("m-answer-in").value.trim();
    if (!answer) {
      addLine("sys", "paste the answer code from Side B first");
      return;
    }
    try {
      await window.SDZManual.acceptAnswer(answer);
      lockControls("answer accepted — establishing the peer-to-peer link…");
    } catch (e) {
      setStatus("error", "finish failed: " + (e && e.message ? e.message : e));
    }
  });

  $("slide-present").addEventListener("click", () => {
    if (!connected) {
      addLine("sys", "join a room first, then present a slide");
      return;
    }
    const title = ($("slide-title").value || "").trim();
    const blocks = ($("slide-bullets").value || "").split(/\n-{3,}\s*\n/);
    const linesOf = (b) => b.split("\n").map((l) => l.trim()).filter(Boolean);
    let slides;
    if (title) {
      slides = [{ title, bullets: linesOf(blocks[0]) }];
      blocks.slice(1).forEach((b) => {
        const ls = linesOf(b);
        if (ls.length) slides.push({ title: ls[0], bullets: ls.slice(1) });
      });
    } else {
      slides = blocks.map((b) => {
        const ls = linesOf(b);
        return ls.length ? { title: ls[0], bullets: ls.slice(1) } : null;
      }).filter(Boolean);
    }
    const res = window.SDZPresent.presentSlides(slides, window.SDZTransport);
    if (res && res.ok === false) {
      addLine("sys", res.reason);
      return;
    }
    addLine("me", `presenting ${slides.length} slide(s) to the room…`);
    $("slide-title").value = "";
    $("slide-bullets").value = "";
  });
})();
