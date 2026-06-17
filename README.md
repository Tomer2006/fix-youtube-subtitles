# Fix YouTube Subtitles

A Chrome extension that replaces YouTube's jittery word-by-word captions with
clean **fixed-length lines**. Captions are regrouped into lines of *X words*, and
each line appears **all at once** the moment its first word is spoken — then the
whole next line replaces it when the video reaches that line's first word.

## How it works

1. `content.js` auto-clicks YouTube's **CC** button so the player loads captions.
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

- **Enabled** — turn the custom subtitles on/off.
- **Max words / line** — lines break at sentence punctuation (`.` `!` `?`),
  ignoring abbreviations (`Mr.`, `e.g.`), decimals (`3.14`), and ellipses. A
  sentence longer than this wraps at the last comma/clause, or at this cap as a
  hard limit (default 14).
- **Font size** — overlay text size in pixels.
- **Lead (sec)** — show each line this many seconds early so it's never late
  (default 0.3). Raise it if lines still feel delayed; set 0 for exact timing.

After changing settings, reload the YouTube tab if you don't see the change.

## Notes / known limits

- Word timing is approximated by spreading each caption cue's words evenly across
  that cue's time. It's accurate to within a cue, which is plenty for line-start
  timing. (We can switch to true word-level timestamps later if you want.)
- The extension only has data once captions are loaded. It auto-enables CC for
  you; if a video genuinely has no captions, there's nothing to show.
- The current line stays on screen until the next line begins (matching the
  intended behavior), so it can linger during long silent gaps.
