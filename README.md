# skool-dropzone

Member-side companion for Skool meetings — when the admins/owners aren't there and members still want to share.

## The gap

Skool community meetings often run without admins or owners present. Members on the call want to share pictures, videos, files, type things at each other, sketch on a whiteboard. The current Skool meeting flow has no built-in side-channel for that. So people fall back to Discord, WhatsApp, or just shrug.

## What this is

A Chrome extension, Skool-optimized, that injects a member-side meeting companion into the Skool meeting page. The meeting link is the access token — whoever has it gets the companion. No admin setup, no separate account.

In one place:

- **Chat with files** — type messages or drop pics, videos, files; same stream, everyone on the link sees it (the "drop zone" and the "chat" are one surface, not two)
- **Whiteboard** — sketch together
- **Video share** — share clips during the meeting
- **Instant presentation** — anyone in the room can grab the presenter slot in one click. No "host promotes you," no screen-share dance. Three modes, stacked:
  - **File-as-deck** — drop a PDF / image / video, it takes over the shared view; you control pages or playback for everyone
  - **Type-as-slides** — type into chat, promote it to a slide everyone sees
  - **Bring-your-own-deck** — load existing slides (PPT / Keynote / PDF) into the overlay and walk through them
  - Whiteboard annotation works *over* whatever's being shown — sketch on top of slides, the PDF, the video frame

Scope = whoever has *this* meeting link, *right now*. Ephemeral by default.

## Security (load-bearing, not optional)

Files, chat, video shared during member-only meetings are private by intent — the whole point of this is that admins/owners aren't even on the call. So:

- **Client-side encryption before transport.** Content encrypted in the extension before it leaves the browser. Whoever hosts the bytes (server or peer) cannot read them. SecuredChat (E2EE git-file-bus) is the precedent — same shape works here.
- **Link as access + readability token.** The meeting link carries (or derives) the symmetric key. Without the link, ciphertext is useless. With the link, you're in.
- **No cross-meeting bleed.** Each meeting's key is scoped to that meeting. Knowing one link doesn't grant access to any other.
- **Ephemeral default.** Content evaporates when the meeting ends, unless explicitly saved (and even then, encrypted at rest).
- **No third-party read.** The host (whoever runs the media relay) sees only ciphertext + traffic metadata. No content access. No "trust us."

This is the standard the rest of the design has to clear, not a nice-to-have.

## Status

Idea stage. No code yet. Repo opened to hold the scope as it firms up.

## Open questions

- Hosted media vs peer-to-peer (server bill vs WebRTC complexity)
- Persistence: ephemeral only, or optional "save this meeting's drops"
- Detection: which Skool URL patterns count as "in a meeting"
- Auth: link-as-token is the design; does Skool's meeting URL stay stable enough across the meeting to use it that way

## License

TBD.
