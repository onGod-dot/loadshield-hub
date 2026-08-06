/*
LoadShield - Smart API Traffic Gateway
Copyright (c) 2026 Baah Cyril Jerry

Author: Baah Cyril Jerry
Repository: https://github.com/onGod-dot/loadshield-hub

This project demonstrates rate limiting, traffic throttling,
caching, and abuse detection for backend API protection.
*/

import express from "express";
import morgan from "morgan";
import { createProxyMiddleware } from "http-proxy-middleware";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.js";
import { createMetrics } from "./metrics.js";
import { createCacheStore } from "./cache_store.js";
import {
  cacheKeyFromRequest,
  getCachedResponse,
  headersToForward,
  isCacheableRequest,
  isCacheableStatus,
  pickHeaders,
  responseFromUpstream,
  setCachedResponse
} from "./cache.js";
import { createTableProvider } from "./table_provider.js";
import {
  ban,
  computeThrottleDelayMs,
  getClientId,
  getClientIp,
  isBanned,
  maybeThrottle,
  rateLimitFixedWindow
} from "./rules.js";

const PORT = Number(process.env.LOADSHIELD_PORT || 4000);
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4001";

// Demo defaults (tweak via env vars)
const RATE_LIMIT_PER_MIN = Number(process.env.LS_RATE_LIMIT_PER_MIN || 100);
const THROTTLE_SOFT_RPS = Number(process.env.LS_THROTTLE_SOFT_RPS || 120);
const THROTTLE_HARD_RPS = Number(process.env.LS_THROTTLE_HARD_RPS || 240);
const THROTTLE_MIN_DELAY_MS = Number(process.env.LS_THROTTLE_MIN_DELAY_MS || 40);
const THROTTLE_MAX_DELAY_MS = Number(process.env.LS_THROTTLE_MAX_DELAY_MS || 450);
const BAN_SECONDS = Number(process.env.LS_BAN_SECONDS || 10 * 60);
const LOGIN_ABUSE_LIMIT_10S = Number(process.env.LS_LOGIN_ABUSE_LIMIT_10S || 30);

const storeWrap = await createStore();
const store = storeWrap.store;
const metrics = createMetrics();

// Separate cache store so devs can choose a different "location" for caching.
const cacheWrap = await createCacheStore();
const cacheStore = cacheWrap.store;
const CACHE_ENABLED = String(process.env.LS_CACHE_ENABLED || "1") === "1";
const CACHE_TTL_SECONDS = Number(process.env.LS_CACHE_TTL_SECONDS || 8);
const CACHE_PREFIX = process.env.LS_CACHE_PREFIX || "cache";
const CACHE_VARY_USER = String(process.env.LS_CACHE_VARY_USER || "0") === "1";
const ADMIN_TOKEN = process.env.LS_ADMIN_TOKEN || "";

const tableProvider = createTableProvider();

const app = express();
app.disable("x-powered-by");
app.use(morgan("dev"));

// Attribution headers (added to every response)
app.use((req, res, next) => {
  res.setHeader("x-loadshield-author", "Baah Cyril Jerry");
  res.setHeader("x-loadshield-project", "LoadShield API Gateway Demo");
  next();
});

// Chrome DevTools may request this well-known URL on localhost origins.
app.get("/.well-known/appspecific/com.chrome.devtools.json", (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.status(200).send("{}");
});

// Serve the dashboard
app.use("/", express.static(fileURLToPath(new URL("./public", import.meta.url))));

// Track inbound RPS (sliding 1s counter)
let rps = 0;
let currentSecond = Math.floor(Date.now() / 1000);
setInterval(() => {
  const nowSecond = Math.floor(Date.now() / 1000);
  if (nowSecond !== currentSecond) {
    currentSecond = nowSecond;
    rps = 0;
  }
}, 200);

