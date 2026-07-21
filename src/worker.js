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
 */

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
    id: "yt-fobbv",
    kind: "atom",
    label: "FOBBV CAM (YouTube)",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsFgbVuhRrPV5FqyN7kOD8g",
  },
];

const WATCHED_PAGES = [
  { id: "fobbv-site", label: "friendsofbigbearvalley.org", url: "https://friendsofbigbearvalley.org/" },
  { id: "orc-site", label: "ojairaptorcenter.org", url: "https://www.ojairaptorcenter.org/" },
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
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, url, env, ctx);
      }
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.log(JSON.stringify({ level: "error", path: url.pathname, message: String(err) }));
      return json({ ok: false, error: "internal error" }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(pollSources(env));
  },
};

async function handleApi(request, url, env, ctx) {
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/health") {
    return json({ ok: true, time: new Date().toISOString() });
  }

  if (route === "GET /api/content") {
    const stored = await env.KV.get("content", "json");
    if (stored) return json(stored);
    // Fall back to the seed shipped with the static assets.
    const seed = await env.ASSETS.fetch(new URL("/content.json", url.origin));
    return new Response(seed.body, { status: seed.status, headers: JSON_HEADERS });
  }

  // Everything below requires the publish token.
  if (!(await authorized(request, env))) {
    return json({ ok: false, error: "unauthorized" }, 401);
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
    return json({ ok: true, updatedAt: now });
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
    const key = `cand:${new Date().toISOString()}-${await shortHash(body.title + (body.url || ""))}`;
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

// ---------- watcher ----------

async function pollSources(env) {
  const summary = { newCandidates: 0, sources: {} };

  for (const feed of WATCHED_FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { "user-agent": FETCH_UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = feed.kind === "atom" ? parseAtom(xml) : parseRss(xml);
      let fresh = 0;
      for (const item of items.slice(0, 25)) {
        const hash = await shortHash(item.link || item.title);
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
