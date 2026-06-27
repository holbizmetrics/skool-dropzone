// skool-dropzone — crypto core (Phase 2 foundation)
//
// E2EE primitives, transport-agnostic. Whatever carries the bytes (WebRTC
// data channel, signaling relay) only ever sees ciphertext produced here.
//
// Model:
//   - A per-room symmetric key is derived from a shared *passphrase* via
//     PBKDF2. The passphrase is agreed out-of-band by meeting participants
//     (e.g. spoken in the call) and is NEVER sent to the signaling relay.
//   - The signaling relay routes by meeting id (which it sees), but the
//     meeting id is NOT the encryption key — so the relay operator cannot
//     decrypt. This is what makes "no third-party read" real.
//   - Convenience fallback: if no passphrase is set, the key is derived
//     from the meeting id alone. This protects against passive network
//     eavesdroppers but NOT against the relay operator or Skool. The UI
//     must clearly flag this weaker mode.
//
// All functions are async (Web Crypto is promise-based) and pure — no
// global state, no network. Unit-testable in isolation.

(() => {
  const PBKDF2_ITERATIONS = 250000;
  const KEY_LENGTH_BITS = 256;
  const IV_LENGTH_BYTES = 12; // AES-GCM standard

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function toB64(bytes) {
    let bin = "";
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function fromB64(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  // Derive an AES-GCM key from a passphrase + salt (the meeting id).
  // mode: "passphrase" (relay-proof) or "id-only" (weaker, convenience).
  async function deriveKey(passphrase, meetingId) {
    const material = await crypto.subtle.importKey(
      "raw",
      enc.encode(passphrase || ""),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode("skool-dropzone:" + (meetingId || "")),
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      material,
      { name: "AES-GCM", length: KEY_LENGTH_BITS },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // A public, human-comparable "room safe-word": a few emoji deterministically
  // derived from the SAME passphrase + room. Everyone who joined the same room
  // with the same passphrase sees the SAME emoji; a mismatch means someone is in
  // a different room or mistyped the passphrase (which otherwise only surfaces as
  // silent "couldn't decrypt" messages). Spiritually like Telegram/Signal's
  // safety emoji, but here it confirms a *shared room secret*, not an
  // anti-MITM key exchange (the relay is untrusted by design — there's no
  // handshake to MITM). See SIGNALING / SECURITY-AUDIT notes.
  //
  // Domain-separated from the encryption key (different salt) AND derived at the
  // same slow PBKDF2 cost, so showing the emoji publicly does NOT make brute-
  // forcing the passphrase any cheaper than attacking a captured ciphertext.
  // 64-emoji alphabet (256 % 64 == 0 → no modulo bias); 5 positions.
  const FINGERPRINT_EMOJI = [
    "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔",
    "🐧","🐦","🦆","🦉","🐢","🐍","🦋","🐌","🐝","🐞","🦀","🐙","🐠","🐬","🐳","🦈",
    "🍎","🍌","🍓","🍒","🍑","🍍","🥑","🌽","🥕","🍄","🍕","🍔","🍟","🧀","🍪","🍩",
    "🌳","🌵","🌻","🌹","🍀","🔥","🌈","🚀","🎸","🎹","🎺","🥁","🎲","🎯","🎮","🎨",
  ];
  const FINGERPRINT_LEN = 5;

  async function roomFingerprint(passphrase, meetingId) {
    const material = await crypto.subtle.importKey(
      "raw",
      enc.encode(passphrase || ""),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: enc.encode("skool-dropzone-fingerprint:" + (meetingId || "")),
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      material,
      256
    );
    const bytes = new Uint8Array(bits);
    const out = [];
    for (let i = 0; i < FINGERPRINT_LEN; i++) {
      out.push(FINGERPRINT_EMOJI[bytes[i] % FINGERPRINT_EMOJI.length]);
    }
    return out.join(" ");
  }

  // Encrypt a string or ArrayBuffer. Returns { iv, ct } as base64 strings.
  async function encrypt(key, data) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    const plaintext = typeof data === "string" ? enc.encode(data) : new Uint8Array(data);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return { iv: toB64(iv), ct: toB64(ct) };
  }

  // Decrypt back to a Uint8Array. Caller decides how to interpret it.
  async function decryptBytes(key, payload) {
    const iv = fromB64(payload.iv);
    const ct = fromB64(payload.ct);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new Uint8Array(plain);
  }

  // Convenience: decrypt to a UTF-8 string.
  async function decryptText(key, payload) {
    return dec.decode(await decryptBytes(key, payload));
  }

  // Self-test: round-trip a string. Returns true on success. For dev use.
  async function selfTest() {
    try {
      const key = await deriveKey("correct horse battery staple", "TgzjxszWRTp");
      const msg = "hello skool-dropzone 🔒";
      const sealed = await encrypt(key, msg);
      const opened = await decryptText(key, sealed);
      const ok = opened === msg;

      // Wrong passphrase must fail to decrypt.
      let wrongFails = false;
      try {
        const badKey = await deriveKey("wrong passphrase", "TgzjxszWRTp");
        await decryptText(badKey, sealed);
      } catch {
        wrongFails = true;
      }

      return ok && wrongFails;
    } catch (e) {
      console.error("[SDZCrypto] selfTest error:", e);
      return false;
    }
  }

  window.SDZCrypto = { deriveKey, roomFingerprint, encrypt, decryptBytes, decryptText, selfTest, toB64, fromB64 };
})();
