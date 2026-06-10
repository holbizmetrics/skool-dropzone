// skool-dropzone — screen share (Phase 8 feature)
//
// Member-side, peer-to-peer screen share for meetings where no owner/admin is
// present to enable the host platform's own share. Any member can present their
// screen to the room.
//
// CONSENT + SLOT (SECURITY-AUDIT H-media fix): an incoming share does NOT
// auto-open fullscreen — that let any member force a fullscreen onto everyone
// and flood it. Instead the viewer gets a dismissible consent prompt; only an
// explicit "View" goes fullscreen. One presenter at a time: a track from a
// different peer while one is active/prompting is ignored. Teardown is
// deterministic via an explicit screen-stop message + track end/mute.
//
// SECURITY BOUNDARY (labelled): the video rides WebRTC DTLS-SRTP, keyed from the
// SDP handshake — NOT the SDZCrypto room passphrase. Encrypted in transit and
// the relay is not a media server, but NOT under the passphrase-E2EE umbrella
// that chat/files get. See SECURITY-AUDIT.md (H-media).
//
// Public API (window.SDZScreenShare):
//   toggle(transport) -> {ok, sharing?, reason?}   presenter: start/stop
//   showRemote(stream, fromPeer)                    viewer: consent prompt
//   handleMessage(obj, fromPeer) -> bool            route __sdz-screen-stop
//   hideRemote()                                    close prompt/overlay
//   active (getter)                                 prompt or overlay open

(() => {
  let overlay = null; // fullscreen viewer (after consent)
  let banner = null; // consent prompt (before fullscreen)
  let currentPeer = null; // the peer whose share we're prompting/showing
  let pendingStream = null; // stream awaiting consent

  function teardownStreamListeners(stream) {
    const vt = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    if (vt) {
      vt.removeEventListener("ended", hideRemote);
      vt.removeEventListener("mute", hideRemote);
    }
  }

  function hideRemote() {
    if (pendingStream) teardownStreamListeners(pendingStream);
    if (banner) {
      try {
        banner.remove();
      } catch {}
      banner = null;
    }
    if (overlay) {
      try {
        overlay.remove();
      } catch {}
      overlay = null;
    }
    currentPeer = null;
    pendingStream = null;
  }

  // The presenter ended/left -> close on the track itself too (covers an abrupt
  // drop where no screen-stop message arrives).
  function watchStream(stream) {
    const vt = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    if (vt) {
      vt.addEventListener("ended", hideRemote);
      vt.addEventListener("mute", hideRemote);
    }
  }

  function openFullscreen() {
    if (!pendingStream) return;
    const stream = pendingStream;
    if (banner) {
      try {
        banner.remove();
      } catch {}
      banner = null;
    }
    overlay = document.createElement("div");
    overlay.className = "sdz-present-overlay";

    const bar = document.createElement("div");
    bar.className = "sdz-present-bar";

    const title = document.createElement("span");
    title.className = "sdz-present-title";
    title.textContent = "A member is sharing their screen";
    bar.appendChild(title);

    const note = document.createElement("span");
    note.className = "sdz-present-note";
    note.textContent = "encrypted in transit — not under your room passphrase";
    bar.appendChild(note);

    const closeBtn = document.createElement("button");
    closeBtn.className = "sdz-present-close";
    closeBtn.textContent = "Leave ✕";
    closeBtn.addEventListener("click", hideRemote);
    bar.appendChild(closeBtn);

    const video = document.createElement("video");
    video.className = "sdz-present-media";
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // video-only; muted lets autoplay proceed
    video.srcObject = stream;
    if (video.play) video.play().catch(() => {});

    overlay.appendChild(bar);
    overlay.appendChild(video);
    document.documentElement.appendChild(overlay);
  }

  // Small fixed banner (inline styles via element.style — MV3 allows that, not
  // inline <style>). NOT fullscreen: the viewer chooses whether to open it.
  function showConsent() {
    banner = document.createElement("div");
    banner.className = "sdz-share-consent";
    const s = banner.style;
    s.position = "fixed";
    s.top = "16px";
    s.left = "50%";
    s.transform = "translateX(-50%)";
    s.zIndex = "2147483647";
    s.background = "#111827";
    s.color = "#fff";
    s.padding = "10px 14px";
    s.borderRadius = "10px";
    s.font = "14px system-ui, sans-serif";
    s.boxShadow = "0 6px 24px rgba(0,0,0,.4)";
    s.display = "flex";
    s.gap = "10px";
    s.alignItems = "center";

    const label = document.createElement("span");
    label.textContent = "🖥 A member wants to share their screen";
    banner.appendChild(label);

    const view = document.createElement("button");
    view.textContent = "View";
    view.style.cssText = "background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;";
    view.addEventListener("click", openFullscreen);
    banner.appendChild(view);

    const dismiss = document.createElement("button");
    dismiss.textContent = "Dismiss";
    dismiss.style.cssText = "background:transparent;color:#9ca3af;border:0;padding:6px 8px;cursor:pointer;";
    dismiss.addEventListener("click", hideRemote);
    banner.appendChild(dismiss);

    document.documentElement.appendChild(banner);
  }

  // Viewer side: a peer's screen-share track arrived. Do NOT auto-fullscreen.
  function showRemote(stream, fromPeer) {
    // Single presenter: a different peer can't seize the slot while one is held.
    if ((overlay || banner) && currentPeer && currentPeer !== fromPeer) return;
    // Same peer renegotiated (e.g. a new track) while we're already showing it.
    if (overlay && currentPeer === fromPeer) {
      const v = overlay.querySelector("video");
      if (v) v.srcObject = stream;
      pendingStream = stream;
      return;
    }
    // Already prompting for this peer — don't stack prompts.
    if (banner && currentPeer === fromPeer) {
      pendingStream = stream;
      return;
    }
    currentPeer = fromPeer;
    pendingStream = stream;
    watchStream(stream);
    showConsent();
  }

  // Deterministic teardown when the presenter stops (removeTrack surfaces as
  // 'mute', not 'ended', so the explicit message is what reliably closes us).
  function handleMessage(obj, fromPeer) {
    if (!obj || obj.kind !== "__sdz-screen-stop") return false;
    if (fromPeer === currentPeer) hideRemote();
    return true;
  }

  // Presenter side: start or stop sharing via the transport.
  async function toggle(transport) {
    transport = transport || window.SDZTransport;
    if (!transport || !transport.joined) {
      return { ok: false, reason: "Join the room first." };
    }
    if (transport.sharing) {
      transport.stopScreen();
      return { ok: true, sharing: false };
    }
    const r = await transport.shareScreen();
    return r.ok ? { ok: true, sharing: true } : r;
  }

  window.SDZScreenShare = {
    toggle,
    showRemote,
    handleMessage,
    hideRemote,
    get active() {
      return !!(overlay || banner);
    },
  };
})();
