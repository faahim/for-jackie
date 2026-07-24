/**
 * For Jackie — single Worker serving the site (static assets), the content API,
 * and the source-watcher cron.
 *
 * KV layout:
 *   content                  — live content document (JSON)
 *   version:<iso>            — full snapshot at each publish (rollback + audit)
 *   audit:<iso>              — publish log entry {actor, note}
 *   cand:<iso>-<hash>        — candidate update awaiting the verification agent
 *   seen:<source>:<hash>     — dedupe marker for watched feed items
 *   pagehash:<host>          — last content hash for watched pages
 *   msg:<iso>-<hash8>        — visitor messages (contact) and wall notes
 *                              (kind:"note", status:"pending"|"approved")
 *   wall:<iso>-<hash8>       — APPROVED wall notes only {name, message, approvedAt}
 */

import {
  PAGE_FOR_PATH,
  transformHtml,
  llmsTxt,
  llmsFullTxt,
  sitemapXml,
  findUpdate,
  renderUpdatePage,
  renderUpdate404,
} from "./ssr.js";

// IndexNow (instant indexing for Bing & partners). The key is public by
// design — it only proves we control this host. Served at /<key>.txt.
const INDEXNOW_KEY = "92a61962b9967228e65b82ffcd4364ba";
const CANONICAL_HOST = "forjackie.org";
const ALIAS_HOSTS = ["www.forjackie.org", "for-jackie.pushkunni.workers.dev"];

const WATCHED_FEEDS = [
  {
    id: "gnews",
    kind: "rss",
    label: "Google News",
    url: "https://news.google.com/rss/search?q=%22Jackie%22+eagle+%22Big+Bear%22&hl=en-US&gl=US&ceid=US:en",
  },
  {
    id: "bing-news",
    kind: "rss",
    label: "Bing News",
    url: "https://www.bing.com/news/search?q=%22Jackie%22+eagle+%22Big+Bear%22&format=rss",
  },
  {
    // Recovery-phase coverage (CBS LA, Fox 11, KESQ, LAT syndications) often
    // omits "Big Bear" — this catches anything mentioning her care facility.
    id: "bing-news-orc",
    kind: "rss",
    label: "Bing News (ORC)",
    url: "https://www.bing.com/news/search?q=%22Ojai+Raptor+Center%22&format=rss",
  },
  {
    id: "yt-fobbv",
    kind: "atom",
    label: "FOBBV CAM (YouTube)",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsFgbVuhRrPV5FqyN7kOD8g",
  },
];

const WATCHED_PAGES = [
  { id: "fobbv-site", label: "friendsofbigbearvalley.org", url: "https://friendsofbigbearvalley.org/" },
  { id: "orc-site", label: "ojairaptorcenter.org", url: "https://www.ojairaptorcenter.org/" },
  {
    id: "fobbv-live-doc",
    label: "FOBBV Live Recap doc (official, real-time)",
    url: "https://docs.google.com/document/d/1gx7VP85Gwp1jhHRilStcZMrnUPszHQ0-w1czkjnf9bc/export?format=txt",
  },
];

