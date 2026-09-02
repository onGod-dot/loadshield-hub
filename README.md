<p align="center">
  <img src="assets/logo.png" alt="LoadShield Logo" width="140" />
</p>

<h1 align="center">LoadShield</h1>

<p align="center">
  <strong>Smart API Traffic Gateway — Rate Limiting · Throttling · Caching · Abuse Detection · AI Assistant</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&logo=node.js" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/built%20with-Express-lightgrey?style=flat-square&logo=express" />
  <img src="https://img.shields.io/badge/frontend-React%20%2B%20TanStack-61DAFB?style=flat-square&logo=react" />
  <img src="https://img.shields.io/badge/AI-Groq%20llama--3.3--70b-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/cache-Memory%20%7C%20Redis%20%7C%20File-red?style=flat-square" />
</p>

---

## What is LoadShield?

LoadShield is a production-grade API traffic-control gateway that protects backend services from overload, abusive traffic, and request spikes. It sits in front of your API and applies intelligent rules before any request reaches your backend — with a real-time React dashboard and a built-in AI assistant powered by Groq.

---

## Architecture

```
Student / Browser
      │
      ▼
┌──────────────────────────────────────┐
│   LoadShield Gateway  :4000          │
│                                      │
│   Rate Limiter  ──→  100 req/min     │
│   Throttle      ──→  delay @ >120rps │
│   Abuse Detect  ──→  ban on flood    │
│   Cache Layer   ──→  HIT/MISS        │
│                  │                   │
└──────────────────┼───────────────────┘
                   │ proxy /api/*
                   ▼
        ┌─────────────────────┐
        │  Backend API  :4001 │
        │  (fragile by design)│
        └─────────────────────┘

React Dashboard  :8080  (polls /metrics)
AI Chat Bubble          (calls Groq API)
```

---

## Repository Structure

```
loadshield/
├── apps/
│   ├── backend/
│   │   └── server.js          ← The protected backend API
│   └── loadshield/
│       ├── server.js          ← Gateway entry point
│       ├── rules.js           ← Rate limiting, throttling, banning
│       ├── cache.js           ← Cache key logic and request helpers
│       ├── cache_store.js     ← Memory / Redis / File cache backends
│       ├── store.js           ← Rate-limit state store (memory/redis)
│       ├── metrics.js         ← In-memory counters and per-second series
│       ├── table_provider.js  ← JSON file → REST table mode
│       └── data/users.json    ← Sample table data
├── src/                       ← React frontend (TanStack Start)
│   ├── components/
│   │   ├── app-layout.tsx     ← Sidebar + header + chat bubble mount
│   │   ├── chat-bubble.tsx    ← Floating AI chat widget (Groq)
│   │   ├── brand.tsx          ← Logo component
│   │   └── ui-bits.tsx        ← StatCard, SectionCard
│   ├── lib/
│   │   ├── api.ts             ← All HTTP calls to the gateway
│   │   ├── groq.ts            ← Groq AI client + system prompt
│   │   └── auth.ts            ← Auth state (localStorage-backed)
│   └── routes/
│       ├── dashboard.tsx      ← Live metrics overview
│       ├── live.tsx           ← Real-time RPS gauge
│       ├── saved.tsx          ← Cache manager + portal tester
│       ├── viewer.tsx         ← Student portal simulation
│       ├── security.tsx       ← Security score + threat counts
│       ├── analytics.tsx      ← Traffic charts + config table
│       ├── connect.tsx        ← 3-step portal setup wizard
│       ├── chat.tsx           ← Full-page AI assistant
│       ├── signin.tsx         ← Sign in page
│       └── signup.tsx         ← Sign up page
├── assets/logo.png
├── public/favicon.ico
├── .env                       ← VITE_GROQ_API_KEY + LOADSHIELD_BASE_URL
└── package.json
```

---

## For Backend Developers

The backend lives entirely in `apps/`. No TypeScript, no build step — pure Node.js ESM that runs directly with `node >= 18`.

### The Gateway Entry Point — `apps/loadshield/server.js`

This is the heart of the system. Every inbound request passes through three layers before reaching the backend.

