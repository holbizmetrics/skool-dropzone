// skool-dropzone — whiteboard module (Phase 6)
//
// Shared transparent canvas overlay everyone can draw on. Strokes broadcast
// over the E2EE channel; coordinates are normalized (0..1) so drawings align
// across different window sizes. Annotates over whatever's underneath
// (including a presentation overlay).
//
// Wire protocol (via SDZTransport.send, E2EE):
//   wb-stroke {stroke:{x0,y0,x1,y1,color,width,eraser}}   — one segment
//   wb-clear {}                                            — clear board
//
// Public API (window.SDZWhiteboard):
//   toggle(transport) / open(transport) / close()
//   handleMessage(obj) -> bool
//   active (getter)

(() => {
  const PALETTE = ["#ef4444", "#111827", "#2563eb", "#10b981", "#f59e0b", "#ffffff"];

  let overlay = null;
  let canvas = null;
  let ctx = null;
  let strokes = []; // normalized segments, replayed on resize
  let drawing = false;
  let last = null;
  let color = "#ef4444";
  let width = 3;
  let eraser = false;
  let transportRef = null;

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
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = norm(e);
      const seg = { x0: last.x, y0: last.y, x1: p.x, y1: p.y, color, width, eraser };
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

    const er = document.createElement("button");
    er.className = "sdz-wb-btn sdz-wb-eraser";
    er.textContent = "Eraser";
    er.addEventListener("click", () => {
      eraser = !eraser;
      markActive(tb);
    });
    tb.appendChild(er);

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
    const er = tb.querySelector(".sdz-wb-eraser");
    if (er) er.classList.toggle("sdz-wb-active", eraser);
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
  }

  function close() {
    if (!overlay) return;
    window.removeEventListener("resize", onResize);
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
      if (!overlay) open(window.SDZTransport); // a member started drawing — show it
      strokes.push(obj.stroke);
      if (strokes.length > MAX_STROKES) strokes.splice(0, strokes.length - MAX_STROKES);
      drawSeg(obj.stroke);
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
    handleMessage,
    get active() {
      return !!overlay;
    },
  };
})();
