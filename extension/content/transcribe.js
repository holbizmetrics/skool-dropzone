// === skool-dropzone — live transcription (v0, mic-based) ===
// Uses Chrome's built-in Web Speech API (webkitSpeechRecognition).
//
// Honest scope of v0:
//  - It transcribes what YOUR MICROPHONE hears. Your own speech is reliable;
//    other participants are only picked up if their audio plays through
//    speakers the mic can hear (headphones = you-only).
//  - Chrome's recognizer streams the mic audio to Google's speech service.
//    That is OUTSIDE the room's E2EE — the transcript itself never touches
//    the transport, but the raw audio goes to Google. The UI says so.
//  - Tab-audio capture of all participants (tabCapture + local Whisper) is
//    the planned v2 and deliberately not attempted here.
(() => {
  const PANEL_ID = "skool-dropzone-panel";
  const BOX_CLASS = "sdz-transcript";

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let rec = null;
  let running = false; // user intent: keep transcribing (drives auto-restart)
  let lang = "en-US";
  const lines = []; // { ts, text }
  let startedAt = null;

  function panel() {
    return document.getElementById(PANEL_ID);
  }

  function ensureBox() {
    const p = panel();
    if (!p) return null;
    let box = p.querySelector(`.${BOX_CLASS}`);
    if (box) return box;
    box = document.createElement("div");
    box.className = BOX_CLASS;
    box.hidden = true;
    box.innerHTML = `
      <div class="sdz-tx-controls">
        <button type="button" class="sdz-btn sdz-tx-start">● Start</button>
        <select class="sdz-tx-lang" title="Recognition language">
          <option value="en-US">English</option>
          <option value="de-DE">Deutsch</option>
        </select>
        <button type="button" class="sdz-btn sdz-tx-download" disabled>⬇ Save .txt</button>
      </div>
      <div class="sdz-tx-note">Mic-based: speakers on = others audible too; headphones = you only. Audio goes to Google for recognition (not E2EE).</div>
      <div class="sdz-tx-lines" role="log" aria-live="polite"></div>
      <div class="sdz-tx-interim"></div>
    `;
    // Sits between the tools row and the messages list.
    const tools = p.querySelector(".sdz-tools");
    if (tools && tools.nextSibling) p.insertBefore(box, tools.nextSibling);
    else p.appendChild(box);

    box.querySelector(".sdz-tx-start").addEventListener("click", onStartStop);
    box.querySelector(".sdz-tx-lang").addEventListener("change", (e) => {
      lang = e.target.value;
      if (running) {
        // restart with the new language
        stopRec();
        startRec();
      }
    });
    box.querySelector(".sdz-tx-lang").value = lang;
    box.querySelector(".sdz-tx-download").addEventListener("click", download);
    lines.forEach((l) => renderLine(box, l));
    syncControls(box);
    return box;
  }

  function toggle() {
    const box = ensureBox();
    if (!box) return;
    box.hidden = !box.hidden;
  }

  function onStartStop() {
    if (running) {
      running = false;
      stopRec();
      syncControls(ensureBox());
    } else {
      if (!SR) {
        setInterim("Speech recognition not available in this browser (Chrome required).");
        return;
      }
      running = true;
      if (!startedAt) startedAt = new Date();
      startRec();
      syncControls(ensureBox());
    }
  }

  function startRec() {
    if (rec) stopRec();
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const text = (r[0] && r[0].transcript ? r[0].transcript : "").trim();
        if (!text) continue;
        if (r.isFinal) addLine(text);
        else interim += text + " ";
      }
      setInterim(interim.trim());
    };

    rec.onerror = (ev) => {
      // 'no-speech' / 'aborted' are routine — onend's auto-restart handles them.
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        running = false;
        setInterim("Microphone access denied — allow the mic for skool.com and press Start again.");
        syncControls(ensureBox());
      } else if (ev.error === "network") {
        setInterim("Speech service unreachable (network) — retrying…");
      }
    };

    // Chrome ends recognition on its own every so often (silence, service
    // limits). While the user wants it running, restart — that's what makes
    // "continuous" actually continuous.
    rec.onend = () => {
      if (running) {
        setTimeout(() => {
          if (running) {
            try {
              startRec();
            } catch {
              /* next onend retries */
            }
          }
        }, 250);
      }
    };

    try {
      rec.start();
    } catch {
      /* start() throws if called while already started — harmless */
    }
  }

  function stopRec() {
    if (!rec) return;
    rec.onend = null; // no auto-restart on a deliberate stop
    rec.onresult = null;
    rec.onerror = null;
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
    rec = null;
    setInterim("");
  }

  function addLine(text) {
    const line = { ts: Date.now(), text };
    lines.push(line);
    const box = ensureBox();
    if (box) {
      renderLine(box, line);
      const dl = box.querySelector(".sdz-tx-download");
      if (dl) dl.disabled = false;
    }
  }

  function renderLine(box, line) {
    const list = box.querySelector(".sdz-tx-lines");
    if (!list) return;
    const div = document.createElement("div");
    div.className = "sdz-tx-line";
    const t = new Date(line.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const time = document.createElement("span");
    time.className = "sdz-tx-time";
    time.textContent = t;
    const body = document.createElement("span");
    body.className = "sdz-tx-text";
    body.textContent = line.text;
    div.appendChild(time);
    div.appendChild(body);
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  function setInterim(text) {
    const box = ensureBox();
    if (!box) return;
    const el = box.querySelector(".sdz-tx-interim");
    if (el) el.textContent = text;
  }

  function syncControls(box) {
    if (!box) return;
    const btn = box.querySelector(".sdz-tx-start");
    if (btn) {
      btn.textContent = running ? "■ Stop" : "● Start";
      btn.classList.toggle("sdz-tx-live", running);
    }
  }

  function download() {
    if (!lines.length) return;
    const stamp = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ` +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const header = `skool-dropzone transcript — started ${stamp(startedAt || new Date())} — ${lines.length} lines\n\n`;
    const body = lines
      .map((l) => `[${new Date(l.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}] ${l.text}`)
      .join("\n");
    const blob = new Blob([header + body], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const d = startedAt || new Date();
    a.download = `skool-transcript-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  window.SDZTranscribe = { toggle };
})();