```js
// Layer 1 — Ban check (fast path out for blocked IPs)
if (await isBanned(store, banKey)) {
  metrics.incBanned();
  return res.status(403).json({ error: "banned" });
}

// Layer 2 — Rate limiting (fixed window per user or IP)
const rl = await rateLimitFixedWindow({
  store,
  key: `rl:${clientId}:${Math.floor(Date.now() / 60000)}`,
  limit: RATE_LIMIT_PER_MIN,
  windowSeconds: 60
});
if (!rl.allowed) return res.status(429).json({ error: "rate_limited" });

// Layer 3 — Throttle (add delay under high RPS instead of crashing)
const delayMs = computeThrottleDelayMs({ rps, softRps, hardRps, minDelayMs, maxDelayMs });
await maybeThrottle({ delayMs });
```

Every allowed request then hits the **cache layer** before touching the backend:

```js
app.get("/api/*", async (req, res, next) => {
  const key = cacheKeyFromRequest({ prefix: CACHE_PREFIX, req, varyUser: CACHE_VARY_USER });
  const hit = await getCachedResponse({ store: cacheStore, key });
  if (hit) {
    res.setHeader("x-loadshield-cache", "HIT");
    return res.status(hit.status).send(hit.body);
  }
  // MISS → fetch from backend, store result, return it
  res.setHeader("x-loadshield-cache", "MISS");
  // ... fetch + setCachedResponse + responseFromUpstream
});
```

### Rate Limiting — `apps/loadshield/rules.js`

Uses a fixed-window counter stored in the chosen store backend:

```js
async function rateLimitFixedWindow({ store, key, limit, windowSeconds }) {
  const { value, ttlMs } = await store.incr(key, windowSeconds);
  const allowed = value <= limit;
  return { allowed, remaining: Math.max(0, limit - value), ttlMs, value };
}
```

The window key includes a minute-epoch (`Math.floor(Date.now() / 60000)`), so each window is exactly 60 seconds and auto-expires via TTL.

### Throttling — `apps/loadshield/rules.js`

Adds a proportional delay between `softRps` and `hardRps` instead of returning errors:

```js
function computeThrottleDelayMs({ rps, softRps, hardRps, minDelayMs, maxDelayMs }) {
  if (rps <= softRps) return 0;
  if (rps >= hardRps) return maxDelayMs;
  const t = (rps - softRps) / Math.max(1, hardRps - softRps);
  return Math.floor(minDelayMs + t * (maxDelayMs - minDelayMs));
}
```

At 120 RPS → 0ms delay. At 240 RPS → 450ms delay. Everything in between is linear.

### Abuse Detection — `apps/loadshield/server.js`

Login flood detection using a 10-second sliding counter:

```js
if (req.method === "POST" && req.path === "/api/login") {
  const abuseKey = `login:${ip}:${Math.floor(Date.now() / 10)}`;
  const { value } = await store.incr(abuseKey, 10);
  if (value > LOGIN_ABUSE_LIMIT_10S) {
    await ban(store, `ban:${ip}`, BAN_SECONDS); // ban the IP
    return res.status(403).json({ error: "login_abuse_banned" });
  }
}
```

### Store Abstraction — `apps/loadshield/store.js`

The store has a consistent interface (`get`, `set`, `del`, `incr`) so swapping backends requires no gateway code changes:

```js
// Memory (default)
return { kind: "memory", store: new MemoryStore() };

// Redis (when REDIS_URL is set)
return { kind: "redis", store: redisAdapter, close: () => client.quit() };
```

### Cache Store — `apps/loadshield/cache_store.js`

Three backends, same interface. Selected by `LS_CACHE_STORE` env var or auto-detected:

```js
// File cache (when LS_CACHE_DIR or LS_CACHE_STORE=file)
// Redis cache (when REDIS_URL or LS_CACHE_STORE=redis)
// Memory cache (default)
```

### Metrics — `apps/loadshield/metrics.js`

In-memory rolling counters exposed at `GET /metrics`:

```js
function incAllowed() {
  tickSecond();               // push a new { t, allowed:0, blocked:0 } if new second
  state.totals.allowed++;
  state.perSecond[state.perSecond.length - 1].allowed++;
}
```

