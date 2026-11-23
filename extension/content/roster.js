// skool-dropzone — participant roster (ROADMAP U8, first slice: snapshot + copy)
//
// ONE place that knows how Skool's meeting DOM names its participants. Everything
// else (copy button now; transcript attribution U2, archive attendance, @-mentions
// later) asks this module and never scrapes the page itself.
//
// Honest bounds (also surfaced in the panel, not just here):
//   - Display names as Skool renders them, NOT identities. Never bind a permission
//     or a crypto claim to a roster entry; the room passphrase is the trust boundary.
//   - Selectors break when Skool restyles. Failure is LOUD: the result always says
//     which source it used and how many tiles it saw without a readable name, so a
//     stale selector reads as "selector out of date", never as "nobody is here".
//   - Video tiles are PAGINATED on big calls: the grid can show fewer people than
//     are present. Skool's People list (when open) is preferred because it lists
//     everyone; a tiles-only result says it may be partial.
//   - Local-only. Nothing here touches the transport; copying is an explicit click.
//
// Public API (window.SDZRoster):
//   read(root?) -> { names, source, tileCount, unnamed, partial }
//   describe(result) -> one-line human status for the panel
//   toText(names) / toCSV(names, isoTime)

(function () {
  "use strict";

  // Two generations of Skool's meeting UI:
  //   - Stream Video React SDK (verified live 2026-05-20): BEM class names below.
  //   - Agora (verified live 2026-11-20, console: "AgoraRTC client v4.24.8"; zero
  //     str-video classes on the page). Tiles live in a grid that carries STABLE
  //     data attributes: [data-columns][data-rows][data-ratio]. Each direct child
  //     of the grid is one participant tile. The name label is a styled-components
  //     class: "sc-3feb84fe-4 <hash>". Only the component half (sc-3feb84fe-4) is
  //     matched; it still changes when Skool rebuilds that component, and when it
  //     does the tiles are found but nameless, which reads "out of date" (loud).
  // Live chain 2026-11-20: grid > DIV.sc-10c7f5d7-2 > DIV.sc-3feb84fe-0 >
  //   DIV.sc-3feb84fe-4 > SPAN "Holger Morlok". One participant only: whether a
  //   grid child is exactly one tile with several people is NOT yet seen live.
  const SEL = {
    listItem: ".str-video__participant-listing-item",
    tile: ".str-video__participant-view",
    grid: "[data-columns][data-rows][data-ratio]",
    name: [
      ".str-video__participant-details__name",
      ".str-video__participant-listing-item__display-name",
      "[class*='participant-details__name']",
      "[class*='display-name']",
      "[class*='participant-name']",
      "[class*='sc-3feb84fe-4']",
    ],
  };

  // Participant tiles from either UI generation. Agora tiles have no class of
  // their own, so they are the grid's direct children.
  function findTiles(doc) {
    const tiles = Array.from(doc.querySelectorAll(SEL.tile));
    for (const grid of doc.querySelectorAll(SEL.grid)) {
      for (const child of Array.from(grid.children || [])) tiles.push(child);
    }
    return tiles;
  }

  function cleanName(raw) {
    if (typeof raw !== "string") return "";
    return raw.replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function nameOf(el) {
    for (const s of SEL.name) {
      const n = el.querySelector(s);
      const t = n && cleanName(n.textContent);
      if (t) return t;
    }
    return "";
  }

  // Dedupe preserving first-seen order. Two people with the same display name
  // collapse into one line here: that is a stated limit of display names, and
  // the count line in describe() uses the element count so it stays visible.
  function uniq(list) {
    const seen = new Set();
    const out = [];
    for (const n of list) {
      if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }

  function collect(els) {
    const names = [];
    let unnamed = 0;
    for (const el of els) {
      const n = nameOf(el);
      if (n) names.push(n); else unnamed++;
    }
    return { names, unnamed, count: els.length };
  }

  // callList: [{ uid, name }] from Skool's own participant data, relayed by
  // skool-bridge.js (2026-11-20). Preferred over everything on screen: it holds
  // everyone in the call, whether or not their tile is on the current page or
  // Skool's participant list is open.
  function read(root, callList) {
    if (Array.isArray(callList) && callList.length) {
      const names = [];
      let unnamed = 0;
      for (const p of callList) {
        const n = cleanName(p && p.name);
        if (n) names.push(n); else unnamed++;
      }
      if (names.length) {
        return { names: uniq(names), source: "call-data", tileCount: callList.length, unnamed, partial: false };
      }
    }
    const doc = root || document;
    const list = collect(Array.from(doc.querySelectorAll(SEL.listItem)));
    if (list.names.length) {
      return { names: uniq(list.names), source: "people-list", tileCount: list.count, unnamed: list.unnamed, partial: false };
    }
    const tiles = collect(findTiles(doc));
    return {
      names: uniq(tiles.names),
      source: tiles.names.length ? "video-tiles" : "none",
      tileCount: tiles.count,
      unnamed: tiles.unnamed,
      // Tiles are paginated, so a tiles-only roster is never claimed complete.
      partial: true,
    };
  }

  function describe(r) {
    if (r.source === "none") {
      return r.tileCount
        ? `Roster unavailable: found ${r.tileCount} participant tile(s) but no readable name in any. Skool's markup changed; the name selector in roster.js is out of date.`
        : "Roster unavailable: no participant tiles found on this page (is the meeting view open?).";
    }
    const from =
      r.source === "call-data" ? "Skool's call data (everyone in the call)" : r.source === "people-list" ? "Skool's People list" : "the video tiles";
    let s = `${r.names.length} name(s) from ${from}`;
    if (r.unnamed) s += `; ${r.unnamed} entr${r.unnamed === 1 ? "y" : "ies"} had no readable name and were skipped`;
    if (r.partial) s += ". Tiles are paginated, so this may miss people; open Skool's People list for the full roster";
    return s + ".";
  }

  function toText(names) {
    return names.join("\n");
  }

  function csvCell(v) {
    const s = String(v);
    // Quote always; double inner quotes; neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return '"' + safe.replace(/"/g, '""') + '"';
  }

  function toCSV(names, isoTime) {
    const rows = ["name,captured_at"];
    for (const n of names) rows.push(csvCell(n) + "," + csvCell(isoTime));
    return rows.join("\r\n");
  }

  const api = { read, describe, toText, toCSV, cleanName, findTiles, SEL };
  if (typeof window !== "undefined") window.SDZRoster = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
