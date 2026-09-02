function pickHeaders(headersObj, allowList) {
  const out = {};
  for (const h of allowList) {
    const v = headersObj.get(h);
    if (v !== null && v !== undefined) out[h] = v;
  }
  return out;
}

function cacheKeyFromRequest({ prefix, req, varyUser }) {
  const parts = [prefix, req.method, req.originalUrl];
  if (varyUser) {
    const uid = req.headers["x-user-id"];
    if (typeof uid === "string" && uid.trim()) parts.push(`user:${uid.trim()}`);
  }
  return parts.join("|");
}

async function getCachedResponse({ store, key }) {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return obj;
  } catch {
    return null;
  }
}

async function setCachedResponse({ store, key, ttlSeconds, value }) {
  const raw = JSON.stringify(value);
  await store.set(key, raw, ttlSeconds);
}

function isCacheableRequest(req) {
  if (req.method !== "GET") return false;
  if (!req.path.startsWith("/api/")) return false;
  // Don't cache mutable/auth routes in the demo.
  if (req.path === "/api/login") return false;
  return true;
}

function isCacheableStatus(status) {
  return status >= 200 && status <= 299;
}

function headersToForward(req) {
  // Forward safe identity hints to backend; skip host, content-length, etc.
  const forward = new Headers();
  const allow = ["accept", "x-user-id"];
  for (const h of allow) {
    const v = req.headers[h];
    if (typeof v === "string" && v.length) forward.set(h, v);
  }
  return forward;
}

function responseFromUpstream({ res, upstreamStatus, upstreamHeaders, bodyText }) {
  const contentType = upstreamHeaders.get("content-type") || "application/json; charset=utf-8";
  res.setHeader("content-type", contentType);
  res.status(upstreamStatus).send(bodyText);
}

export {
  pickHeaders,
  cacheKeyFromRequest,
  getCachedResponse,
  setCachedResponse,
  isCacheableRequest,
  isCacheableStatus,
  headersToForward,
  responseFromUpstream
};

