// skool-dropzone — panel layout: which side, how wide, where the SDZ button sits.
// (ROADMAP U9 + U1; operator screenshots 2026-11-20: a fixed position always
// collided with something — Skool's chat button, then Skool Extensions' send
// button, then the full-height panel over Skool's own bottom bar.)
//
// Rules this owns:
//   - The width is always between MIN_WIDTH and the smaller of MAX_WIDTH and
//     MAX_SHARE of the window, whatever was stored or dragged.
//   - The SDZ button always stays fully inside the window (a stored position from
//     a bigger screen is pulled back in, never left off-screen and unclickable).
//   - A press on the SDZ button that moves less than DRAG_THRESHOLD px is a CLICK
//     (open/close); more is a DRAG (move it). A drag never also toggles the panel.
//   - Preferences live in chrome.storage.sync (follow the user across machines),
//     falling back to local, falling back to defaults. A storage failure never
//     breaks the panel; it only means the choice is not remembered.

(function () {
  "use strict";

  const MIN_WIDTH = 300;
  const MAX_WIDTH = 900;
  const MAX_SHARE = 0.7;
  const DEFAULT_WIDTH = 360;
  const MARKER_MARGIN = 6;
  const DRAG_THRESHOLD = 4;
  const STORE_KEY = "sdzLayout";

  const DEFAULTS = { side: "right", width: DEFAULT_WIDTH, marker: null }; // marker: {x, y} = top-left px

  function clampWidth(width, viewportWidth) {
    const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewportWidth * MAX_SHARE)));
    const w = Number(width);
    if (!Number.isFinite(w)) return Math.min(DEFAULT_WIDTH, max);
    return Math.max(MIN_WIDTH, Math.min(max, Math.round(w)));
  }

  function clampMarker(pos, size, viewport) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
    const maxX = Math.max(MARKER_MARGIN, viewport.width - size.width - MARKER_MARGIN);
    const maxY = Math.max(MARKER_MARGIN, viewport.height - size.height - MARKER_MARGIN);
    return {
      x: Math.max(MARKER_MARGIN, Math.min(maxX, Math.round(pos.x))),
      y: Math.max(MARKER_MARGIN, Math.min(maxY, Math.round(pos.y))),
    };
  }

  function normalize(raw, viewport) {
    const p = Object.assign({}, DEFAULTS, raw && typeof raw === "object" ? raw : {});
    return {
      side: p.side === "left" ? "left" : "right",
      width: clampWidth(p.width, viewport.width),
      marker: p.marker && typeof p.marker === "object" ? { x: Number(p.marker.x), y: Number(p.marker.y) } : null,
    };
  }

  // Width a drag produces: the grip sits on the panel's inner edge, so on the
  // right side the width grows as the pointer moves LEFT, on the left side RIGHT.
  function widthFromDrag(side, pointerX, viewportWidth) {
    const raw = side === "left" ? pointerX : viewportWidth - pointerX;
    return clampWidth(raw, viewportWidth);
  }

  function isDrag(dx, dy) {
    return Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD;
  }

  // --- storage (sync -> local -> nothing) ---
  function storageArea() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage) return chrome.storage.sync || chrome.storage.local || null;
    } catch (e) {
      /* extension context gone (extension reloaded under the page) */
    }
    return null;
  }

  function load() {
    return new Promise((resolve) => {
      const area = storageArea();
      if (!area) return resolve(null);
      try {
        area.get(STORE_KEY, (r) => resolve((r && r[STORE_KEY]) || null));
      } catch (e) {
        resolve(null);
      }
    });
  }

  function save(prefs) {
    const area = storageArea();
    if (!area) return;
    try {
      area.set({ [STORE_KEY]: prefs });
    } catch (e) {
      /* not remembered this time; the layout on screen is still right */
    }
  }

  const api = { clampWidth, clampMarker, normalize, widthFromDrag, isDrag, load, save, DEFAULTS, MIN_WIDTH, MAX_WIDTH, MAX_SHARE, DRAG_THRESHOLD };
  if (typeof window !== "undefined") window.SDZLayout = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
