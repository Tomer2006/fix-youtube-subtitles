// Runs in the PAGE's JS world (world: "MAIN").
// Captures two things and forwards them to content.js via postMessage:
//   1) the player response  -> caption track list
//   2) the timedtext response YouTube itself fetches -> the actual caption data
// Capturing #2 is the reliable path: YouTube's own request carries all the
// tokens (pot / signature) that a hand-built request is now missing.

(function () {
  "use strict";

  function videoIdFromUrl(url) {
    try {
      return new URL(url, location.href).searchParams.get("v") || null;
    } catch (e) {
      return null;
    }
  }

  function postTracks(pr) {
    try {
      const r = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer;
      const tracks = (r && r.captionTracks) || [];
      const videoId = pr && pr.videoDetails && pr.videoDetails.videoId;
      if (videoId || tracks.length) {
        window.postMessage(
          {
            type: "YTFIX_CAPTION_TRACKS",
            videoId: videoId || null,
            tracks: tracks.map((t) => ({
              baseUrl: t.baseUrl,
              languageCode: t.languageCode,
              kind: t.kind || null,
              name:
                (t.name &&
                  (t.name.simpleText ||
                    (t.name.runs && t.name.runs[0] && t.name.runs[0].text))) ||
                null,
            })),
          },
          "*"
        );
      }
    } catch (e) {
      /* ignore */
    }
  }

  let lastTimedtextUrl = "";
  function postTimedtext(url, body) {
    try {
      if (!body || url === lastTimedtextUrl) return;
      lastTimedtextUrl = url;
      window.postMessage(
        {
          type: "YTFIX_TIMEDTEXT",
          videoId: videoIdFromUrl(url),
          url: url,
          body: body,
        },
        "*"
      );
    } catch (e) {
      /* ignore */
    }
  }

  function postCurrentPlayerResponse() {
    if (window.ytInitialPlayerResponse) postTracks(window.ytInitialPlayerResponse);
  }

  function postCurrentPlayerSoon() {
    setTimeout(postCurrentPlayerResponse, 0);
    setTimeout(postCurrentPlayerResponse, 250);
  }

  // 1) First page load embeds the player response in a global.
  let tries = 0;
  (function readInitial() {
    if (window.ytInitialPlayerResponse) {
      postCurrentPlayerResponse();
    } else if (tries++ < 50) {
      setTimeout(readInitial, 100);
    }
  })();

  document.addEventListener("yt-navigate-finish", postCurrentPlayerSoon);
  document.addEventListener("yt-page-data-updated", postCurrentPlayerSoon);

  // 2) Tap fetch for both player responses and timedtext responses.
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      try {
        const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
        if (url && url.indexOf("/youtubei/v1/player") !== -1) {
          p.then((r) => r.clone().json().then(postTracks).catch(() => {})).catch(() => {});
        } else if (url && url.indexOf("/api/timedtext") !== -1) {
          p.then((r) =>
            r
              .clone()
              .text()
              .then((t) => postTimedtext(url, t))
              .catch(() => {})
          ).catch(() => {});
        }
      } catch (e) {
        /* ignore */
      }
      return p;
    };
  }

  // 3) Same for XHR.
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ytfixUrl = url;
    return origOpen.apply(this, arguments);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    const url = this.__ytfixUrl ? String(this.__ytfixUrl) : "";
    if (url.indexOf("/youtubei/v1/player") !== -1) {
      this.addEventListener("load", function () {
        try {
          postTracks(JSON.parse(this.responseText));
        } catch (e) {
          /* ignore */
        }
      });
    } else if (url.indexOf("/api/timedtext") !== -1) {
      this.addEventListener("load", function () {
        try {
          postTimedtext(url, this.responseText);
        } catch (e) {
          /* ignore */
        }
      });
    }
    return origSend.apply(this, arguments);
  };
})();
