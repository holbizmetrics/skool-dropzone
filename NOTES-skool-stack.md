# Skool stack — reverse-engineering notes

Captured 2026-05-20 from analysis of the competing **Skool Extensions** extension (`jinaapgibcgkfaffmpkhdikncmfhpfne` v1.4.8, Chrome Web Store). Their code reveals Skool's underlying tech choices, which inform our injection strategy.

## Skool's tech stack

| Layer | Tech | Evidence |
|---|---|---|
| Frontend framework | **Next.js (React)** | React root is `#__next` (standard Next.js DOM marker) |
| Live video / meetings | **Stream.io Video React SDK** | All meeting DOM elements use the `str-video__*` CSS prefix |
| Meeting signaling | WebSocket to `stream-io-api.com` | Competitor patches `WebSocket` to intercept Stream events |
| Static assets | `assets.skool.com` | Manifest host_permissions |

## Stream.io implications

**Stream is a hosted, commercial real-time video provider.** When you're on a Skool meeting:

- Your video and audio stream through Stream's servers
- Stream sees all participants, raise-hands, reactions, screen-shares
- Stream's TURN servers may also see ICE candidates (though P2P fallback may avoid relaying media)
- **No client-side E2EE.** Stream supports E2EE in some configurations, but the default SDK setup is not E2EE, and there's no evidence Skool opts into it.

This is the basis for the security framing in [README.md](README.md#why-this-matters-for-skool-specifically): the meeting video is a known compromise; skool-dropzone's E2EE side-channel for shared *artifacts* (files, chat, presentations) is the real privacy win.

## DOM selectors observed in competitor code

These are the Stream React SDK's default class names. Stream maintains them across SDK versions for theming purposes; they should be stable enough to rely on (with a fallback strategy in place for SDK upgrades).

| Selector | Purpose |
|---|---|
| `.str-video__participant-listing-item` | Container for each participant tile |
| `.str-video__participant-listing-item__display-name` | Participant display name text |
| `.str-video__participant-listing-item__media-indicator-group` | Mic / camera state indicators |

**Likely existing selectors (not observed but standard in Stream SDK)** — to verify in a live meeting:

| Selector | Purpose |
|---|---|
| `.str-video__call` | The top-level call container (best Phase 1 detection target) |
| `.str-video__participant-view` | Each participant's video tile |
| `.str-video__call-controls` | The bottom controls bar |

## Hook points used by the competitor

These tell us what's possible to intercept in a Skool meeting:

| Hook | Where | Purpose |
|---|---|---|
| Patch `WebSocket` constructor | `document_start`, MAIN world | Intercept Stream's JSON event stream — competitor watches for `call.reaction_new` events to detect raise-hand. |
| Patch `navigator.mediaDevices.getDisplayMedia` | `document_start`, MAIN world | Detect when anyone starts a screen share. Broadcasts via `window.postMessage({type:"skt-screenshare-start"})`. |
| Detect raise-hand custom payloads | Inside WebSocket message handler | Looks for `custom.skt_raise_hand` and `custom.skt_force_lower` fields — Stream's customizable reaction system. |

**For us:** Phase 1 doesn't need any of these patches (DOM detection is enough). Phase 5+ presenter-claim coordination may want WebSocket-level hooks if we want to ride Stream's signaling channel for presenter-slot announcements, but our own E2EE WebRTC data channel (Phase 2) is probably the cleaner path — it keeps presenter-state on the E2EE side-channel, not visible to Stream / Skool.

## Skool URL patterns (TBD — verify from a live meeting)

The competitor doesn't gate by URL, but we should still know what they look like for human-readable purposes (e.g. "Phase 1 panel injects on URLs matching X"). To verify on the next live meeting:

- Community page: `https://www.skool.com/<community-slug>/` (likely)
- Calendar / event: `https://www.skool.com/<community-slug>/calendar/...` (likely)
- Meeting / live call: TBD — could be a modal over a calendar event, could be a sub-route

## Anti-patterns / things to avoid

- **Don't fight Skool's SPA.** Skool tears down and re-mounts DOM aggressively during route changes. Any DOM injection must be re-asserted via `MutationObserver` (Phase 0's marker already does this; Phase 1's panel will need the same).
- **Don't rely on Skool-internal CSS class names** (their own classes, not Stream's). Skool likely uses CSS modules or styled-components — their class names will be hashed and change with every deploy. Stream's `str-video__*` are stable; Skool's own classes are not.
- **Don't break Skool.** If our injection breaks Skool's own meeting flow (panel covers controls, captures clicks, etc.), users will uninstall fast. Phase 1's panel docks beside the meeting, not over it.

## References

- Competitor extension: [Skool Extensions on Chrome Web Store](https://chromewebstore.google.com/detail/skool-extensions/jinaapgibcgkfaffmpkhdikncmfhpfne)
- Developer site: [skool-extensions.com](https://skool-extensions.com/) (Marco Berlin)
- Stream Video React SDK docs: [getstream.io/video/docs/react/](https://getstream.io/video/docs/react/)
