(() => {
  const HOST_ID = "skool-dropzone-host";
  const MARKER_ID = "skool-dropzone-marker";
  const PANEL_ID = "skool-dropzone-panel";

  // Stream.io Video React SDK is what Skool uses for live calls.
  // .str-video__call-controls (the bottom controls bar) is the most
  // reliable "we are in an active call" signal — verified in a live
  // meeting on 2026-05-20 (URL: skool.com/live/<id>).
  const CALL_ROOT_SELECTOR = ".str-video__call-controls";

  let isOpen = false;
  let inCall = false;
  let userToggled = false; // remember if user manually closed; respect that
  const messages = []; // ephemeral, session-only
  const staged = new Map(); // id -> { id, file, name, size, type }
  let stageSeq = 0;

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
          <span class="sdz-version">v0.2.0</span>
        </div>
        <button class="sdz-close" type="button" title="Close" aria-label="Close panel">×</button>
      </header>
      <div class="sdz-banner">
        <strong>Local-only.</strong> Nothing sent over the network yet — transport lands in Phase 2.
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

    wireDragDrop(panel);
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
    addMessage({ kind: "text", body: text });
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
    // Phase 2 will encrypt + send over the wire here. For now, local-only:
    // move the file into the message log as a "shared" tile.
    addMessage({
      kind: "file",
      body: item.name,
      meta: `${formatBytes(item.size)} · ${item.type || "application/octet-stream"} · shared (local-only)`,
    });
    unstage(id);
  }

  function presentStaged(id) {
    const item = staged.get(id);
    if (!item) return;
    // Phase 5 will sync this fullscreen to everyone over the E2EE channel.
    // For now, present locally to self so the surface is real and testable.
    presentLocally(item);
  }

  function presentLocally(item) {
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    const url = URL.createObjectURL(item.file);
    const overlay = document.createElement("div");
    overlay.className = "sdz-present-overlay";
    const isImage = (item.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(item.name);
    const isVideo = (item.type || "").startsWith("video/") || /\.(mp4|webm|mov)$/i.test(item.name);
    let media;
    if (isImage) {
      media = `<img class="sdz-present-media" src="${url}" alt="${escapeHtml(item.name)}" />`;
    } else if (isVideo) {
      media = `<video class="sdz-present-media" src="${url}" controls autoplay></video>`;
    } else {
      // PDF / other: iframe preview
      media = `<iframe class="sdz-present-media" src="${url}"></iframe>`;
    }
    overlay.innerHTML = `
      <div class="sdz-present-bar">
        <span class="sdz-present-title">Presenting (local preview) — ${escapeHtml(item.name)}</span>
        <span class="sdz-present-note">Phase 5 will sync this to everyone in the room</span>
        <button type="button" class="sdz-present-close" title="End preview">End ✕</button>
      </div>
      ${media}
    `;
    host.appendChild(overlay);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      overlay.remove();
      document.removeEventListener("keydown", onEsc);
    };
    const onEsc = (e) => { if (e.key === "Escape") cleanup(); };
    overlay.querySelector(".sdz-present-close").addEventListener("click", cleanup);
    document.addEventListener("keydown", onEsc);
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
    li.className = `sdz-msg sdz-msg-${msg.kind}`;
    const time = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (msg.kind === "file") {
      li.innerHTML = `
        <div class="sdz-msg-row">
          <span class="sdz-msg-icon">📎</span>
          <span class="sdz-msg-body">${escapeHtml(msg.body)}</span>
          <span class="sdz-msg-time">${time}</span>
        </div>
        <div class="sdz-msg-meta">${escapeHtml(msg.meta)}</div>
      `;
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

  // initial mount
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
