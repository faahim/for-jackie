/* For Jackie — client renderer. Renders instantly from the last cached content
 * document (no layout jitter), then refreshes from the live API and re-renders
 * only when something actually changed. Also: freshness stamps in the visitor's
 * local time, soothing first-view reveals, and the "message the keeper" drawer. */
(function () {
  "use strict";

  var page = document.body.getAttribute("data-page") || "home";
  var CACHE_KEY = "fj:content:v1";
  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Gate the reveal styles on JS being present so no-JS visitors see everything.
  document.documentElement.classList.add("js");

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sourcesHtml(sources) {
    if (!sources || !sources.length) return "";
    return (
      '<div class="srcs">' +
      sources
        .map(function (s) {
          return '<a class="src" rel="noopener" target="_blank" href="' + esc(s.url) + '">' + esc(s.label) + "</a>";
        })
        .join("") +
      "</div>"
    );
  }

  function prettyDate(iso) {
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  // "updated today at 2:41 PM" / "updated yesterday at 9:03 AM" / older → full date,
  // always in the visitor's own timezone.
  function humanStamp(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return null;
    var now = new Date();
    var time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var days = Math.round((startOfToday - startOfThat) / 86400000);
    if (days <= 0) return "updated today at " + time;
    if (days === 1) return "updated yesterday at " + time;
    if (days < 7) {
      return "updated " + d.toLocaleDateString(undefined, { weekday: "long" }) + " at " + time;
    }
    return "updated " + d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function updateHtml(u) {
    return (
      '<li class="update ' + esc(u.tone || "info") + '">' +
      '<div class="when"><span class="tone-dot"></span>' + esc(prettyDate(u.date)) + "</div>" +
      "<h3>" +
      (u.id ? '<a href="/updates/' + esc(u.id) + '">' + esc(u.title) + "</a>" : esc(u.title)) +
      "</h3>" +
      "<p>" + esc(u.body) + "</p>" +
      (u.id && u.longBody ? '<a class="more-link" href="/updates/' + esc(u.id) + '">Read the full update →</a>' : "") +
      sourcesHtml(u.sources) +
      "</li>"
    );
  }

  // mode: "cache" (silent), "enter" (cold-load fade-in), "update" (cross-fade).
  // Identical content is guaranteed zero DOM mutation: we compare against the
  // exact string we last wrote (browser-serialized innerHTML is normalized and
  // never compares equal, which would re-trigger animations for nothing).
  function setHtml(el, html, mode) {
    if (el.__fjHtml === html) return;
    el.__fjHtml = html;
    el.innerHTML = html;
    if (reduceMotion || mode === "cache") return;
    var cls = mode === "update" ? "region-swap" : "region-in";
    el.classList.remove("region-swap", "region-in");
    void el.offsetWidth; // reflow so the animation can replay
    el.classList.add(cls);
  }

  function setText(el, text) {
    if (el && text && el.textContent !== text) el.textContent = text;
  }

  // Relative wording for meta.checkedAt (watcher vigilance).
  function relParts(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return null;
    var age = Math.max(0, Date.now() - d.getTime());
    var mins = Math.floor(age / 60000);
    return {
      stale: age > 20 * 60000,
      compact: age < 90000 ? "just now" : mins < 60 ? mins + "m ago" : Math.floor(mins / 60) + "h ago",
      full: age < 90000 ? "just now" : mins < 60 ? mins + " min ago" : Math.floor(mins / 60) + " h ago",
    };
  }

  var stampMeta = null;
  var stampConfirmed = false; // true once a live fetch has vouched for checkedAt

  function applyStamps() {
    if (!stampMeta) return;
    var updated = stampMeta.updatedAt ? humanStamp(stampMeta.updatedAt) : null;
    var rel = stampMeta.checkedAt ? relParts(stampMeta.checkedAt) : null;
    var navText, heroText;
    if (rel) {
      // A stale cached claim isn't vigilance — say "checking…" until a live
      // fetch confirms; formats mirror the inline head script exactly.
      var uncertain = rel.stale && !stampConfirmed;
      navText = uncertain ? "checking…" : "checked " + rel.compact;
      heroText = (uncertain ? "Checking now" : "Checked " + rel.full) +
        (updated ? " · " + updated.replace(/^updated/, "latest update") : "");
    } else {
      navText = updated || (stampMeta.lastVerified ? "verified " + stampMeta.lastVerified : null);
      heroText = updated ? "Verified facts · " + updated : null;
    }
    setText(document.getElementById("fresh"), navText);
    setText(document.getElementById("stamp"), heroText);
  }

  function renderStamps(content) {
    stampMeta = content.meta || null;
    applyStamps();
  }

  // Keep "checked X ago" honest in long-open tabs: a guarded text swap every
  // minute — no DOM rebuild, no animation. visibilitychange refetches too.
  setInterval(applyStamps, 60000);

  function render(content, mode) {
    var el;

    renderStamps(content);

    // emergency banner (all pages) — the inline head script already applied
    // it pre-paint from cache; only touch the DOM when something changed.
    el = document.getElementById("alert-banner");
    if (el) {
      if (content.banner && content.banner.text) {
        if (el.textContent !== content.banner.text) el.textContent = content.banner.text;
        el.classList.add("visible");
      } else {
        el.classList.remove("visible");
      }
    }

    if (page === "home") {
      el = document.getElementById("headline");
      if (el && content.headline) {
        setHtml(
          el,
          "<h1>" + content.headline.title.replace("alive and stable", "<em>alive and stable</em>") + "</h1>" +
            '<p class="lede">' + esc(content.headline.lede) + "</p>",
          mode
        );
      }
      el = document.getElementById("chips");
      if (el && content.statuses) {
        setHtml(
          el,
          content.statuses
            .map(function (s) {
              return (
                '<div class="chip ' + esc(s.tone) + '"><span class="who">' + esc(s.who) +
                '</span><span class="state">' + esc(s.state) + "</span></div>"
              );
            })
            .join(""),
          mode
        );
      }
      el = document.getElementById("latest");
      if (el && content.updates) {
        setHtml(el, content.updates.slice(0, 5).map(updateHtml).join(""), mode);
      }
      el = document.getElementById("unknowns");
      if (el && content.unknowns) {
        setHtml(
          el,
          content.unknowns.map(function (u) { return "<li>" + esc(u) + "</li>"; }).join(""),
          mode
        );
      }
    }

    if (page === "updates") {
      el = document.getElementById("feed");
      if (el && content.updates) {
        // Every update, no cap — this page is the full record.
        setHtml(el, content.updates.map(updateHtml).join(""), mode);
      }
    }

    if (page === "rumors") {
      el = document.getElementById("rumor-list");
      if (el && content.rumors) {
        setHtml(
          el,
          content.rumors
            .map(function (r) {
              return (
                '<div class="rumor"><div class="claim">' + esc(r.claim) + "</div>" +
                '<div class="verdict"><p><span class="tag ' + esc(r.verdict) + '">' + esc(r.verdictLabel) +
                "</span> " + esc(r.body) + " " +
                (r.sources || [])
                  .map(function (s) {
                    return '<a class="src" rel="noopener" target="_blank" href="' + esc(s.url) + '">' + esc(s.label) + "</a>";
                  })
                  .join(" ") +
                "</p></div></div>"
              );
            })
            .join(""),
          mode
        );
      }
    }

    if (page === "wall") {
      // "From the community" — curated excerpts from the content doc.
      // Hidden entirely unless content.community[] exists and has entries.
      var communitySection = document.getElementById("community");
      el = document.getElementById("community-list");
      if (communitySection && el) {
        var community = Array.isArray(content.community) ? content.community : [];
        if (community.length) {
          setHtml(
            el,
            community
              .map(function (c) {
                return (
                  '<figure class="community-card"><blockquote>' + esc(c.quote) + "</blockquote>" +
                  '<figcaption><span class="who">' + esc(c.author || "A community member") + "</span>" +
                  (c.url
                    ? '<a class="src" rel="noopener" target="_blank" href="' + esc(c.url) + '">' +
                      esc(c.sourceLabel || "source") + "</a>"
                    : "") +
                  "</figcaption></figure>"
                );
              })
              .join(""),
            mode
          );
          communitySection.hidden = false;
        } else {
          communitySection.hidden = true;
        }
      }
    }

    if (page === "timeline") {
      el = document.getElementById("timeline");
      if (el && content.timeline) {
        setHtml(
          el,
          content.timeline
            .map(function (ch) {
              return (
                '<li class="chapter">' + esc(ch.chapter) + "</li>" +
                ch.events
                  .map(function (ev) {
                    var cls = ev.phase === "crisis" ? " crisis" : ev.phase === "hope" ? " hope" : "";
                    return (
                      '<li class="event' + cls + '"><span class="date">' + esc(ev.date) + "</span><h3>" +
                      esc(ev.title) + "</h3><p>" + esc(ev.body) + "</p></li>"
                    );
                  })
                  .join("")
              );
            })
            .join(""),
          mode
        );
      }
    }
  }

  // ---- cache-first hydration: paint from the last known document immediately ----

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
  }
  function writeCache(content) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(content)); } catch (e) { /* private mode etc. */ }
  }

  var lastRendered = null;
  var cached = readCache();
  if (cached && cached.meta) {
    try {
      render(cached, "cache"); // synchronous, silent — before first paint
      lastRendered = cached.meta.updatedAt || null;
    } catch (e) {
      console.log("cache render failed", e);
    }
  }

  function load() {
    fetch("/api/content", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("api " + res.status);
        return res.json();
      })
      .catch(function () {
        return fetch("/content.json").then(function (res) { return res.json(); });
      })
      .then(function (content) {
        if (!content || !content.meta) return;
        stampConfirmed = true; // live response: checkedAt is current
        writeCache(content);
        if (content.meta.updatedAt !== lastRendered) {
          // Cold load (nothing rendered yet) fades in; a genuine content
          // change cross-fades. Identical content never reaches this branch.
          // Server-rendered pages (body[data-ssr]) already show real content,
          // so the first live render must be silent, not an entrance.
          var entrance = document.body.hasAttribute("data-ssr") ? "cache" : "enter";
          render(content, lastRendered === null ? entrance : "update");
          lastRendered = content.meta.updatedAt || null;
        } else {
          renderStamps(content); // "today"/"yesterday" wording can drift across midnight
        }
      })
      .catch(function (err) {
        console.log("content load failed", err);
      });
  }

  load();
  // Re-check for fresh content when the tab regains focus — people leave this open.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load();
  });

  // ---- Wall of Love: cache-first notes + moderated submissions ----

  function wallNoteHtml(n) {
    var d = new Date(n.approvedAt);
    var when = isNaN(d)
      ? ""
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return (
      '<div class="wall-note"><p class="txt">' + esc(n.message) + "</p>" +
      '<div class="who"><span>' + esc(n.name || "A friend of the nest") + "</span>" +
      (when ? '<span class="date">' + esc(when) + "</span>" : "") +
      "</div></div>"
    );
  }

  function setupWall() {
    var wallEl = document.getElementById("wall");
    if (!wallEl) return;
    var WALL_CACHE = "fj:wall:v1";
    var lastNotes = null; // serialized form of what's rendered

    function renderWall(notes, mode) {
      var html = notes.length
        ? notes.map(wallNoteHtml).join("")
        : '<div class="wall-empty"><p>The wall is waiting for its very first note. If the nest family has meant something to you, yours could be the one that starts it.</p></div>';
      // Stagger only the cold-load entrance; later refreshes cross-fade quietly.
      if (mode === "enter" && !reduceMotion && notes.length) {
        wallEl.classList.add("wall-stagger");
      } else {
        wallEl.classList.remove("wall-stagger");
      }
      setHtml(wallEl, html, mode);
      if (wallEl.classList.contains("wall-stagger")) {
        Array.prototype.slice.call(wallEl.children).forEach(function (card, i) {
          card.style.animationDelay = Math.min(i * 45, 400) + "ms";
        });
      }
    }

    var cachedNotes = null;
    try { cachedNotes = JSON.parse(localStorage.getItem(WALL_CACHE)); } catch (e) { /* fine */ }
    if (cachedNotes && Array.isArray(cachedNotes)) {
      renderWall(cachedNotes, "cache"); // synchronous, silent — before first paint
      lastNotes = JSON.stringify(cachedNotes);
    }

    function loadWall() {
      fetch("/api/wall", { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("api " + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.notes)) return;
          var sig = JSON.stringify(data.notes);
          try { localStorage.setItem(WALL_CACHE, sig); } catch (e) { /* fine */ }
          if (sig !== lastNotes) {
            renderWall(data.notes, lastNotes === null ? "enter" : "update");
            lastNotes = sig;
          }
        })
        .catch(function (err) {
          console.log("wall load failed", err);
          if (lastNotes === null) {
            renderWall([], "enter"); // clear the skeletons; show the invitation
            lastNotes = "[]";
          }
        });
    }
    loadWall();
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) loadWall();
    });

    // ---- submission: pending until a volunteer approves, and the form says so ----
    var form = document.getElementById("wall-form");
    if (!form) return;
    var counter = document.getElementById("wall-count");
    if (counter) {
      form.elements.message.addEventListener("input", function () {
        var len = form.elements.message.value.length;
        var text = len + " / 500";
        if (counter.textContent !== text) counter.textContent = text;
      });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var errorEl = form.querySelector(".msg-error");
      var submit = form.querySelector('button[type="submit"]');
      var message = form.elements.message.value.trim();
      if (!message) {
        errorEl.textContent = "Please write a note first — even a few words are plenty.";
        errorEl.hidden = false;
        form.elements.message.focus();
        return;
      }
      if (!form.elements.consent.checked) {
        errorEl.textContent = "Please tick the box confirming your note may be displayed publicly.";
        errorEl.hidden = false;
        form.elements.consent.focus();
        return;
      }
      errorEl.hidden = true;
      submit.disabled = true;
      submit.textContent = "Sending…";
      fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "note",
          name: form.elements.name.value.trim(),
          message: message,
          consent: true,
          website: form.elements.website.value,
          page: page,
        }),
      })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok && data.ok !== false, data: data }; });
        })
        .then(function (result) {
          if (result.ok) {
            form.hidden = true;
            var done = document.querySelector(".wall-done");
            if (done) done.hidden = false;
          } else {
            errorEl.textContent = result.data.error || "Something went wrong — please try again.";
            errorEl.hidden = false;
          }
        })
        .catch(function () {
          errorEl.textContent = "Couldn’t reach the nest — please try again in a moment.";
          errorEl.hidden = false;
        })
        .then(function () {
          submit.disabled = false;
          submit.textContent = "Add my note";
        });
    });
  }
  if (page === "wall") setupWall();

  // ---- home: "From the Wall of Love" — 3 newest notes, hidden when empty ----

  function setupHomeWall() {
    var sec = document.getElementById("home-wall");
    var list = document.getElementById("home-wall-list");
    if (!sec || !list) return;
    var lastSig = null;
    function show(notes, mode) {
      if (!notes || !notes.length) return; // no empty state on home — stays hidden
      sec.hidden = false;
      setHtml(list, notes.slice(0, 3).map(wallNoteHtml).join(""), mode);
    }
    var cachedNotes = null;
    try { cachedNotes = JSON.parse(localStorage.getItem("fj:wall:v1")); } catch (e) { /* fine */ }
    if (cachedNotes && Array.isArray(cachedNotes)) {
      show(cachedNotes, "cache"); // synchronous — zero-CLS on warm loads
      lastSig = JSON.stringify(cachedNotes);
    }
    fetch("/api/wall", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("api " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.notes)) return;
        var sig = JSON.stringify(data.notes);
        try { localStorage.setItem("fj:wall:v1", sig); } catch (e) { /* fine */ }
        if (sig !== lastSig) {
          show(data.notes, lastSig === null ? "enter" : "update");
          lastSig = sig;
        }
      })
      .catch(function (err) {
        console.log("home wall load failed", err);
      });
  }
  if (page === "home") setupHomeWall();

  // ---- soothing first-view reveals (once, staggered, ease-out) ----

  function setupReveals() {
    var els = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    if (!els.length) return;

    // A soothing animation must NEVER hide content: force-reveal everything.
    function finish() {
      els.forEach(function (el) {
        el.classList.add("is-in");
        el.style.transitionDelay = "";
      });
    }

    // The rise is a first-view greeting, not a navigation effect: repeat
    // visits to a page this session skip straight to visible (no motion).
    var seenKey = "fj:revealed:" + page;
    var seen = false;
    try { seen = sessionStorage.getItem(seenKey) === "1"; } catch (e) { /* fine */ }

    if (seen || reduceMotion || !("IntersectionObserver" in window)) {
      finish();
      return;
    }
    try { sessionStorage.setItem(seenKey, "1"); } catch (e) { /* fine */ }

    // Above-the-fold content is revealed via a synchronous geometry check —
    // never trust the observer's first callback for what's already on screen
    // (it can misreport while a cross-document view transition holds rendering).
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var delay = 0;
    var onScreen = [];
    var pending = [];
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (vh > 0 && r.top < vh && r.bottom > 0) {
        el.style.transitionDelay = delay + "ms";
        delay += 70; // small stagger between elements arriving together
        onScreen.push(el);
      } else {
        pending.push(el);
      }
    });
    // Double rAF so the hidden state paints once and the transition can run.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        onScreen.forEach(function (el) { el.classList.add("is-in"); });
      });
    });

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        });
      },
      { threshold: 0 }
    );
    pending.forEach(function (el) { io.observe(el); });

    // Hard safety net: whatever happens above, nothing stays hidden past ~800ms.
    // (Below-the-fold elements finish their fade off-screen — invisible cost.)
    setTimeout(function () {
      io.disconnect();
      finish();
    }, 800);
    // Belt and suspenders for bfcache restores.
    window.addEventListener("pageshow", finish);
  }
  setupReveals();

  // ---- dock pill: deterministic FLIP glide between pages ----
  // The previous page stores the active pill's rect in sessionStorage on
  // pagehide; on load we start the pill there and glide it to the current
  // item. No view-transition dependency, no flakiness.

  function setupDockPills() {
    [
      { root: document.querySelector(".topnav .links"), key: "fj:pill:top" },
      { root: document.querySelector(".tabbar"), key: "fj:pill:tab" },
    ].forEach(function (dock) {
      var root = dock.root;
      if (!root) return;
      var active = root.querySelector('a[aria-current="page"]');
      if (!active) return;
      var pill = document.createElement("span");
      pill.className = "dock-pill";
      pill.setAttribute("aria-hidden", "true");
      root.appendChild(pill);

      // Rects are measured with offsetLeft/offsetTop, i.e. relative to the
      // dock container itself (the positioned offsetParent) — never the
      // viewport — so scroll position and dock placement can't skew the FLIP.
      function rect() {
        return { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight };
      }
      function apply(r, animated) {
        if (!animated) pill.style.transition = "none";
        pill.style.transform = "translate(" + r.x + "px," + r.y + "px)";
        pill.style.width = r.w + "px";
        pill.style.height = r.h + "px";
        if (!animated) {
          void pill.offsetWidth; // commit without a tween
          pill.style.transition = "";
        }
      }
      function snap() {
        var r = rect();
        pill.style.opacity = r.w ? "" : "0"; // dock hidden at this width
        if (r.w) apply(r, false);
      }

      var r = rect();
      if (!r.w) {
        pill.style.opacity = "0";
      } else {
        var prev = null;
        try {
          prev = JSON.parse(sessionStorage.getItem(dock.key));
          sessionStorage.removeItem(dock.key);
        } catch (e) { /* fine */ }
        var samePlace = prev && prev.x === r.x && prev.w === r.w;
        var sameRow = prev && Math.abs(prev.y - r.y) < r.h; // viewport changed → don't glide
        if (prev && prev.w && !samePlace && sameRow && !reduceMotion) {
          apply(prev, false); // First: where the pill sat on the previous page
          apply(r, true);     // Last + play: glide to the current item
        } else {
          apply(r, false);    // no stored rect: just present at rest, no glide
        }
      }
      // Hide the static fallback pill in the same synchronous step the JS pill
      // becomes real — exactly one pill visible at every instant. If app.js
      // never runs, has-pill is never added and the fallback stays.
      root.classList.add("has-pill");

      window.addEventListener("resize", snap);
      window.addEventListener("pagehide", function () {
        var out = rect();
        if (out.w) {
          try { sessionStorage.setItem(dock.key, JSON.stringify(out)); } catch (e) { /* fine */ }
        }
      });
    });
  }
  setupDockPills();

  // ---- bottom sheet (Vaul-style): shared by the More menu & mobile contact ----
  // Slides up with rounded corners + grab handle; visualViewport keeps the
  // focused input above the on-screen keyboard (the Vaul "inputs" behavior);
  // dismiss via backdrop, drag-down, Esc; focus trapped and restored.

  var sheetApi = null;

  function getSheet() {
    if (sheetApi) return sheetApi;

    var sOverlay = document.createElement("div");
    sOverlay.className = "sheet-overlay";
    sOverlay.hidden = true;
    var sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.innerHTML =
      '<button class="sheet-handle" type="button" aria-label="Close"></button>' +
      '<div class="sheet-body"></div>';
    document.body.appendChild(sOverlay);
    document.body.appendChild(sheet);
    var body = sheet.querySelector(".sheet-body");
    var handle = sheet.querySelector(".sheet-handle");
    var isOpen = false;
    var restoreTo = null;
    var vv = window.visualViewport;

    // When the keyboard opens the visual viewport shrinks: pin the sheet
    // above it, cap its height to the visible area, and keep the focused
    // field in view (instead of the browser shoving the page around).
    function vvSync() {
      if (!isOpen || !vv) return;
      var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      sheet.style.bottom = kb + "px";
      sheet.style.maxHeight = Math.round(vv.height * 0.9) + "px";
      var ae = document.activeElement;
      if (kb > 0 && ae && sheet.contains(ae) && ae.scrollIntoView) {
        ae.scrollIntoView({ block: "nearest" });
      }
    }
    sheet.addEventListener("focusin", function () { setTimeout(vvSync, 250); });

    function sheetFocusables() {
      return Array.prototype.slice
        .call(sheet.querySelectorAll("a[href], button, input, textarea, [tabindex]"))
        .filter(function (el) {
          return !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null;
        });
    }
    function onSheetKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      var f = sheetFocusables();
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // drag-down to dismiss (pointer events, simple threshold)
    var dragFrom = null;
    var draggedFar = false;
    handle.addEventListener("pointerdown", function (e) {
      dragFrom = e.clientY;
      draggedFar = false;
      sheet.classList.add("is-dragging");
      if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", function (e) {
      if (dragFrom == null) return;
      var dy = Math.max(0, e.clientY - dragFrom);
      if (dy > 8) draggedFar = true;
      sheet.style.transform = "translateY(" + dy + "px)";
    });
    function endDrag(e) {
      if (dragFrom == null) return;
      var dy = Math.max(0, e.clientY - dragFrom);
      dragFrom = null;
      sheet.classList.remove("is-dragging");
      sheet.style.transform = "";
      if (dy > 90) close();
    }
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    handle.addEventListener("click", function () {
      if (!draggedFar) close(); // a plain tap on the handle closes
      draggedFar = false;
    });

    function open(contentEl, opts) {
      var wasOpen = isOpen;
      if (!wasOpen) restoreTo = document.activeElement;
      body.innerHTML = "";
      body.appendChild(contentEl);
      body.scrollTop = 0;
      sOverlay.hidden = false;
      sheet.hidden = false;
      if (!wasOpen) {
        sOverlay.classList.remove("is-closing");
        sheet.classList.remove("is-closing");
        void sheet.offsetWidth; // paint the resting state before opening
        sOverlay.classList.add("is-open");
        sheet.classList.add("is-open");
        document.addEventListener("keydown", onSheetKey);
        if (vv) {
          vv.addEventListener("resize", vvSync);
          vv.addEventListener("scroll", vvSync);
        }
        isOpen = true;
      }
      vvSync();
      var target = opts && opts.focusHandle ? handle : sheetFocusables()[0] || handle;
      if (target) target.focus();
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      document.removeEventListener("keydown", onSheetKey);
      if (vv) {
        vv.removeEventListener("resize", vvSync);
        vv.removeEventListener("scroll", vvSync);
      }
      sOverlay.classList.add("is-closing");
      sOverlay.classList.remove("is-open");
      sheet.classList.add("is-closing");
      sheet.classList.remove("is-open");
      setTimeout(function () {
        sOverlay.hidden = true;
        sheet.hidden = true;
        sOverlay.classList.remove("is-closing");
        sheet.classList.remove("is-closing");
        sheet.style.bottom = "";
        sheet.style.maxHeight = "";
      }, reduceMotion ? 0 : 260);
      if (restoreTo && restoreTo.focus) restoreTo.focus();
    }

    sOverlay.addEventListener("click", close);
    sheet.addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) close();
    });

    sheetApi = { open: open, close: close, isOpen: function () { return isOpen; } };
    return sheetApi;
  }

  // ---- More menu (mobile tab bar): Timeline, About, Write to the keeper ----

  var moreContent = null;
  var moreBtn = document.querySelector(".tabbar .more");
  if (moreBtn) {
    moreBtn.addEventListener("click", function () {
      if (!moreContent) {
        moreContent = document.createElement("div");
        moreContent.innerHTML =
          '<nav class="sheet-rows" aria-label="More pages">' +
          '<a class="sheet-row" href="/timeline"><span class="eyebrow">The story of 2026</span><span class="row-title">Timeline</span></a>' +
          '<a class="sheet-row" href="/about"><span class="eyebrow">Why this exists · sources</span><span class="row-title">About this page</span></a>' +
          '<button class="sheet-row" type="button"><span class="eyebrow">Say hello</span><span class="row-title">Write to the keeper</span></button>' +
          "</nav>";
        moreContent.querySelector("button.sheet-row").addEventListener("click", function () {
          openDrawer(); // swaps the open sheet's content to the contact form
        });
      }
      getSheet().open(moreContent);
    });
  }

  // ---- "Made with love" message drawer ----
  // One shared content node: mounted in the centered dialog on desktop,
  // in the bottom sheet on phones (<720px).

  var overlay = null;
  var lastFocus = null;
  var msgContent = null;

  function focusables() {
    return Array.prototype.slice
      .call(overlay.querySelectorAll("a[href], button, input, textarea, [tabindex]"))
      .filter(function (el) {
        return !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null;
      });
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDrawer();
      return;
    }
    if (e.key !== "Tab") return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function buildMsgContent() {
    msgContent = document.createElement("div");
    msgContent.className = "msg-content";
    msgContent.innerHTML =
      '<p class="eyebrow">Say hello</p>' +
      '<h3 id="msg-title">A note for the keeper</h3>' +
      '<p class="msg-intro">Hi — I’m the volunteer who tends this page, with a lot of help from the watchers of the nest. Corrections, official links we missed, or just a kind word — all of it is welcome here.</p>' +
      '<form class="msg-form" novalidate>' +
      '<label class="msg-field"><span class="lbl">Your name <em>· optional</em></span>' +
      '<input name="name" maxlength="120" autocomplete="name"></label>' +
      '<label class="msg-field"><span class="lbl">Email or social handle <em>· optional, if you’d like a reply</em></span>' +
      '<input name="contact" maxlength="200" autocomplete="email"></label>' +
      '<label class="msg-field"><span class="lbl">Your message</span>' +
      '<textarea name="message" maxlength="2000" required rows="5"></textarea></label>' +
      '<label class="hp" aria-hidden="true">Leave this field empty<input name="website" tabindex="-1" autocomplete="off"></label>' +
      '<p class="msg-error" hidden></p>' +
      '<div class="msg-actions">' +
      '<button type="submit" class="btn">Send message</button>' +
      '<button type="button" class="btn quiet" data-close>Close</button>' +
      "</div>" +
      "</form>" +
      '<div class="msg-done" hidden>' +
      "<p><strong>Thank you — the keeper reads every message.</strong></p>" +
      "<p>It means a lot that you took a moment. Be kind to yourself, and keep an eye on the nest.</p>" +
      '<button type="button" class="btn quiet" data-close>Close</button>' +
      "</div>";

    var form = msgContent.querySelector(".msg-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var errorEl = msgContent.querySelector(".msg-error");
      var submit = form.querySelector('button[type="submit"]');
      var message = form.elements.message.value.trim();
      if (!message) {
        errorEl.textContent = "Please write a message first — even a short one.";
        errorEl.hidden = false;
        form.elements.message.focus();
        return;
      }
      errorEl.hidden = true;
      submit.disabled = true;
      submit.textContent = "Sending…";
      fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.elements.name.value.trim(),
          contact: form.elements.contact.value.trim(),
          message: message,
          website: form.elements.website.value,
          page: page,
        }),
      })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok && data.ok !== false, data: data }; });
        })
        .then(function (result) {
          if (result.ok) {
            form.hidden = true;
            var done = msgContent.querySelector(".msg-done");
            done.hidden = false;
            done.querySelector("[data-close]").focus();
          } else {
            errorEl.textContent = result.data.error || "Something went wrong — please try again.";
            errorEl.hidden = false;
          }
        })
        .catch(function () {
          errorEl.textContent = "Couldn’t reach the nest — please try again in a moment.";
          errorEl.hidden = false;
        })
        .then(function () {
          submit.disabled = false;
          submit.textContent = "Send message";
        });
    });
  }

  function buildDrawer() {
    overlay = document.createElement("div");
    overlay.className = "msg-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="msg-panel" role="dialog" aria-modal="true" aria-labelledby="msg-title">' +
      '<button class="msg-x" type="button" data-close aria-label="Close">×</button>' +
      "</div>";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest("[data-close]")) closeDrawer();
    });
  }

  var mobileMq = window.matchMedia("(max-width: 719px)");

  function openDrawer() {
    if (!msgContent) buildMsgContent();
    if (mobileMq.matches) {
      // Phones: Vaul-style bottom sheet (keyboard-aware). Focus rests on the
      // handle so the keyboard only opens when a field is tapped.
      getSheet().open(msgContent, { focusHandle: true });
      return;
    }
    if (!overlay) buildDrawer();
    var panel = overlay.querySelector(".msg-panel");
    if (msgContent.parentNode !== panel) panel.appendChild(msgContent);
    lastFocus = document.activeElement;
    overlay.hidden = false;
    overlay.classList.remove("is-closing");
    void overlay.offsetWidth; // paint the resting state before opening
    overlay.classList.add("is-open");
    document.addEventListener("keydown", onKeydown);
    var field = msgContent.querySelector(".msg-form:not([hidden]) input[name='name']") ||
      msgContent.querySelector(".msg-done:not([hidden]) [data-close]");
    if (field) field.focus();
  }

  function closeDrawer() {
    if (!overlay || overlay.hidden) return;
    document.removeEventListener("keydown", onKeydown);
    overlay.classList.add("is-closing");
    overlay.classList.remove("is-open");
    var wait = reduceMotion ? 0 : 200; // matches the 180ms exit transition
    setTimeout(function () {
      overlay.hidden = true;
      overlay.classList.remove("is-closing");
    }, wait);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Every opener on the page (footer buttons, "Send a correction…")
  Array.prototype.slice.call(document.querySelectorAll("[data-open-msg]")).forEach(function (btn) {
    btn.addEventListener("click", openDrawer);
  });

  // ---- whole update card opens its permalink ----
  // Delegated (cards re-render), and deliberately forgiving: clicks on links
  // or buttons pass through, and an active text selection never navigates —
  // people copy update text to share, and that must keep working.
  document.addEventListener("click", function (e) {
    var card = e.target.closest && e.target.closest(".update");
    if (!card || e.target.closest("a, button")) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length) return;
    var link = card.querySelector("h3 a");
    if (link) window.location.assign(link.href);
  });
})();
