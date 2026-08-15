/**
 * For Jackie — edge rendering for search engines and AI crawlers.
 *
 * The site hydrates client-side from /api/content, but no major AI crawler
 * (GPTBot, ClaudeBot, PerplexityBot, …) executes JavaScript — they read raw
 * HTML once and move on. This module injects the live content document into
 * the static HTML at the edge so every crawler (and no-JS visitor) sees the
 * real, current content. The HTML builders mirror public/app.js exactly;
 * app.js re-renders over them harmlessly (its setHtml memoization and the
 * body[data-ssr] flag keep hydration silent).
 *
 * Also here: per-page JSON-LD, /sitemap.xml, /llms.txt, /llms-full.txt.
 */

const SITE = "https://forjackie.org";

/** Clean asset paths (html_handling: auto-trailing-slash) → logical page. */
export const PAGE_FOR_PATH = {
  "/": "home",
  "/updates": "updates",
  "/rumors": "rumors",
  "/timeline": "life",   // the cinematic life story (static content, Aug 15 2026)
  "/record": "timeline", // the 2026 day-by-day record (renders content.timeline[])
  "/wall": "wall",
  "/about": "about",
  "/help": "help",
};

// ---------- HTML builders (mirror public/app.js) ----------

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
      .map((s) => '<a class="src" rel="noopener" target="_blank" href="' + esc(s.url) + '">' + esc(s.label) + "</a>")
      .join("") +
    "</div>"
  );
}

function prettyDate(iso) {
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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

function headlineHtml(headline) {
  return (
    "<h1>" + headline.title.replace("alive and stable", "<em>alive and stable</em>") + "</h1>" +
    '<p class="lede">' + esc(headline.lede) + "</p>"
  );
}

function chipsHtml(statuses) {
  return statuses
    .map(
      (s) =>
        '<div class="chip ' + esc(s.tone) + '"><span class="who">' + esc(s.who) +
        '</span><span class="state">' + esc(s.state) + "</span></div>"
    )
    .join("");
}

function unknownsHtml(unknowns) {
  return unknowns.map((u) => "<li>" + esc(u) + "</li>").join("");
}

function rumorsHtml(rumors) {
  return rumors
    .map(
      (r) =>
        '<div class="rumor"><div class="claim">' + esc(r.claim) + "</div>" +
        '<div class="verdict"><p><span class="tag ' + esc(r.verdict) + '">' + esc(r.verdictLabel) +
        "</span> " + esc(r.body) + " " +
        (r.sources || [])
          .map((s) => '<a class="src" rel="noopener" target="_blank" href="' + esc(s.url) + '">' + esc(s.label) + "</a>")
          .join(" ") +
        "</p></div></div>"
    )
    .join("");
}

function timelineHtml(timeline) {
  return timeline
    .map(
      (ch) =>
        '<li class="chapter">' + esc(ch.chapter) + "</li>" +
        ch.events
          .map((ev) => {
            const cls = ev.phase === "crisis" ? " crisis" : ev.phase === "hope" ? " hope" : "";
            return (
              '<li class="event' + cls + '"><span class="date">' + esc(ev.date) + "</span><h3>" +
              esc(ev.title) + "</h3><p>" + esc(ev.body) + "</p></li>"
            );
          })
          .join("")
    )
    .join("");
}

// ---------- Wall of Love builders (mirror public/app.js — keep in sync) ----------

function wallDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function wallNoteHtml(n) {
  const when = wallDate(n.approvedAt);
  return (
    '<div class="wall-note"><p class="txt">' + esc(n.message) + "</p>" +
    '<div class="who"><span>' + esc(n.name || "A friend of the nest") + "</span>" +
    (when ? '<span class="date">' + esc(when) + "</span>" : "") +
    "</div></div>"
  );
}

/** Blank lines separate paragraphs; single newlines become soft breaks. */
function storyParagraphs(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => "<p>" + esc(p.trim()).replace(/\n/g, "<br>") + "</p>")
    .join("");
}

function storyHtml(s) {
  const when = wallDate(s.approvedAt);
  const meta = [s.from, when].filter(Boolean).join(" · ");
  return (
    '<article class="story">' +
    '<div class="story-text">' + storyParagraphs(s.message) + "</div>" +
    '<footer class="story-sig"><span class="story-name">' + esc(s.name || "A friend of the nest") + "</span>" +
    (meta ? '<span class="story-meta">' + esc(meta) + "</span>" : "") +
    (s.id ? '<a class="story-link" href="/wall/' + esc(s.id) + '">This story’s own page →</a>' : "") +
    "</footer></article>"
  );
}

function communityHtml(community) {
  return community
    .map(
      (c) =>
        '<figure class="community-card"><blockquote>' + esc(c.quote) + "</blockquote>" +
        '<figcaption><span class="who">' + esc(c.author || "A community member") + "</span>" +
        (c.url
          ? '<a class="src" rel="noopener" target="_blank" href="' + esc(c.url) + '">' + esc(c.sourceLabel || "source") + "</a>"
          : "") +
        "</figcaption></figure>"
    )
    .join("");
}

