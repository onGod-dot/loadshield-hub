import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ExternalLink,
  RefreshCw,
  User,
  Link2,
  Timer,
  Database,
  ShieldCheck,
  Server,
  Clock,
  AlertCircle,
} from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { SectionCard } from "@/components/ui-bits";
import { LOADSHIELD_BASE, deleteCacheEntry, fetchMetrics, buildCacheKey } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/viewer")({
  head: () => ({
    meta: [
      { title: "Portal Viewer — TTU-LoadShield" },
      { name: "description", content: "Live embedded TTU student portal with LoadShield protection." },
    ],
  }),
  component: ViewerPage,
});

// Detect if gateway is running locally or on a cloud server.
// When on cloud (Render), the portal proxy is blocked by Cloudflare bot protection,
// so we show the portal directly from the browser instead.
const IS_LOCAL_GATEWAY =
  LOADSHIELD_BASE.includes("localhost") ||
  LOADSHIELD_BASE.includes("127.0.0.1");

// Portal URL — proxy when local (enables snapshots), direct when cloud
const PORTAL_URL = IS_LOCAL_GATEWAY
  ? `${LOADSHIELD_BASE}/portal/login`
  : "https://records.ttuportal.com/login";

const PORTAL_DISPLAY_URL = IS_LOCAL_GATEWAY
  ? "records.ttuportal.com · via LoadShield proxy"
  : "records.ttuportal.com · direct (cloud mode)";

const STUDENT_ID = "STU-100118";
const PORTAL_CACHE_KEY = buildCacheKey("/api/data", STUDENT_ID);

