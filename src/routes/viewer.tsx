import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ExternalLink, RefreshCw, User, Link2, Timer, Database, ShieldCheck, Server, WifiOff } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { SectionCard } from "@/components/ui-bits";
import { fetchThroughGateway, fetchMetrics, LOADSHIELD_BASE } from "@/lib/api";

export const Route = createFileRoute("/viewer")({
  head: () => ({
    meta: [
      { title: "Portal Viewer — TTU-LoadShield" },
      { name: "description", content: "Watch LoadShield protect every request in real time." },
    ],
  }),
  component: ViewerPage,
});

const STUDENT_ID = "STU-100118";

type RequestLog = {
  time: number;
  latencyMs: number;
  cacheStatus: "HIT" | "MISS" | "N/A";
  status: number;
  data: unknown;
  error: boolean;
};

function ViewerPage() {
  const [log, setLog] = useState<RequestLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [totalAllowed, setTotalAllowed] = useState(0);
  const [totalBlocked, setTotalBlocked] = useState(0);
  const tickRef = useRef(0);

  async function fetchData() {
    setLoading(true);
    try {
      const result = await fetchThroughGateway("/api/data", STUDENT_ID);
      setLog({
        time: Date.now(),
        latencyMs: result.latencyMs,
        cacheStatus: result.cacheStatus,
        status: result.status,
        data: result.data,
        error: result.status >= 400,
      });
      setTick((t) => t + 1);
    } catch {
      setLog({ time: Date.now(), latencyMs: 0, cacheStatus: "N/A", status: 0, data: null, error: true });
    } finally {
      setLoading(false);
    }
  }

  // Poll metrics for totals
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      try {
        const m = await fetchMetrics();
        setTotalAllowed(m.totals.allowed);
        setTotalBlocked(m.totals.blocked);
      } catch {
        // ignore
      } finally {
        if (!cancelled) tickRef.current = window.setTimeout(poll, 3000);
      }
    }
    poll();
    return () => { cancelled = true; clearTimeout(tickRef.current); };
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(fetchData, 3500);
    return () => clearInterval(t);
  }, [autoRefresh]);

  const fromCache = log?.cacheStatus === "HIT";

  return (
    <AppLayout title="Portal Viewer">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <SectionCard
          title="Student Portal"
          description={`Requests routed through LoadShield at ${LOADSHIELD_BASE}`}
          action={
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setAutoRefresh((v) => !v)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  autoRefresh
                    ? "bg-primary text-primary-foreground"
                    : "border border-input text-muted-foreground hover:bg-accent"
                }`}
              >
                {autoRefresh ? "Auto: On" : "Auto: Off"}
              </button>
              <button
                onClick={fetchData}
                disabled={loading}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                aria-label="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <a
                href={`${LOADSHIELD_BASE}/api/data`}
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
          <div className="overflow-hidden rounded-xl border border-border bg-[#F8FAFC]">
            {/* Fake browser chrome */}
            <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#22C55E]" />
              <div className="ml-3 flex-1 truncate rounded-md bg-background px-2.5 py-1 text-xs text-muted-foreground">
                {LOADSHIELD_BASE}/api/data
              </div>
              {log && (
                <span
                  className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    fromCache ? "bg-primary/10 text-primary" : "bg-[color:var(--warning)]/10 text-[color:var(--warning)]"
                  }`}
                >
                  {fromCache ? "⚡ Cache HIT" : "🌐 Cache MISS"}
                </span>
              )}
            </div>

            <div className="min-h-[400px] p-6">
              {!log && !loading && (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <RefreshCw className="h-8 w-8 opacity-40" />
                  <p className="text-sm">Click Refresh or turn on Auto to load the portal.</p>
                </div>
              )}
              {loading && (
                <div className="space-y-4">
                  <div className="h-5 w-48 animate-pulse rounded bg-accent" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[1,2,3,4].map((i) => (
                      <div key={i} className="h-20 animate-pulse rounded-xl bg-accent" />
                    ))}
                  </div>
                </div>
              )}
              {log && !loading && (
                <MockPortalDisplay log={log} studentId={STUDENT_ID} />
              )}
            </div>
          </div>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="Live Protection" description="Every request in real time.">
            <ul className="space-y-3">
              <PanelRow icon={User} label="Student ID" value={STUDENT_ID} />
              <PanelRow icon={Link2} label="Endpoint" value="/api/data" mono />
              <PanelRow
                icon={Timer}
                label="Response Time"
                value={log ? `${log.latencyMs}ms` : "—"}
                accent={!log ? "default" : log.latencyMs < 100 ? "success" : log.latencyMs < 300 ? "warning" : "danger"}
                animateKey={tick}
              />
              <PanelRow
                icon={Database}
                label="Served From"
                value={!log ? "—" : fromCache ? "Saved (fast!)" : "Live Portal"}
                accent={!log ? "default" : fromCache ? "success" : "warning"}
                animateKey={tick}
              />
              <PanelRow
                icon={Database}
                label="Cache Status"
                value={log?.cacheStatus ?? "—"}
                accent={!log ? "default" : fromCache ? "success" : "warning"}
                animateKey={tick}
              />
              <PanelRow icon={ShieldCheck} label="Protection" value="Active" accent="success" />
              <PanelRow
                icon={Server}
                label="Backend Contacted"
                value={!log ? "—" : fromCache ? "No" : "Yes"}
                accent={!log ? "default" : fromCache ? "success" : "warning"}
                animateKey={tick}
              />
            </ul>
          </SectionCard>

          <SectionCard title="Session Totals" description="Requests handled by this gateway.">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Allowed" value={totalAllowed.toLocaleString()} />
              <MiniStat label="Blocked" value={totalBlocked.toLocaleString()} />
              <MiniStat label="Last Latency" value={log ? `${log.latencyMs}ms` : "—"} />
              <MiniStat label="Last Source" value={log ? log.cacheStatus : "—"} />
            </div>
          </SectionCard>
        </div>
      </div>
    </AppLayout>
  );
}