/**
 * The About page's "Sources" list, derived from the live document instead of
 * hand-maintained markup. Every URL cited anywhere in updates[] or rumors[]
 * appears exactly once, in document order (newest first, since updates[] is).
 *
 * Source labels are "Outlet · Mon DD" — the outlet becomes the link text and
 * the date the mono stamp. Keep this mirrored with citedSourcesHtml in app.js.
 */
const PINNED_SOURCES = [
  {
    url: "https://friendsofbigbearvalley.org/",
    name: "Friends of Big Bear Valley",
    date: "official · nest cams & updates",
  },
  {
    url: "https://www.ojairaptorcenter.org/",
    name: "Ojai Raptor Center",
    date: "official · Jackie's care facility",
  },
];

function citedSources(c) {
  const seen = new Set();
  const items = [];
  for (const p of PINNED_SOURCES) {
    seen.add(p.url);
    items.push(p);
  }
  const add = (s) => {
    if (!s || !s.url || seen.has(s.url)) return;
    seen.add(s.url);
    const label = String(s.label || "");
    const cut = label.lastIndexOf(" · ");
    items.push({
      url: s.url,
      name: cut > 0 ? label.slice(0, cut) : label || "source",
      date: cut > 0 ? label.slice(cut + 3) : "",
    });
  };
  for (const u of c.updates || []) (u.sources || []).forEach(add);
  for (const r of c.rumors || []) (r.sources || []).forEach(add);
  return items;
}

function citedSourcesHtml(c) {
  return citedSources(c)
    .map(
      (s) =>
        '<li><a rel="noopener" target="_blank" href="' + esc(s.url) + '">' + esc(s.name) + "</a>" +
        (s.date ? '<span class="mono">' + esc(s.date) + "</span>" : "") +
        "</li>"
    )
    .join("");
}