const FETCH_UA =
  "ForJackieWatcher/1.0 (+community fan project; monitors public updates about Jackie the Big Bear eagle)";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      // Canonical host: page requests on aliases 301 to forjackie.org so
      // search engines see exactly one copy of the site. API routes are
      // exempt — the pipelines call them on the workers.dev host.
      if (ALIAS_HOSTS.includes(url.hostname) && !url.pathname.startsWith("/api/")) {
        url.hostname = CANONICAL_HOST;
        url.protocol = "https:";
        url.port = "";
        return Response.redirect(url.toString(), 301);
      }
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, url, env, ctx);
      }
      return await handlePage(request, url, env);
    } catch (err) {
      console.log(JSON.stringify({ level: "error", path: url.pathname, message: String(err) }));
      return json({ ok: false, error: "internal error" }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(pollSources(env));
  },

  /**
   * Inbound email (Cloudflare Email Routing → this Worker). Used for official
   * newsletters (e.g. the ORC email list — their designated update channel).
   * Every message becomes a candidate for the verification agent and is
   * forwarded to Telegram. Nothing is ever published directly from email.
   */
  async email(message, env, ctx) {
    try {
      const from = message.from || "unknown";
      const subject = message.headers.get("subject") || "(no subject)";
      const rawSize = message.rawSize || 0;
      let bodyText = "";
      if (rawSize > 0 && rawSize < 1024 * 1024) {
        const raw = await new Response(message.raw).text();
        // Crude text extraction: strip headers block, tags, collapse whitespace.
        const afterHeaders = raw.split(/\r?\n\r?\n/).slice(1).join("\n\n");
        bodyText = normalizeHtml(afterHeaders).slice(0, 4000);
      }
      const key = `cand:${new Date().toISOString()}-${await shortHash(from + subject)}`;
      await env.KV.put(
        key,
        JSON.stringify({
          source: `email:${from}`,
          title: `Inbound email: ${subject}`,
          url: null,
          note: bodyText ? `Body (extracted): ${bodyText.slice(0, 1500)}` : "Body could not be extracted.",
          detectedAt: new Date().toISOString(),
        })
      );
      console.log(JSON.stringify({ level: "info", event: "email", from, subject, stored: key }));
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        ctx.waitUntil(
          fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: env.TELEGRAM_CHAT_ID,
              text: `📬 Watcher inbox\nFrom: ${from}\nSubject: ${subject}\n\n${bodyText.slice(0, 500)}`,
            }),
          }).catch((err) =>
            console.log(JSON.stringify({ level: "error", event: "email-telegram", message: String(err) }))
          )
        );
      }
    } catch (err) {
      console.log(JSON.stringify({ level: "error", event: "email", message: String(err) }));
    }
  },
};

