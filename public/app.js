/* For Jackie — client renderer. Renders instantly from the last cached content
 * document (no layout jitter), then refreshes from the live API and re-renders
 * only when something actually changed. Also: freshness stamps in the visitor's
 * local time, soothing first-view reveals, and the "message Fahim" drawer. */
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
      "<h3>" + esc(u.title) + "</h3>" +
      "<p>" + esc(u.body) + "</p>" +
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

  function renderStamps(content) {
    var stamp = content.meta && content.meta.updatedAt ? humanStamp(content.meta.updatedAt) : null;
    setText(
      document.getElementById("fresh"),
      stamp || (content.meta && content.meta.lastVerified ? "verified " + content.meta.lastVerified : null)
    );
    if (stamp) setText(document.getElementById("stamp"), "Verified facts · " + stamp);
  }

  function render(content, mode) {
    var el;

    renderStamps(content);

    // emergency banner (all pages)
    el = document.getElementById("alert-banner");
    if (el) {
      if (content.banner && content.banner.text) {
        el.textContent = content.banner.text;
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
                  "<figcaption>" + esc(c.author || "A community member") +
                  (c.url
                    ? ' <a class="src" rel="noopener" target="_blank" href="' + esc(c.url) + '">' +
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
        writeCache(content);
        if (content.meta.updatedAt !== lastRendered) {
          // Cold load (nothing rendered yet) fades in; a genuine content
          // change cross-fades. Identical content never reaches this branch.
          render(content, lastRendered === null ? "enter" : "update");
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

  function setupWall() {
    var wallEl = document.getElementById("wall");
    if (!wallEl) return;
    var WALL_CACHE = "fj:wall:v1";
    var lastNotes = null; // serialized form of what's rendered

    function noteHtml(n) {
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

    function renderWall(notes, mode) {
      var html = notes.length
        ? notes.map(noteHtml).join("")
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

  // ---- "Made with love by Faahim" message drawer ----

  var overlay = null;
  var lastFocus = null;

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

  function buildDrawer() {
    overlay = document.createElement("div");
    overlay.className = "msg-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="msg-panel" role="dialog" aria-modal="true" aria-labelledby="msg-title">' +
      '<button class="msg-x" type="button" data-close aria-label="Close">×</button>' +
      '<p class="eyebrow">Say hello</p>' +
      '<h3 id="msg-title">A note for Fahim</h3>' +
      '<p class="msg-intro">Hi — I’m Fahim. I tend this page with a lot of help from the watchers of the nest. Corrections, official links we missed, or just a kind word — all of it is welcome here.</p>' +
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
      "<p><strong>Thank you — Fahim reads every message.</strong></p>" +
      "<p>It means a lot that you took a moment. Be kind to yourself, and keep an eye on the nest.</p>" +
      '<button type="button" class="btn quiet" data-close>Close</button>' +
      "</div>" +
      "</div>";
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest("[data-close]")) closeDrawer();
    });

    var form = overlay.querySelector(".msg-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var errorEl = overlay.querySelector(".msg-error");
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
            var done = overlay.querySelector(".msg-done");
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

  function openDrawer() {
    if (!overlay) buildDrawer();
    lastFocus = document.activeElement;
    overlay.hidden = false;
    overlay.classList.remove("is-closing");
    void overlay.offsetWidth; // paint the resting state before opening
    overlay.classList.add("is-open");
    document.addEventListener("keydown", onKeydown);
    var field = overlay.querySelector(".msg-form:not([hidden]) input[name='name']") ||
      overlay.querySelector(".msg-done:not([hidden]) [data-close]");
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

  // Every opener on the page ("Faahim", "Write to Fahim", "Send a correction…")
  Array.prototype.slice.call(document.querySelectorAll("[data-open-msg]")).forEach(function (btn) {
    btn.addEventListener("click", openDrawer);
  });
})();
