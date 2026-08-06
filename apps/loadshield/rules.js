function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getClientIp(req) {
  const xfwd = req.headers["x-forwarded-for"];
  if (typeof xfwd === "string" && xfwd.length) return xfwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function getClientId(req) {
  // Prefer an app-level user id if present; fall back to IP.
  const uid = req.headers["x-user-id"];
  if (typeof uid === "string" && uid.trim()) return `user:${uid.trim()}`;
  return `ip:${getClientIp(req)}`;
}

async function isBanned(store, banKey) {
  const banned = await store.get(banKey);
  return banned === 1;
}

async function ban(store, banKey, seconds) {
  await store.set(banKey, 1, seconds);
}

async function rateLimitFixedWindow({ store, key, limit, windowSeconds }) {
  const { value, ttlMs } = await store.incr(key, windowSeconds);
  const allowed = value <= limit;
  return { allowed, remaining: Math.max(0, limit - value), ttlMs, value };
}

function computeThrottleDelayMs({ rps, softRps, hardRps, minDelayMs, maxDelayMs }) {
  if (rps <= softRps) return 0;
  if (rps >= hardRps) return maxDelayMs;
  const t = (rps - softRps) / Math.max(1, hardRps - softRps);
  return Math.floor(minDelayMs + t * (maxDelayMs - minDelayMs));
}

async function maybeThrottle({ delayMs }) {
  if (delayMs <= 0) return;
  await sleep(delayMs);
}

export {
  getClientId,
  getClientIp,
  isBanned,
  ban,
  rateLimitFixedWindow,
  computeThrottleDelayMs,
  maybeThrottle
};

