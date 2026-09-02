function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i++;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randInt(n) {
  return Math.floor(Math.random() * n);
}

const args = parseArgs(process.argv);
const modeDirect = args.get("direct") === true;
const modeShield = args.get("shield") === true;
const baseUrl =
  (args.get("url") && String(args.get("url"))) ||
  (modeDirect ? "http://localhost:4001" : "http://localhost:4000");

const rps = Number(args.get("rps") || 500);
const seconds = Number(args.get("seconds") || 15);
const users = Number(args.get("users") || 50);
const loginRatio = Number(args.get("loginRatio") || 0.15);
const timeoutMs = Number(args.get("timeoutMs") || 5000);

const dataUrl = `${baseUrl}/api/data`;
const loginUrl = `${baseUrl}/api/login`;

const stats = {
  sent: 0,
  ok: 0,
  s403: 0,
  s429: 0,
  s503: 0,
  other: 0,
  errors: 0,
  latencySumMs: 0
};

function classifyStatus(s) {
  if (s === 200) return "ok";
  if (s === 403) return "s403";
  if (s === 429) return "s429";
  if (s === 503) return "s503";
  return "other";
}

async function sendOne(i) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const userId = String(1 + (i % users));
    const isLogin = Math.random() < loginRatio;
    const url = isLogin ? loginUrl : dataUrl;
    const init = {
      method: isLogin ? "POST" : "GET",
      headers: {
        "x-user-id": userId,
        "content-type": "application/json"
      },
      body: isLogin ? JSON.stringify({ user: `user${userId}`, pass: "demo" }) : undefined,
      signal: controller.signal
    };

    const res = await fetch(url, init);
    stats[classifyStatus(res.status)]++;
    stats.latencySumMs += Date.now() - t0;
    await res.arrayBuffer().catch(() => {});
  } catch {
    stats.errors++;
  } finally {
    clearTimeout(timer);
  }
}

function printLine(prefix, s) {
  // Keep output single-line for easy copy/paste into slides.
  process.stdout.write(
    `${prefix} sent=${s.sent} ok=${s.ok} 429=${s.s429} 403=${s.s403} 503=${s.s503} err=${s.errors} avgMs=${s.sent ? Math.round(s.latencySumMs / s.sent) : 0}\n`
  );
}

console.log(`[spike] target=${baseUrl} rps=${rps} seconds=${seconds} users=${users} loginRatio=${loginRatio}`);
if (modeDirect) console.log("[spike] mode=direct (hitting backend)");
if (modeShield) console.log("[spike] mode=shield (hitting LoadShield)");

const started = Date.now();
let lastPrint = started;
let nextToSend = 0;
const inflight = new Set();

while (Date.now() - started < seconds * 1000) {
  const elapsed = (Date.now() - started) / 1000;
  const shouldHaveSent = Math.floor(elapsed * rps);
  const toSend = Math.min(5000, shouldHaveSent - nextToSend);

  for (let j = 0; j < toSend; j++) {
    const idx = nextToSend++;
    stats.sent++;
    const p = sendOne(idx).finally(() => inflight.delete(p));
    inflight.add(p);
  }

  const now = Date.now();
  if (now - lastPrint >= 1000) {
    lastPrint = now;
    printLine("[spike]", stats);
  }

  // Small yield to avoid pegging the CPU in the generator itself.
  // The requests are what should consume resources.
  await sleep(10);
}

console.log("[spike] waiting for inflight requests to finish...");
await Promise.allSettled(Array.from(inflight));
printLine("[spike] final", stats);

