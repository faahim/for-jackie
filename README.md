# For Jackie 🦅

An unofficial, community-run portal for verified, always-current information about
**Jackie**, the famous Big Bear bald eagle, following her July 2026 rescue — plus
Shadow, Sandy, and Luna. Built to give a distressed community one calm place with
sourced facts instead of rumors.

**Not affiliated with** Friends of Big Bear Valley (FOBBV) or the Ojai Raptor
Center (ORC). Every fact on the site links to the official statement or reporting
it came from.

## Architecture

One Cloudflare Worker (`src/worker.js`) does everything:

- **Static site** — `public/` served via Workers static assets. Six pages
  (Status, Updates, Timeline, Rumor Check, How to Help, About) hydrated by
  `public/app.js` from the content API.
- **Content API** — `GET /api/content` serves the live content document from KV
  (falling back to the deployed `public/content.json` seed).
- **Publishing** — `POST /api/publish` (Bearer token) replaces the content
  document, snapshots every version (`version:*`), and logs to an audit trail
  (`audit:*`). The site reflects changes instantly; no rebuild.
- **Watcher** — a `*/15` cron polls Google News RSS, the FOBBV CAM and ORC
  YouTube feeds, and watches the FOBBV/ORC sites for content changes. It also
  reads the Instagram posts ORC embeds on its own site, pulling each caption
  from Instagram's public `/embed/captioned/` endpoint — no account, no API
  key. New findings become *candidates* (`cand:*` in KV) — never published
  directly. If discovery finds nothing to read, or a caption won't parse, the
  watcher files a `watcher-health` candidate and pings Telegram rather than
  reporting a quiet day.
- **Caption lookup** — `GET /api/ig-caption?url=<instagram permalink>` (Bearer)
  returns that post's caption verbatim, so an update can be written from the
  source's own words rather than a news paraphrase.
- **Candidates API** — `GET/POST /api/candidates`, `POST /api/candidates/resolve`
  (Bearer token). The verification agent consumes these; humans and the local
  browser-watcher can inject tips too. `POST /api/poll` runs the watcher on demand.

## Editorial pipeline (the hybrid gate)

1. The cron watcher detects candidate updates from watched sources.
2. A scheduled verification agent reviews candidates, confirms claims against
   official sources, and updates the content document via `/api/publish`.
3. **Routine updates** (freshness stamps, minor clearly-sourced news) publish
   automatically. **Major claims** (health changes, death/release news) are held
   for human approval before publishing.
4. Every publish is snapshotted and audit-logged in KV.

Content rules: official sources only; unknowns stated, never filled; corrections
beat pride.

## Development

```sh
wrangler dev          # local dev
wrangler deploy       # deploy
wrangler secret put PUBLISH_TOKEN   # set/rotate the publish token
```

`public/content.json` is the seed/fallback shipped with the assets; the live
document lives in KV and evolves via the API. To publish manually:

```sh
curl -X POST https://<worker-host>/api/publish \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"actor":"manual","note":"reason","content":{...full document...}}'
```