function fmtDateUTC(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// ---------- JSON-LD ----------

function ldOrg() {
  return {
    "@type": "Organization",
    "@id": SITE + "/#org",
    name: "For Jackie",
    url: SITE + "/",
    logo: { "@type": "ImageObject", url: SITE + "/icon-512.png" },
    description:
      "A volunteer-run community resource publishing verified, source-linked updates about Jackie, the Big Bear bald eagle. Not affiliated with Friends of Big Bear Valley or the Ojai Raptor Center.",
  };
}

function ldWebsite() {
  return {
    "@type": "WebSite",
    "@id": SITE + "/#website",
    name: "For Jackie",
    url: SITE + "/",
    description:
      "Verified, source-linked live updates on Jackie the Big Bear bald eagle — her rescue, her recovery at the Ojai Raptor Center, and her family: Shadow, Sandy, and Luna.",
    publisher: { "@id": SITE + "/#org" },
    inLanguage: "en",
  };
}

function ldJackie() {
  return {
    "@type": "Thing",
    "@id": SITE + "/#jackie",
    name: "Jackie (bald eagle)",
    alternateName: ["Jackie the eagle", "Jackie the Big Bear eagle"],
    description:
      "Wild bald eagle of Big Bear Valley, California, mate of Shadow and mother of 2026 fledglings Sandy and Luna. Rescued on July 17, 2026 after being found grounded by Big Bear Lake; her recovery at the Ojai Raptor Center is chronicled on this site with sources.",
    sameAs: ["https://en.wikipedia.org/wiki/Jackie_and_Shadow"],
  };
}

export function jsonLdFor(page, c) {
  const updatedAt = (c.meta && c.meta.updatedAt) || undefined;
  const graph = [ldWebsite(), ldOrg(), ldJackie()];
  const base = (path, extra) =>
    Object.assign(
      {
        "@type": "WebPage",
        "@id": SITE + path + "#webpage",
        url: SITE + path,
        isPartOf: { "@id": SITE + "/#website" },
        about: { "@id": SITE + "/#jackie" },
        inLanguage: "en",
        dateModified: updatedAt,
      },
      extra
    );

  if (page === "home") {
    graph.push(
      base("/", {
        name: (c.headline && c.headline.title) || "For Jackie — Live Status",
        description: c.headline && c.headline.lede,
      })
    );
  }

  if (page === "updates") {
    graph.push({
      "@type": "LiveBlogPosting",
      "@id": SITE + "/updates#liveblog",
      url: SITE + "/updates",
      mainEntityOfPage: SITE + "/updates",
      headline: "Jackie's rescue and recovery — every verified update, with sources",
      about: { "@id": SITE + "/#jackie" },
      publisher: { "@id": SITE + "/#org" },
      coverageStartTime: "2026-07-17",
      dateModified: updatedAt,
      inLanguage: "en",
      liveBlogUpdate: (c.updates || []).map((u) => {
        const post = {
          "@type": "BlogPosting",
          headline: u.title,
          articleBody: u.body,
          datePublished: u.date,
        };
        if (u.sources && u.sources.length) post.citation = u.sources.map((s) => s.url);
        return post;
      }),
    });
  }

  if (page === "rumors") {
    graph.push(
      base("/rumors", {
        "@type": "FAQPage",
        name: "Rumor check — claims about Jackie the Big Bear eagle vs. what official sources say",
        mainEntity: (c.rumors || []).map((r) => ({
          "@type": "Question",
          name: r.claim,
          acceptedAnswer: {
            "@type": "Answer",
            text:
              r.verdictLabel + " — " + r.body +
              (r.sources && r.sources.length
                ? " (Sources: " + r.sources.map((s) => s.label + " — " + s.url).join("; ") + ")"
                : ""),
          },
        })),
      })
    );
  }

  if (page === "life") {
    graph.push(
      base("/timeline", {
        "@type": "Article",
        headline: "The Story of Jackie — a Life Above Big Bear Lake, 2012–2026",
        name: "The Story of Jackie — a Life Above Big Bear Lake, 2012–2026",
        description:
          "The whole life of Jackie, the Big Bear bald eagle: the first chick ever documented hatching in the valley (2012), the nest camera that made her famous, the 2023 blizzard, her ten eaglets, and her death at the Ojai Raptor Center in August 2026 — every fact sourced to FOBBV, ORC, CDFW and first-hand reporting.",
        datePublished: "2026-08-15",
        publisher: { "@id": SITE + "/#org" },
      })
    );
  }

  if (page === "timeline") {
    graph.push(
      base("/record", {
        name: "Jackie's 2026, day by day — the season, the rescue, and the final weeks, with sources",
        mainEntity: {
          "@type": "ItemList",
          itemListElement: (c.timeline || [])
            .flatMap((ch) => ch.events)
            .map((ev, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: ev.date + " — " + ev.title,
              description: ev.body,
            })),
        },
      })
    );
  }

  if (page === "wall") {
    graph.push(
      base("/wall", {
        name: "Wall of Love — a moderated community memorial wall for Jackie",
        description:
          "Notes and stories from Jackie's worldwide community — what she meant to the people who watched her. Everything is checked before it appears.",
      })
    );
  }

  if (page === "about") {
    graph.push(
      base("/about", {
        "@type": "AboutPage",
        name: "About For Jackie — who runs it and how facts are verified",
      })
    );
  }

  if (page === "help") {
    graph.push(
      base("/help", {
        name: "How to help Jackie the Big Bear eagle",
        significantLink: [
          "https://ojairaptorcenter.networkforgood.com/projects/303440-bald-eagle-rehabilitation-campaign",
          "https://friendsofbigbearvalley.org/",
        ],
      })
    );
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

// ---------- HTML transform ----------

class InnerHtml {
  constructor(html) { this.html = html; }
  element(el) { el.setInnerContent(this.html, { html: true }); }
}

/**
 * Rewrite a static HTML asset response with the live content document.
 * Never throws into the response path: callers wrap in try/catch and fall
 * back to the untouched asset.
 */
export function transformHtml(page, assetRes, c, wallEntries) {
  const rewriter = new HTMLRewriter();

  // Mark the document as server-rendered so app.js hydrates silently
  // (no entrance animation replay over identical content).
  rewriter.on("body", {
    element(el) { el.setAttribute("data-ssr", "1"); },
  });

  // Emergency banner (all pages).
  if (c.banner && c.banner.text) {
    rewriter.on("#alert-banner", {
      element(el) {
        el.setAttribute("class", "alert-banner visible");
        el.setInnerContent(c.banner.text);
      },
    });
  }

  // Freshness stamps: absolute UTC date for crawlers; the client rewrites
  // these into the visitor's local time.
  const updatedNice = c.meta && c.meta.updatedAt ? fmtDateUTC(c.meta.updatedAt) : null;
  if (updatedNice) {
    rewriter.on("#fresh", { element(el) { el.setInnerContent("updated " + updatedNice); } });
    rewriter.on("#stamp", { element(el) { el.setInnerContent("Verified facts · updated " + updatedNice); } });
  }

  if (page === "home") {
    if (c.headline) {
      rewriter.on("#headline", new InnerHtml(headlineHtml(c.headline)));
      // Keep the meta description as current as the hero: use the live lede.
      const desc = String(c.headline.lede || "").slice(0, 300);
      if (desc) {
        rewriter.on('meta[name="description"]', {
          element(el) { el.setAttribute("content", desc); },
        });
        rewriter.on('meta[property="og:description"]', {
          element(el) { el.setAttribute("content", desc); },
        });
      }
    }
    if (c.statuses) rewriter.on("#chips", new InnerHtml(chipsHtml(c.statuses)));
    if (c.updates) rewriter.on("#latest", new InnerHtml(c.updates.slice(0, 5).map(updateHtml).join("")));
    if (c.unknowns) rewriter.on("#unknowns", new InnerHtml(unknownsHtml(c.unknowns)));
  }

  if (page === "updates" && c.updates) {
    rewriter.on("#feed", new InnerHtml(c.updates.map(updateHtml).join("")));
  }

  if (page === "rumors" && c.rumors) {
    rewriter.on("#rumor-list", new InnerHtml(rumorsHtml(c.rumors)));
  }

  if (page === "timeline" && c.timeline) {
    rewriter.on("#timeline", new InnerHtml(timelineHtml(c.timeline)));
  }

  if (page === "about") {
    rewriter.on("#sources", new InnerHtml(citedSourcesHtml(c)));
  }

  if (page === "wall" && Array.isArray(c.community) && c.community.length) {
    rewriter.on("#community", { element(el) { el.removeAttribute("hidden"); } });
    rewriter.on("#community-list", new InnerHtml(communityHtml(c.community)));
  }

  // Wall page: server-render the approved notes and stories themselves so
  // crawlers and no-JS visitors see the real wall (newest first), not
  // skeleton placeholders. wallEntries comes straight from the wall:* KV list.
  if (page === "wall" && Array.isArray(wallEntries)) {
    const notes = [];
    const stories = [];
    for (const e of wallEntries) {
      if (e.kind === "story") {
        stories.push({
          id: String(e.key || "").slice(-8),
          name: e.name || null,
          from: e.from || null,
          message: e.message,
          approvedAt: e.approvedAt,
        });
      } else {
        notes.push({ name: e.name || null, message: e.message, approvedAt: e.approvedAt });
      }
    }
    notes.reverse();
    stories.reverse();
    if (notes.length) rewriter.on("#wall", new InnerHtml(notes.map(wallNoteHtml).join("")));
    if (stories.length) {
      rewriter.on("#stories", { element(el) { el.removeAttribute("hidden"); } });
      rewriter.on("#story-list", new InnerHtml(stories.map(storyHtml).join("")));
    }
  }

  // JSON-LD: appended just before </head>. <-escape so "</script>" in
  // content can never break out of the script element.
  const ld = JSON.stringify(jsonLdFor(page, c)).replace(/</g, "\\u003c");
  rewriter.on("head", {
    element(el) {
      el.append('<script type="application/ld+json">' + ld + "</script>", { html: true });
    },
  });

  const res = rewriter.transform(assetRes);
  const headers = new Headers(res.headers);
  // The body now varies with the content doc — conditional revalidation
  // against the static asset would serve stale SSR. Short shared max-age
  // keeps crawlers fresh without hammering KV.
  headers.delete("etag");
  headers.delete("last-modified");
  headers.set("cache-control", "public, max-age=300");
  return new Response(res.body, { status: res.status, headers });
}

// ---------- update permalink pages (/updates/<id>) ----------

/** Mirrors the pre-paint head script in the static pages — keep in sync. */
const PREPAINT_SCRIPT = `
document.documentElement.classList.add("js");
(function () {
  try {
    var doc = JSON.parse(localStorage.getItem("fj:content:v1"));
    if (doc && doc.banner && doc.banner.text) window.__fjBanner = String(doc.banner.text);
    var meta = doc && doc.meta;
    if (!meta) return;
    var updated = null;
    var d = new Date(meta.updatedAt);
    if (!isNaN(d)) {
      var now = new Date();
      var time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      var days = Math.round(
        (new Date(now.getFullYear(), now.getMonth(), now.getDate()) -
          new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
      updated =
        days <= 0 ? "updated today at " + time :
        days === 1 ? "updated yesterday at " + time :
        days < 7 ? "updated " + d.toLocaleDateString(undefined, { weekday: "long" }) + " at " + time :
        "updated " + d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }
    var c = new Date(meta.checkedAt);
    if (!isNaN(c)) {
      var age = Math.max(0, Date.now() - c.getTime());
      var mins = Math.floor(age / 60000);
      var stale = age > 20 * 60000;
      window.__fjFresh = stale ? "checking…" :
        "checked " + (age < 90000 ? "just now" : mins < 60 ? mins + "m ago" : Math.floor(mins / 60) + "h ago");
      window.__fjHero = (stale ? "Checking now" :
        "Checked " + (age < 90000 ? "just now" : mins < 60 ? mins + " min ago" : Math.floor(mins / 60) + " h ago")) +
        (updated ? " · " + updated.replace(/^updated/, "latest update") : "");
    } else if (updated) {
      window.__fjFresh = updated;
      window.__fjHero = "Verified facts · " + updated;
    }
  } catch (e) { /* first visit or blocked storage */ }
})();
`;

function fullDate(iso) {
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function excerpt(text, max) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

function paragraphs(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => "<p>" + esc(p.trim()) + "</p>")
    .join("");
}

function exploreCard(href, eyebrow, title, desc) {
  return (
    '<a class="explore-card" href="' + esc(href) + '">' +
    '<span class="eyebrow">' + esc(eyebrow) + "</span>" +
    '<span class="title">' + esc(title) + "</span>" +
    '<span class="desc">' + esc(desc) + "</span>" +
    '<span class="go" aria-hidden="true">→</span></a>'
  );
}

export function findUpdate(c, id) {
  const updates = c.updates || [];
  const i = updates.findIndex((u) => u.id === id);
  if (i === -1) return null;
  return { u: updates[i], newer: updates[i - 1] || null, older: updates[i + 1] || null };
}

/**
 * A full server-rendered article page for one verified update. Same chrome as
 * the static pages (strip, banner, nav, footer, tab bar, pre-paint script) so
 * navigation, stamps, and the message drawer behave identically; app.js runs
 * with data-page="post" and touches only the banner and freshness stamps.
 */
export function renderUpdatePage(found, c) {
  const { u, newer, older } = found;
  const url = SITE + "/updates/" + u.id;
  const title = u.title + " — Jackie Update, " + fmtDateUTC(u.date + "T12:00:00Z") + " · For Jackie";
  const desc = excerpt(u.body, 160);
  const updatedNice = c.meta && c.meta.updatedAt ? fmtDateUTC(c.meta.updatedAt) : null;
  const bannerHtml =
    c.banner && c.banner.text
      ? '<div class="alert-banner visible" id="alert-banner" role="status">' + esc(c.banner.text) + "</div>"
      : '<div class="alert-banner" id="alert-banner" role="status"></div>';

  const article = {
    "@type": "NewsArticle",
    "@id": url + "#article",
    headline: u.title,
    description: desc,
    articleBody: u.body + (u.longBody ? "\n\n" + u.longBody : ""),
    datePublished: u.date,
    dateModified: u.date,
    url,
    mainEntityOfPage: url,
    isPartOf: { "@id": SITE + "/#website" },
    publisher: { "@id": SITE + "/#org" },
    about: { "@id": SITE + "/#jackie" },
    inLanguage: "en",
  };
  if (u.sources && u.sources.length) article.citation = u.sources.map((s) => s.url);
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "For Jackie", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Verified updates", item: SITE + "/updates" },
      { "@type": "ListItem", position: 3, name: u.title, item: url },
    ],
  };
  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [ldWebsite(), ldOrg(), ldJackie(), article, breadcrumb],
  }).replace(/</g, "\\u003c");

  const neighborCards =
    (older
      ? exploreCard("/updates/" + older.id, "Earlier · " + prettyDate(older.date), older.title, excerpt(older.body, 90))
      : "") +
    (newer
      ? exploreCard("/updates/" + newer.id, "Next · " + prettyDate(newer.date), newer.title, excerpt(newer.body, 90))
      : "");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="stylesheet" href="/styles.css?v=16">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:site_name" content="For Jackie">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(u.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE}/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="article:published_time" content="${esc(u.date)}">
