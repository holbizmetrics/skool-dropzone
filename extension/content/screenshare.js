// skool-dropzone — screen share (Phase 8 feature)
//
// Member-side, peer-to-peer screen share for meetings where no owner/admin is
// present to enable the host platform's own share. Any member can present their
// screen to the room; viewers see it fullscreen. One presenter at a time
// (matches the present-slot model).
//
// SECURITY BOUNDARY (labelled in the UI): the video rides WebRTC DTLS-SRTP,
// keyed from the SDP handshake — NOT the SDZCrypto room passphrase. Encrypted in
// transit and the relay is not a media server, but it is NOT under the
// passphrase-E2EE umbrella that chat/files get. See SECURITY-AUDIT.md (H-media).
//
// Public API (window.SDZScreenShare):
//   toggle(transport) -> {ok, sharing?, reason?}   presenter: start/stop sharing
//   showRemote(stream, fromPeer)                    viewer: open the fullscreen view
//   hideRemote()                                    viewer: close it
//   active (getter)                                 is the viewer overlay open

(() => {
  let overlay = null;

  function hideRemote() {
    if (overlay) {
      try {
        overlay.remove();
      } catch {}
      overlay = null;
    }
  }

  // Viewer side: a peer started sharing — show their stream fullscreen.
  function showRemote(stream) {
    hideRemote();
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
    video.muted = true; // screen share is video-only; muted lets autoplay proceed
    video.srcObject = stream;
    video.play && video.play().catch(() => {}); // some browsers need an explicit kick

    overlay.appendChild(bar);
    overlay.appendChild(video);
    document.documentElement.appendChild(overlay);

    // When the presenter stops, the remote track ends -> close the viewer.
    const vt = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    if (vt) vt.addEventListener("ended", hideRemote);
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
    hideRemote,
    get active() {
      return !!overlay;
    },
  };
})();
