// skool-dropzone — meeting archive (Phase 11, the "memory" feature)
//
// Skool recordings expire after 14 days; this room's artifacts don't have to.
// One click bundles what the session holds — chat, transcript, whiteboard,
// shared-file list — into ONE self-contained HTML file that opens anywhere,
// forever, offline. No server, no account, no expiry: the meeting's memory
// outlives the call.
//
// buildArchiveHtml() is PURE (string in, string out) so the node harness can
// verify structure and — load-bearing — that peer-controlled content (chat
// bodies, file names, transcript text) is HTML-escaped. An archive is a
// document someone will open in a browser; unescaped peer text would be
// stored XSS with a delay timer.

(() => {
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return "";
    }
  }

  // data: { room, generatedAt, messages:[{kind,body,meta,ts,mine}],
  //         transcript:[{ts,text}], whiteboardPng: dataURL|null,
  //         files:[{name, meta}] }
  function buildArchiveHtml(data) {
    const d = data || {};
    const when = d.generatedAt ? new Date(d.generatedAt) : new Date();
    const parts = [];

    parts.push(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>skool-dropzone archive — ${esc(d.room || "meeting")}</title>
<style>
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111827; max-width: 760px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .meta { color: #6b7280; font-size: 13px; }
  .msg { margin: 6px 0; padding: 6px 10px; border-radius: 8px; background: #f3f4f6; }
  .msg.mine { background: #dbeafe; }
  .msg.system { background: none; color: #6b7280; font-size: 13px; font-style: italic; }
  .t { color: #9ca3af; font-size: 11px; margin-right: 8px; white-space: nowrap; }
  .filemeta { color: #6b7280; font-size: 12px; }
  img.wb { max-width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; }
  ul { padding-left: 20px; }
  footer { margin-top: 36px; color: #9ca3af; font-size: 12px; border-top: 1px solid #e5e7eb; padding-top: 8px; }
</style>
</head>
<body>
<h1>skool-dropzone — meeting archive</h1>
<div class="meta">Room: ${esc(d.room || "unknown")} · Saved: ${esc(when.toLocaleString())}</div>`);

    const msgs = Array.isArray(d.messages) ? d.messages : [];
    if (msgs.length) {
      parts.push(`<h2>Chat</h2>`);
      msgs.forEach((m) => {
        const cls = m.kind === "system" ? "msg system" : "msg" + (m.mine ? " mine" : "");
        const meta = m.meta ? ` <span class="filemeta">(${esc(m.meta)})</span>` : "";
        const icon = m.kind === "file" || m.kind === "file-progress" ? "📎 " : "";
        parts.push(`<div class="${cls}"><span class="t">${esc(fmtTime(m.ts))}</span>${icon}${esc(m.body)}${meta}</div>`);
      });
    }

    const tx = Array.isArray(d.transcript) ? d.transcript : [];
    if (tx.length) {
      parts.push(`<h2>Transcript</h2>`);
      parts.push(`<div class="meta">Mic-based (v0) — the operator's microphone view of the meeting, not a certified record.</div>`);
      tx.forEach((l) => {
        parts.push(`<div class="msg"><span class="t">${esc(fmtTime(l.ts))}</span>${esc(l.text)}</div>`);
      });
    }

    if (d.whiteboardPng && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d.whiteboardPng)) {
      parts.push(`<h2>Whiteboard</h2><img class="wb" alt="whiteboard snapshot" src="${d.whiteboardPng}">`);
    }

    const files = Array.isArray(d.files) ? d.files : [];
    if (files.length) {
      parts.push(`<h2>Files shared</h2><ul>`);
      files.forEach((f) => parts.push(`<li>📎 ${esc(f.name)} <span class="filemeta">${esc(f.meta || "")}</span></li>`));
      parts.push(`</ul><div class="meta">The files themselves live wherever they were downloaded during the meeting — this list is the record of what moved.</div>`);
    }

    parts.push(`<footer>Generated locally by skool-dropzone. This file is self-contained and private — share it deliberately, it holds the room's content.</footer>
</body>
</html>`);
    return parts.join("\n");
  }

  function save(data) {
    const html = buildArchiveHtml(data);
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const dt = new Date(data && data.generatedAt ? data.generatedAt : Date.now());
    const pad = (n) => String(n).padStart(2, "0");
    a.download = `skool-meeting-archive-${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}-${pad(dt.getHours())}${pad(dt.getMinutes())}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return html.length;
  }

  window.SDZArchive = { buildArchiveHtml, save };
})();