The `perSecond` array is capped at 120 entries (2-minute rolling window). The frontend polls this every 750ms–2s to drive all charts.

### Backend API — `apps/backend/server.js`

Intentionally fragile — limited to `MAX_INFLIGHT` concurrent requests before returning 503:

```js
app.get("/api/data", async (req, res) => {
  if (inflight >= MAX_INFLIGHT) {
    return res.status(503).json({ error: "backend_overloaded", inflight });
  }
  inflight++;
  try {
    burnCpu(Math.floor(work * 0.35));   // simulate CPU work
    await sleep(Math.floor(work * 0.65)); // simulate I/O
    res.json({ ok: true, latencyMs: Date.now() - t0 });
  } finally {
    inflight--;
  }
});
```

This is what makes the "before vs after" demo compelling — without LoadShield, this collapses under load.

### Key Environment Variables

| Variable | Default | Effect |
|---|---|---|
| `BACKEND_URL` | `http://localhost:4001` | Where gateway proxies `/api/*` |
| `LS_RATE_LIMIT_PER_MIN` | `100` | Requests per minute per client |
| `LS_THROTTLE_SOFT_RPS` | `120` | RPS where delay starts |
| `LS_THROTTLE_HARD_RPS` | `240` | RPS where max delay applies |
| `LS_BAN_SECONDS` | `600` | Ban duration in seconds |
| `LS_LOGIN_ABUSE_LIMIT_10S` | `30` | Max logins per IP per 10s |
| `LS_CACHE_ENABLED` | `1` | Toggle caching on/off |
| `LS_CACHE_TTL_SECONDS` | `8` | Cache entry lifetime |
| `LS_CACHE_VARY_USER` | `0` | `1` = separate cache per `x-user-id` |
| `LS_CACHE_STORE` | auto | `memory` / `redis` / `file` |
| `LS_ADMIN_TOKEN` | `""` | Protects `/admin/*` endpoints |
| `REDIS_URL` | — | Redis connection string |

### Gateway API Reference

```
GET  /health                      → { ok: true }
GET  /metrics                     → full snapshot (totals, perSecond, cache, backend)
GET  /api/data                    → cached + proxied backend response
POST /api/login                   → proxied, abuse-monitored login
GET  /api/stats                   → backend inflight/config
GET  /data/:table                 → JSON table (requires LS_TABLES env var)
GET  /admin/cache?key=<k>         → inspect cache entry
PUT  /admin/cache                 → write cache: { key, value, ttlSeconds }
DELETE /admin/cache               → invalidate: { key }
```

Response headers added to every proxied request:
```
x-loadshield-limit:      100
x-loadshield-remaining:  94
x-loadshield-reset-ms:   43200
x-loadshield-cache:      HIT | MISS
```

---

## For Frontend Developers

The frontend is a React app built with TanStack Start, TanStack Router (file-based), Tailwind CSS v4, Framer Motion, and Recharts. All source lives in `src/`.

### API Client — `src/lib/api.ts`

Single source of truth for all backend calls. Every route imports from here:

```ts
export const LOADSHIELD_BASE =
  (window as any).LOADSHIELD_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:4000`;

export const fetchMetrics = () => get<MetricsSnapshot>("/metrics");
export const fetchHealth  = () => get<{ ok: boolean }>("/health");
export const deleteCacheEntry = (key: string) =>
  del("/admin/cache", { key });

export async function fetchThroughGateway(endpoint: string, userId: string) {
  const res = await fetch(`${LOADSHIELD_BASE}${endpoint}`, {
    headers: { "x-user-id": userId },
  });
  const cacheStatus = res.headers.get("x-loadshield-cache"); // "HIT" | "MISS"
  return { data: await res.json(), cacheStatus, latencyMs, status: res.status };
}
```

In production, set `LOADSHIELD_BASE_URL` on the `window` object or via an environment variable injection to point at your deployed gateway.

### Groq AI Client — `src/lib/groq.ts`

Calls the Groq API with a system prompt that contains the full LoadShield knowledge base:

```ts
export async function chatWithGroq(messages: ChatMessage[]): Promise<string> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",  // free, fast
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });
  return data.choices[0].message.content;
}
```

The API key is read from `VITE_GROQ_API_KEY` in `.env`. Get a free key at [console.groq.com](https://console.groq.com/keys).

### Chat Bubble — `src/components/chat-bubble.tsx`

Floating AI widget mounted inside `AppLayout` — appears on every authenticated page:

```tsx
// In app-layout.tsx
import { ChatBubble } from "@/components/chat-bubble";