async function handleApi(request, url, env, ctx) {
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/health") {
    return json({ ok: true, time: new Date().toISOString() });
  }

  if (route === "GET /api/content") {
    // Privacy-respecting visit counter: one daily number, nothing else.
    ctx.waitUntil(bumpDailyHits(env));
    const [stored, lastCheck] = await Promise.all([
      env.KV.get("content", "json"),
      env.KV.get("lastcheck"),
    ]);
    if (stored) {
      // Merged at read time only — never persisted into the content doc.
      if (lastCheck && stored.meta) stored.meta.checkedAt = lastCheck;
      return json(stored);
    }
    // Fall back to the seed shipped with the static assets.
    const seed = await env.ASSETS.fetch(new URL("/content.json", url.origin));
    return new Response(seed.body, { status: seed.status, headers: JSON_HEADERS });
  }

  if (route === "POST /api/messages") {
    return await handleIncomingMessage(request, env);
  }

  if (route === "GET /api/wall") {
    // Public wall: APPROVED notes only, newest first. The wall:* records hold
    // exactly {name, message, approvedAt} — but map the fields explicitly so
    // nothing private (contact, IP, page) can ever leak into this payload.
    const entries = await listWithValues(env, "wall:", 200);
    const notes = entries
      .map((e) => ({ name: e.name || null, message: e.message, approvedAt: e.approvedAt }))
      .reverse();
    return json({ ok: true, notes });
  }

  // Everything below requires the publish token.
  if (!(await authorized(request, env))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  if (route === "GET /api/messages") {
    const messages = await listWithValues(env, "msg:", 50);
    return json({ ok: true, messages: messages.reverse() }); // newest first
  }

  if (route === "GET /api/wall/pending") {
    const messages = await listWithValues(env, "msg:", 200);
    const pending = messages
      .filter((m) => m.kind === "note" && m.status === "pending")
      .reverse(); // newest first
    return json({ ok: true, pending });
  }

  if (route === "POST /api/wall/approve") {
    const body = await request.json();
    const key = body && typeof body.key === "string" ? body.key : "";
    if (!key.startsWith("msg:")) {
      return json({ ok: false, error: "key must be a msg:* key" }, 400);
    }
    const record = await env.KV.get(key, "json");
    if (!record) return json({ ok: false, error: "message not found" }, 404);
    if (record.kind !== "note") {
      return json({ ok: false, error: "not a wall note" }, 400);
    }
    const approvedAt = new Date().toISOString();
    const hash = key.slice(-8); // reuse the msg hash so the two records stay linked
    const wallKey = `wall:${approvedAt}-${hash}`;
    // The public record carries ONLY what the wall displays — never contact/IP.
    await env.KV.put(
      wallKey,
      JSON.stringify({ name: record.name || null, message: record.message, approvedAt })
    );
    await env.KV.put(key, JSON.stringify({ ...record, status: "approved", approvedAt, wallKey }));
    console.log(JSON.stringify({ level: "info", event: "wall-approve", key, wallKey }));
    return json({ ok: true, wallKey });
  }

  if (route === "POST /api/wall/remove") {
    const body = await request.json();
    const key = body && typeof body.key === "string" ? body.key : "";
    if (!key.startsWith("wall:")) {
      return json({ ok: false, error: "key must be a wall:* key" }, 400);
    }
    await env.KV.delete(key);
    console.log(JSON.stringify({ level: "info", event: "wall-remove", key }));
    return json({ ok: true, removed: key });
  }

  if (route === "POST /api/publish") {
    const body = await request.json();
    const content = body && body.content;
    if (!content || !content.meta || !Array.isArray(content.updates)) {
      return json({ ok: false, error: "content must include meta and updates[]" }, 400);
    }
    const now = new Date().toISOString();
    content.meta.updatedAt = now;
    const doc = JSON.stringify(content);
    await env.KV.put("content", doc);
    await env.KV.put(`version:${now}`, doc);
    await env.KV.put(
      `audit:${now}`,
      JSON.stringify({ actor: body.actor || "unknown", note: body.note || "", bytes: doc.length })
    );
    ctx.waitUntil(pingIndexNow(content));
    return json({ ok: true, updatedAt: now });
  }

  if (route === "GET /api/stats") {
    const days = await Promise.all(
      Array.from({ length: 14 }, (_, i) => {
        const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        return env.KV.get(`hits:${day}`).then((v) => ({ day, hits: parseInt(v || "0", 10) }));
      })
    );
    return json({ ok: true, days });
  }

  if (route === "GET /api/audit") {
    const entries = await listWithValues(env, "audit:", 50);
    return json({ ok: true, entries });
  }

  if (route === "GET /api/versions") {
    const list = await env.KV.list({ prefix: "version:", limit: 100 });
    return json({ ok: true, versions: list.keys.map((k) => k.name) });
  }

  if (route === "GET /api/candidates") {
    const candidates = await listWithValues(env, "cand:", 100);
    return json({ ok: true, candidates });
  }

  if (route === "POST /api/candidates") {
    const body = await request.json();
    if (!body || !body.title) {
      return json({ ok: false, error: "candidate needs at least a title" }, 400);
    }
    // Server-side dedupe: watchers can re-submit what they see; repeats are dropped.
    const hash = await shortHash((body.dedupeKey || body.title) + (body.url || ""));
    const seenKey = `seen:ingest:${hash}`;
    if (await env.KV.get(seenKey)) {
      return json({ ok: true, duplicate: true });
    }
    await env.KV.put(seenKey, "1", { expirationTtl: 60 * 60 * 24 * 90 });
    const key = `cand:${new Date().toISOString()}-${hash}`;
    await env.KV.put(
      key,
      JSON.stringify({
        source: body.source || "manual",
        title: body.title,
        url: body.url || null,
        note: body.note || null,
        detectedAt: new Date().toISOString(),
      })
    );
    return json({ ok: true, key });
  }

  if (route === "POST /api/candidates/resolve") {
    const body = await request.json();
    const keys = Array.isArray(body && body.keys) ? body.keys : [];
    await Promise.all(keys.filter((k) => k.startsWith("cand:")).map((k) => env.KV.delete(k)));
    return json({ ok: true, resolved: keys.length });
  }

  if (route === "POST /api/poll") {
    const result = await pollSources(env);
    return json({ ok: true, result });
  }

  return json({ ok: false, error: "not found" }, 404);
}