function MockPortalDisplay({ log, studentId }: { log: RequestLog; studentId: string }) {
  if (log.error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-destructive">
        <WifiOff className="h-8 w-8" />
        <p className="text-sm font-semibold">Request blocked or failed</p>
        <p className="text-xs text-muted-foreground">HTTP status: {log.status || "network error"}</p>
        <pre className="mt-2 max-h-32 w-full overflow-auto rounded-lg bg-[#0F172A] p-3 text-xs text-slate-100">
          {JSON.stringify(log.data, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Student Portal</p>
          <h3 className="mt-1 text-2xl font-bold text-foreground">Welcome, {studentId}</h3>
        </div>
        <div className="hidden rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground sm:block">
          Latency: <span className="font-medium text-foreground">{log.latencyMs}ms</span>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {[
          { t: "Response OK", v: log.status === 200 ? "Yes ✓" : `Status ${log.status}` },
          { t: "Cache Status", v: log.cacheStatus },
          { t: "Source", v: log.cacheStatus === "HIT" ? "Saved Copy" : "Live Backend" },
          { t: "Timestamp", v: new Date(log.time).toLocaleTimeString() },
        ].map((c) => (
          <div key={c.t} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{c.t}</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{c.v}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">Raw Response</p>
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[#0F172A] p-3 text-xs leading-relaxed text-slate-100">
          {JSON.stringify(log.data, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function PanelRow({
  icon: Icon, label, value, mono, accent = "default", animateKey,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
  accent?: "default" | "success" | "warning" | "danger";
  animateKey?: number;
}) {
  const tone =
    accent === "success" ? "text-[color:var(--success)]"
    : accent === "warning" ? "text-[color:var(--warning)]"
    : accent === "danger" ? "text-destructive"
    : "text-foreground";
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <motion.span
        key={animateKey}
        initial={{ opacity: 0, y: -3 }}
        animate={{ opacity: 1, y: 0 }}
        className={`truncate text-sm font-semibold ${tone} ${mono ? "font-mono text-xs" : ""}`}
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
