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

const app = express();
app.use(express.json());
app.use(morgan("dev"));

// A deliberately fragile backend:
// - limited concurrent "work"
// - CPU+latency simulated per request
// This makes "before vs after" obvious when LoadShield is enabled.
const PORT = Number(process.env.PORT || process.env.BACKEND_PORT || 4001);
const MAX_INFLIGHT = Number(process.env.BACKEND_MAX_INFLIGHT || 50);
const BASE_WORK_MS = Number(process.env.BACKEND_WORK_MS || 35);
const WORK_JITTER_MS = Number(process.env.BACKEND_WORK_JITTER_MS || 30);

let inflight = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function burnCpu(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy loop (demo)
  }
}

app.get("/health", (req, res) => res.json({ ok: true }));

// Chrome DevTools may request this well-known URL on localhost origins.
// It's not part of the demo, but returning a 200 avoids noisy console 404s.
app.get("/.well-known/appspecific/com.chrome.devtools.json", (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.status(200).send("{}");
});

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "demo-backend",
    try: ["/health", "/api/data", "/api/login", "/api/stats"]
  });
});

app.get("/api/data", async (req, res) => {
  if (inflight >= MAX_INFLIGHT) {
    return res.status(503).json({
      ok: false,
      error: "backend_overloaded",
      inflight,
      maxInflight: MAX_INFLIGHT
    });
  }

  inflight++;
  const t0 = Date.now();
  try {
    const work = BASE_WORK_MS + Math.floor(Math.random() * WORK_JITTER_MS);
    // Simulate DB/CPU work.
    burnCpu(Math.floor(work * 0.35));
    await sleep(Math.floor(work * 0.65));

    res.json({
      ok: true,
      message: "backend_response",
      latencyMs: Date.now() - t0,
      inflight
    });
  } finally {
    inflight--;
  }
});

app.post("/api/login", async (req, res) => {
  // Keep it "real": login always works, but is expensive.
  if (inflight >= MAX_INFLIGHT) {
    return res.status(503).json({
      ok: false,
      error: "backend_overloaded",
      inflight,
      maxInflight: MAX_INFLIGHT
    });
  }

  inflight++;
  const t0 = Date.now();
  try {
    const work = BASE_WORK_MS + 25 + Math.floor(Math.random() * WORK_JITTER_MS);
    burnCpu(Math.floor(work * 0.4));
    await sleep(Math.floor(work * 0.6));

    res.json({
      ok: true,
      message: "login_ok",
      user: req.body?.user ?? "demo",
      latencyMs: Date.now() - t0
    });
  } finally {
    inflight--;
  }
});

app.get("/api/stats", (req, res) => {
  res.json({
    ok: true,
    inflight,
    maxInflight: MAX_INFLIGHT,
    baseWorkMs: BASE_WORK_MS,
    jitterMs: WORK_JITTER_MS
  });
});

app.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
});
