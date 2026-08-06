const GROQ_API_KEY = typeof window !== "undefined" 
  ? (window as any).GROQ_API_KEY 
  : import.meta.env.VITE_GROQ_API_KEY;

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are a helpful AI assistant for LoadShield, an API traffic gateway system. You help users understand and use LoadShield's features.

LoadShield is a production-grade API traffic-control gateway that protects backend services from overload, abusive traffic, and request spikes. It sits in front of your API and applies intelligent rules before any request reaches your backend.

Key Features:
- Rate Limiting: Fixed-window counter per user (x-user-id) or per IP. Default 100 req/min
- Traffic Throttling: Adds delay when inbound RPS exceeds soft/hard thresholds instead of crashing
- Abuse Detection: Too many POST /api/login attempts in 10s triggers a temporary IP ban
- Response Caching: Read-through cache for GET /api/* — memory, Redis, or file-based
- Admin Cache API: Push, inspect, and invalidate cache entries via REST endpoints
- Live Dashboard: Real-time React UI showing allowed/blocked/throttled traffic, gauges, and charts
- Portal Tester: Built-in tool to send real requests and observe cache HIT/MISS
- Table Mode: Serve JSON files directly as /data/:table endpoints
- Redis Support: Optional Redis backend for persistent rate-limit and cache state

Architecture:
- LoadShield Gateway (port 4000): Handles rate limiting, throttling, abuse detection, and caching
- Backend API (port 4001): The protected backend service
- React Dashboard (port 8080): Real-time monitoring UI

Environment Variables:
- LOADSHIELD_PORT: Gateway listen port (default 4000)
- BACKEND_URL: Where to proxy /api/* (default http://localhost:4001)
- LS_RATE_LIMIT_PER_MIN: Max requests per minute per client (default 100)
- LS_THROTTLE_SOFT_RPS: RPS where throttle delay begins (default 120)
- LS_THROTTLE_HARD_RPS: RPS where max throttle delay applies (default 240)
- LS_BAN_SECONDS: How long a ban lasts (default 600)
- LS_LOGIN_ABUSE_LIMIT_10S: Max login attempts per IP per 10s (default 30)
- LS_CACHE_ENABLED: Set to 0 to disable caching (default 1)
- LS_CACHE_TTL_SECONDS: Cache entry lifetime (default 8)
- LS_CACHE_VARY_USER: 1 = separate cache per x-user-id (default 0)
- LS_CACHE_STORE: auto, memory, redis, or file (default auto)
- LS_ADMIN_TOKEN: Protects /admin/* when set
- LS_TABLES: Comma-separated tables to expose
- REDIS_URL: Redis for rate-limit store

API Endpoints:
- GET /health: Health check
- GET /metrics: Full live metrics snapshot
- GET /api/data: Proxied + cached backend response
- POST /api/login: Proxied login (abuse-detected)
- GET /api/stats: Backend inflight stats
- GET /data/:table: Table mode (requires LS_TABLES env var)
- GET /data/:table/:id: Single row lookup
- GET /admin/cache?key=<k>: Inspect a cache entry
- PUT /admin/cache: Write a value into cache
- DELETE /admin/cache: Invalidate a cache entry

Dashboard Pages:
- /dashboard: Live totals, traffic chart, status banner
- /live: RPS gauge, rolling chart, real-time counters
- /saved: Cache manager + portal tester
- /viewer: Simulated student portal with live protection panel
- /security: Security score, threat counts, health checks
- /analytics: Traffic buckets, backend inflight, config table
- /connect: 3-step wizard to configure your portal URL
- /settings: Protection toggles and configuration

Be helpful, concise, and technical. If you don't know something specific about the user's setup, ask for clarification.`;

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function chatWithGroq(messages: ChatMessage[]): Promise<string> {
  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
  } catch (error) {
    console.error("Groq API error:", error);
    throw error;
  }
}
