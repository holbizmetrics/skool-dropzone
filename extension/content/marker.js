(() => {
  const MARKER_ID = "skool-dropzone-marker";

  function ensureMarker() {
    if (document.getElementById(MARKER_ID)) return;
    const el = document.createElement("div");
    el.id = MARKER_ID;
    el.textContent = "SDZ";
    el.title = "skool-dropzone Phase 0 — extension loaded";
    document.documentElement.appendChild(el);
  }

  ensureMarker();

  const observer = new MutationObserver(ensureMarker);
  observer.observe(document.documentElement, { childList: true, subtree: false });

  window.addEventListener("popstate", ensureMarker);
})();