// ---------- pages: edge rendering + machine-readable routes ----------

/** Live content doc (KV, falling back to the seed asset). Null on failure. */
async function contentDoc(env, origin) {
  try {
    const stored = await env.KV.get("content", "json");
    if (stored) return stored;
    const seed = await env.ASSETS.fetch(new URL("/content.json", origin));
    return seed.ok ? await seed.json() : null;
  } catch {
    return null;
  }
}

/**
 * Serve site pages with the live content rendered into the HTML at the edge
 * (AI crawlers don't execute JavaScript — see src/ssr.js), plus the
 * machine-readable discovery routes. Any SSR failure falls back to the
 * untouched static asset: the site must never break because of this layer.
 */
async function handlePage(request, url, env) {
  if (url.pathname === "/sitemap.xml" || url.pathname === "/llms.txt" || url.pathname === "/llms-full.txt") {
    const c = await contentDoc(env, url.origin);
    if (!c) return json({ ok: false, error: "content unavailable" }, 503);
    if (url.pathname === "/sitemap.xml") {
      return new Response(sitemapXml(c), {
        headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" },
      });
    }
    const text = url.pathname === "/llms.txt" ? llmsTxt(c) : llmsFullTxt(c);
    return new Response(text, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  }

  // Per-update permalink pages: fully synthesized at the edge, no static asset.
  const updateMatch = url.pathname.match(/^\/updates\/([A-Za-z0-9-]+)\/?$/);
  if (updateMatch && request.method === "GET") {
    if (url.pathname.endsWith("/")) {
      return Response.redirect(url.origin + "/updates/" + updateMatch[1], 301);
    }
    const c = await contentDoc(env, url.origin);
    const found = c && findUpdate(c, updateMatch[1]);
    const html = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" };
    if (!found) return new Response(renderUpdate404(), { status: 404, headers: html });
    return new Response(renderUpdatePage(found, c), { headers: html });
  }

  const page = PAGE_FOR_PATH[url.pathname];
  if (page && request.method === "GET") {
    try {
      // Strip conditional headers: the response body varies with the content
      // doc, so a 304 against the static asset would pin stale content.
      const headers = new Headers(request.headers);
      headers.delete("if-none-match");
      headers.delete("if-modified-since");
      const [assetRes, c] = await Promise.all([
        env.ASSETS.fetch(new Request(url.toString(), { headers })),
        contentDoc(env, url.origin),
      ]);
      if (c && assetRes.ok && (assetRes.headers.get("content-type") || "").includes("text/html")) {
        return transformHtml(page, assetRes, c);
      }
      return assetRes;
    } catch (err) {
      console.log(JSON.stringify({ level: "error", event: "ssr", path: url.pathname, message: String(err) }));
      return env.ASSETS.fetch(request);
    }
  }

  return env.ASSETS.fetch(request);
}

/**
 * Tell IndexNow-participating engines (Bing, and via them much of the AI
 * search ecosystem) that the site changed. Fire-and-forget from publishes.
 */
async function pingIndexNow(content) {
  try {
    const paths = ["/", "/updates", "/rumors", "/timeline", "/wall", "/help", "/about"];
    for (const u of (content && content.updates) || []) {
      if (u.id) paths.push("/updates/" + u.id);
    }
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: CANONICAL_HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${CANONICAL_HOST}/${INDEXNOW_KEY}.txt`,
        urlList: paths.map((p) => `https://${CANONICAL_HOST}${p}`),
      }),
    });
    console.log(JSON.stringify({ level: "info", event: "indexnow", status: res.status }));
  } catch (err) {
    console.log(JSON.stringify({ level: "warn", event: "indexnow-failed", message: String(err) }));
  }
}

