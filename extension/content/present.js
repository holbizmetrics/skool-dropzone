// skool-dropzone — presentation module (Phase 5)
//
// Shared by the meeting panel and the test harness. One presenter pushes a
// file (image / video / PDF) to everyone over the E2EE channel; it opens
// fullscreen for all viewers; presenter controls (video play/pause/seek,
// PDF page) sync to viewers.
//
// Wire protocol (all via SDZTransport.send, so encrypted end-to-end):
//   present-start {id,name,type,total} / present-chunk {id,seq,data} /
//   present-end {id}            — distribute the file
//   present-control {control}   — presenter drives playback / pages
//   present-close {}            — presenter ended; viewers close
//
// Public API (window.SDZPresent):
//   presentFile(file, transport)  — presenter flow (local overlay + broadcast)
//   handleMessage(obj) -> bool    — route an incoming present-* message
//   close()                       — close any open overlay
//   active (getter)               — is an overlay open

(() => {
  let active = null; // { overlay, url, ownsUrl, applyControl, applyPage, mode }
  const incoming = new Map(); // id -> { name, type, total, parts[], received }

  // Presenter slot guard (Phase 8 hardening of the Phase 5 "last Present wins"
  // limit). We hold a soft lock for the two common races:
  //   - you can't start presenting over a presentation you're WATCHING
  //   - an incoming presentation can't hijack YOUR screen while you present
  // The remaining race (two people hit Present in the same instant, before
  // either sees the other) still resolves last-wins among viewers — a true
  // global lock needs a peerId-tiebreak claim token (deferred, see ROADMAP).
  function busyAsPresenter() {
    return !!(active && active.mode === "presenter");
  }
  function watchingSomeoneElse() {
    return !!(active && active.mode === "viewer");
  }

  function reassemble(parts, type) {
    const bufs = parts.map((b) => window.SDZCrypto.fromB64(b || ""));
    let len = 0;
    bufs.forEach((b) => (len += b.length));
    const all = new Uint8Array(len);
    let off = 0;
    bufs.forEach((b) => {
      all.set(b, off);
      off += b.length;
    });
    return new Blob([all], { type: type || "application/octet-stream" });
  }

  function kindOf(name, type) {
    const n = (name || "").toLowerCase();
    if ((type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(n)) return "image";
    if ((type || "").startsWith("video/") || /\.(mp4|webm|mov)$/.test(n)) return "video";
    if (type === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
    return "other";
  }

  function open({ name, type, url, mode, onControl, ownsUrl }) {
    close();
    const kind = kindOf(name, type);
    let pdfPage = 1;

    const overlay = document.createElement("div");
    overlay.className = "sdz-present-overlay";

    const bar = document.createElement("div");
    bar.className = "sdz-present-bar";

    const title = document.createElement("span");
    title.className = "sdz-present-title";
    title.textContent = (mode === "viewer" ? "A member is presenting — " : "Presenting — ") + name;
    bar.appendChild(title);

    let media;
    if (kind === "image") {
      media = document.createElement("img");
      media.src = url;
      media.alt = name;
    } else if (kind === "video") {
      media = document.createElement("video");
      media.src = url;
      media.controls = mode !== "viewer"; // viewers follow the presenter, no scrubbing
      if (mode === "presenter" && onControl) {
        media.addEventListener("play", () => onControl({ action: "video", state: "play", time: media.currentTime }));
        media.addEventListener("pause", () => onControl({ action: "video", state: "pause", time: media.currentTime }));
        media.addEventListener("seeked", () =>
          onControl({ action: "video", state: media.paused ? "pause" : "play", time: media.currentTime })
        );
      }
    } else {
      // pdf / other → iframe (Chrome's PDF viewer honors #page=N best-effort)
      media = document.createElement("iframe");
      media.src = url + (kind === "pdf" ? "#page=1" : "");
    }
    media.className = "sdz-present-media";

    if (mode === "presenter" && kind === "pdf") {
      const prev = document.createElement("button");
      prev.className = "sdz-present-btn";
      prev.textContent = "‹ Prev";
      const next = document.createElement("button");
      next.className = "sdz-present-btn";
      next.textContent = "Next ›";
      prev.addEventListener("click", () => {
        pdfPage = Math.max(1, pdfPage - 1);
        media.src = url + "#page=" + pdfPage;
        onControl && onControl({ action: "pdf-page", page: pdfPage });
      });
      next.addEventListener("click", () => {
        pdfPage += 1;
        media.src = url + "#page=" + pdfPage;
        onControl && onControl({ action: "pdf-page", page: pdfPage });
      });
      bar.appendChild(prev);
      bar.appendChild(next);
    }

    const note = document.createElement("span");
    note.className = "sdz-present-note";
    note.textContent =
      mode === "presenter"
        ? "everyone in the room sees this"
        : mode === "viewer"
        ? "following the presenter"
        : "local preview — join a room to present to others";
    bar.appendChild(note);

    const closeBtn = document.createElement("button");
    closeBtn.className = "sdz-present-close";
    closeBtn.textContent = mode === "viewer" ? "Leave ✕" : "End ✕";
    closeBtn.addEventListener("click", () => {
      if (mode === "presenter" && onControl) onControl({ action: "close" });
      close();
    });
    bar.appendChild(closeBtn);

    overlay.appendChild(bar);
    overlay.appendChild(media);
    document.documentElement.appendChild(overlay);

    function applyControl(c) {
      if (!c) return;
      if (c.action === "video" && kind === "video") {
        if (typeof c.time === "number" && Math.abs(media.currentTime - c.time) > 0.5) media.currentTime = c.time;
        if (c.state === "play") media.play().catch(() => {});
        else media.pause();
      } else if (c.action === "pdf-page" && kind === "pdf") {
        pdfPage = c.page;
        media.src = url + "#page=" + pdfPage;
      }
    }

    const onEsc = (e) => {
      if (e.key === "Escape") {
        if (mode === "presenter" && onControl) onControl({ action: "close" });
        close();
      }
    };
    document.addEventListener("keydown", onEsc);

    active = { overlay, url, ownsUrl, applyControl, onEsc, mode };
  }

  function close() {
    if (!active) return;
    try {
      document.removeEventListener("keydown", active.onEsc);
    } catch {}
    try {
      active.overlay.remove();
    } catch {}
    if (active.ownsUrl && active.url) {
      try {
        URL.revokeObjectURL(active.url);
      } catch {}
    }
    active = null;
  }

  async function presentFile(file, transport) {
    if (watchingSomeoneElse()) {
      return { ok: false, reason: "Someone is already presenting — wait for them to finish." };
    }
    const url = URL.createObjectURL(file);
    if (transport && transport.joined) {
      open({
        name: file.name,
        type: file.type,
        url,
        mode: "presenter",
        ownsUrl: true,
        onControl: (c) => {
          if (c.action === "close") transport.send({ kind: "present-close" });
          else transport.send({ kind: "present-control", control: c });
        },
      });
      await transport.sendFile(file, null, "present");
    } else {
      open({ name: file.name, type: file.type, url, mode: "local", ownsUrl: true });
    }
    return { ok: true };
  }

  // === Phase 7: type-as-slides ===
  //
  // A slide deck is pure text (no file transfer) — a small array of
  // { title, bullets[] } objects. The presenter builds slides in chat and
  // promotes them; the whole deck rides one encrypted `slide-show` frame and
  // page-turns sync via `slide-page`. Reuses the present overlay shell + the
  // shared `present-close` teardown.

  function renderSlide(slide, index, count) {
    const el = document.createElement("div");
    el.className = "sdz-slide";
    if (slide && slide.title) {
      const h = document.createElement("h1");
      h.className = "sdz-slide-title";
      h.textContent = slide.title;
      el.appendChild(h);
    }
    const bullets = (slide && slide.bullets) || [];
    if (bullets.length) {
      const ul = document.createElement("ul");
      ul.className = "sdz-slide-bullets";
      bullets.forEach((b) => {
        const li = document.createElement("li");
        li.textContent = b;
        ul.appendChild(li);
      });
      el.appendChild(ul);
    }
    if (count > 1) {
      const pg = document.createElement("div");
      pg.className = "sdz-slide-page";
      pg.textContent = `${index + 1} / ${count}`;
      el.appendChild(pg);
    }
    return el;
  }

  function openSlides({ slides, mode, startIndex, onControl }) {
    close();
    let idx = Math.min(Math.max(0, startIndex || 0), slides.length - 1);

    const overlay = document.createElement("div");
    overlay.className = "sdz-present-overlay";

    const bar = document.createElement("div");
    bar.className = "sdz-present-bar";
    const title = document.createElement("span");
    title.className = "sdz-present-title";
    title.textContent = mode === "viewer" ? "A member is presenting slides" : "Presenting slides";
    bar.appendChild(title);

    const stage = document.createElement("div");
    stage.className = "sdz-present-media sdz-slide-stage";

    function paint() {
      stage.innerHTML = "";
      stage.appendChild(renderSlide(slides[idx], idx, slides.length));
    }

    if (mode === "presenter" && slides.length > 1) {
      const prev = document.createElement("button");
      prev.className = "sdz-present-btn";
      prev.textContent = "‹ Prev";
      const next = document.createElement("button");
      next.className = "sdz-present-btn";
      next.textContent = "Next ›";
      prev.addEventListener("click", () => {
        idx = Math.max(0, idx - 1);
        paint();
        onControl && onControl({ action: "slide-page", index: idx });
      });
      next.addEventListener("click", () => {
        idx = Math.min(slides.length - 1, idx + 1);
        paint();
        onControl && onControl({ action: "slide-page", index: idx });
      });
      bar.appendChild(prev);
      bar.appendChild(next);
    }

    const note = document.createElement("span");
    note.className = "sdz-present-note";
    note.textContent =
      mode === "presenter" ? "everyone in the room sees this" : mode === "viewer" ? "following the presenter" : "local preview";
    bar.appendChild(note);

    const closeBtn = document.createElement("button");
    closeBtn.className = "sdz-present-close";
    closeBtn.textContent = mode === "viewer" ? "Leave ✕" : "End ✕";
    closeBtn.addEventListener("click", () => {
      if (mode === "presenter" && onControl) onControl({ action: "close" });
      close();
    });
    bar.appendChild(closeBtn);

    overlay.appendChild(bar);
    overlay.appendChild(stage);
    document.documentElement.appendChild(overlay);
    paint();

    const onEsc = (e) => {
      if (e.key === "Escape") {
        if (mode === "presenter" && onControl) onControl({ action: "close" });
        close();
      }
    };
    document.addEventListener("keydown", onEsc);

    active = {
      overlay,
      url: null,
      ownsUrl: false,
      onEsc,
      mode,
      applyPage: (i) => {
        idx = Math.min(Math.max(0, i), slides.length - 1);
        paint();
      },
    };
  }

  // slides: array of { title, bullets[] }. Returns {ok} like presentFile.
  function presentSlides(slides, transport, startIndex) {
    if (watchingSomeoneElse()) {
      return { ok: false, reason: "Someone is already presenting — wait for them to finish." };
    }
    if (!Array.isArray(slides) || slides.length === 0) {
      return { ok: false, reason: "Nothing to present — add a title or some bullets first." };
    }
    const id = (crypto.randomUUID && crypto.randomUUID()) || "s" + Math.random().toString(36).slice(2);
    const start = startIndex || 0;
    if (transport && transport.joined) {
      openSlides({
        slides,
        mode: "presenter",
        startIndex: start,
        onControl: (c) => {
          if (c.action === "close") transport.send({ kind: "present-close" });
          else if (c.action === "slide-page") transport.send({ kind: "slide-page", index: c.index });
        },
      });
      transport.send({ kind: "slide-show", id, slides, index: start });
    } else {
      openSlides({ slides, mode: "local", startIndex: start });
    }
    return { ok: true };
  }

  function handleMessage(obj) {
    if (!obj || !obj.kind) return false;
    switch (obj.kind) {
      case "present-start":
        // Don't let a peer's presentation hijack your screen while YOU present.
        if (busyAsPresenter()) return true; // swallow; we hold the slot
        incoming.set(obj.id, { name: obj.name, type: obj.type, total: obj.total, parts: new Array(obj.total), received: 0 });
        return true;
      case "present-chunk": {
        const t = incoming.get(obj.id);
        if (t && t.parts[obj.seq] === undefined) {
          t.parts[obj.seq] = obj.data;
          t.received++;
        }
        return true;
      }
      case "present-end": {
        const t = incoming.get(obj.id);
        if (t) {
          const blob = reassemble(t.parts, t.type);
          open({ name: t.name, type: t.type, url: URL.createObjectURL(blob), mode: "viewer", ownsUrl: true });
          incoming.delete(obj.id);
        }
        return true;
      }
      case "present-control":
        if (active && active.applyControl) active.applyControl(obj.control);
        return true;
      case "present-close":
        close();
        return true;
      case "slide-show":
        if (busyAsPresenter()) return true; // we hold the slot; ignore peer deck
        openSlides({ slides: obj.slides || [], mode: "viewer", startIndex: obj.index || 0 });
        return true;
      case "slide-page":
        if (active && active.applyPage) active.applyPage(obj.index || 0);
        return true;
    }
    return false;
  }

  window.SDZPresent = {
    presentFile,
    presentSlides,
    handleMessage,
    close,
    get active() {
      return !!active;
    },
  };
})();