export function AppLayout({ children, title }) {
  return (
    <div>
      {/* ... sidebar, header, main ... */}
      <ChatBubble />   {/* ← floats bottom-right on every page */}
    </div>
  );
}
```

The bubble manages its own message state, shows quick-question chips on first open, has a typing indicator, and tracks unread count when closed.

### Live Polling Pattern

Every dashboard page uses the same pattern — poll the gateway, update state, repeat:

```tsx
useEffect(() => {
  let cancelled = false;

  async function poll() {
    if (cancelled) return;
    try {
      const m = await fetchMetrics();
      setMetrics(m);
    } catch {
      setError(true);
    } finally {
      if (!cancelled) tickRef.current = window.setTimeout(poll, 1000);
    }
  }

  poll();
  return () => { cancelled = true; clearTimeout(tickRef.current); };
}, []);
```

The `cancelled` flag prevents state updates after unmount. `setTimeout` (not `setInterval`) ensures no overlap if the request takes longer than the interval.

### StatCard — `src/components/ui-bits.tsx`

Animated counter card used on all metric pages:

```tsx
export function StatCard({ label, value, tone }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.floor(v).toLocaleString());
  useEffect(() => {
    animate(mv, value, { duration: 1.2, ease: "easeOut" });
  }, [value]);

  return (
    <motion.div whileHover={{ y: -2 }}>
      <motion.span className={toneMap[tone]}>{rounded}</motion.span>
    </motion.div>
  );
}
```

Pass a new `value` prop and the number animates to it automatically.

### Route Structure

File-based routing via TanStack Router. Each file in `src/routes/` is a route:

| File | URL | Data source |
|---|---|---|
| `dashboard.tsx` | `/dashboard` | `GET /metrics` every 2s |
| `live.tsx` | `/live` | `GET /metrics` every 1s |
| `saved.tsx` | `/saved` | `fetchThroughGateway` + `DELETE /admin/cache` |
| `viewer.tsx` | `/viewer` | `fetchThroughGateway` + `GET /metrics` |
| `security.tsx` | `/security` | `GET /metrics` every 3s |
| `analytics.tsx` | `/analytics` | `GET /metrics` every 5s |
| `connect.tsx` | `/connect` | `GET /health` |
| `chat.tsx` | `/chat` | Groq API |

`routeTree.gen.ts` registers all routes — update it when adding new route files.

### Environment Variables (Frontend)

| Variable | Required | Description |
|---|---|---|
| `VITE_GROQ_API_KEY` | Yes | Groq API key for AI assistant |
| `LOADSHIELD_BASE_URL` | No | Gateway URL (defaults to same host, port 4000) |

---

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Copy env file
cp .env.example .env
# Fill in VITE_GROQ_API_KEY

# 3. Start the gateway + backend
node apps/backend/server.js &
node apps/loadshield/server.js &

# 4. Start the frontend
bun run dev
```

Open **http://localhost:8080**

---

## The "Before vs After" Demo

```bash
# Hit backend directly (no protection) — watch it collapse
node scripts/spike.mjs --direct --rps 500 --seconds 15

# Hit through LoadShield — watch backend survive
node scripts/spike.mjs --shield --rps 500 --seconds 15
```

Watch the Live Traffic page during the spike to see the gauge and chart react in real time.

---

## Deployment

LoadShield requires **persistent, long-running Node.js processes**. It will not work on Vercel or other serverless platforms because rate-limit counters, ban lists, and metrics all live in memory.

Recommended platforms: **Railway**, **Render**, **Fly.io**, **DigitalOcean App Platform**, or a VPS with PM2.

---

## Author

**Baah Cyril Jerry**  
LoadShield — API Traffic Control Gateway · TTU Final Year Project

---

## License

MIT — see [LICENSE](LICENSE)