<meta name="twitter:card" content="summary_large_image">
<script>${PREPAINT_SCRIPT}</script>
<script type="application/ld+json">${ld}</script>
</head>
<body data-page="post" data-ssr="1">

<div class="strip"><span class="strip-full">Community-run · <strong>Not affiliated</strong> with FOBBV or the Ojai Raptor Center · Every fact links to its source</span><span class="strip-mini">Community-run · <strong>Not affiliated</strong> · Sources linked</span></div>
${bannerHtml}
<script>(function () { var el = document.getElementById("alert-banner"); if (window.__fjBanner && el) { el.textContent = window.__fjBanner; el.classList.add("visible"); } })();</script>

<nav class="topnav">
  <div class="inner">
    <a class="wordmark" href="/">For Jackie</a>
    <div class="links">
      <a href="/">Status</a>
      <a href="/updates" aria-current="page">Updates</a>
      <a href="/wall">Wall of Love</a>
      <a href="/timeline">Timeline</a>
      <a href="/rumors">Rumor Check</a>
      <a href="/help">How to Help</a>
    </div>
    <span class="fresh" id="fresh">${updatedNice ? "updated " + esc(updatedNice) : "updated recently"}</span>
  </div>
</nav>
<script>if (window.__fjFresh) document.getElementById("fresh").textContent = window.__fjFresh;</script>

