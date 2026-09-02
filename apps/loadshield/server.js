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

// ── CORS ──────────────────────────────────────────────────────────────────────
// Allow the frontend (any localhost port or deployed origin) to call the gateway.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow any localhost origin in dev, or set LS_ALLOWED_ORIGIN for production
  const allowed = process.env.LS_ALLOWED_ORIGIN || "http://localhost:8080";
  const allowList = [allowed, "http://localhost:3000", "http://localhost:5173", "http://localhost:8080", "http://localhost:4173"];
  if (origin && allowList.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    // same-origin / curl / server-to-server — allow
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-user-id, x-loadshield-admin-token");
  res.setHeader("Access-Control-Expose-Headers", "x-loadshield-cache, x-loadshield-limit, x-loadshield-remaining, x-loadshield-reset-ms");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
// ─────────────────────────────────────────────────────────────────────────────

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

// ── Portal Session Tracker ────────────────────────────────────────────────────
// Every request that passes through /portal/* is recorded here.
// Sessions are grouped by cookie-based session ID.
// Exposed at GET /portal-sessions for the frontend to poll.

const MAX_SESSION_EVENTS = 2000; // rolling cap

const portalSessions = new Map(); // sessionId → { id, ip, firstSeen, lastSeen, pageTrail[], requestCount }
const portalEvents = [];          // flat rolling log of all portal requests

function extractSessionId(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/laravel_session=([^;]+)/);
  return match ? match[1].slice(0, 16) : null; // use first 16 chars as ID
}

function recordPortalAccess({ sessionId, ip, path, method, status, latencyMs }) {
  const now = Date.now();
  const friendlyPath = path.replace(/^\/portal/, "") || "/";

  // Update session map
  if (!portalSessions.has(sessionId)) {
    portalSessions.set(sessionId, {
      id: sessionId,
      ip,
      firstSeen: now,
      lastSeen: now,
      pageTrail: [],
      requestCount: 0,
    });
  }
  const session = portalSessions.get(sessionId);
  session.lastSeen = now;
  session.requestCount++;
  // Only track page navigations (GET HTML), not assets
  if (method === "GET" && !friendlyPath.match(/\.(css|js|png|jpg|svg|ico|woff|ttf|map)(\?|$)/i)) {
    session.pageTrail.push({ path: friendlyPath, time: now, status, latencyMs });
    if (session.pageTrail.length > 50) session.pageTrail.shift();
  }

  // Flat event log
  portalEvents.push({ sessionId, ip, path: friendlyPath, method, status, latencyMs, time: now });
  if (portalEvents.length > MAX_SESSION_EVENTS) portalEvents.shift();
}

app.get("/portal-sessions", (req, res) => {
  const sessions = Array.from(portalSessions.values())
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 200);
  res.json({
    ok: true,
    sessionCount: portalSessions.size,
    sessions,
    recentEvents: portalEvents.slice(-100).reverse(),
  });
});

app.delete("/portal-sessions", (req, res) => {
  portalSessions.clear();
  portalEvents.length = 0;
  res.json({ ok: true });
});
// ─────────────────────────────────────────────────────────────────────────────

// ── Portal Content Snapshot & Change Detector ─────────────────────────────────
// When the proxy serves HTML for a "watchable" page (results, fees, transcript…),
// it extracts the visible text, hashes it, and stores a snapshot.
// On subsequent visits the new hash is compared — a difference means content changed.
// The frontend reads these via GET /portal-snapshots and GET /portal-changes,
// then persists them permanently in Supabase under the logged-in user's account.

