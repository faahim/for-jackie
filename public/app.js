/* For Jackie — client renderer. Fetches the live content document and
 * hydrates the dynamic regions of whichever page is open. */
(function () {
  "use strict";

  var page = document.body.getAttribute("data-page") || "home";

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

  function render(content) {
    var el;

    // freshness stamp (all pages)
    el = document.getElementById("fresh");
    if (el && content.meta && content.meta.lastVerified) {
      el.textContent = "verified " + content.meta.lastVerified;
    }

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
        el.innerHTML =
          "<h1>" + content.headline.title.replace("alive and stable", "<em>alive and stable</em>") + "</h1>" +
          '<p class="lede">' + esc(content.headline.lede) + "</p>";
      }
      el = document.getElementById("chips");
      if (el && content.statuses) {
        el.innerHTML = content.statuses
          .map(function (s) {
            return (
              '<div class="chip ' + esc(s.tone) + '"><span class="who">' + esc(s.who) +
              '</span><span class="state">' + esc(s.state) + "</span></div>"
            );
          })
          .join("");
      }
      el = document.getElementById("latest");
      if (el && content.updates) {
        el.innerHTML = content.updates.slice(0, 3).map(updateHtml).join("");
      }
      el = document.getElementById("unknowns");
      if (el && content.unknowns) {
        el.innerHTML = content.unknowns
          .map(function (u) { return "<li>" + esc(u) + "</li>"; })
          .join("");
      }
    }

    if (page === "updates") {
      el = document.getElementById("feed");
      if (el && content.updates) {
        el.innerHTML = content.updates.map(updateHtml).join("");
      }
    }

    if (page === "rumors") {
      el = document.getElementById("rumor-list");
      if (el && content.rumors) {
        el.innerHTML = content.rumors
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
          .join("");
      }
    }

    if (page === "timeline") {
      el = document.getElementById("timeline");
      if (el && content.timeline) {
        el.innerHTML = content.timeline
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
          .join("");
      }
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
      .then(render)
      .catch(function (err) {
        console.log("content load failed", err);
      });
  }

  load();
  // Re-check for fresh content when the tab regains focus — people leave this open.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load();
  });
})();
