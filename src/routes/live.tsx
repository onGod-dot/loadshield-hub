import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Activity, ShieldCheck, Ban, Timer, Database, WifiOff } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { StatCard, SectionCard } from "@/components/ui-bits";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { fetchMetrics, type MetricsSnapshot } from "@/lib/api";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Live Traffic — TTU-LoadShield" },
      { name: "description", content: "Real-time view of requests flowing through your portal." },
    ],
  }),
  component: LivePage,
});

function LivePage() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [series, setSeries] = useState<{ t: number; v: number }[]>([]);
  const tickRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const m = await fetchMetrics();
        setError(false);
        setMetrics(m);
        // Build rolling chart series from per-second data
        const pts = (m.perSecond ?? []).slice(-30).map((p, i) => ({
          t: i,
          v: p.allowed + p.blocked,
        }));
        setSeries(pts);
      } catch {
        setError(true);
      } finally {
        if (!cancelled) {
          tickRef.current = window.setTimeout(poll, 1000);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(tickRef.current);
    };
  }, []);

  const rps = metrics?.inbound?.rps ?? 0;
  const totals = metrics?.totals;
  const inflight = metrics?.backend?.inflightSeries ?? [];
  const currentInflight = inflight[inflight.length - 1] ?? 0;

  const pct = Math.min(100, (rps / 600) * 100);
  const angle = -90 + (pct / 100) * 180;

  return (
    <AppLayout title="Live Traffic">
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <WifiOff className="h-4 w-4 shrink-0" />
          Cannot reach LoadShield gateway. Make sure it is running on port 4000.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <SectionCard title="Live requests" description="Requests per second flowing through LoadShield.">
          <div className="flex flex-col items-center">
            <div className="relative h-52 w-full max-w-sm">
              <svg viewBox="0 0 200 120" className="h-full w-full">
                <defs>
                  <linearGradient id="gauge" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#16A34A" />
                    <stop offset="60%" stopColor="#F59E0B" />
                    <stop offset="100%" stopColor="#DC2626" />
                  </linearGradient>
                </defs>
                <path d="M20 110 A 80 80 0 0 1 180 110" fill="none" stroke="#E2E8F0" strokeWidth="14" strokeLinecap="round" />
                <path
                  d="M20 110 A 80 80 0 0 1 180 110"
                  fill="none"
                  stroke="url(#gauge)"
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeDasharray="251.2"
                  strokeDashoffset={251.2 - (251.2 * pct) / 100}
                  style={{ transition: "stroke-dashoffset 0.8s ease" }}
                />
                <motion.line
                  x1="100"
                  y1="110"
                  x2="100"
                  y2="45"
                  stroke="#0F172A"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  style={{ transformOrigin: "100px 110px" }}
                  animate={{ rotate: angle }}
                  transition={{ type: "spring", stiffness: 60, damping: 14 }}
                />
                <circle cx="100" cy="110" r="6" fill="#0F172A" />
              </svg>
              <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center">
                <p className="text-4xl font-bold tabular-nums text-foreground">{rps}</p>
                <p className="text-xs font-medium text-muted-foreground">requests / second</p>
              </div>
            </div>

            {series.length > 0 && (
              <div className="mt-6 h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series}>
                    <defs>
                      <linearGradient id="live" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="v" stroke="#2563EB" strokeWidth={2} fill="url(#live)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label="Requests Allowed"
            value={totals?.allowed ?? 0}
            icon={<ShieldCheck className="h-4 w-4" />}
            tone="success"
          />
          <StatCard
            label="Requests Blocked"
            value={totals?.blocked ?? 0}
            icon={<Ban className="h-4 w-4" />}
            tone="danger"
          />
          <StatCard
            label="Requests Slowed"
            value={totals?.throttled ?? 0}
            icon={<Timer className="h-4 w-4" />}
            tone="warning"
          />
          <StatCard
            label="Backend Inflight Now"
            value={currentInflight}
            icon={<Database className="h-4 w-4" />}
            tone="primary"
          />
        </div>
      </div>

      {series.length > 0 && (
        <SectionCard className="mt-6" title="Traffic pulse" description="A rolling look at how requests are flowing.">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="t" hide />
                <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
                <Area type="monotone" dataKey="v" stroke="#2563EB" strokeWidth={2} fill="url(#live)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      )}

      {/* Suspicious activity */}
      {(totals?.suspicious ?? 0) > 0 && (
        <SectionCard className="mt-6" title="Suspicious Activity" description="Requests flagged by the abuse detector.">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-destructive/10">
              <Activity className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold text-destructive">{totals?.suspicious}</p>
              <p className="text-xs text-muted-foreground">login abuse attempts detected</p>
            </div>
            <div className="ml-auto rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {totals?.banned ?? 0} IPs currently banned
            </div>
          </div>
        </SectionCard>
      )}
    </AppLayout>
  );
}
