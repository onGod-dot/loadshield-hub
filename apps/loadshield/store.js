function nowMs() {
  return Date.now();
}

class MemoryStore {
  constructor() {
    this._map = new Map();
  }

  async incr(key, windowSeconds) {
    const expiresAt = nowMs() + windowSeconds * 1000;
    const entry = this._map.get(key);
    if (!entry || entry.expiresAt <= nowMs()) {
      this._map.set(key, { value: 1, expiresAt });
      return { value: 1, ttlMs: windowSeconds * 1000 };
    }
    entry.value += 1;
    entry.expiresAt = Math.max(entry.expiresAt, expiresAt);
    return { value: entry.value, ttlMs: Math.max(0, entry.expiresAt - nowMs()) };
  }

  async get(key) {
    const entry = this._map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= nowMs()) {
      this._map.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, ttlSeconds) {
    const expiresAt = nowMs() + ttlSeconds * 1000;
    this._map.set(key, { value, expiresAt });
  }

  async del(key) {
    this._map.delete(key);
  }
}

async function createStore() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return { kind: "memory", store: new MemoryStore() };

  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl, {
      enableReadyCheck: true,
      maxRetriesPerRequest: 1,
      lazyConnect: true
    });

    await client.connect();
    const store = {
      async incr(key, windowSeconds) {
        // Atomic fixed-window counter: INCR + EXPIRE on first hit.
        const pipeline = client.multi();
        pipeline.incr(key);
        pipeline.ttl(key);
        const results = await pipeline.exec();
        const value = Number(results?.[0]?.[1] ?? 0);
        const ttl = Number(results?.[1]?.[1] ?? -1);
        if (ttl < 0) {
          await client.expire(key, windowSeconds);
          return { value, ttlMs: windowSeconds * 1000 };
        }
        return { value, ttlMs: ttl * 1000 };
      },
      async get(key) {
        const v = await client.get(key);
        return v === null ? null : Number(v);
      },
      async set(key, value, ttlSeconds) {
        await client.set(key, String(value), "EX", ttlSeconds);
      },
      async del(key) {
        await client.del(key);
      }
    };

    return { kind: "redis", store, close: () => client.quit() };
  } catch (err) {
    console.warn(`[loadshield] Redis not available, using memory store: ${err?.message ?? err}`);
    return { kind: "memory", store: new MemoryStore() };
  }
}

export { createStore };
