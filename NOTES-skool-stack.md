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

## DOM selectors — verified in a live meeting 2026-05-20

The live probe (`document.querySelectorAll('[class*="str-video"]')`) found **59 elements** with **36 distinct `str-video*` classes**. The Stream React SDK uses a stable CSS class prefix that should survive SDK upgrades (Stream maintains these classes for theming).

### Selectors confirmed present in a live meeting

| Selector | Purpose | Notes |
|---|---|---|
| `.str-video` | SDK root container | Bare class on the SDK's outermost element |
| **`.str-video__call-controls`** | Bottom controls bar | **★ Phase 1 detection target** — always present in an active call |
| `.str-video__participant-view` | Per-participant tile (one per participant) | Includes modifiers: `--dominant-speaker`, `--no-audio`, `--no-video`, `--speaking` |
| `.str-video__video` | Each `<video>` element |  |
| `.str-video__call-controls__button` | Individual control buttons (mic, camera, leave, etc.) | With `--enabled`, `--variant-danger` modifiers |
| `.str-video__icon--*` | Iconography classes | `mic-off`, `camera-off`, `screen-share-off`, `chat`, `participants`, `reactions`, `recording-off`, `call-end`, etc. |
| `.str-video__composite-button` | Compound button (button + dropdown menu) | Used for camera/mic/screen-share with their device-picker menus |
| `.str-video__menu-toggle-button` | Dropdown menu trigger |  |
| `.str-video__no-media-permission` | Warning shown when mic/camera permission denied | Present when user joins audio-off |
| `.str-video__notification-wrapper` | In-call notification toasts |  |
| `.str-video__video-placeholder` + `__avatar` | Fallback shown when participant has no video |  |

### Selectors NOT present (despite being mentioned in Stream docs / competitor code)

These were tested in the live meeting and were **absent** — Skool's specific Stream SDK configuration doesn't use them, or they only render conditionally:

| Selector | Why absent (best guess) |
|---|---|
| `.str-video__call` | Stream SDK uses `.str-video` (bare) as the root instead of `.str-video__call` |
| `.str-video__call-container` | Not used in this build |
| `.str-video__participant-listing` | Only renders when the participant sidebar panel is open (user-toggled) |
| `.str-video__participant-listing-item` | Same — only when the participant sidebar is open |
| `.str-video__paginated-grid-layout` | This build uses a different layout (probably speaker-focus by default) |
| `.str-video__speaker-layout` | Not present in initial state — may render after a participant becomes a speaker |

**Implication:** the competitor extension's `.str-video__participant-listing-item` detector would miss meetings until the user opens the participant sidebar. Our `.str-video__call-controls` detector fires immediately on entering a call.

## Hook points used by the competitor

These tell us what's possible to intercept in a Skool meeting:

| Hook | Where | Purpose |
|---|---|---|
| Patch `WebSocket` constructor | `document_start`, MAIN world | Intercept Stream's JSON event stream — competitor watches for `call.reaction_new` events to detect raise-hand. |
| Patch `navigator.mediaDevices.getDisplayMedia` | `document_start`, MAIN world | Detect when anyone starts a screen share. Broadcasts via `window.postMessage({type:"skt-screenshare-start"})`. |
| Detect raise-hand custom payloads | Inside WebSocket message handler | Looks for `custom.skt_raise_hand` and `custom.skt_force_lower` fields — Stream's customizable reaction system. |

**For us:** Phase 1 doesn't need any of these patches (DOM detection is enough). Phase 5+ presenter-claim coordination may want WebSocket-level hooks if we want to ride Stream's signaling channel for presenter-slot announcements, but our own E2EE WebRTC data channel (Phase 2) is probably the cleaner path — it keeps presenter-state on the E2EE side-channel, not visible to Stream / Skool.

## Skool URL patterns

**Verified in a live meeting 2026-05-20** — meeting URL pattern is:

```
https://www.skool.com/live/<meeting-id>
```

Where `<meeting-id>` is an opaque short ID (e.g. `TgzjxszWRTp` — 11 alphanumeric chars).

**This means we CAN URL-gate at the manifest level** — unlike the competitor extension, which matches all of `*.skool.com/*` and detects meeting state at runtime. Phase 1 of skool-dropzone uses the narrower `https://www.skool.com/live/*` match pattern, which means the content script doesn't even *load* on non-meeting pages. Cleaner, less invasive, smaller permission surface.

Other Skool URL patterns observed (informational, not used by this extension):

- Community page: `https://www.skool.com/<community-slug>/`
- Classroom / calendar / event subroutes: `https://www.skool.com/<community-slug>/<feature>/...`

## Anti-patterns / things to avoid

- **Don't fight Skool's SPA.** Skool tears down and re-mounts DOM aggressively during route changes. Any DOM injection must be re-asserted via `MutationObserver` (Phase 0's marker already does this; Phase 1's panel will need the same).
- **Don't rely on Skool-internal CSS class names** (their own classes, not Stream's). Skool likely uses CSS modules or styled-components — their class names will be hashed and change with every deploy. Stream's `str-video__*` are stable; Skool's own classes are not.
- **Don't break Skool.** If our injection breaks Skool's own meeting flow (panel covers controls, captures clicks, etc.), users will uninstall fast. Phase 1's panel docks beside the meeting, not over it.

## References

- Competitor extension: [Skool Extensions on Chrome Web Store](https://chromewebstore.google.com/detail/skool-extensions/jinaapgibcgkfaffmpkhdikncmfhpfne)
- Developer site: [skool-extensions.com](https://skool-extensions.com/) (Marco Berlin)
- Stream Video React SDK docs: [getstream.io/video/docs/react/](https://getstream.io/video/docs/react/)