<main>
  <article class="post ${esc(u.tone || "info")}">
    <div class="page-head reveal">
      <a class="backlink" href="/updates">← All verified updates</a>
      <p class="eyebrow post-when"><span class="tone-dot"></span>Verified update · ${esc(fullDate(u.date))}</p>
      <h1>${esc(u.title)}</h1>
    </div>
    <div class="post-body reveal">
      ${paragraphs(u.body)}
      ${u.longBody ? paragraphs(u.longBody) : ""}
      ${sourcesHtml(u.sources)}
    </div>
  </article>

  <section class="reveal">
    <p class="eyebrow">Right now</p>
    <h2>Where things stand today</h2>
    <p class="section-intro">${esc((c.headline && c.headline.lede) || "")}</p>
    <a class="more-link" href="/">Jackie's live status →</a>
  </section>

  <section class="reveal">
    <p class="eyebrow">Keep reading</p>
    <h2>More of the story</h2>
    <div class="explore-grid">
      ${neighborCards}
      ${exploreCard("/rumors", "Rumor check", "Before you worry", "What's true, what isn't, and what's simply unknown.")}
      ${exploreCard("/wall", "Wall of Love", "Leave a little light", "Notes of hope from the community. Read them, or add your own.")}
      ${exploreCard("/help", "How to help", "Turn worry into help", "What genuinely makes a difference — and what to skip.")}
    </div>
  </section>
</main>

<footer class="site">
  <main style="padding-bottom:0;">
    <nav>
      <a href="/about">About this page &amp; sources</a>
      <a href="/wall">Wall of Love</a>
      <a href="/timeline">Timeline</a>
      <a rel="noopener" target="_blank" href="https://friendsofbigbearvalley.org/livestream/">Official FOBBV livestream</a>
      <a rel="noopener" target="_blank" href="https://www.ojairaptorcenter.org/">Ojai Raptor Center</a>
    </nav>
    <p><strong>For Jackie</strong> is an unofficial, volunteer-made community resource — not affiliated with, endorsed by, or speaking for Friends of Big Bear Valley, the Ojai Raptor Center, or any agency involved in Jackie's care. When this page and an official source disagree, trust the official source.</p>
    <p>Have a correction, a resource, an idea for the community — or just something on your heart? The keeper of this page would love to hear it. <button class="made-by" type="button" data-open-msg>Write to the keeper</button></p>
    <p class="made-line">Made with love by <button class="made-by" type="button" data-open-msg>the keeper of this page</button> and the watchers of the nest. 🦅</p>
  </main>
