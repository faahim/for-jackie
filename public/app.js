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

  function setHtml(el, html, animate) {
    if (el.innerHTML === html) return;
    el.innerHTML = html;
    if (animate && !reduceMotion) {
      el.classList.remove("region-swap");
      void el.offsetWidth; // reflow so the animation can replay
      el.classList.add("region-swap");
    }
  }

  function renderStamps(content) {
    var stamp = content.meta && content.meta.updatedAt ? humanStamp(content.meta.updatedAt) : null;
    var el = document.getElementById("fresh");
    if (el) {
      el.textContent = stamp || (content.meta && content.meta.lastVerified
        ? "verified " + content.meta.lastVerified
        : el.textContent);
    }
    el = document.getElementById("stamp");
    if (el && stamp) el.textContent = "Verified facts · " + stamp;
  }

  function render(content, animate) {
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
          animate
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
          animate
        );
      }
      el = document.getElementById("latest");
      if (el && content.updates) {
        setHtml(el, content.updates.slice(0, 5).map(updateHtml).join(""), animate);
      }
      el = document.getElementById("unknowns");
      if (el && content.unknowns) {
        setHtml(
          el,
          content.unknowns.map(function (u) { return "<li>" + esc(u) + "</li>"; }).join(""),
          animate
        );
      }
    }

    if (page === "updates") {
      el = document.getElementById("feed");
      if (el && content.updates) {
        // Every update, no cap — this page is the full record.
        setHtml(el, content.updates.map(updateHtml).join(""), animate);
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
          animate
        );
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
          animate
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
      render(cached, false);
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
          render(content, lastRendered !== null);
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

  // ---- soothing first-view reveals (once, staggered, ease-out) ----

  function setupReveals() {
    var els = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    if (!els.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        var delay = 0;
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          el.style.transitionDelay = delay + "ms";
          delay += 70; // small stagger between elements arriving together
          el.classList.add("is-in");
          io.unobserve(el);
          setTimeout(function () { el.style.transitionDelay = ""; }, 1200);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
    );
    els.forEach(function (el) { io.observe(el); });
  }
  setupReveals();

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
    var wait = reduceMotion ? 0 : 180;
    setTimeout(function () {
      overlay.hidden = true;
      overlay.classList.remove("is-closing");
    }, wait);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  var opener = document.getElementById("open-msg");
  if (opener) opener.addEventListener("click", openDrawer);
})();