// ---------- visitor messages ----------

/**
 * POST /api/messages — unauthenticated contact form from the site footer, and
 * (with {kind:"note"}) Wall of Love submissions. Notes are shorter (≤500),
 * require explicit {consent:true}, and are stored status:"pending" — nothing
 * user-submitted ever displays without a /api/wall/approve. Validates lengths,
 * drops honeypot hits silently, best-effort rate limit of 5 messages/hour per
 * IP (KV counter), stores as msg:<iso>-<hash8>, and forwards to Telegram when
 * the secrets exist. Storage always wins: Telegram failures are logged and
 * swallowed.
 */
async function handleIncomingMessage(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "invalid body" }, 400);
  }

  // Honeypot: bots fill everything. Pretend success, store nothing.
  if (body.website) {
    return json({ ok: true });
  }

  const kind = body.kind === "note" ? "note" : "contact";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return json({ ok: false, error: kind === "note" ? "please write a note first" : "message is required" }, 400);
  }
  if (kind === "note") {
    if (message.length > 500) {
      return json({ ok: false, error: "note too long (500 characters max)" }, 400);
    }
    if (body.consent !== true) {
      return json(
        { ok: false, error: "consent is required — please confirm your note may be displayed publicly" },
        400
      );
    }
  } else if (message.length > 2000) {
    return json({ ok: false, error: "message too long (2000 characters max)" }, 400);
  }
  const name =
    typeof body.name === "string" ? body.name.trim().slice(0, kind === "note" ? 60 : 120) : "";
  const contact = typeof body.contact === "string" ? body.contact.trim().slice(0, 200) : "";
  const fromPage = typeof body.page === "string" ? body.page.trim().slice(0, 40) : "";

  // Best-effort per-IP rate limit: 5/hour (KV counter, non-atomic is fine here).
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rateKey = `msgrate:${await shortHash(ip)}:${new Date().toISOString().slice(0, 13)}`;
  const count = parseInt((await env.KV.get(rateKey)) || "0", 10);
  if (count >= 5) {
    return json({ ok: false, error: "too many messages — please try again in an hour" }, 429);
  }
  await env.KV.put(rateKey, String(count + 1), { expirationTtl: 60 * 60 });

  const receivedAt = new Date().toISOString();
  const hash = (await shortHash(receivedAt + ip + message)).slice(0, 8);
  const key = `msg:${receivedAt}-${hash}`;
  const record = {
    name: name || null,
    contact: contact || null,
    message,
    page: fromPage || null,
    receivedAt,
  };
  if (kind === "note") {
    record.kind = "note";
    record.status = "pending"; // displays only after POST /api/wall/approve
    record.consent = true;
  }
  await env.KV.put(key, JSON.stringify(record));
  console.log(JSON.stringify({ level: "info", event: "message", kind, key, bytes: message.length }));

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    try {
      const label = kind === "note" ? "📝 Wall note (pending)" : "✉️ Message";
      const text =
        `${label} — For Jackie\n` +
        `From: ${name || "anonymous"}${contact ? ` (${contact})` : ""}\n` +
        `Page: ${fromPage || "unknown"}\n\n${message}`;
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
      });
      if (!res.ok) throw new Error(`telegram HTTP ${res.status}`);
    } catch (err) {
      console.log(JSON.stringify({ level: "warn", event: "telegram-forward-failed", key, message: String(err) }));
    }
  }

  return json({ ok: true });
}

// ---------- watcher ----------

