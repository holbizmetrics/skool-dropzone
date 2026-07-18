// skool-dropzone — whiteboard module (Phase 6)
//
// Shared transparent canvas overlay everyone can draw on. Strokes broadcast
// over the E2EE channel; coordinates are normalized (0..1) so drawings align
// across different window sizes. Annotates over whatever's underneath
// (including a presentation overlay).
//
// Wire protocol (via SDZTransport.send, E2EE):
//   wb-stroke {stroke:{x0,y0,x1,y1,color,width,eraser,path}} — one segment;
//              `path` groups the segments of one pen-down..pen-up gesture so
//              it can be undone as a unit (older peers ignore the field)
//   wb-undo  {path}                                          — remove one gesture
//   wb-clear {}                                              — clear board
//
// Public API (window.SDZWhiteboard):
//   toggle(transport) / open(transport) / close()
//   undo()  — remove own last gesture (also bound to Ctrl+Z while open)
//   handleMessage(obj) -> bool
//   active (getter), strokeCount (getter, for the node harness)

(() => {
  const PALETTE = ["#ef4444", "#111827", "#2563eb", "#10b981", "#f59e0b", "#ffffff"];

  let overlay = null;
  let canvas = null;
  let ctx = null;
  let strokes = []; // normalized segments, replayed on resize
  let drawing = false;
  let last = null;
  let color = "#ef4444";
  let width = 4;
  let eraser = false;
  let transportRef = null;
  let currentPath = null; // id of the gesture being drawn
  const myPaths = []; // own gesture ids, newest last (undo stack)

  function newPathId() {
    return "p-" + Math.random().toString(36).slice(2, 10);
  }

  function broadcast(obj) {
    if (transportRef && transportRef.joined) transportRef.send(obj);
  }

  function sizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function drawSeg(s) {
    if (!ctx) return;
    ctx.globalCompositeOperation = s.eraser ? "destination-out" : "source-over";
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * (s.eraser ? 6 : 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(s.x0 * canvas.width, s.y0 * canvas.height);
    ctx.lineTo(s.x1 * canvas.width, s.y1 * canvas.height);
    ctx.stroke();
  }

  function redraw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(drawSeg);
  }

  function onResize() {
    sizeCanvas();
    redraw();
  }

  function norm(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function wireDraw() {
    canvas.addEventListener("pointerdown", (e) => {
      drawing = true;
      last = norm(e);
      currentPath = newPathId();
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = norm(e);
      // Register the gesture on its FIRST segment — a click without movement
      // draws nothing and must not become an empty entry in the undo stack.
      if (myPaths[myPaths.length - 1] !== currentPath) myPaths.push(currentPath);
      const seg = { x0: last.x, y0: last.y, x1: p.x, y1: p.y, color, width, eraser, path: currentPath };
      strokes.push(seg);
      drawSeg(seg);
      broadcast({ kind: "wb-stroke", stroke: seg });
      last = p;
    });
    const end = () => {
      drawing = false;
      last = null;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", end);
  }

  function buildToolbar() {
    const tb = document.createElement("div");
    tb.className = "sdz-wb-toolbar";

    PALETTE.forEach((c) => {
      const b = document.createElement("button");
      b.className = "sdz-wb-swatch";
      b.style.background = c;
      b.title = c;
      b.addEventListener("click", () => {
        color = c;
        eraser = false;
        markActive(tb);
      });
      b.dataset.color = c;
      tb.appendChild(b);
    });

    // pen width: three fixed sizes
    [
      ["S", 2],
      ["M", 4],
      ["L", 8],
    ].forEach(([label, w]) => {
      const b = document.createElement("button");
      b.className = "sdz-wb-btn sdz-wb-size";
      b.textContent = label;
      b.title = `Pen width ${w}px`;
      b.dataset.width = String(w);
      b.addEventListener("click", () => {
        width = w;
        markActive(tb);
      });
      tb.appendChild(b);
    });

    const er = document.createElement("button");
    er.className = "sdz-wb-btn sdz-wb-eraser";
    er.textContent = "Eraser";
    er.addEventListener("click", () => {
      eraser = !eraser;
      markActive(tb);
    });
    tb.appendChild(er);

    const un = document.createElement("button");
    un.className = "sdz-wb-btn";
    un.textContent = "Undo";
    un.title = "Remove your last stroke (Ctrl+Z)";
    un.addEventListener("click", undo);
    tb.appendChild(un);

    const sv = document.createElement("button");
    sv.className = "sdz-wb-btn";
    sv.textContent = "Save";
    sv.title = "Save the board as a PNG";
    sv.addEventListener("click", savePng);
    tb.appendChild(sv);

    const clr = document.createElement("button");
    clr.className = "sdz-wb-btn";
    clr.textContent = "Clear";
    clr.addEventListener("click", () => {
      doClear();
      broadcast({ kind: "wb-clear" });
    });
    tb.appendChild(clr);

    const cls = document.createElement("button");
    cls.className = "sdz-wb-btn sdz-wb-close";
    cls.textContent = "Close ✕";
    cls.addEventListener("click", () => close());
    tb.appendChild(cls);

    return tb;
  }

  function markActive(tb) {
    tb.querySelectorAll(".sdz-wb-swatch").forEach((s) => {
      s.classList.toggle("sdz-wb-active", !eraser && s.dataset.color === color);
    });
    tb.querySelectorAll(".sdz-wb-size").forEach((s) => {
      s.classList.toggle("sdz-wb-active", Number(s.dataset.width) === width);
    });
    const er = tb.querySelector(".sdz-wb-eraser");
    if (er) er.classList.toggle("sdz-wb-active", eraser);
  }

  function removePath(pathId) {
    const before = strokes.length;
    strokes = strokes.filter((s) => s.path !== pathId);
    if (strokes.length !== before) redraw();
  }

  function undo() {
    const pathId = myPaths.pop();
    if (!pathId) return;
    removePath(pathId);
    broadcast({ kind: "wb-undo", path: pathId });
  }

  function savePng() {
    if (!canvas) return;
    // Composite over white: the live canvas is transparent (it overlays the
    // meeting), and eraser strokes are punched-out alpha — both read as white
    // in the exported image.
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d");
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      a.download = `skool-whiteboard-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      undo();
    }
  }

  function doClear() {
    strokes = [];
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function open(transport) {
    if (overlay) return;
    transportRef = transport || window.SDZTransport || null;
    overlay = document.createElement("div");
    overlay.className = "sdz-wb-overlay";
    canvas = document.createElement("canvas");
    canvas.className = "sdz-wb-canvas";
    const tb = buildToolbar();
    overlay.appendChild(canvas);
    overlay.appendChild(tb);
    document.documentElement.appendChild(overlay);
    sizeCanvas();
    ctx = canvas.getContext("2d");
    redraw();
    wireDraw();
    markActive(tb);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown, true);
  }

  function close() {
    if (!overlay) return;
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeyDown, true);
    try {
      overlay.remove();
    } catch {}
    overlay = null;
    canvas = null;
    ctx = null;
    drawing = false;
    last = null;
    // strokes are kept so reopening restores the board within the session
  }

  function toggle(transport) {
    overlay ? close() : open(transport);
  }

  // Bound memory against a peer flooding wb-stroke frames (SECURITY-AUDIT P1/P2).
  // A real session stays well under this; a flood just rolls the oldest off.
  // (The whiteboard is collaborative — no single owner — so strokes/clear are
  // not sender-bound; making clear owner-only is a product decision, see audit.)
  const MAX_STROKES = 5000;

  function handleMessage(obj, fromPeer) {
    if (!obj || !obj.kind) return false;
    if (obj.kind === "wb-stroke") {
      if (!obj.stroke || typeof obj.stroke !== "object") return true; // ignore malformed
      if (!overlay) {
        // a member started drawing — show it (guarded: state still accumulates
        // when no DOM is available, e.g. the node harness)
        try {
          open(window.SDZTransport);
        } catch {}
      }
      strokes.push(obj.stroke);
      if (strokes.length > MAX_STROKES) strokes.splice(0, strokes.length - MAX_STROKES);
      drawSeg(obj.stroke);
      return true;
    }
    if (obj.kind === "wb-undo") {
      if (typeof obj.path !== "string" || !obj.path) return true; // ignore malformed
      removePath(obj.path);
      return true;
    }
    if (obj.kind === "wb-clear") {
      doClear();
      return true;
    }
    return false;
  }

  window.SDZWhiteboard = {
    toggle,
    open,
    close,
    undo,
    handleMessage,
    get active() {
      return !!overlay;
    },
    get strokeCount() {
      return strokes.length;
    },
  };
})();