</footer>

<nav class="tabbar" aria-label="Primary">
  <a href="/">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg>
    Status
  </a>
  <a href="/updates" aria-current="page">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 6h14M5 12h14M5 18h9"/></svg>
    Updates
  </a>
  <a href="/wall">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7-4.3-7-9.3C5 8 7 6 9.3 6c1.2 0 2.1.5 2.7 1.4C12.6 6.5 13.5 6 14.7 6 17 6 19 8 19 10.7c0 5-7 9.3-7 9.3z"/></svg>
    Wall
  </a>
  <a href="/rumors">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M9.8 9.5a2.2 2.2 0 1 1 3.2 2c-.8.5-1 1-1 1.8"/><circle cx="12" cy="16.3" r="0.4" fill="currentColor"/></svg>
    Rumors
  </a>
  <a href="/help">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path stroke-linecap="round" d="M12 4v4.6M12 15.4V20M4 12h4.6M15.4 12H20"/></svg>
    Help
  </a>
  <button class="more" type="button" aria-haspopup="dialog">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/></svg>
    More
  </button>
</nav>

<script src="/app.js?v=16" defer></script>
</body>
</html>
`;
}

/** Small, honest 404 for unknown update ids — noindex, links back to the record. */
export function renderUpdate404() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Update not found · For Jackie</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/styles.css?v=16">
</head>
<body data-page="post">
<main>
  <div class="page-head">
    <p class="eyebrow">Not found</p>
    <h1>That update isn't here</h1>
    <p class="intro">It may have been consolidated into another entry. Everything verified lives on one page: <a href="/updates">all verified updates</a>.</p>
  </div>
</main>
</body>
</html>
`;
}

// ---------- story permalink pages (/wall/<hash8>) ----------

/**
 * A permanent, shareable page for one approved Wall of Love story. Same chrome
 * as the other pages (strip, banner, nav, footer, tab bar, pre-paint script);
 * app.js runs with data-page="story" and touches only banner + stamps.
 * The words are the writer's own — rendered with care, never altered.
 */
export function renderStoryPage(story, id, c) {
  const url = SITE + "/wall/" + id;
  const who = story.name || "A friend of the nest";
  const title = (story.name ? story.name + "’s story — For Jackie" : "A story for Jackie");
  const desc = excerpt(story.message, 160);
  const dateNice = story.approvedAt ? fmtDateUTC(story.approvedAt) : null;
  const updatedNice = c && c.meta && c.meta.updatedAt ? fmtDateUTC(c.meta.updatedAt) : null;
  const bannerHtml =
    c && c.banner && c.banner.text
      ? '<div class="alert-banner visible" id="alert-banner" role="status">' + esc(c.banner.text) + "</div>"
      : '<div class="alert-banner" id="alert-banner" role="status"></div>';
  const sigMeta = [story.from, dateNice].filter(Boolean).join(" · ");

  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      ldWebsite(),
      ldOrg(),
      ldJackie(),
      {
        "@type": "WebPage",
        "@id": url + "#webpage",
        url,
        name: title,
        description: desc,
        isPartOf: { "@id": SITE + "/#website" },
        about: { "@id": SITE + "/#jackie" },
        inLanguage: "en",
        datePublished: story.approvedAt,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "For Jackie", item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: "Wall of Love", item: SITE + "/wall" },
          { "@type": "ListItem", position: 3, name: title, item: url },
        ],
      },
    ],
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="stylesheet" href="/styles.css?v=16">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:site_name" content="For Jackie">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE}/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script>${PREPAINT_SCRIPT}</script>
<script type="application/ld+json">${ld}</script>
</head>
<body data-page="story" data-ssr="1">

<div class="strip"><span class="strip-full">Community-run · <strong>Not affiliated</strong> with FOBBV or the Ojai Raptor Center · Every fact links to its source</span><span class="strip-mini">Community-run · <strong>Not affiliated</strong> · Sources linked</span></div>
${bannerHtml}
<script>(function () { var el = document.getElementById("alert-banner"); if (window.__fjBanner && el) { el.textContent = window.__fjBanner; el.classList.add("visible"); } })();</script>

<nav class="topnav">
  <div class="inner">
    <a class="wordmark" href="/">For Jackie</a>
    <div class="links">
      <a href="/">Status</a>
      <a href="/updates">Updates</a>
      <a href="/wall" aria-current="page">Wall of Love</a>
      <a href="/timeline">Timeline</a>
      <a href="/rumors">Rumor Check</a>
      <a href="/help">How to Help</a>
    </div>
    <span class="fresh" id="fresh">${updatedNice ? "updated " + esc(updatedNice) : "updated recently"}</span>
  </div>
</nav>
<script>if (window.__fjFresh) document.getElementById("fresh").textContent = window.__fjFresh;</script>