async function pollSources(env) {
  // Record the check itself first: even a run that finds nothing proves the
  // watchers are awake. Surfaces as meta.checkedAt on GET /api/content.
  await env.KV.put("lastcheck", new Date().toISOString());
  const summary = { newCandidates: 0, sources: {} };

  for (const feed of WATCHED_FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { "user-agent": FETCH_UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = feed.kind === "atom" ? parseAtom(xml) : parseRss(xml);
      let fresh = 0;
      for (const item of items.slice(0, 25)) {
        // Dedupe by title: feed links (Bing especially) carry rotating tracking params.
        const hash = await shortHash(item.title || item.link);
        const seenKey = `seen:${feed.id}:${hash}`;
        if (await env.KV.get(seenKey)) continue;
        await env.KV.put(seenKey, "1", { expirationTtl: 60 * 60 * 24 * 90 });
        await env.KV.put(
          `cand:${new Date().toISOString()}-${hash}`,
          JSON.stringify({
            source: feed.label,
            title: item.title,
            url: item.link,
            publishedAt: item.date || null,
            detectedAt: new Date().toISOString(),
          })
        );
        fresh++;
      }
      summary.sources[feed.id] = { ok: true, items: items.length, fresh };
      summary.newCandidates += fresh;
    } catch (err) {
      summary.sources[feed.id] = { ok: false, error: String(err) };
    }
  }

  for (const page of WATCHED_PAGES) {
    try {
      const res = await fetch(page.url, { headers: { "user-agent": FETCH_UA, accept: "text/html" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = normalizeHtml(await res.text());
      const hash = await shortHash(text);
      const key = `pagehash:${page.id}`;
      const prev = await env.KV.get(key);
      if (prev && prev !== hash) {
        await env.KV.put(
          `cand:${new Date().toISOString()}-${hash}`,
          JSON.stringify({
            source: page.label,
            title: `Site content changed on ${page.label}`,
            url: page.url,
            detectedAt: new Date().toISOString(),
          })
        );
        summary.newCandidates++;
      }
      if (prev !== hash) await env.KV.put(key, hash);
      summary.sources[page.id] = { ok: true, changed: Boolean(prev && prev !== hash) };
    } catch (err) {
      summary.sources[page.id] = { ok: false, error: String(err) };
    }
  }

  console.log(JSON.stringify({ level: "info", event: "poll", ...summary }));
  return summary;
}

// ---------- parsing helpers ----------

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    title: tagText(m[1], "title"),
    link: tagText(m[1], "link"),
    date: tagText(m[1], "pubDate"),
  }));
}

function parseAtom(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => ({
    title: tagText(m[1], "title"),
    link: (m[1].match(/<link[^>]*href="([^"]+)"/) || [])[1] || "",
    date: tagText(m[1], "published"),
  }));
}

function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim()) : "";
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function normalizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- utilities ----------

/**
 * Best-effort daily visit counter (hits:YYYY-MM-DD). Non-atomic get+put is
 * fine — this is a mood indicator, not analytics. No IPs, no UAs, no cookies:
 * a single number per day, expiring after 30 days.
 */
async function bumpDailyHits(env) {
  try {
    const key = `hits:${new Date().toISOString().slice(0, 10)}`;
    const count = parseInt((await env.KV.get(key)) || "0", 10) + 1;
    await env.KV.put(key, String(count), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch (err) {
    console.log(JSON.stringify({ level: "warn", event: "hits-bump-failed", message: String(err) }));
  }
}

async function listWithValues(env, prefix, limit) {
  const list = await env.KV.list({ prefix, limit });
  const out = [];
  for (const key of list.keys) {
    const value = await env.KV.get(key.name, "json");
    if (value) out.push({ key: key.name, ...value });
  }
  return out;
}

async function shortHash(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authorized(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const secret = env.PUBLISH_TOKEN;
  if (!secret || !token) return false;
  const enc = new TextEncoder();
  const a = enc.encode(token);
  const b = enc.encode(secret);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
