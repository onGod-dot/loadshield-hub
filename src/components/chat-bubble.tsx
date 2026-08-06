import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Bot, User, Sparkles, Minimize2 } from "lucide-react";
import { chatWithGroq, type ChatMessage } from "@/lib/groq";
import { toast } from "sonner";

const WELCOME: ChatMessage = {
  role: "assistant",
  content:
    "👋 Hi! I'm the LoadShield AI assistant. Ask me anything about rate limiting, caching, traffic throttling, the API, or how to set up the system.",
};

const QUICK = [
  "How does rate limiting work?",
  "What is a cache HIT vs MISS?",
  "How do I ban abusive traffic?",
  "What env vars do I need?",
];

export function ChatBubble() {
  const [open, setOpen] = useState(false);
  const [minimised, setMinimised] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new message
  useEffect(() => {
    if (open && !minimised) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open, minimised]);

  // Focus input when opened
  useEffect(() => {
    if (open && !minimised) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [open, minimised]);

  // Unread counter when closed
  useEffect(() => {
    if (!open && messages.length > 1) {
      const assistantCount = messages.filter((m) => m.role === "assistant").length - 1;
      setUnread(assistantCount);
    } else {
      setUnread(0);
    }
  }, [open, messages]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput("");

    const userMsg: ChatMessage = { role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const reply = await chatWithGroq([...messages, userMsg]);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      toast.error("AI assistant unavailable. Check your Groq API key.");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I ran into an error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            className="fixed bottom-24 right-6 z-50 flex w-[360px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            style={{ maxHeight: minimised ? 56 : 520 }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border bg-primary px-4 py-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">LoadShield AI</p>
                <p className="text-[11px] text-white/70">Powered by Groq · llama-3.3-70b</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  aria-label="Minimise"
                  onClick={() => setMinimised((v) => !v)}
                  className="rounded-md p-1.5 text-white/70 hover:bg-white/20 hover:text-white"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
                <button
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-white/70 hover:bg-white/20 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {!minimised && (
              <>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 340 }}>
                  {messages.map((msg, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                      className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10">
                          <Bot className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div
                        className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      </div>
                      {msg.role === "user" && (
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary">
                          <User className="h-3.5 w-3.5 text-primary-foreground" />
                        </div>
                      )}
                    </motion.div>
                  ))}

                  {/* Typing indicator */}
                  {loading && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex gap-2 justify-start"
                    >
                      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex items-center gap-1 rounded-2xl bg-muted px-3 py-2">
                        {[0, 0.2, 0.4].map((delay, i) => (
                          <motion.span
                            key={i}
                            animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay }}
                            className="block h-1.5 w-1.5 rounded-full bg-foreground/40"
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Quick suggestions — only show when only welcome message */}
                {messages.length === 1 && (
                  <div className="border-t border-border px-4 py-2">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Quick questions
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK.map((q) => (
                        <button
                          key={q}
                          onClick={() => send(q)}
                          disabled={loading}
                          className="rounded-full border border-input bg-background px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Input */}
                <div className="border-t border-border p-3">
                  <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKey}
                      placeholder="Ask anything about LoadShield…"
                      disabled={loading}
                      className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
                    />
                    <button
                      onClick={() => send()}
                      disabled={loading || !input.trim()}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90"
                      aria-label="Send"
                    >
                      {loading ? (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </motion.div>
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating button */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => {
          setOpen((v) => !v);
          setMinimised(false);
        }}
        className="fixed bottom-6 right-6 z-50 grid h-14 w-14 place-items-center rounded-full bg-primary shadow-lg shadow-primary/30 text-primary-foreground hover:bg-primary/90"
        aria-label="Toggle AI assistant"
      >
        <AnimatePresence mode="wait">
          {open ? (
            <motion.div key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.18 }}>
              <X className="h-6 w-6" />
            </motion.div>
          ) : (
            <motion.div key="chat" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.18 }} className="relative">
              <MessageCircle className="h-6 w-6" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </>
  );
}