// Pages we care about — matched against the proxied path (after /portal prefix stripped).
// Uses prefix matching so /result/transcript/provisonal matches "/result".
const WATCHABLE_PAGES = {
  // Results / grades
  "/result":              "Academic Results",
  "/results":             "Academic Results",
  "/studentresult":       "Academic Results",
  "/grade":               "Academic Results",
  "/grades":              "Academic Results",
  // Fees / payments
  "/fee":                 "Fee Statement",
  "/fees":                "Fee Statement",
  "/studentfees":         "Fee Statement",
  "/finance":             "Fee Statement",
  "/payment":             "Fee Statement",
  // Transcript
  "/transcript":          "Transcript",
  "/studenttranscript":   "Transcript",
  // Profile
  "/profile":             "Student Profile",
  "/studentprofile":      "Student Profile",
  "/account":             "Student Profile",
  // Courses / registration
  "/course":              "Course Registration",
  "/courses":             "Course Registration",
  "/registration":        "Course Registration",
  "/studentcourses":      "Course Registration",
  // Schedule
  "/schedule":            "Lecturing Timetable",
  "/timetable":           "Lecturing Timetable",
  // Dashboard — capture this too so we have a baseline
  "/dashboard":           "Student Dashboard",
  // Assessment
  "/assessment":          "Assessment",
  // Biodata / profile update
  "/biodataUpdate":       "Student Profile",
  "/biodata":             "Student Profile",
  // Fee / account statement
  "/statement_account":   "Fee Statement",
  "/statementaccount":    "Fee Statement",
  // Timetables
  "/timetableTeach":      "Lecturing Timetable",
  "/timetableExams":      "Exams Timetable",
  // Industrial liaison — not captured (not useful for history)
  // "/liaison":          "Industrial Liaison",
  // Home page
  "/home":                "Student Home",
  // Course registration steps & resit
  "/registrationSteps":   "Registration Steps",
  "/registerResit":       "Resit Registration",
  "/resit":               "Resit Registration",
  // Course outlines / syllabus
  "/courseOutlines":      "Course Outlines",
  "/courseoutlines":      "Course Outlines",
  "/outline":             "Course Outlines",
  // Matriculation
  "/matriculation":       "Matriculation",
  // Graduation
  "/graduation":          "Graduation",
  // Policies
  "/policies":            "University Policies",
  "/policy":              "University Policies",
  // Check status / profile verification
  "/checkStatus":         "Student Status",
  "/checkstatus":         "Student Status",
  "/status":              "Student Status",
  // E-Library
  "/library":             "E-Library",
  "/elibrary":            "E-Library",
  // Assumption form
  "/assumptionForm":      "Assumption Form",
  "/assumption":          "Assumption Form",
  // Attachment letter
  "/attachmentLetter":    "Attachment Letter",
  "/attachment":          "Attachment Letter",
};

