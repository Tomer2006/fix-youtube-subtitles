# Fix YouTube Subtitles

A Chrome extension that replaces YouTube's jittery word-by-word captions with
clean, **whole-line subtitles** split at sentence boundaries. Each line appears
**all at once** the moment its first word is spoken — then the next line replaces
it when the video reaches that line's first word.

## How it works

1. The extension mirrors YouTube's **CC** button: turn captions on (in the player
   or via the popup) and it switches on; turn them off and it switches off — the
   two are always kept in sync. Turning CC on makes the player load captions.
2. `interceptor.js` runs in the page and captures the caption response YouTube
   itself fetches (it carries the tokens a hand-built request now lacks). It also
   reads the caption track list from the player response.
3. `content.js` parses that data — `json3` **or** XML (`srv1`/`srv3`) — into a
   timed word stream, then splits it into lines at sentence boundaries.
4. An overlay drawn inside the video player shows the line whose start time is
   `<=` the current playback time. It updates every animation frame, so it stays
   in sync when you seek, pause, or change speed.
5. While the extension is on, YouTube's native captions are hidden via CSS.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (`fix subsides`).
4. Open any YouTube video that has captions and play it.

> Icons live in `icons/`. To tweak the design (color, shape), edit and re-run
> `make-icons.ps1` (`powershell -ExecutionPolicy Bypass -File make-icons.ps1`),
> which regenerates all four PNG sizes.

## Settings (toolbar popup)

- **Enabled** — turn the custom subtitles on/off. Stays in sync with YouTube's CC
  button: toggling captions in the player flips this, and flipping this toggles
  the CC button.
- **Max words / line** — lines break at sentence punctuation (`.` `!` `?`),
  ignoring abbreviations (`Mr.`, `e.g.`), decimals (`3.14`), and ellipses. A
  sentence longer than this wraps at the last comma/clause, or at this cap as a
  hard limit (default 14).
- **Font size** — overlay text size in pixels.
- **Lead (sec)** — show each line this many seconds early so it's never late
  (default 0.3). Raise it if lines still feel delayed; set 0 for exact timing.

Settings apply to the active YouTube tab as you edit them. If you reload the
extension itself from `chrome://extensions`, refresh any already-open YouTube
tabs so Chrome injects the updated content script.

## Status & errors

When something isn't working, the extension tells you instead of failing silently:

- **Popup status line** (top of the popup) shows the live state of the current
  tab — one of:
  - 🟢 *Working — showing N lines*
  - 🔵 *Loading captions…*
  - ⚪ *Off — turn on YouTube's CC button*
  - 🟡 *This video has no captions*
  - 🔴 *Couldn't load this video's captions* / *Error: …*
- **On-screen notice**: if captions can't be loaded for a video (after a few
  seconds), a small banner appears over the player explaining why.

## Notes / known limits

- Word timing is approximated by spreading each caption cue's words evenly across
  that cue's time. It's accurate to within a cue, which is plenty for line-start
  timing. (We can switch to true word-level timestamps later if you want.)
- The extension shows subtitles whenever YouTube's CC is on. If a video genuinely
  has no captions, the CC button does nothing and there's nothing to show.
- The extension watches YouTube's SPA navigation and resets caption state across
  regular watch pages, Shorts, playlist video changes, and `www.youtube.com`
  embeds.
- The current line stays on screen until the next line begins (matching the
  intended behavior), so it can linger during long silent gaps.
