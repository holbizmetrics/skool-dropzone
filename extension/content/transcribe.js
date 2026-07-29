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
//  - F2 (SECURITY-AUDIT-VERIFICATION 2026-07-19): the ROOM must see it too,
//    not just the operator running it — other participants' speech can reach
//    Google via this feature. The ONLY thing that ever crosses the transport
//    is a tiny tx-status on/off frame (consent visibility); transcript
//    content never does.
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
  let visible = false; // box visibility survives panel DOM re-mounts
  // Liveness (live-test finding 2026-07-29): the recognizer died mid-meeting
  // and the UI kept showing "recording". `running` is user INTENT — these
  // track what the recognizer is actually doing, and a watchdog restarts it
  // when it goes quiet without saying so.
  let lastEventAt = 0; // last sign of life from the recognizer
  let watchdog = null;
  const WATCHDOG_MS = 20000; // silence >20s with no recognizer event = stalled

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
        <span class="sdz-tx-state" hidden></span>
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
    visible = !box.hidden;
  }

  // Called by panel.js after Skool wipes the DOM and the panel is rebuilt:
  // recognition (rec/running/lines) lives in this closure and survived, but
  // the box element died with the old panel. Recreate it in the same state.
  function remount() {
    if (!visible && !running && !lines.length) return; // nothing to restore
    const box = ensureBox();
    if (box) box.hidden = !visible;
    setState(lastState); // the badge element died with the old panel DOM
  }

  // F2: tell the room. A participant whose speech may reach Google's
  // recognizer deserves to see that it's happening — consent belongs to the
  // room, not just the member who clicked Start.
  function broadcastStatus(on) {
    const t = window.SDZTransport;
    if (t && t.joined) {
      try {
        t.send({ kind: "tx-status", on: !!on });
      } catch {
        /* status is best-effort; never blocks the feature */
      }
    }
  }

  function onStartStop() {
    if (running) {
      running = false;
      stopRec();
      syncControls(ensureBox());
      broadcastStatus(false);
    } else {
      if (!SR) {
        setInterim("Speech recognition not available in this browser (Chrome required).");
        return;
      }
      running = true;
      if (!startedAt) startedAt = new Date();
      startRec();
      syncControls(ensureBox());
      broadcastStatus(true);
    }
  }

  function startRec() {
    if (rec) stopRec();
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    lastEventAt = Date.now();

    rec.onstart = () => {
      lastEventAt = Date.now();
      setState("live");
    };
    rec.onaudiostart = () => {
      lastEventAt = Date.now();
    };

    rec.onresult = (ev) => {
      lastEventAt = Date.now();
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
      lastEventAt = Date.now();
      // 'no-speech' / 'aborted' are routine — onend's auto-restart handles them.
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        running = false;
        setInterim("Microphone access denied — allow the mic for skool.com and press Start again.");
        syncControls(ensureBox());
        broadcastStatus(false); // the room saw ON; it must also see the stop
      } else if (ev.error === "network") {
        setInterim("Speech service unreachable (network) — retrying…");
        setState("retrying");
      }
    };

    // Chrome ends recognition on its own every so often (silence, service
    // limits). While the user wants it running, restart — that's what makes
    // "continuous" actually continuous.
    rec.onend = () => {
      lastEventAt = Date.now();
      if (running) {
        setState("retrying");
        setTimeout(() => {
          if (running) startRec();
        }, 250);
      }
    };

    try {
      rec.start();
    } catch {
      // Live-test finding 2026-07-29: a failed start() used to be swallowed
      // with "next onend retries" — but a recognizer that never started never
      // fires onend, so the chain died silently while the UI said recording.
      // Schedule the retry ourselves; the watchdog is the backstop.
      setState("retrying");
      setTimeout(() => {
        if (running) startRec();
      }, 1000);
    }

    armWatchdog();
  }

  // Backstop for every silent-death mode we can't enumerate: if the user wants
  // transcription and the recognizer has shown no sign of life for WATCHDOG_MS,
  // tear it down and start fresh. A needless restart during real silence is
  // harmless (there is no interim text to lose); a dead recognizer that LOOKS
  // alive is the failure that cost a meeting's transcript.
  function armWatchdog() {
    if (watchdog) return;
    watchdog = setInterval(() => {
      if (!running) return;
      if (Date.now() - lastEventAt > WATCHDOG_MS) {
        setState("retrying");
        startRec(); // stops the old instance first
      }
    }, 5000);
  }

  function disarmWatchdog() {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }

  function stopRec() {
    if (!rec) return;
    rec.onend = null; // no auto-restart on a deliberate stop
    rec.onresult = null;
    rec.onerror = null;
    rec.onstart = null;
    rec.onaudiostart = null;
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
    rec = null;
    setInterim("");
    if (!running) {
      disarmWatchdog();
      setState("off");
    }
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

  // The badge tells the truth the Start button can't: whether the recognizer
  // is actually listening right now ("live"), between instances ("retrying"),
  // or off. `lastState` survives DOM re-mounts.
  let lastState = "off";
  function setState(state) {
    lastState = state;
    const box = ensureBox();
    if (!box) return;
    const el = box.querySelector(".sdz-tx-state");
    if (!el) return;
    if (state === "off") {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.dataset.state = state;
    el.textContent = state === "live" ? "● listening" : "↻ restarting…";
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

  window.SDZTranscribe = {
    toggle,
    remount,
    get lines() {
      return lines.slice(); // for the meeting archive
    },
  };
})();