/**
 * Strip all HTML tags and collapse whitespace to get comparable plain text.
 * Also removes <script> and <style> blocks entirely before stripping tags.
 */
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Simple FNV-1a 32-bit hash — fast, no crypto module needed.
 * Good enough for change detection (we're not doing security hashing here).
 */
function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Find the content type label for a given path.
 * All comparisons are case-insensitive — WATCHABLE_PAGES keys are lowercased at lookup.
 */
function getContentType(path) {
  const clean = path.split("?")[0].toLowerCase().replace(/\/+$/, "") || "/";
  // Exact match (case-insensitive — lower both sides)
  for (const [key, label] of Object.entries(WATCHABLE_PAGES)) {
    if (key.toLowerCase() === clean) return label;
  }
  // Prefix match — longest prefix wins
  let best = null;
  let bestLen = 0;
  for (const [prefix, label] of Object.entries(WATCHABLE_PAGES)) {
    const p = prefix.toLowerCase();
    if (
      (clean === p || clean.startsWith(p + "/") || clean.startsWith(p + "?")) &&
      p.length > bestLen
    ) {
      best = label;
      bestLen = p.length;
    }
  }
  return best;
}

// In-memory stores (frontend persists these to Supabase)
// snapshots: "sessionId:path" → { sessionId, path, contentType, hash, text, capturedAt }
const portalSnapshots = new Map();
// changes: append-only array of change records
const portalChanges = [];
const MAX_CHANGES = 500;

// Pages that should only be captured once per day (not on every visit)
const DAILY_ONLY_PAGES = new Set(["Student Dashboard", "Student Home"]);

/**
 * Returns "YYYY-MM-DD" for a given Unix ms timestamp in local time.
 */
function toDateString(ms) {
  return new Date(ms).toLocaleDateString("en-CA"); // en-CA gives YYYY-MM-DD
}

/**
 * Called after we have the final HTML for a watchable page.
 * Returns a change record if content changed, null otherwise.
 */
function processSnapshot({ sessionId, path, html }) {
  const contentType = getContentType(path);
  if (!contentType) return null;

  const text = extractText(html);
  if (text.length < 20) return null; // skip nearly-empty pages (login redirects etc.)

  const hash = hashText(text);
  const now = Date.now();
  const key = `${sessionId}:${path.split("?")[0]}`;

  const existing = portalSnapshots.get(key);

  // For dashboard/home: only capture once per calendar day per session
  if (DAILY_ONLY_PAGES.has(contentType) && existing) {
    const capturedToday = toDateString(existing.capturedAt) === toDateString(now);
    if (capturedToday) return null; // already have today's snapshot — skip
  }

  if (!existing) {
    // First visit — store baseline snapshot
    portalSnapshots.set(key, { sessionId, path, contentType, hash, text, capturedAt: now });
    return null; // no change to report yet
  }

  if (existing.hash === hash) {
    // Content unchanged — update capturedAt so we know it was checked
    existing.capturedAt = now;
    return null;
  }

  // Content changed — store change record and update snapshot
  const change = {
    id: `${key}:${now}`,
    sessionId,
    path,
    contentType,
    before: { text: existing.text, capturedAt: existing.capturedAt },
    after:  { text, capturedAt: now },
    detectedAt: now,
  };

  portalChanges.push(change);
  if (portalChanges.length > MAX_CHANGES) portalChanges.shift();

  // Update the stored snapshot to the latest
  portalSnapshots.set(key, { sessionId, path, contentType, hash, text, capturedAt: now });

  return change;
}

// Expose snapshots to the frontend
app.get("/portal-snapshots", (req, res) => {
  res.json({
    ok: true,
    snapshots: Array.from(portalSnapshots.values()),
    changes: portalChanges.slice().reverse(), // newest first
  });
});

// Debug: test getContentType and processSnapshot inline (remove in production)
app.get("/portal-snapshots/debug-path", (req, res) => {
  const path = String(req.query.path || "/result/transcript/provisonal");
  const contentType = getContentType(path);
  const snapshotCount = portalSnapshots.size;
  res.json({ path, contentType, snapshotCount, watchableKeys: Object.keys(WATCHABLE_PAGES) });
});

app.delete("/portal-snapshots", (req, res) => {
  portalSnapshots.clear();
  portalChanges.length = 0;
  res.json({ ok: true });
});
// ─────────────────────────────────────────────────────────────────────────────

// Apply express.json() only to non-portal routes so it doesn't consume the
// raw form body that the portal proxy needs to forward.
app.use((req, res, next) => {
  if (req.path.startsWith("/portal")) return next();
  express.json()(req, res, next);
});

// ── Secure AI Chat Proxy ──────────────────────────────────────────────────────
// The Groq API key lives ONLY here on the server (GROQ_API_KEY env var).
// The frontend calls POST /chat/completions — the key is never sent to the browser.
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

app.post("/chat/completions", async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(503).json({
      ok: false,
      error: "ai_not_configured",
      message: "GROQ_API_KEY is not set on the server. Add it to your environment."
    });
  }

  try {
    const upstream = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({ ok: false, error: "groq_error", detail: data });
    }

    res.json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: "chat_proxy_error", message: err?.message ?? String(err) });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// ── TTU Portal Proxy ──────────────────────────────────────────────────────────
// records.ttuportal.com sends X-Frame-Options: SAMEORIGIN which blocks iframes.
// We fetch the portal server-side, strip that header, rewrite internal links
// so navigation stays within our proxy, and serve it at /portal/*.
// The frontend iframe points to http://localhost:4000/portal/login
const PORTAL_ORIGIN = "https://records.ttuportal.com";

