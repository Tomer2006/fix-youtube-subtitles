// Isolated-world content script: the brain of the extension.
// - Auto-enables the CC button so YouTube fetches its captions
// - Receives the captured caption data (json3 OR xml) from interceptor.js
// - Rebuilds it into fixed-length lines (X words each)
// - Draws an overlay synced to the video, one whole line at a time.

(function () {
  "use strict";

  const DEFAULTS = {
    enabled: true,
    maxWords: 14, // wrap cap for an over-long sentence
    fontSize: 30,
    lead: 0.3,
  };
  let settings = { ...DEFAULTS };

  // Optimistically hide native captions right away (corrected once settings load).
  document.documentElement.setAttribute("data-ytfix", "on");

  let words = []; // [{ text, t }]  t = seconds (when this word is spoken)
  let lines = []; // [{ start, end, text }]
  let overlayEl = null;
  let spanEl = null;
  let rafId = null;

  let lastTracks = null;
  let lastVideoId = null;
  let loadedVideoId = null; // which video's captions we've already parsed
  let fallbackVideo = null; // video we've already scheduled a fallback for
  let fallbackTimerId = null;
  let captionStateVersion = 0;
  let lastLocationHref = location.href;
  let lastError = ""; // last hard failure (parse/fetch), shown in the popup
  let loadAttempted = false; // have we had a fair chance to load this video's captions
  let toastVideo = null; // video we've already shown a problem notice for

  // ---------------------------------------------------------------- settings

  chrome.storage.sync.get(DEFAULTS, (s) => {
    applySettings(s, true);
    watchCc(0); // start mirroring the CC button (reconciles enabled to it)
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const next = {};
    for (const key in changes) {
      next[key] = changes[key].newValue;
    }
    applySettings(next, false);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    if (message.type === "YTFIX_SETTINGS") {
      applySettings(message.settings, false);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "YTFIX_GET_STATUS") {
      sendResponse(getStatus());
    }
  });

  function applySettings(next, forceEnabled) {
    const patch = sanitizeSettings(next);
    const prev = settings;
    settings = { ...settings, ...patch };

    if (settings.maxWords !== prev.maxWords) rebuildLines();
    if (overlayEl && settings.fontSize !== prev.fontSize) {
      overlayEl.style.fontSize = settings.fontSize + "px";
    }
    if (forceEnabled || settings.enabled !== prev.enabled) applyEnabled();
  }

  function sanitizeSettings(next) {
    const out = {};
    if (!next || typeof next !== "object") return out;
    if ("enabled" in next) out.enabled = Boolean(next.enabled);
    if ("maxWords" in next) out.maxWords = clampInt(next.maxWords, DEFAULTS.maxWords, 2, 30);
    if ("fontSize" in next) out.fontSize = clampInt(next.fontSize, DEFAULTS.fontSize, 12, 80);
    if ("lead" in next) out.lead = clampNumber(next.lead, DEFAULTS.lead, 0, 2);
    return out;
  }

  function clampInt(value, fallback, min, max) {
    return Math.max(min, Math.min(max, parseInt(value, 10) || fallback));
  }

  function clampNumber(value, fallback, min, max) {
    const n = parseFloat(value);
    return Math.max(min, Math.min(max, isNaN(n) ? fallback : n));
  }

  // ------------------------------------------------ navigation / video state

  handleNavigation("initial");
  document.addEventListener("yt-navigate-start", () => handleNavigation("start"));
  document.addEventListener("yt-navigate-finish", () => handleNavigation("finish"));
  document.addEventListener("yt-page-data-updated", () => handleNavigation("page-data"));
  window.addEventListener("popstate", () => handleNavigation("popstate"));
  window.addEventListener("hashchange", () => handleNavigation("hashchange"));
  setInterval(() => handleNavigation("poll"), 600);

  function handleNavigation(reason) {
    const href = location.href;
    const urlVideoId = getCurrentUrlVideoId();
    const hrefChanged = href !== lastLocationHref;
    if (hrefChanged) lastLocationHref = href;

    if (urlVideoId !== lastVideoId && (hrefChanged || urlVideoId || lastVideoId)) {
      resetCaptionState(urlVideoId);
      if (urlVideoId) setTimeout(() => watchCc(0), reason === "initial" ? 0 : 500);
    }
  }

  function resetCaptionState(videoId) {
    lastVideoId = videoId || null;
    lastTracks = null;
    loadedVideoId = null;
    fallbackVideo = null;
    captionStateVersion++;
    words = [];
    lines = [];
    lastError = "";
    loadAttempted = false;
    toastVideo = null;

    if (fallbackTimerId != null) {
      clearTimeout(fallbackTimerId);
      fallbackTimerId = null;
    }
    clearOverlayText();
  }

  function syncActiveVideo(videoId) {
    if (videoId && videoId !== lastVideoId) resetCaptionState(videoId);
    else if (videoId) lastVideoId = videoId;
  }

  function getMessageVideoId(rawId) {
    const urlVideoId = getCurrentUrlVideoId();
    const messageVideoId = cleanVideoId(rawId);
    if (urlVideoId && messageVideoId && messageVideoId !== urlVideoId) return false;
    return messageVideoId || urlVideoId || null;
  }

  function getCurrentUrlVideoId() {
    return videoIdFromUrl(location.href);
  }

  function videoIdFromUrl(url) {
    try {
      const u = new URL(url, location.href);
      const watchId = cleanVideoId(u.searchParams.get("v"));
      if (watchId) return watchId;
      const pathMatch = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      return pathMatch ? cleanVideoId(pathMatch[1]) : null;
    } catch (e) {
      return null;
    }
  }

  function cleanVideoId(value) {
    if (!value) return null;
    const id = String(value).trim();
    return /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : null;
  }

  // --------------------------------------------------- messages from page

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d) return;

    if (d.type === "YTFIX_CAPTION_TRACKS") {
      const videoId = getMessageVideoId(d.videoId);
      if (videoId === false) return; // stale player response from the previous SPA route

      syncActiveVideo(videoId);
      lastTracks = Array.isArray(d.tracks) ? d.tracks : [];
      lastError = "";
      loadAttempted = false;
      if (!lastTracks.length) {
        loadAttempted = true;
        maybeProblemToast();
        return;
      }
      watchCc(0); // (re)attach to this video's CC button and reconcile state
      if (settings.enabled) scheduleFallback();
      return;
    }

    if (d.type === "YTFIX_TIMEDTEXT") {
      const videoId = getMessageVideoId(d.videoId || videoIdFromUrl(d.url || ""));
      if (videoId === false) return; // stale caption response from the previous video

      syncActiveVideo(videoId);
      const stateVersion = captionStateVersion;

      // Always parse and keep the captions, even while disabled, so toggling
      // back on shows them instantly (YouTube won't re-send what it already sent).
      let w = [];
      try {
        w = parseTimedtext(d.body || "");
      } catch (err) {
        lastError = String((err && err.message) || err);
        console.error("[ytfix] failed to parse captions:", err);
        if (settings.enabled && ccState() !== false) showToast("Couldn't read this video's captions.", "error");
      }
      if (w.length && stateVersion === captionStateVersion) {
        words = w;
        rebuildLines();
        loadedVideoId = videoId || lastVideoId;
        lastError = "";
        loadAttempted = true;
      }
      return;
    }
  });

  // ---------------------------------------------------- status (for popup)

  function getStatus() {
    if (!getCurrentUrlVideoId()) return { level: "idle", msg: "Open a YouTube video to use subtitles." };
    if (lastError) return { level: "error", msg: "Error: " + lastError };
    if (!settings.enabled || ccState() === false) return { level: "off", msg: "Off - turn on YouTube's CC button." };
    if (lines.length) return { level: "ok", msg: "Working - showing " + lines.length + " lines." };
    if (!lastTracks || !lastTracks.length) return { level: "warn", msg: "This video has no captions." };
    if (loadAttempted) return { level: "error", msg: "Couldn't load this video's captions." };
    return { level: "loading", msg: "Loading captions..." };
  }

  // -------------------------------------- two-way sync with the CC button
  //
  // The extension's on/off and YouTube's CC button are kept equal. Every
  // action only fires on a *mismatch* and moves toward agreement, so the two
  // settle without looping: turning CC on/off flips the extension, and the
  // popup toggle flips CC.

  function ccButton() {
    const player = getActivePlayer();
    return (
      (player && player.querySelector(".ytp-subtitles-button")) ||
      document.querySelector(".ytp-subtitles-button")
    );
  }

  function ccState() {
    const b = ccButton();
    if (!b) return null;
    const p = b.getAttribute("aria-pressed");
    return p === "true" ? true : p === "false" ? false : null;
  }

  // Make YouTube's CC button match our enabled flag (click only on mismatch).
  function syncToCc() {
    const on = ccState();
    if (on === null || on === settings.enabled) return;
    const b = ccButton();
    if (b) b.click();
  }

  // CC button changed (or first seen): mirror its state into our enabled flag.
  function onCcChanged() {
    const on = ccState();
    if (on === null || on === settings.enabled) return;
    applySettings({ enabled: on }, false);
    chrome.storage.sync.set({ enabled: on }); // updates popup + runs applyEnabled
  }

  let ccObserver = null;
  let ccObserved = null;
  function watchCc(attempt) {
    const b = ccButton();
    if (!b) {
      if ((attempt || 0) < 40) setTimeout(() => watchCc((attempt || 0) + 1), 500);
      return;
    }
    if (ccObserved !== b) {
      if (ccObserver) ccObserver.disconnect();
      ccObserved = b;
      ccObserver = new MutationObserver(onCcChanged);
      ccObserver.observe(b, { attributes: true, attributeFilter: ["aria-pressed"] });
    }
    onCcChanged(); // reconcile right now
  }

  // ------------------------------------------------ caption parsing

  // Auto-detect json3 vs xml (srv1/srv3).
  function parseTimedtext(body) {
    const s = body.replace(/^﻿/, "").replace(/^\s+/, "");
    if (s.charAt(0) === "{") {
      try {
        return parseJson3(JSON.parse(s));
      } catch (e) {
        return [];
      }
    }
    if (s.charAt(0) === "<") return parseXml(s);
    return [];
  }

  function parseJson3(json) {
    const events = (json && json.events) || [];
    const out = [];
    let prevText = "";
    for (const ev of events) {
      if (!ev.segs) continue;
      const start = (ev.tStartMs || 0) / 1000;
      const end = start + (ev.dDurationMs || 0) / 1000;

      // Collect non-empty segments and their real (per-word) offsets, if any.
      const segs = [];
      for (const s of ev.segs) {
        const txt = (s.utf8 || "").replace(/\s+/g, " ").trim();
        if (!txt) continue;
        segs.push({ txt, off: typeof s.tOffsetMs === "number" ? s.tOffsetMs / 1000 : null });
      }
      if (!segs.length) continue;

      const fullText = segs.map((s) => s.txt).join(" ");

      // Rolling auto-captions restate the previous line plus a new word.
      if (prevText && fullText !== prevText && fullText.indexOf(prevText) === 0) {
        const newPart = fullText.slice(prevText.length).trim();
        prevText = fullText;
        pushDistributed(out, newPart, start, end); // appended word ~ at event start
        continue;
      }
      if (fullText === prevText) continue; // exact duplicate
      prevText = fullText;

      // Non-rolling cue: use real word offsets when present (no drift).
      if (segs.some((s) => s.off !== null)) {
        for (const s of segs) {
          const t = start + (s.off != null ? s.off : 0);
          for (const w of s.txt.split(" ").filter(Boolean)) out.push({ text: w, t });
        }
      } else {
        pushDistributed(out, fullText, start, end);
      }
    }
    return finalize(out);
  }

  function parseXml(xml) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(xml, "text/xml");
    } catch (e) {
      return [];
    }
    if (!doc || doc.getElementsByTagName("parsererror").length) {
      try {
        doc = new DOMParser().parseFromString(xml, "text/html");
      } catch (e) {
        return [];
      }
    }
    const out = [];

    // srv1 format: <transcript><text start="s" dur="s">...</text></transcript>
    const texts = Array.from(doc.getElementsByTagName("text"));
    if (texts.length) {
      for (const el of texts) {
        const start = parseFloat(el.getAttribute("start") || "0");
        const dur = parseFloat(el.getAttribute("dur") || "0");
        const text = decodeEntities(el.textContent || "").replace(/\s+/g, " ").trim();
        pushDistributed(out, text, start, start + (isNaN(dur) ? 0 : dur));
      }
      return finalize(out);
    }

    // srv3 format: <timedtext><body><p t="ms" d="ms"><s t="offsetMs">word</s>...
    const ps = Array.from(doc.getElementsByTagName("p"));
    let prevText = "";
    for (const p of ps) {
      const base = parseInt(p.getAttribute("t") || "0", 10) / 1000;
      const dur = parseInt(p.getAttribute("d") || "0", 10) / 1000;
      const end = base + (isNaN(dur) ? 0 : dur);
      const ss = Array.from(p.getElementsByTagName("s"));

      const fullText = (ss.length
        ? ss.map((s) => (s.textContent || "").trim()).filter(Boolean).join(" ")
        : p.textContent || ""
      )
        .replace(/\s+/g, " ")
        .trim();
      if (!fullText) continue;

      if (prevText && fullText !== prevText && fullText.indexOf(prevText) === 0) {
        const newPart = fullText.slice(prevText.length).trim();
        prevText = fullText;
        pushDistributed(out, newPart, base, end);
        continue;
      }
      if (fullText === prevText) continue;
      prevText = fullText;

      if (ss.length) {
        for (const s of ss) {
          const off = parseInt(s.getAttribute("t") || "0", 10) / 1000;
          const w = (s.textContent || "").replace(/\s+/g, " ").trim();
          if (!w) continue;
          for (const tok of w.split(" ").filter(Boolean)) {
            out.push({ text: tok, t: base + (isNaN(off) ? 0 : off) });
          }
        }
      } else {
        pushDistributed(out, fullText, base, end);
      }
    }
    return finalize(out);
  }

  function decodeEntities(s) {
    if (s.indexOf("&") === -1) return s;
    const ta = document.createElement("textarea");
    ta.innerHTML = s;
    return ta.value;
  }

  // Spread a cue's words evenly across [start, end] into the word stream.
  function pushDistributed(out, text, start, end) {
    if (!text) return;
    const toks = text.split(" ").filter(Boolean);
    if (!toks.length) return;
    const span = Math.max(end - start, 0.001);
    for (let i = 0; i < toks.length; i++) {
      out.push({ text: toks[i], t: start + (span * i) / toks.length });
    }
  }

  function finalize(out) {
    for (let i = 1; i < out.length; i++) {
      if (out[i].t < out[i - 1].t) out[i].t = out[i - 1].t;
    }
    return out;
  }

  function rebuildLines() {
    lines = buildLinesBySentence(words, Math.max(2, settings.maxWords | 0));
  }

  function makeLine(chunk) {
    return {
      start: chunk[0].t,
      end: chunk[chunk.length - 1].t,
      text: chunk.map((w) => w.text).join(" "),
    };
  }

  // Common abbreviations whose trailing "." is NOT a sentence end.
  const ABBR = new Set(
    ("mr mrs ms dr prof sr jr st vs etc e.g i.e a.m p.m inc ltd co u.s u.k fig no " +
      "dept gen sen rep gov col capt lt sgt mt ave jan feb mar apr jun jul aug sep " +
      "sept oct nov dec approx dept est vol pp")
      .split(" ")
  );

  function stripClosers(t) {
    return t.replace(/[)"'»”’\]]+$/, "");
  }

  function isSentenceEnd(raw) {
    const t = stripClosers(raw);
    if (!/[.!?]$/.test(t)) return false;
    if (/\.\.\.$/.test(t)) return false; // ellipsis = keep going
    if (t.endsWith(".")) {
      const core = t.slice(0, -1).toLowerCase();
      if (ABBR.has(core)) return false; // Mr.  e.g.  etc.
      if (/^[a-z]$/.test(core)) return false; // initial like "A."
      if (/\d$/.test(core)) return false; // "3." or a price/section number
    }
    return true;
  }

  function isClauseEnd(raw) {
    return /[,;:—–]$/.test(stripClosers(raw));
  }

  // Break at sentence boundaries; wrap an over-long sentence at the last clause
  // mark (comma/semicolon/colon/dash) or, failing that, at the max-word cap.
  function buildLinesBySentence(words, maxWords) {
    const out = [];
    let cur = [];
    let lastClause = -1; // length-position of the last clause break inside cur

    const flush = (upto) => {
      const take = cur.slice(0, upto);
      if (take.length) out.push(makeLine(take));
      cur = cur.slice(upto);
      lastClause = -1;
    };

    for (const w of words) {
      cur.push(w);
      if (isSentenceEnd(w.text)) {
        flush(cur.length);
        continue;
      }
      if (isClauseEnd(w.text)) lastClause = cur.length;
      if (cur.length >= maxWords) {
        flush(lastClause > 0 && lastClause < cur.length ? lastClause : cur.length);
      }
    }
    if (cur.length) out.push(makeLine(cur));
    return out;
  }

  // -------------------------------------------- quiet fallback (best effort)

  // If we never captured YouTube's own timedtext request, try fetching it
  // ourselves. This may fail (missing tokens) — that's fine, so stay quiet.
  function scheduleFallback() {
    if (!lastVideoId || !lastTracks || !lastTracks.length) return;
    if (fallbackVideo === lastVideoId) return;
    fallbackVideo = lastVideoId;
    const stateVersion = captionStateVersion;
    fallbackTimerId = setTimeout(async () => {
      fallbackTimerId = null;
      if (stateVersion !== captionStateVersion) return;
      if (settings.enabled && !words.length) await directFetchFallback(stateVersion);
      if (stateVersion !== captionStateVersion) return;
      loadAttempted = true;
      maybeProblemToast();
    }, 4000);
  }

  // After we've had a fair chance to load, tell the user on-screen if nothing came.
  function maybeProblemToast() {
    if (!settings.enabled || ccState() === false || lines.length) return;
    if (toastVideo === lastVideoId) return;
    toastVideo = lastVideoId;
    if (!lastTracks || !lastTracks.length) showToast("This video has no captions to show.", "warn");
    else showToast("Couldn't load subtitles for this video.", "error");
  }

  // Brief notice shown over the player.
  function showToast(msg, level) {
    const player = getActivePlayer();
    if (!player) return;
    let t = player.querySelector(".ytfix-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "ytfix-toast";
      player.appendChild(t);
    }
    t.textContent = "Fix YouTube Subtitles: " + msg;
    t.setAttribute("data-level", level || "info");
    t.classList.add("ytfix-toast-show");
    clearTimeout(t._hide);
    t._hide = setTimeout(() => t.classList.remove("ytfix-toast-show"), 5000);
  }

  async function directFetchFallback(stateVersion) {
    const track = pickTrack(lastTracks);
    if (!track || !track.baseUrl) return;
    const base = track.baseUrl.replace(/&amp;/g, "&");
    const urls = [
      base + (base.indexOf("fmt=") !== -1 ? "" : "&fmt=json3"),
      base.replace(/&fmt=[^&]*/g, ""),
    ];
    for (const u of urls) {
      try {
        const urlVideoId = videoIdFromUrl(u);
        if (urlVideoId && lastVideoId && urlVideoId !== lastVideoId) continue;
        const res = await fetch(u, { credentials: "include" });
        if (stateVersion !== captionStateVersion) return;
        if (!res.ok) continue;
        const text = await res.text();
        if (stateVersion !== captionStateVersion) return;
        const w = parseTimedtext(text);
        if (w.length && stateVersion === captionStateVersion) {
          words = w;
          rebuildLines();
          loadedVideoId = lastVideoId;
          return;
        }
      } catch (e) {
        /* quiet */
      }
    }
    console.debug("[ytfix] fallback fetch found nothing; relying on captured captions.");
  }

  function pickTrack(tracks) {
    if (!tracks || !tracks.length) return null;
    const en = tracks.filter((t) => (t.languageCode || "").indexOf("en") === 0);
    return (
      en.find((t) => t.kind !== "asr") ||
      en[0] ||
      tracks.find((t) => t.kind !== "asr") ||
      tracks[0]
    );
  }

  // ------------------------------------------------ overlay + sync

  function getVideoElement() {
    const videos = Array.from(document.querySelectorAll("video.html5-main-video, video"));
    return (
      videos.find((video) => isVisible(video) && !video.paused) ||
      videos.find(isVisible) ||
      videos[0] ||
      null
    );
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  function getActivePlayer() {
    const video = getVideoElement();
    return getPlayerForVideo(video) || document.querySelector("#movie_player, .html5-video-player");
  }

  function getPlayerForVideo(video) {
    return video && video.closest("#movie_player, .html5-video-player");
  }

  function ensureOverlay(video) {
    const player =
      getPlayerForVideo(video) || document.querySelector("#movie_player, .html5-video-player");
    if (!player) return null;
    if (overlayEl && overlayEl.parentElement === player) return overlayEl;
    removeOverlay();

    overlayEl = document.createElement("div");
    overlayEl.className = "ytfix-overlay";
    overlayEl.style.fontSize = settings.fontSize + "px";
    spanEl = document.createElement("span");
    spanEl.className = "ytfix-text";
    overlayEl.appendChild(spanEl);
    player.appendChild(overlayEl);
    return overlayEl;
  }

  function clearOverlayText() {
    if (!spanEl) return;
    spanEl.textContent = "";
    spanEl.style.display = "none";
  }

  // Largest line index whose start time is <= t (binary search).
  function findLineIndex(t) {
    const tt = t + (settings.lead || 0); // show the line a touch early, never late
    let lo = 0,
      hi = lines.length - 1,
      ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].start <= tt) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  function tick() {
    rafId = requestAnimationFrame(tick);
    const video = getVideoElement();
    if (!video || !ensureOverlay(video)) return;

    let text = "";
    if (lines.length) {
      const idx = findLineIndex(video.currentTime);
      if (idx >= 0) text = lines[idx].text;
    }
    if (spanEl.textContent !== text) {
      spanEl.textContent = text;
      spanEl.style.display = text ? "inline-block" : "none";
    }
  }

  function startLoop() {
    if (rafId == null) rafId = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  function removeOverlay() {
    if (overlayEl && overlayEl.parentElement) overlayEl.parentElement.removeChild(overlayEl);
    overlayEl = null;
    spanEl = null;
  }

  function applyEnabled() {
    if (settings.enabled) {
      document.documentElement.setAttribute("data-ytfix", "on");
      startLoop(); // renders stored captions immediately if we already have them
      scheduleFallback();
    } else {
      document.documentElement.setAttribute("data-ytfix", "off");
      stopLoop();
      removeOverlay();
    }
    syncToCc(); // keep YouTube's CC button matching our state
  }

  // Re-attach to the CC button after SPA navigations (it gets recreated).
  document.addEventListener("yt-navigate-finish", () => {
    setTimeout(() => watchCc(0), 800);
  });
})();
