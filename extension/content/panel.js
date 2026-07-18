(() => {
  const HOST_ID = "skool-dropzone-host";
  const MARKER_ID = "skool-dropzone-marker";
  const PANEL_ID = "skool-dropzone-panel";

  // Stream.io Video React SDK is what Skool uses for live calls.
  // .str-video__call-controls (the bottom controls bar) is the most
  // reliable "we are in an active call" signal — verified in a live
  // meeting on 2026-05-20 (URL: skool.com/live/<id>).
  const CALL_ROOT_SELECTOR = ".str-video__call-controls";

  const MAX_FILE = 50 * 1024 * 1024; // 50 MB cap for Phase 4
  const MAX_CHUNKS = Math.ceil(MAX_FILE / (16 * 1024)) + 2; // receive-side total guard (SECURITY-AUDIT P2)
  // Peer-controlled MIME is coerced to a non-executable allowlist so a received
  // blob can't render as HTML if opened (SECURITY-AUDIT P6). Anything not on the
  // list (e.g. text/html, image/svg+xml) becomes an inert download.
  const SAFE_MIME = /^(image\/(png|jpe?g|gif|webp|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|mp4|ogg|wav|webm)|application\/pdf)$/;
  function safeMime(t) {
    t = String(t || "").toLowerCase().split(";")[0].trim();
    return SAFE_MIME.test(t) ? t : "application/octet-stream";
  }

  let isOpen = false;
  let inCall = false;
  let userToggled = false;
  let connected = false; // joined the E2EE room
  let convenienceMode = false; // joined with empty passphrase
  let convenienceConfirmed = false; // user explicitly accepted the no-passphrase exposure (H2)
  let lastPeers = 0; // for presence (join/leave) detection
  const messages = [];
  const staged = new Map();
  let stageSeq = 0;
  const incoming = new Map(); // transfer id -> { name, size, type, total, parts[], received, domId }
  let xferSeq = 0;

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
    renderMarker(host);
    renderPanel(host);
    return host;
  }

  function renderMarker(host) {
    if (document.getElementById(MARKER_ID)) return;
    const marker = document.createElement("button");
    marker.id = MARKER_ID;
    marker.type = "button";
    marker.textContent = "SDZ";
    marker.title = "skool-dropzone — click to open";
    marker.addEventListener("click", onUserToggle);
    host.appendChild(marker);
  }

  function renderPanel(host) {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `
      <header class="sdz-header">
        <div class="sdz-title">
          <span class="sdz-dot" data-state="idle"></span>
          skool-dropzone
          <span class="sdz-version">v0.7.0</span>
        </div>
        <button class="sdz-close" type="button" title="Close" aria-label="Close panel">×</button>
      </header>

      <div class="sdz-connect">
        <input class="sdz-pass" type="text" placeholder="Room passphrase (recommended — blank = host can read)" autocomplete="off" />
        <button class="sdz-join" type="button">Join room</button>
      </div>
      <div class="sdz-status" data-mode="offline">Not connected — join the room to chat with other members.</div>
      <div class="sdz-safeword" hidden></div>

      <div class="sdz-tools">
        <button class="sdz-wb-toggle" type="button" title="Open shared whiteboard">🖊 Whiteboard</button>
        <button class="sdz-slide-toggle" type="button" title="Type a slide and present it">▤ Slide</button>
        <button class="sdz-tx-toggle" type="button" title="Live transcription (mic-based)">🎙 Transcript</button>
        <button class="sdz-poll-toggle" type="button" title="Start a poll">📊 Poll</button>
      </div>

      <div class="sdz-reactions"></div>

      <div class="sdz-poll-compose" hidden>
        <input class="sdz-poll-q" type="text" maxlength="200" placeholder="Poll question" autocomplete="off" />
        <textarea class="sdz-poll-opts" rows="3" maxlength="500" placeholder="One option per line (2–6 options)"></textarea>
        <div class="sdz-poll-compose-actions">
          <button class="sdz-poll-start" type="button">Start poll</button>
          <button class="sdz-poll-cancel" type="button">Cancel</button>
        </div>
      </div>

      <div class="sdz-slide-compose" hidden>
        <input class="sdz-slide-title-in" type="text" placeholder="Slide title" autocomplete="off" />
        <textarea class="sdz-slide-bullets-in" rows="4" placeholder="One bullet per line.&#10;Separate multiple slides with a line of ---"></textarea>
        <div class="sdz-slide-compose-actions">
          <button class="sdz-slide-present" type="button">Present slide</button>
          <button class="sdz-slide-cancel" type="button">Cancel</button>
        </div>
      </div>

      <ul class="sdz-messages" role="log" aria-live="polite"></ul>

      <div class="sdz-stage" hidden>
        <div class="sdz-stage-label">Staged — choose an action per file:</div>
        <ul class="sdz-stage-list"></ul>
      </div>

      <form class="sdz-composer">
        <label class="sdz-attach" title="Attach a file">
          <input type="file" multiple hidden />
          <span>＋</span>
        </label>
        <input class="sdz-input" type="text" placeholder="Type a message…" autocomplete="off" />
        <button class="sdz-send" type="submit" title="Send" aria-label="Send">↑</button>
      </form>
      <div class="sdz-dropzone-hint">Drop files to stage them</div>
    `;
    host.appendChild(panel);

    panel.querySelector(".sdz-close").addEventListener("click", onUserClose);
    panel.querySelector(".sdz-composer").addEventListener("submit", onSubmit);
    panel.querySelector(".sdz-attach input").addEventListener("change", onAttach);
    panel.querySelector(".sdz-join").addEventListener("click", onJoin);
    panel.querySelector(".sdz-pass").addEventListener("keydown", (e) => {
      if (e.key === "Enter") onJoin();
    });
    panel.querySelector(".sdz-wb-toggle").addEventListener("click", () => {
      if (window.SDZWhiteboard) window.SDZWhiteboard.toggle(window.SDZTransport);
    });
    panel.querySelector(".sdz-tx-toggle").addEventListener("click", () => {
      if (window.SDZTranscribe) window.SDZTranscribe.toggle();
    });
    wireSlideCompose(panel);
    wireEngage(panel);

    wireDragDrop(panel);
  }

  // === transport / connection ===

  async function onJoin() {
    if (connected) return;
    const passInput = document.querySelector(`#${PANEL_ID} .sdz-pass`);
    const passphrase = passInput ? passInput.value : "";

    // H2: a blank passphrase is convenience mode — the meeting host (and anyone
    // with the link) can read the traffic. Don't let a user land there silently;
    // require one explicit confirm before joining without a passphrase.
    if (!passphrase && !convenienceConfirmed) {
      convenienceConfirmed = true;
      const joinBtn = document.querySelector(`#${PANEL_ID} .sdz-join`);
      if (joinBtn) joinBtn.textContent = "Join without a passphrase";
      setStatus(
        "error",
        "No passphrase: the meeting host (and anyone with the link) can read these messages. Add a passphrase for end-to-end privacy, or click Join again to continue anyway."
      );
      return;
    }
    convenienceMode = !passphrase;

    if (!window.SDZTransport) {
      setStatus("error", "Transport unavailable (reload the extension).");
      return;
    }

    setStatus("connecting", "Connecting…");
    try {
      await window.SDZTransport.init({
        passphrase,
        onMessage: onRemoteMessage,
        onStatus: onTransportStatus,
      });
      connected = true;
      const join = document.querySelector(`#${PANEL_ID} .sdz-join`);
      if (join) {
        join.disabled = true;
        join.textContent = "Joined";
      }
      if (passInput) passInput.disabled = true;
      showSafeWord(passphrase, window.SDZTransport.room);
    } catch (e) {
      setStatus("error", "Could not join: " + (e && e.message ? e.message : e));
    }
  }

  // The room "safe-word": everyone who joined the same meeting with the same
  // passphrase sees the SAME emoji. If a member sees different emoji, they typed
  // a different passphrase (otherwise that only shows up as silent "couldn't
  // decrypt" messages). Members compare it out loud in the call.
  async function showSafeWord(passphrase, room) {
    try {
      const fp = await window.SDZCrypto.roomFingerprint(passphrase, room);
      const el = document.querySelector(`#${PANEL_ID} .sdz-safeword`);
      if (!el) return;
      if (!passphrase) {
        // F3 (verification 2026-07-19): in convenience mode the emoji derive
        // from the public meeting id — everyone (including the relay) gets the
        // same ones, so matching emoji must NOT read as a privacy confirmation.
        el.textContent = "Room check (no passphrase):  " + fp;
        el.title =
          "No passphrase set — these emoji only confirm you're in the same room. They say NOTHING about privacy: anyone with the link derives the same ones.";
      } else {
        el.textContent = "Room safe-word:  " + fp;
        el.title = "Everyone in this room should see the SAME emoji. Different emoji = different passphrase.";
      }
      el.hidden = false;
    } catch {
      /* non-fatal — the safe-word is a confirmation aid, not required to connect */
    }
  }

  function onTransportStatus(s) {
    const n = s.peers || 0;
    if (s.state === "signaling-error" || s.state === "signaling-disconnected" || s.state === "signaling-closed") {
      setStatus("error", "Signaling relay not reachable — is the local relay running? (npm start in /signaling)");
      return;
    }
    // Late-joiner whiteboard catch-up: on FIRST peer contact, ask the room for
    // board state (no-ops unless our board is empty — see whiteboard.js wb-sync).
    if (lastPeers === 0 && n > 0 && window.SDZWhiteboard) window.SDZWhiteboard.requestSync();
    // Presence (Phase 3): announce members joining/leaving the mesh.
    if (n !== lastPeers) {
      if (n > lastPeers) addMessage({ kind: "system", body: `A member connected (${n} now in the room).` });
      else if (n > 0) addMessage({ kind: "system", body: `A member left (${n} remaining).` });
      else addMessage({ kind: "system", body: "You're alone in the room now." });
      lastPeers = n;
    }
    const lock = convenienceMode ? "⚠ convenience mode" : "🔒 end-to-end encrypted";
    if (n > 0) {
      setStatus("connected", `${lock} · ${n} peer${n === 1 ? "" : "s"} connected`);
    } else {
      setStatus("waiting", `${lock} · waiting for other members…`);
    }
  }

  function setStatus(mode, text) {
    const el = document.querySelector(`#${PANEL_ID} .sdz-status`);
    if (!el) return;
    el.dataset.mode = mode;
    el.textContent = text;
  }

  function onRemoteMessage(obj, fromPeer) {
    if (!obj || !obj.kind) return;
    // Presentation (present-*), whiteboard (wb-*), and reactions/polls
    // (react/poll-*) are handled by their modules.
    if (window.SDZPresent && window.SDZPresent.handleMessage(obj, fromPeer)) return;
    if (window.SDZWhiteboard && window.SDZWhiteboard.handleMessage(obj, fromPeer)) return;
    if (window.SDZEngage && window.SDZEngage.handleMessage(obj, fromPeer)) return;
    switch (obj.kind) {
      case "undecryptable":
        addMessage({ kind: "system", body: "A message arrived that couldn't be decrypted — passphrase mismatch?" });
        break;
      case "text":
        addMessage({ kind: "text", body: obj.body, mine: false, peer: fromPeer });
        break;
      case "tx-status":
        // F2 consent visibility: transcription elsewhere in the room is
        // something YOUR speech may be feeding — always surfaced, never silent.
        addMessage({
          kind: "system",
          body: obj.on
            ? "🎙 A member turned transcription ON — speech their mic hears (possibly yours) may reach Google's speech service."
            : "🎙 A member turned transcription OFF.",
        });
        break;
      case "file-start":
        startIncoming(obj);
        break;
      case "file-chunk":
        chunkIncoming(obj);
        break;
      case "file-end":
        endIncoming(obj);
        break;
    }
  }

  // === Phase 4: incoming file reassembly ===

  function startIncoming(obj) {
    if (obj.size > MAX_FILE) return; // sender should have blocked it; ignore
    // total is attacker-controlled off the wire — never allocate on an
    // unvalidated count (SECURITY-AUDIT P2 — one-frame OOM).
    if (!Number.isInteger(obj.total) || obj.total < 1 || obj.total > MAX_CHUNKS) return;
    const domId = "sdz-in-" + obj.id;
    incoming.set(obj.id, {
      name: obj.name,
      size: obj.size,
      type: obj.type,
      total: obj.total,
      parts: new Array(obj.total),
      received: 0,
      domId,
    });
    addMessage({
      kind: "file-progress",
      domId,
      body: obj.name,
      meta: `${formatBytes(obj.size)} · receiving 0%`,
      mine: false,
    });
  }

  function chunkIncoming(obj) {
    const t = incoming.get(obj.id);
    if (!t) return;
    if (!Number.isInteger(obj.seq) || obj.seq < 0 || obj.seq >= t.total) return; // P2: bound seq
    if (t.parts[obj.seq] === undefined) {
      t.parts[obj.seq] = obj.data;
      t.received++;
    }
    const pct = Math.round((100 * t.received) / t.total);
    updateProgress(t.domId, `${formatBytes(t.size)} · receiving ${pct}%`);
  }

  function endIncoming(obj) {
    const t = incoming.get(obj.id);
    if (!t) return;
    const parts = t.parts.map((b64) => window.SDZCrypto.fromB64(b64 || ""));
    let len = 0;
    parts.forEach((p) => (len += p.length));
    const all = new Uint8Array(len);
    let off = 0;
    parts.forEach((p) => {
      all.set(p, off);
      off += p.length;
    });
    const blob = new Blob([all], { type: safeMime(t.type) });
    finalizeFileMessage(t.domId, { name: t.name, size: t.size, type: t.type }, URL.createObjectURL(blob), false);
    incoming.delete(obj.id);
  }

  function wireDragDrop(panel) {
    let depth = 0;
    const setDrag = (on) => panel.classList.toggle("sdz-dragover", on);
    panel.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDrag(true);
    });
    panel.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    panel.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDrag(false);
    });
    panel.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDrag(false);
      Array.from(e.dataTransfer.files || []).forEach(stageFile);
    });
  }

  function hasFiles(e) {
    return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  }

  function onUserToggle() {
    userToggled = true;
    isOpen ? closePanel() : openPanel();
  }
  function onUserClose() {
    userToggled = true;
    closePanel();
  }

  function openPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("sdz-open");
    document.getElementById(MARKER_ID)?.classList.add("sdz-marker-active");
    isOpen = true;
    setTimeout(() => panel.querySelector(".sdz-input")?.focus(), 50);
  }
  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.setAttribute("aria-hidden", "true");
    panel.classList.remove("sdz-open");
    document.getElementById(MARKER_ID)?.classList.remove("sdz-marker-active");
    isOpen = false;
  }

  function setCallState(active) {
    if (active === inCall) return;
    inCall = active;
    const dot = document.querySelector(`#${PANEL_ID} .sdz-dot`);
    if (dot) dot.dataset.state = active ? "in-call" : "idle";
    if (active && !userToggled) openPanel();
    if (!active && !userToggled) closePanel();
  }

  function onSubmit(ev) {
    ev.preventDefault();
    const input = ev.currentTarget.querySelector(".sdz-input");
    const text = input.value.trim();
    if (!text) return;
    addMessage({ kind: "text", body: text, mine: true });
    if (connected && window.SDZTransport) {
      window.SDZTransport.send({ kind: "text", body: text });
    }
    input.value = "";
  }

  function onAttach(ev) {
    Array.from(ev.currentTarget.files || []).forEach(stageFile);
    ev.currentTarget.value = "";
  }

  // === Fork B: staging ===

  function stageFile(file) {
    const id = `s${++stageSeq}`;
    staged.set(id, { id, file, name: file.name, size: file.size, type: file.type });
    renderStage();
  }
  function unstage(id) {
    staged.delete(id);
    renderStage();
  }
  function canPresent(type, name) {
    const n = (name || "").toLowerCase();
    return (
      (type && (type.startsWith("image/") || type.startsWith("video/") || type === "application/pdf")) ||
      /\.(pdf|png|jpe?g|gif|webp|mp4|webm|mov)$/.test(n)
    );
  }

  function renderStage() {
    const wrap = document.querySelector(`#${PANEL_ID} .sdz-stage`);
    const list = document.querySelector(`#${PANEL_ID} .sdz-stage-list`);
    if (!wrap || !list) return;
    list.innerHTML = "";
    if (staged.size === 0) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    staged.forEach((item) => {
      const li = document.createElement("li");
      li.className = "sdz-stage-item";
      const presentable = canPresent(item.type, item.name);
      li.innerHTML = `
        <div class="sdz-stage-row">
          <span class="sdz-msg-icon">📎</span>
          <span class="sdz-stage-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
          <span class="sdz-stage-size">${formatBytes(item.size)}</span>
        </div>
        <div class="sdz-stage-actions">
          <button type="button" class="sdz-btn sdz-btn-share" data-act="share" data-id="${item.id}">Share</button>
          <button type="button" class="sdz-btn sdz-btn-present" data-act="present" data-id="${item.id}" ${presentable ? "" : "disabled title='Not a presentable file type'"}>Present</button>
          <button type="button" class="sdz-btn sdz-btn-remove" data-act="remove" data-id="${item.id}" title="Remove">✕</button>
        </div>
      `;
      list.appendChild(li);
    });
    list.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        if (act === "remove") return unstage(id);
        if (act === "share") return shareStaged(id);
        if (act === "present") return presentStaged(id);
      });
    });
  }

  function shareStaged(id) {
    const item = staged.get(id);
    if (!item) return;
    if (item.size > MAX_FILE) {
      addMessage({ kind: "system", body: `"${item.name}" is too large to share (max ${formatBytes(MAX_FILE)}).` });
      return;
    }
    if (connected && window.SDZTransport) {
      const domId = "sdz-out-" + ++xferSeq;
      addMessage({
        kind: "file-progress",
        domId,
        body: item.name,
        meta: `${formatBytes(item.size)} · sending 0%`,
        mine: true,
      });
      window.SDZTransport.sendFile(item.file, (p) => {
        updateProgress(domId, `${formatBytes(item.size)} · sending ${Math.round(p * 100)}%`);
      })
        .then(() => {
          // Sender already has the file locally — offer it back as a download too.
          finalizeFileMessage(domId, item, URL.createObjectURL(item.file), true);
        })
        .catch((err) => {
          updateProgress(domId, `${formatBytes(item.size)} · send failed`);
          console.error("[skool-dropzone] sendFile failed:", err);
        });
    } else {
      addMessage({
        kind: "file",
        body: item.name,
        meta: `${formatBytes(item.size)} · ${item.type || "application/octet-stream"} · shared (local-only — join a room to transmit)`,
        mine: true,
      });
    }
    unstage(id);
  }

  // === Phase 4: file message rendering (progress → done with download/preview) ===

  function updateProgress(domId, metaText) {
    const meta = document.querySelector(`#${PANEL_ID} #${CSS.escape(domId)} .sdz-msg-meta`);
    if (meta) meta.textContent = metaText;
  }

  function finalizeFileMessage(domId, item, url, mine) {
    const li = document.querySelector(`#${PANEL_ID} #${CSS.escape(domId)}`);
    if (!li) return;
    li.innerHTML = "";

    const row = document.createElement("div");
    row.className = "sdz-msg-row";
    const icon = document.createElement("span");
    icon.className = "sdz-msg-icon";
    icon.textContent = "📎";
    const name = document.createElement("span");
    name.className = "sdz-msg-body";
    name.textContent = item.name;
    row.appendChild(icon);
    row.appendChild(name);
    li.appendChild(row);

    const isImage = (item.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(item.name);
    if (isImage) {
      const img = document.createElement("img");
      img.className = "sdz-msg-thumb";
      img.src = url;
      img.alt = item.name;
      li.appendChild(img);
    }

    const actions = document.createElement("div");
    actions.className = "sdz-msg-fileactions";
    const dl = document.createElement("a");
    dl.className = "sdz-btn sdz-btn-download";
    dl.textContent = "Download";
    dl.href = url;
    dl.download = item.name;
    actions.appendChild(dl);
    if (mine) {
      const tag = document.createElement("span");
      tag.className = "sdz-sent-tag";
      tag.textContent = "sent ✓";
      actions.appendChild(tag);
    }
    li.appendChild(actions);

    const list = document.querySelector(`#${PANEL_ID} .sdz-messages`);
    if (list) list.scrollTop = list.scrollHeight;
  }

  function presentStaged(id) {
    const item = staged.get(id);
    if (!item) return;
    // Shared module: presenter overlay + broadcast to peers (or local preview
    // if not joined to a room). Viewers receive via SDZPresent.handleMessage.
    if (window.SDZPresent) {
      const res = window.SDZPresent.presentFile(item.file, window.SDZTransport);
      Promise.resolve(res).then((r) => {
        if (r && r.ok === false) addMessage({ kind: "system", body: r.reason });
      });
    }
  }

  // === Phase 7: type-as-slides ===

  function wireSlideCompose(panel) {
    const box = panel.querySelector(".sdz-slide-compose");
    const titleIn = panel.querySelector(".sdz-slide-title-in");
    const bulletsIn = panel.querySelector(".sdz-slide-bullets-in");
    const toggle = panel.querySelector(".sdz-slide-toggle");
    if (!box || !toggle) return;

    const hide = () => {
      box.hidden = true;
    };
    toggle.addEventListener("click", () => {
      box.hidden = !box.hidden;
      if (!box.hidden) setTimeout(() => titleIn && titleIn.focus(), 30);
    });
    panel.querySelector(".sdz-slide-cancel").addEventListener("click", hide);
    panel.querySelector(".sdz-slide-present").addEventListener("click", () => {
      if (!window.SDZPresent) return;
      const title = (titleIn.value || "").trim();
      const body = bulletsIn.value || "";
      const blocks = body.split(/\n-{3,}\s*\n/); // --- separates extra slides
      let slides;
      if (title) {
        // Explicit title field owns slide 1; its bullets are the first block's
        // lines. Any further --- blocks parse as their own titled slides.
        slides = [{ title, bullets: linesOf(blocks[0]) }];
        blocks.slice(1).forEach((b) => {
          const ls = linesOf(b);
          if (ls.length) slides.push({ title: ls[0], bullets: ls.slice(1) });
        });
      } else {
        // No title field: every block is line-1-title + rest-bullets.
        slides = blocks
          .map((b) => {
            const ls = linesOf(b);
            return ls.length ? { title: ls[0], bullets: ls.slice(1) } : null;
          })
          .filter(Boolean);
      }
      const res = window.SDZPresent.presentSlides(slides, window.SDZTransport);
      if (res && res.ok === false) {
        addMessage({ kind: "system", body: res.reason });
        return;
      }
      titleIn.value = "";
      bulletsIn.value = "";
      hide();
    });
  }

  function linesOf(block) {
    return block.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  // === Phase 9: reactions + polls (state machine in engage.js; render here) ===

  function wireEngage(panel) {
    const E = window.SDZEngage;
    if (!E) return;

    // reactions strip
    const strip = panel.querySelector(".sdz-reactions");
    if (strip) {
      E.REACTIONS.forEach((emoji) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sdz-react-btn";
        b.textContent = emoji;
        b.title = "Send a reaction";
        b.addEventListener("click", () => {
          floatEmoji(emoji); // own feedback immediately
          if (connected && window.SDZTransport) window.SDZTransport.send({ kind: "react", emoji });
        });
        strip.appendChild(b);
      });
    }

    // poll compose
    const box = panel.querySelector(".sdz-poll-compose");
    const toggle = panel.querySelector(".sdz-poll-toggle");
    const qIn = panel.querySelector(".sdz-poll-q");
    const optsIn = panel.querySelector(".sdz-poll-opts");
    if (toggle && box) {
      toggle.addEventListener("click", () => {
        box.hidden = !box.hidden;
        if (!box.hidden) setTimeout(() => qIn && qIn.focus(), 30);
      });
      panel.querySelector(".sdz-poll-cancel").addEventListener("click", () => {
        box.hidden = true;
      });
      panel.querySelector(".sdz-poll-start").addEventListener("click", () => {
        const opts = (optsIn.value || "").split("\n").map((l) => l.trim()).filter(Boolean);
        const frame = E.createPoll(qIn.value, opts);
        if (!frame) {
          addMessage({ kind: "system", body: "Poll needs a question and 2–6 options." });
          return;
        }
        if (connected && window.SDZTransport) window.SDZTransport.send(frame);
        else addMessage({ kind: "system", body: "Poll is local-only — join the room to let others vote." });
        qIn.value = "";
        optsIn.value = "";
        box.hidden = true;
      });
    }

    E.onEvent = (ev) => {
      if (ev.type === "react") return floatEmoji(ev.emoji);
      if (ev.type === "poll-new") return addPollCard(ev.poll);
      if (ev.type === "poll-update" || ev.type === "poll-closed") return updatePollCard(ev.poll);
    };
  }

  function floatEmoji(emoji) {
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    const span = document.createElement("span");
    span.className = "sdz-react-float";
    span.textContent = emoji;
    span.style.right = 40 + Math.random() * 120 + "px";
    host.appendChild(span);
    span.addEventListener("animationend", () => span.remove());
    setTimeout(() => span.remove(), 3000); // belt: never leak nodes
  }

  function addPollCard(poll) {
    const list = document.querySelector(`#${PANEL_ID} .sdz-messages`);
    if (!list || document.getElementById("sdz-poll-" + poll.id)) return;
    const li = document.createElement("li");
    li.className = "sdz-msg sdz-msg-poll" + (poll.mine ? " sdz-msg-mine" : "");
    li.id = "sdz-poll-" + poll.id;
    renderPollInto(li, poll);
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }

  function updatePollCard(poll) {
    const li = document.getElementById("sdz-poll-" + poll.id);
    if (li) renderPollInto(li, poll);
  }

  function renderPollInto(li, poll) {
    li.innerHTML = "";
    const q = document.createElement("div");
    q.className = "sdz-poll-question";
    q.textContent = "📊 " + poll.q + (poll.open ? "" : " (closed)");
    li.appendChild(q);

    const max = Math.max(1, ...poll.counts);
    poll.opts.forEach((opt, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        "sdz-poll-opt" +
        (poll.myVote === i ? " sdz-poll-voted" : "") +
        (!poll.open && poll.counts[i] === max && poll.total > 0 ? " sdz-poll-winner" : "");
      row.disabled = !poll.open;
      const bar = document.createElement("span");
      bar.className = "sdz-poll-bar";
      bar.style.width = Math.round((100 * poll.counts[i]) / max) + "%";
      const label = document.createElement("span");
      label.className = "sdz-poll-opt-label";
      label.textContent = opt;
      const n = document.createElement("span");
      n.className = "sdz-poll-count";
      n.textContent = String(poll.counts[i]);
      row.appendChild(bar);
      row.appendChild(label);
      row.appendChild(n);
      row.addEventListener("click", () => {
        const frame = window.SDZEngage.vote(poll.id, i);
        if (frame && connected && window.SDZTransport) window.SDZTransport.send(frame);
      });
      li.appendChild(row);
    });

    const foot = document.createElement("div");
    foot.className = "sdz-poll-foot";
    const total = document.createElement("span");
    total.textContent = `${poll.total} vote${poll.total === 1 ? "" : "s"}`;
    foot.appendChild(total);
    if (poll.mine && poll.open) {
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "sdz-btn";
      closeBtn.textContent = "Close poll";
      closeBtn.addEventListener("click", () => {
        const frame = window.SDZEngage.closePoll(poll.id);
        if (frame && connected && window.SDZTransport) window.SDZTransport.send(frame);
      });
      foot.appendChild(closeBtn);
    }
    li.appendChild(foot);
  }

  // === messages ===

  function addMessage(msg) {
    msg.ts = Date.now();
    messages.push(msg);
    renderMessage(msg);
  }

  function renderMessage(msg) {
    const list = document.querySelector(`#${PANEL_ID} .sdz-messages`);
    if (!list) return;
    const li = document.createElement("li");
    li.className = `sdz-msg sdz-msg-${msg.kind}` + (msg.mine ? " sdz-msg-mine" : "");
    if (msg.domId) li.id = msg.domId;
    const time = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (msg.kind === "file" || msg.kind === "file-progress") {
      li.innerHTML = `
        <div class="sdz-msg-row">
          <span class="sdz-msg-icon">📎</span>
          <span class="sdz-msg-body">${escapeHtml(msg.body)}</span>
          <span class="sdz-msg-time">${time}</span>
        </div>
        <div class="sdz-msg-meta">${escapeHtml(msg.meta)}</div>
      `;
    } else if (msg.kind === "system") {
      li.innerHTML = `<div class="sdz-msg-row"><span class="sdz-msg-body">${escapeHtml(msg.body)}</span></div>`;
    } else {
      li.innerHTML = `
        <div class="sdz-msg-row">
          <span class="sdz-msg-body">${escapeHtml(msg.body)}</span>
          <span class="sdz-msg-time">${time}</span>
        </div>
      `;
    }
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function checkCallPresence() {
    setCallState(!!document.querySelector(CALL_ROOT_SELECTOR));
  }

  ensureHost();
  checkCallPresence();

  const observer = new MutationObserver(() => {
    if (!document.getElementById(HOST_ID)) {
      ensureHost();
      messages.forEach(renderMessage);
      renderStage();
      if (isOpen) openPanel();
    }
    checkCallPresence();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("popstate", () => {
    if (!document.getElementById(HOST_ID)) ensureHost();
    checkCallPresence();
  });
})();