app.use("/portal", async (req, res) => {
  const portalPath = req.path || "/";
  const portalUrl = `${PORTAL_ORIGIN}${portalPath}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
  const t0 = Date.now();
  const clientIp = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
  const sessionId = extractSessionId(req.headers.cookie) || `anon-${clientIp.replace(/\./g, "-")}`;

  try {
    // Forward cookies and common headers so sessions work
    const forwardHeaders = {
      "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
      "accept": req.headers["accept"] || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": req.headers["accept-language"] || "en-US,en;q=0.5",
      "accept-encoding": "identity", // avoid compressed responses we can't rewrite
      "origin": PORTAL_ORIGIN,      // tell the portal we're coming from its own origin
      "host": "records.ttuportal.com",
    };
    if (req.headers.cookie) forwardHeaders["cookie"] = req.headers.cookie;
    if (req.headers["content-type"]) forwardHeaders["content-type"] = req.headers["content-type"];
    if (req.headers["x-csrf-token"]) forwardHeaders["x-csrf-token"] = req.headers["x-csrf-token"];
    if (req.headers.referer) {
      forwardHeaders["referer"] = req.headers.referer.replace(
        /http:\/\/localhost:\d+\/portal/g,
        PORTAL_ORIGIN
      );
    } else {
      forwardHeaders["referer"] = `${PORTAL_ORIGIN}/login`;
    }

    // Read body for POST requests (login form submissions)
    let body;
    if (req.method === "POST") {
      body = await new Promise((resolve) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
      });
      if (body.length > 0 && !forwardHeaders["content-type"]) {
        forwardHeaders["content-type"] = "application/x-www-form-urlencoded";
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

    const upstreamRes = await fetch(portalUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: body && body.length > 0 ? body : undefined,
      redirect: "manual", // handle redirects ourselves
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Forward cookies from the portal back to the browser.
    // Rewrite cookie attributes so they work inside an iframe:
    // - Remove 'SameSite=Lax/Strict' (replaced with None so iframe can send them)
    // - Remove 'Secure' flag in dev (we're on http://localhost)
    // - Remove 'HttpOnly' restriction is kept (security)
    const setCookieHeaders = [];
    upstreamRes.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        // Rewrite SameSite to None and remove Secure for localhost iframe compatibility
        const rewritten = value
          .replace(/;\s*SameSite=\w+/gi, "")
          .replace(/;\s*Secure/gi, "")
          + "; SameSite=None";
        setCookieHeaders.push(rewritten);
      }
    });
    if (setCookieHeaders.length > 0) {
      res.setHeader("set-cookie", setCookieHeaders);
    }

    // Handle redirects — rewrite the Location header to stay within our proxy
    if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
      const location = upstreamRes.headers.get("location") || "/";
      const rewritten = location.startsWith(PORTAL_ORIGIN)
        ? location.replace(PORTAL_ORIGIN, "/portal")
        : location.startsWith("/")
          ? `/portal${location}`
          : location;
      recordPortalAccess({ sessionId, ip: clientIp, path: req.path, method: req.method, status: upstreamRes.status, latencyMs: Date.now() - t0 });
      return res.redirect(upstreamRes.status, rewritten);
    }

    const contentType = upstreamRes.headers.get("content-type") || "text/html";
    res.setHeader("content-type", contentType);

    // Strip embedding-blocking headers
    // (do NOT forward these — they would block our iframe)
    const STRIP_HEADERS = ["x-frame-options", "content-security-policy", "content-encoding", "transfer-encoding"];

    upstreamRes.headers.forEach((value, key) => {
      if (!STRIP_HEADERS.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    res.status(upstreamRes.status);

    // For HTML responses, rewrite internal links so navigation stays in proxy
    if (contentType.includes("text/html")) {
      let html = await upstreamRes.text();

      // Rewrite absolute URLs pointing to the portal origin
      html = html.replaceAll(PORTAL_ORIGIN, "/portal");

      // Rewrite root-relative paths in href, src, action, url()
      html = html.replace(
        /(href|src|action)="(?!https?:\/\/)(?!\/portal)(\/[^"]*?)"/gi,
        (_, attr, path) => `${attr}="/portal${path}"`
      );
      html = html.replace(
        /url\((?!['"]?https?:\/\/)['"]?(\/[^)'"]*?)['"]?\)/gi,
        (_, path) => `url("/portal${path}")`
      );

      // Snapshot extraction — runs after HTML is fully rewritten
      const friendlyPath = req.path.replace(/^\/portal/, "") || "/";
      processSnapshot({ sessionId, path: friendlyPath, html });

      recordPortalAccess({ sessionId, ip: clientIp, path: req.path, method: req.method, status: upstreamRes.status, latencyMs: Date.now() - t0 });
      return res.send(html);
    }

    // For non-HTML (CSS, JS, images) — pipe the body directly
    const buffer = await upstreamRes.arrayBuffer();
    recordPortalAccess({ sessionId, ip: clientIp, path: req.path, method: req.method, status: upstreamRes.status, latencyMs: Date.now() - t0 });
    res.send(Buffer.from(buffer));

  } catch (err) {
    const isTimeout = err?.name === "AbortError";
    const msg = isTimeout
      ? "Request timed out after 20s"
      : (err?.cause?.message ?? err?.message ?? String(err));
    res.status(502).send(`
      <html><body style="font-family:sans-serif;padding:2rem;text-align:center;color:#1e293b">
        <h2 style="color:#dc2626">Portal Proxy Error</h2>
        <p>Could not reach <strong>${PORTAL_ORIGIN}</strong></p>
        <p style="color:#64748b;font-size:0.85rem;margin-top:1rem">${msg}</p>
        <p style="margin-top:1.5rem">
          <a href="/portal/login" style="color:#2563eb;text-decoration:none;font-weight:600">↩ Try again</a>
        </p>
      </body></html>
    `);
  }
});
// ─────────────────────────────────────────────────────────────────────────────

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