// Track backend inflight for graphing (polled from backend)
const backendInflightSeries = [];
async function pollBackendStats() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/stats`);
    const json = await res.json();
    backendInflightSeries.push(Number(json?.inflight ?? 0));
    if (backendInflightSeries.length > 120) backendInflightSeries.shift();
  } catch {
    backendInflightSeries.push(0);
    if (backendInflightSeries.length > 120) backendInflightSeries.shift();
  } finally {
    setTimeout(pollBackendStats, 1000);
  }
}
pollBackendStats();

app.get("/metrics", (req, res) => {
  res.json(
    metrics.snapshot({
      store: { kind: storeWrap.kind },
      cache: { kind: cacheWrap.kind, enabled: CACHE_ENABLED, ttlSeconds: CACHE_TTL_SECONDS },
      inbound: { rps },
      backend: { inflightSeries: backendInflightSeries.slice() }
    })
  );
});

app.use(express.json());

function requireAdmin(req, res) {
  if (!ADMIN_TOKEN) return true; // demo convenience: no token => open admin
  const token = req.headers["x-loadshield-admin-token"];
  if (typeof token === "string" && token === ADMIN_TOKEN) return true;
  res.status(401).json({ ok: false, error: "admin_unauthorized" });
  return false;
}

// Admin cache API:
// - devs can push data themselves (write-through) or invalidate
app.get("/admin/cache", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const key = String(req.query.key || "");
  if (!key) return res.status(400).json({ ok: false, error: "missing_key" });
  const raw = await cacheStore.get(key);
  res.json({ ok: true, key, hit: Boolean(raw), raw });
});

app.put("/admin/cache", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const key = req.body?.key;
  const value = req.body?.value;
  const ttlSeconds = Number(req.body?.ttlSeconds ?? CACHE_TTL_SECONDS);
  if (typeof key !== "string" || !key) return res.status(400).json({ ok: false, error: "missing_key" });
  await cacheStore.set(key, typeof value === "string" ? value : JSON.stringify(value ?? null), ttlSeconds);
  res.json({ ok: true, key, ttlSeconds });
});

app.delete("/admin/cache", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const key = req.body?.key ?? req.query?.key;
  if (typeof key !== "string" || !key) return res.status(400).json({ ok: false, error: "missing_key" });
  await cacheStore.del(key);
  res.json({ ok: true, key });
});

// Demo "table mode": pretend these are DB tables, and LoadShield can serve them directly.
// In a real system, replace this provider with a Postgres/Mongo adapter.
app.get("/data/:table", async (req, res) => {
  const { table } = req.params;
  if (!tableProvider.allowTables.has(table)) {
    return res.status(404).json({ ok: false, error: "unknown_table", allowed: Array.from(tableProvider.allowTables) });
  }
  const rows = await tableProvider.list(table);
  res.json({ ok: true, table, rows });
});

app.get("/data/:table/:id", async (req, res) => {
  const { table, id } = req.params;
  if (!tableProvider.allowTables.has(table)) {
    return res.status(404).json({ ok: false, error: "unknown_table", allowed: Array.from(tableProvider.allowTables) });
  }
  const row = await tableProvider.getById(table, id);
  if (!row) return res.status(404).json({ ok: false, error: "not_found" });
  res.json({ ok: true, table, row });
});

// LoadShield gatekeeper middleware (applies before proxying to backend)
app.use(async (req, res, next) => {
  rps++;

  const ip = getClientIp(req);
  const clientId = getClientId(req);
  const banKey = `ban:${ip}`;

  if (await isBanned(store, banKey)) {
    metrics.incBanned();
    metrics.incBlocked();
    return res.status(403).json({ ok: false, error: "banned", banSeconds: BAN_SECONDS });
  }

  // Demo feature 1: rate limiting (per user or per IP)
  const rlKey = `rl:${clientId}:${Math.floor(Date.now() / 60000)}`;
  const rl = await rateLimitFixedWindow({
    store,
    key: rlKey,
    limit: RATE_LIMIT_PER_MIN,
    windowSeconds: 60
  });

  res.setHeader("x-loadshield-limit", String(RATE_LIMIT_PER_MIN));
  res.setHeader("x-loadshield-remaining", String(rl.remaining));
  res.setHeader("x-loadshield-reset-ms", String(rl.ttlMs));

  if (!rl.allowed) {
    metrics.incBlocked();
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }

  // Demo feature 2: traffic throttling (delay under high inbound RPS)
  const delayMs = computeThrottleDelayMs({
    rps,
    softRps: THROTTLE_SOFT_RPS,
    hardRps: THROTTLE_HARD_RPS,
    minDelayMs: THROTTLE_MIN_DELAY_MS,
    maxDelayMs: THROTTLE_MAX_DELAY_MS
  });
  if (delayMs > 0) metrics.incThrottled();
  await maybeThrottle({ delayMs });

  // Demo feature 3: abuse detection (login attempts per IP in 10s)
  if (req.method === "POST" && req.path === "/api/login") {
    const abuseKey = `login:${ip}:${Math.floor(Date.now() / 10)}`;
    const { value } = await store.incr(abuseKey, 10);
    if (value > LOGIN_ABUSE_LIMIT_10S) {
      metrics.incSuspicious();
      await ban(store, banKey, BAN_SECONDS);
      metrics.incBlocked();
      return res.status(403).json({ ok: false, error: "login_abuse_banned", banSeconds: BAN_SECONDS });
    }
  }

  metrics.incAllowed();
  next();
});

// Auto-cache GET /api/* by fetching upstream ourselves (so we can store the response body).
app.get("/api/*", async (req, res, next) => {
  if (!CACHE_ENABLED) return next();
  if (!isCacheableRequest(req)) return next();

  const key = cacheKeyFromRequest({ prefix: CACHE_PREFIX, req, varyUser: CACHE_VARY_USER });
  const hit = await getCachedResponse({ store: cacheStore, key });
  if (hit) {
    res.setHeader("x-loadshield-cache", "HIT");
    if (hit.contentType) res.setHeader("content-type", hit.contentType);
    return res.status(hit.status || 200).send(hit.body ?? "");
  }

  res.setHeader("x-loadshield-cache", "MISS");
  const upstreamUrl = `${BACKEND_URL}${req.originalUrl}`;
  const upstreamRes = await fetch(upstreamUrl, { headers: headersToForward(req), method: "GET" });
  const bodyText = await upstreamRes.text();

  const upstreamStatus = upstreamRes.status;
  const contentType = upstreamRes.headers.get("content-type") || "application/json; charset=utf-8";

  if (isCacheableStatus(upstreamStatus)) {
    const toCache = {
      status: upstreamStatus,
      contentType,
      headers: pickHeaders(upstreamRes.headers, ["cache-control"]),
      body: bodyText
    };
    await setCachedResponse({
      store: cacheStore,
      key,
      ttlSeconds: CACHE_TTL_SECONDS,
      value: toCache
    });
  }

  responseFromUpstream({
    res,
    upstreamStatus,
    upstreamHeaders: upstreamRes.headers,
    bodyText
  });
});

// Proxy all /api/* to backend
app.use(
  "/api",
  createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,
    proxyTimeout: 15_000,
    timeout: 15_000,
    onProxyReq(proxyReq) {
      // Add some identity headers to make demos easier.
      proxyReq.setHeader("x-loadshield", "1");
    }
  })
);

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[loadshield] listening on http://localhost:${PORT} (backend ${BACKEND_URL})`);
});

process.on("SIGINT", async () => {
  if (storeWrap.close) await storeWrap.close();
  if (cacheWrap.close) await cacheWrap.close();
  process.exit(0);
});
