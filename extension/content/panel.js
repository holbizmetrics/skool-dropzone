(() => {
  const HOST_ID = "skool-dropzone-host";
  const MARKER_ID = "skool-dropzone-marker";
  const PANEL_ID = "skool-dropzone-panel";

  let isOpen = false;
  const messages = []; // ephemeral, session-only

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
    marker.addEventListener("click", togglePanel);
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
          <span class="sdz-dot"></span>
          skool-dropzone
          <span class="sdz-version">v0.0.2</span>
        </div>
        <button class="sdz-close" type="button" title="Close" aria-label="Close panel">×</button>
      </header>
      <div class="sdz-banner">
        <strong>Phase 0.5 shell.</strong> Local-only — nothing sent over the network yet.
      </div>
      <ul class="sdz-messages" role="log" aria-live="polite"></ul>
      <form class="sdz-composer">
        <label class="sdz-attach" title="Attach a file (Phase 0.5: placeholder)">
          <input type="file" multiple hidden />
          <span>＋</span>
        </label>
        <input class="sdz-input" type="text" placeholder="Type a message…" autocomplete="off" />
        <button class="sdz-send" type="submit" title="Send" aria-label="Send">↑</button>
      </form>
    `;
    host.appendChild(panel);

    panel.querySelector(".sdz-close").addEventListener("click", closePanel);
    panel.querySelector(".sdz-composer").addEventListener("submit", onSubmit);
    panel.querySelector(".sdz-attach input").addEventListener("change", onAttach);
  }

  function togglePanel() {
    isOpen ? closePanel() : openPanel();
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

  function onSubmit(ev) {
    ev.preventDefault();
    const input = ev.currentTarget.querySelector(".sdz-input");
    const text = input.value.trim();
    if (!text) return;
    addMessage({ kind: "text", body: text });
    input.value = "";
  }

  function onAttach(ev) {
    const files = Array.from(ev.currentTarget.files || []);
    files.forEach((f) => {
      addMessage({
        kind: "file",
        body: f.name,
        meta: `${formatBytes(f.size)} · ${f.type || "application/octet-stream"}`,
      });
    });
    ev.currentTarget.value = "";
  }

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

  // initial mount
  ensureHost();

  // re-assert on SPA navigation (Skool tears down + remounts the DOM aggressively)
  const observer = new MutationObserver(() => {
    if (!document.getElementById(HOST_ID)) {
      ensureHost();
      // re-render messages we had in this tab's session
      messages.forEach(renderMessage);
      if (isOpen) openPanel();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: false });

  window.addEventListener("popstate", () => {
    if (!document.getElementById(HOST_ID)) ensureHost();
  });
})();