<main>
  <article class="story-page">
    <div class="page-head reveal">
      <a class="backlink" href="/wall">← The Wall of Love</a>
      <p class="eyebrow">A story for Jackie${dateNice ? " · shared " + esc(dateNice) : ""}</p>
      <h1>${esc(story.name ? story.name + "’s story" : "A story for Jackie")}</h1>
    </div>
    <div class="story-body reveal">
      ${storyParagraphs(story.message)}
      <p class="story-close">— ${esc(who)}${sigMeta ? '<span class="story-meta"> · ' + esc(sigMeta) + "</span>" : ""}</p>
    </div>
  </article>

  <section class="reveal">
    <p class="eyebrow">The wall keeps growing</p>
    <h2>More from the community</h2>
    <div class="explore-grid">
      ${exploreCard("/wall", "Wall of Love", "Read more, or add your own", "Notes and stories from the people who watched Jackie's nest, all over the world.")}
      ${exploreCard("/timeline", "Her story", "The whole timeline", "From the nest above Big Bear Lake to the days the world watched and hoped.")}
    </div>
  </section>
</main>

<footer class="site">
  <main style="padding-bottom:0;">
    <nav>
      <a href="/about">About this page &amp; sources</a>
      <a href="/wall">Wall of Love</a>
      <a href="/timeline">Timeline</a>
      <a rel="noopener" target="_blank" href="https://friendsofbigbearvalley.org/livestream/">Official FOBBV livestream</a>
      <a rel="noopener" target="_blank" href="https://www.ojairaptorcenter.org/">Ojai Raptor Center</a>
    </nav>
    <p><strong>For Jackie</strong> is an unofficial, volunteer-made community resource — not affiliated with, endorsed by, or speaking for Friends of Big Bear Valley, the Ojai Raptor Center, or any agency involved in Jackie's care. When this page and an official source disagree, trust the official source.</p>
    <p>Have a correction, a resource, an idea for the community — or just something on your heart? The keeper of this page would love to hear it. <button class="made-by" type="button" data-open-msg>Write to the keeper</button></p>
    <p class="made-line">Made with love by <button class="made-by" type="button" data-open-msg>the keeper of this page</button> and the watchers of the nest. 🦅</p>
  </main>
</footer>

<nav class="tabbar" aria-label="Primary">
  <a href="/">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg>
    Status
  </a>
  <a href="/updates">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 6h14M5 12h14M5 18h9"/></svg>
    Updates
  </a>
  <a href="/wall" aria-current="page">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7-4.3-7-9.3C5 8 7 6 9.3 6c1.2 0 2.1.5 2.7 1.4C12.6 6.5 13.5 6 14.7 6 17 6 19 8 19 10.7c0 5-7 9.3-7 9.3z"/></svg>
    Wall
  </a>
  <a href="/rumors">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M9.8 9.5a2.2 2.2 0 1 1 3.2 2c-.8.5-1 1-1 1.8"/><circle cx="12" cy="16.3" r="0.4" fill="currentColor"/></svg>
    Rumors
  </a>
  <a href="/help">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path stroke-linecap="round" d="M12 4v4.6M12 15.4V20M4 12h4.6M15.4 12H20"/></svg>
    Help
  </a>
  <button class="more" type="button" aria-haspopup="dialog">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/></svg>
    More
  </button>
</nav>

<script src="/app.js?v=16" defer></script>
</body>
</html>
`;
}

/** Small, honest 404 for unknown story ids — noindex, links back to the wall. */
export function renderStory404() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Story not found · For Jackie</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/styles.css?v=16">
</head>
<body data-page="story">
<main>
  <div class="page-head">
    <p class="eyebrow">Not found</p>
    <h1>That story isn't here</h1>
    <p class="intro">It may have been taken down at its writer's request. The wall itself is always open: <a href="/wall">the Wall of Love</a>.</p>
  </div>
</main>
</body>
</html>
`;
}

// ---------- machine-readable text (llms.txt convention) ----------

function mdSources(sources) {
  if (!sources || !sources.length) return "";
  return " Sources: " + sources.map((s) => s.label + " <" + s.url + ">").join(", ");
}

export function llmsTxt(c) {
  const updated = (c.meta && c.meta.updatedAt) || "";
  return `# For Jackie

> Community-run, source-linked live coverage of Jackie, the famous bald eagle of Big Bear Valley, California (mate of Shadow; mother of 2026 fledglings Sandy and Luna). Jackie was rescued on July 17, 2026 and is in rehabilitation at the Ojai Raptor Center. Every published fact links to an official source (Friends of Big Bear Valley, the Ojai Raptor Center, or agencies involved in her care). This site is volunteer-run and NOT affiliated with FOBBV or ORC — when it and an official source disagree, trust the official source.

Content last updated: ${updated} (the site is updated whenever official sources publish news, typically several times a day).

Current summary: ${(c.headline && c.headline.lede) || ""}

## Pages

- [Live status](${SITE}/): Jackie's current condition, family status, latest verified updates, and open unknowns
- [Verified updates](${SITE}/updates): every update in order, each with its sources
- [Rumor check](${SITE}/rumors): circulating claims measured against what official sources actually said
- [The story of Jackie](${SITE}/timeline): her whole life, 2012–2026 — the first chick hatched in Big Bear Valley, the camera, the blizzard, her ten eaglets, and her final weeks, every fact sourced
- [The 2026 record](${SITE}/record): the season, the rescue, and the final weeks, day by day with sources
- [How to help](${SITE}/help): what genuinely helps (and what to skip)
- [About & sources](${SITE}/about): who runs this and the verification rules

## Full content

- [llms-full.txt](${SITE}/llms-full.txt): the complete current content of this site as plain text — status, all updates with sources, rumor checks, unknowns, and timeline

## Official sources

- [Friends of Big Bear Valley](https://friendsofbigbearvalley.org/): runs the nest cameras; the official voice of Jackie and Shadow's story
- [Official live nest cams on YouTube](https://www.youtube.com/channel/UCsFgbVuhRrPV5FqyN7kOD8g/live): FOBBV CAM, the official channel (Jackie is recovering off-camera at ORC; the cams show the nest territory)
- [FOBBV livestream page](https://friendsofbigbearvalley.org/livestream/): both cams plus viewing tips, straight from the source
- [Ojai Raptor Center](https://www.ojairaptorcenter.org/): the facility caring for Jackie
`;
}

