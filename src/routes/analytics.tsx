import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppLayout } from "@/components/app-layout";
import { SectionCard } from "@/components/ui-bits";
import { fetchMetrics, type MetricsSnapshot } from "@/lib/api";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — TTU-LoadShield" },
      { name: "description", content: "Understand traffic patterns, response times and cache efficiency." },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const tickRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const m = await fetchMetrics();
        setMetrics(m);
      } catch {
        // keep previous data, don't break the page
      } finally {
        if (!cancelled) tickRef.current = window.setTimeout(poll, 5000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(tickRef.current);
    };
  }, []);

  // Per-second series from the last 2 min, formatted for bar chart
  const perSecond = metrics?.perSecond ?? [];

  // Group per-second into 10-second buckets for a readable bar chart
  const buckets: { label: string; allowed: number; blocked: number }[] = [];
  for (let i = 0; i < perSecond.length; i += 10) {
    const slice = perSecond.slice(i, i + 10);
    const allowed = slice.reduce((s, p) => s + p.allowed, 0);
    const blocked = slice.reduce((s, p) => s + p.blocked, 0);
    const t = slice[0]?.t ?? 0;
    buckets.push({
      label: new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      allowed,
      blocked,
    });
  }

  // Backend inflight series for response time proxy
  const inflightSeries = (metrics?.backend?.inflightSeries ?? []).map((v, i) => ({
    m: `${i}s`,
    inflight: v,
    maxInflight: 50, // matches backend default
  }));

  const totals = metrics?.totals;
  const total = (totals?.allowed ?? 0) + (totals?.blocked ?? 0);
  const blockRatePct = total > 0 ? Math.round(((totals?.blocked ?? 0) / total) * 100) : 0;
  const allowRatePct = 100 - blockRatePct;

  return (
    <AppLayout title="Analytics">
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Traffic breakdown" description="Allowed vs blocked in 10-second buckets (last 2 min).">
          <div className="h-64">
            {buckets.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748B" }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(buckets.length / 6) - 1)} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
                  <Bar dataKey="allowed" name="Allowed" radius={[4, 4, 0, 0]} fill="#16A34A" />
                  <Bar dataKey="blocked" name="Blocked" radius={[4, 4, 0, 0]} fill="#DC2626" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Waiting for traffic data…
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Backend inflight" description="How many concurrent requests reached the backend.">
          <div className="h-64">
            {inflightSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={inflightSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="m" tick={{ fontSize: 10, fill: "#64748B" }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(inflightSeries.length / 10) - 1)} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
                  <Bar dataKey="inflight" name="Inflight" radius={[4, 4, 0, 0]}>
                    {inflightSeries.map((row, i) => (
                      <Cell
                        key={i}
                        fill={
                          row.inflight >= row.maxInflight * 0.9
                            ? "#DC2626"
                            : row.inflight >= row.maxInflight * 0.6
                              ? "#F59E0B"
                              : "#16A34A"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Waiting for backend data…
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Traffic health summary" description="Overall pass/block rate since gateway started.">
          <ul className="space-y-3">
            {[
              { name: "Requests Allowed", v: totals?.allowed ?? 0, pct: allowRatePct },
              { name: "Requests Blocked", v: totals?.blocked ?? 0, pct: blockRatePct },
              { name: "Requests Throttled", v: totals?.throttled ?? 0, pct: total > 0 ? Math.round(((totals?.throttled ?? 0) / total) * 100) : 0 },
              { name: "Suspicious / Abuse", v: totals?.suspicious ?? 0, pct: total > 0 ? Math.round(((totals?.suspicious ?? 0) / total) * 100) : 0 },
              { name: "IPs Banned", v: totals?.banned ?? 0, pct: 0 },
            ].map((e) => (
              <li key={e.name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-xs text-foreground">{e.name}</span>
                  <span className="tabular-nums text-muted-foreground">{e.v.toLocaleString()}</span>
                </div>
                {e.pct > 0 && (
                  <div className="mt-1.5 h-2 w-full rounded-full bg-accent">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${e.pct}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">Allow Rate</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{allowRatePct}%</p>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">Block Rate</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{blockRatePct}%</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Gateway configuration" description="Current settings from the running LoadShield instance.">
          {metrics ? (
            <div className="space-y-3">
              {[
                { label: "Store Type", value: metrics.store.kind },
                { label: "Cache Type", value: metrics.cache.kind },
                { label: "Cache Enabled", value: metrics.cache.enabled ? "Yes" : "No" },
                { label: "Cache TTL", value: `${metrics.cache.ttlSeconds}s` },
                { label: "Uptime", value: formatUptime(metrics.uptimeMs) },
                { label: "Inbound RPS (now)", value: `${metrics.inbound.rps}` },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                  <span className="text-sm font-semibold text-foreground">{row.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              Connecting to gateway…
            </div>
          )}
        </SectionCard>
      </div>
    </AppLayout>
  );
}

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