function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function ViewerPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(IS_LOCAL_GATEWAY); // no loading spinner in cloud mode
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const [tick, setTick] = useState(0);
  const [totalAllowed, setTotalAllowed] = useState(0);
  const [totalBlocked, setTotalBlocked] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [countdown, setCountdown] = useState(formatCountdown(msUntilMidnight()));
  const [refreshing, setRefreshing] = useState(false);
  const metricsRef = useRef(0);
  const midnightRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Midnight cache-bust scheduler (local only — proxy caches) ─────────────
  const scheduleMidnightRefresh = useCallback(() => {
    if (!IS_LOCAL_GATEWAY) return;
    clearTimeout(midnightRef.current);
    const delay = msUntilMidnight();
    midnightRef.current = setTimeout(async () => {
      try { await deleteCacheEntry(PORTAL_CACHE_KEY); } catch { /* best-effort */ }
      setIframeKey((k) => k + 1);
      setLastRefresh(new Date());
      toast.success("Midnight cache refresh", { description: "Portal cache cleared and view reloaded." });
      scheduleMidnightRefresh();
    }, delay);
  }, []);

  useEffect(() => {
    scheduleMidnightRefresh();
    return () => clearTimeout(midnightRef.current);
  }, [scheduleMidnightRefresh]);

  // ── Live countdown ─────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCountdown(formatCountdown(msUntilMidnight())), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Poll gateway metrics ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      try {
        const m = await fetchMetrics();
        setTotalAllowed(m.totals.allowed);
        setTotalBlocked(m.totals.blocked);
      } catch { /* ignore */ }
      finally { if (!cancelled) metricsRef.current = window.setTimeout(poll, 3000); }
    }
    poll();
    return () => { cancelled = true; clearTimeout(metricsRef.current); };
  }, []);

  // ── Manual refresh ─────────────────────────────────────────────────────────
  async function manualRefresh() {
    setRefreshing(true);
    if (IS_LOCAL_GATEWAY) {
      try { await deleteCacheEntry(PORTAL_CACHE_KEY); } catch { /* best-effort */ }
    }
    setIframeKey((k) => k + 1);
    setLastRefresh(new Date());
    if (IS_LOCAL_GATEWAY) setLoading(true);
    setTick((t) => t + 1);
    toast.success("Portal refreshed", { description: IS_LOCAL_GATEWAY ? "Cache cleared and view reloaded." : "View reloaded." });
    setRefreshing(false);
  }

  function handleIframeLoad() { setLoading(false); setIframeBlocked(false); }
  function handleIframeError() { setLoading(false); setIframeBlocked(true); }

  return (
    <AppLayout title="Portal Viewer">

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* ── Iframe panel ── */}
        <SectionCard
          title="TTU Student Portal"
          description={PORTAL_DISPLAY_URL}
          action={
            <div className="flex items-center gap-1.5">
              <button
                onClick={manualRefresh}
                disabled={refreshing}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                aria-label="Refresh portal"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
              <a
                href="https://records.ttuportal.com/login"
                target="_blank"
                rel="noreferrer"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Open in new tab"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          }
        >
          {/* Browser chrome */}
          <div className="overflow-hidden rounded-xl border border-border shadow-sm">
            <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#22C55E]" />
              <div className="ml-3 flex-1 truncate rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                🔒 records.ttuportal.com{IS_LOCAL_GATEWAY ? " (via LoadShield proxy)" : ""}
              </div>
              <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                IS_LOCAL_GATEWAY
                  ? "bg-[color:var(--success)]/10 text-[color:var(--success)]"
                  : "bg-primary/10 text-primary"
              }`}>
                {IS_LOCAL_GATEWAY ? "Protected" : "Direct"}
              </span>
            </div>

            <div className="relative bg-white" style={{ height: 560 }}>
              {/* Loading skeleton */}
              {loading && !iframeBlocked && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  <p className="text-sm text-muted-foreground">Loading TTU portal…</p>
                </div>
              )}

              {/* Error / blocked state */}
              {iframeBlocked && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#F8FAFC] p-8 text-center">
                  <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[color:var(--warning)]/10">
                    <AlertCircle className="h-7 w-7 text-[color:var(--warning)]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {IS_LOCAL_GATEWAY ? "Portal blocked embedding" : "Portal cannot be embedded"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      {IS_LOCAL_GATEWAY
                        ? "The TTU portal set X-Frame-Options which prevents embedding. This is a security policy on their server."
                        : "The TTU portal's X-Frame-Options security header prevents it from being embedded from external domains. Open it directly in your browser instead."}
                    </p>
                  </div>
                  <a
                    href="https://records.ttuportal.com/login"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open Portal Directly
                  </a>
                </div>
              )}

              {/* The iframe — local proxy only */}
              {!iframeBlocked && IS_LOCAL_GATEWAY && (
                <iframe
                  key={iframeKey}
                  ref={iframeRef}
                  src={PORTAL_URL}
                  title="TTU Student Portal"
                  className="h-full w-full border-0"
                  onLoad={handleIframeLoad}
                  onError={handleIframeError}
                />
              )}

              {/* Cloud mode — load portal directly in browser iframe */}
              {!IS_LOCAL_GATEWAY && (
                <iframe
                  key={iframeKey}
                  src="https://records.ttuportal.com/login"
                  title="TTU Student Portal"
                  className="h-full w-full border-0"
                  onLoad={() => setLoading(false)}
                  onError={() => {
                    setLoading(false);
                    setIframeBlocked(true);
                  }}
                  // sandbox allows scripts + forms + popups so the portal works
                  sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                />
              )}
            </div>
          </div>
        </SectionCard>

        {/* ── Right panel ── */}
        <div className="space-y-4">
          <SectionCard title="Live Protection" description="Every request in real time.">
            <ul className="space-y-3">
              <PanelRow icon={User} label="Student ID" value={STUDENT_ID} />
              <PanelRow icon={Link2} label="Portal" value="records.ttuportal.com" mono />
              <PanelRow
                icon={Clock}
                label="Next Cache Refresh"
                value={IS_LOCAL_GATEWAY ? countdown : "Local only"}
                accent={IS_LOCAL_GATEWAY ? "primary" : "default"}
                animateKey={0}
              />
              <PanelRow
                icon={RefreshCw}
                label="Last Refreshed"
                value={lastRefresh.toLocaleTimeString()}
                accent="success"
                animateKey={tick}
              />
              <PanelRow icon={ShieldCheck} label="Protection" value="Active" accent="success" />
              <PanelRow
                icon={Database}
                label="Cache Key"
                value={IS_LOCAL_GATEWAY ? PORTAL_CACHE_KEY : "N/A (cloud mode)"}
                mono
              />
              <PanelRow
                icon={Server}
                label="Snapshot Capture"
                value={IS_LOCAL_GATEWAY ? "Enabled" : "Local only"}
                accent={IS_LOCAL_GATEWAY ? "success" : "default"}
              />
            </ul>
          </SectionCard>

          {IS_LOCAL_GATEWAY ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Midnight Cache Refresh</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    At midnight LoadShield automatically clears cached portal responses and reloads — so students always see fresh data.
                  </p>
                  <div className="mt-3 rounded-lg border border-primary/20 bg-background px-3 py-2 text-center">
                    <p className="text-[11px] text-muted-foreground">Refreshes in</p>
                    <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-primary">{countdown}</p>
                  </div>
                  <button
                    onClick={manualRefresh}
                    disabled={refreshing}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    Clear Cache & Reload Now
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-accent/30 p-4">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Snapshots require local gateway</p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    Page content snapshots and session tracking are captured when the gateway proxies requests locally.
                    Run LoadShield on your machine to enable full snapshot and change-detection features.
                  </p>
                  <code className="mt-2 block rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                    npm run start:servers
                  </code>
                </div>
              </div>
            </div>
          )}

          <SectionCard title="Session Totals" description="Requests handled by this gateway.">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Allowed" value={totalAllowed.toLocaleString()} />
              <MiniStat label="Blocked" value={totalBlocked.toLocaleString()} />
              <MiniStat label="Last Refresh" value={lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
              <MiniStat label="Mode" value={IS_LOCAL_GATEWAY ? "Proxy" : "Direct"} />
            </div>
          </SectionCard>
        </div>
      </div>
    </AppLayout>
  );
}

function PanelRow({
  icon: Icon, label, value, mono, accent = "default", animateKey,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
  accent?: "default" | "success" | "warning" | "danger" | "primary";
  animateKey?: number;
}) {
  const tone =
    accent === "success" ? "text-[color:var(--success)]"
    : accent === "warning" ? "text-[color:var(--warning)]"
    : accent === "danger" ? "text-destructive"
    : accent === "primary" ? "text-primary"
    : "text-foreground";
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <motion.span
        key={animateKey}
        initial={{ opacity: 0, y: -3 }}
        animate={{ opacity: 1, y: 0 }}
        className={`max-w-[180px] truncate text-right text-sm font-semibold ${tone} ${mono ? "font-mono text-[10px]" : ""}`}
      >
        {value}
      </motion.span>
    </li>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
