import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function nowMs() {
  return Date.now();
}

function base64UrlEncode(s) {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

class MemoryCacheStore {
  constructor() {
    this._map = new Map();
  }

  async get(key) {
    const entry = this._map.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= nowMs()) {
      this._map.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, ttlSeconds) {
    const expiresAtMs = ttlSeconds ? nowMs() + ttlSeconds * 1000 : null;
    this._map.set(key, { value, expiresAtMs });
  }

  async del(key) {
    this._map.delete(key);
  }
}

class FileCacheStore {
  constructor(dir) {
    this._dir = dir;
  }

  _filePathForKey(key) {
    const name = base64UrlEncode(key);
    return path.join(this._dir, `${name}.json`);
  }

  async get(key) {
    const p = this._filePathForKey(key);
    try {
      const raw = await fs.readFile(p, "utf8");
      const obj = JSON.parse(raw);
      if (obj.expiresAtMs !== null && obj.expiresAtMs <= nowMs()) {
        await fs.unlink(p).catch(() => {});
        return null;
      }
      return obj.value ?? null;
    } catch {
      return null;
    }
  }

  async set(key, value, ttlSeconds) {
    await fs.mkdir(this._dir, { recursive: true });
    const p = this._filePathForKey(key);
    const expiresAtMs = ttlSeconds ? nowMs() + ttlSeconds * 1000 : null;
    const payload = JSON.stringify({ expiresAtMs, value });
    await fs.writeFile(p, payload, "utf8");
  }

  async del(key) {
    const p = this._filePathForKey(key);
    await fs.unlink(p).catch(() => {});
  }
}

async function createCacheStore() {
  const explicit = process.env.LS_CACHE_STORE; // "memory" | "redis" | "file"
  const redisUrl = process.env.LS_CACHE_REDIS_URL || process.env.REDIS_URL;
  const fileDirEnv = process.env.LS_CACHE_DIR;

  if (explicit === "file" || (!explicit && fileDirEnv)) {
    const defaultDir = fileURLToPath(new URL("./.cache", import.meta.url));
    const dir = fileDirEnv || defaultDir;
    return { kind: "file", store: new FileCacheStore(dir) };
  }

  if (explicit === "redis" || (!explicit && redisUrl)) {
    if (!redisUrl) return { kind: "memory", store: new MemoryCacheStore() };
    try {
      const { default: Redis } = await import("ioredis");
      const client = new Redis(redisUrl, {
        enableReadyCheck: true,
        maxRetriesPerRequest: 1,
        lazyConnect: true
      });
      await client.connect();
      const store = {
        async get(key) {
          return await client.get(key);
        },
        async set(key, value, ttlSeconds) {
          if (!ttlSeconds) {
            await client.set(key, value);
            return;
          }
          await client.set(key, value, "EX", ttlSeconds);
        },
        async del(key) {
          await client.del(key);
        }
      };
      return { kind: "redis", store, close: () => client.quit() };
    } catch (err) {
      console.warn(`[loadshield] Cache Redis not available, using memory cache: ${err?.message ?? err}`);
      return { kind: "memory", store: new MemoryCacheStore() };
    }
  }

  return { kind: "memory", store: new MemoryCacheStore() };
}

export { createCacheStore };