export function llmsFullTxt(c) {
  const L = [];
  L.push("# For Jackie — complete current content (plain text)");
  L.push("");
  L.push("Community-run, source-linked coverage of Jackie, the Big Bear bald eagle. Not affiliated with Friends of Big Bear Valley (FOBBV) or the Ojai Raptor Center (ORC). Canonical site: " + SITE + "/");
  if (c.meta && c.meta.updatedAt) L.push("Content last updated: " + c.meta.updatedAt);
  L.push("");
  if (c.banner && c.banner.text) {
    L.push("## Important notice");
    L.push(c.banner.text);
    L.push("");
  }
  if (c.headline) {
    L.push("## Current status");
    L.push(c.headline.title);
    L.push("");
    L.push(c.headline.lede);
    L.push("");
  }
  if (c.statuses && c.statuses.length) {
    L.push("## At a glance");
    for (const s of c.statuses) L.push("- " + s.who + ": " + s.state);
    L.push("");
  }
  if (c.updates && c.updates.length) {
    L.push("## Verified updates (newest first)");
    for (const u of c.updates) {
      L.push("### " + u.date + " — " + u.title);
      L.push(u.body + (u.longBody ? "\n\n" + u.longBody : "") + mdSources(u.sources));
      if (u.id) L.push("Permalink: " + SITE + "/updates/" + u.id);
      L.push("");
    }
  }
  if (c.unknowns && c.unknowns.length) {
    L.push("## What nobody knows yet (open questions with no official answer)");
    for (const u of c.unknowns) L.push("- " + u);
    L.push("");
  }
  if (c.rumors && c.rumors.length) {
    L.push("## Rumor check (claims vs. official sources)");
    for (const r of c.rumors) {
      L.push("- Claim: \"" + r.claim + "\" — Verdict: " + r.verdictLabel + ". " + r.body + mdSources(r.sources));
    }
    L.push("");
  }
  if (c.timeline && c.timeline.length) {
    L.push("## Her whole life, as one story");
    L.push("The Story of Jackie (" + SITE + "/timeline) tells her entire life, 2012-2026, with every fact sourced: the first bald eagle chick ever documented hatching in Big Bear Valley (summer 2012, per CDFW), the FOBBV nest camera installed October 2015, her years with Mr. B and then Shadow (from 2018), the 2023 blizzard that made her world-famous, ten eaglets of which seven fledged (Stormy, Simba, Spirit, Sunny, Gizmo, Sandy, Luna), 25 eggs, her 62-hour incubation record (Feb 2024), and her death at the Ojai Raptor Center overnight Aug 9-10, 2026, at age 14.");
    L.push("");
    L.push("## The 2026 record (day-by-day timeline)");
    for (const ch of c.timeline) {
      L.push("### " + ch.chapter);
      for (const ev of ch.events) L.push("- " + ev.date + " — " + ev.title + ": " + ev.body);
      L.push("");
    }
  }
  L.push("## How to help");
  L.push("- Donate to the Ojai Raptor Center's Bald Eagle Rehabilitation Campaign (pays for Jackie's care): https://ojairaptorcenter.networkforgood.com/projects/303440-bald-eagle-rehabilitation-campaign");
  L.push("- Support Friends of Big Bear Valley (cameras, habitat, official updates): https://friendsofbigbearvalley.org/");
  L.push("- Do NOT call or text the Ojai Raptor Center's hotline — it is reserved for animals in urgent need. Updates come via their email list and social media.");
  L.push("");
  L.push("## Editorial rules");
  L.push("Only officially sourced facts are published, and every fact links to its source. Unknowns are stated as unknowns, never filled with speculation. This site is volunteer-run; when it and an official source disagree, the official source is right.");
  L.push("");
  return L.join("\n");
}

// ---------- sitemap ----------

export function sitemapXml(c) {
  const lastmod = c.meta && c.meta.updatedAt ? c.meta.updatedAt.slice(0, 10) : null;
  const urls = [
    { path: "/", lastmod },
    { path: "/updates", lastmod },
    { path: "/rumors", lastmod },
    { path: "/timeline", lastmod: "2026-08-15" },
    { path: "/record", lastmod },
    { path: "/wall" },
    { path: "/help" },
    { path: "/about" },
    ...(c.updates || [])
      .filter((u) => u.id)
      .map((u) => ({ path: "/updates/" + u.id, lastmod: u.date })),
  ];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          "  <url><loc>" + SITE + u.path + "</loc>" +
          (u.lastmod ? "<lastmod>" + u.lastmod + "</lastmod>" : "") +
          "</url>"
      )
      .join("\n") +
    "\n</urlset>\n"
  );
}
