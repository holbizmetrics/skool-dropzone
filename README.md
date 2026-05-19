# skool-dropzone

Member-side companion for Skool meetings — when the admins/owners aren't there and members still want to share.

## The gap

Skool community meetings often run without admins or owners present. Members on the call want to share pictures, videos, files, type things at each other, sketch on a whiteboard. The current Skool meeting flow has no built-in side-channel for that. So people fall back to Discord, WhatsApp, or just shrug.

## What this is

A Chrome extension, Skool-optimized, that injects a member-side meeting companion into the Skool meeting page. The meeting link is the access token — whoever has it gets the companion. No admin setup, no separate account.

In one place:

- **Drop zone** — drop pics, videos, files; everyone on the link sees them
- **Chat** — type to the room
- **Whiteboard** — sketch together
- **Video share** — share clips during the meeting

Scope = whoever has *this* meeting link, *right now*. Ephemeral by default.

## Status

Idea stage. No code yet. Repo opened to hold the scope as it firms up.

## Open questions

- Hosted media vs peer-to-peer (server bill vs WebRTC complexity)
- Persistence: ephemeral only, or optional "save this meeting's drops"
- Detection: which Skool URL patterns count as "in a meeting"
- Auth: link-as-token is the design; does Skool's meeting URL stay stable enough across the meeting to use it that way

## License

TBD.
