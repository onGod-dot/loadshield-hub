/**
 * Groq AI client — routed through the LoadShield gateway.
 *
 * The Groq API key lives ONLY on the server (GROQ_API_KEY env var on the
 * gateway process). The browser never sees it. All AI requests go to:
 *   POST /chat/completions  (on the LoadShield gateway at port 4000)
 * which proxies them to Groq with the key attached server-side.
 */

import { LOADSHIELD_BASE } from "./api";

const CHAT_PROXY_URL = `${LOADSHIELD_BASE}/chat/completions`;

const SYSTEM_PROMPT = `You are a helpful AI assistant for LoadShield, an API traffic gateway built at Takoradi Technical University (TTU).

IMPORTANT RULES — follow these strictly:
- Never use markdown formatting. No asterisks, no hashes, no backticks, no bullet dashes, no bold, no headers.
- Write in plain conversational sentences only.
- Keep answers short and direct — 2 to 4 sentences maximum unless the user explicitly asks for more detail.
- If listing items, use plain numbered lines like "1. item" not bullet points or dashes.
- Never start with "Sure!", "Great!", or similar filler words.

LoadShield features: rate limiting (fixed-window, 100 req/min default), traffic throttling (adds delay at high RPS), abuse detection (IP ban after too many login attempts), response caching (GET /api/* cached in memory/Redis/file), admin cache API, live React dashboard, portal proxy for TTU student portal.

Gateway runs on port 4000, backend on port 4001. Key env vars: GROQ_API_KEY, LS_RATE_LIMIT_PER_MIN, LS_CACHE_ENABLED, LS_CACHE_TTL_SECONDS, BACKEND_URL.`;

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function chatWithGroq(messages: ChatMessage[]): Promise<string> {
  try {
    const response = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "compound-beta-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        temperature: 0.4,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      // Surface a helpful message if the key isn't configured on the server
      if (response.status === 503) {
        throw new Error("AI assistant is not configured on the server. Set GROQ_API_KEY.");
      }
      throw new Error(`Chat proxy error: ${response.status} — ${JSON.stringify(err)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate a response.";
  } catch (error) {
    console.error("Groq chat error:", error);
    throw error;
  }
}
