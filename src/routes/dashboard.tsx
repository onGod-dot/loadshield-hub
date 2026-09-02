import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Users,
  ShieldAlert,
  Zap,
  Activity as ActivityIcon,
  CheckCircle2,
  Ban,
  TrendingUp,
  Database,
  ArrowUpRight,
  WifiOff,
  AlertTriangle,
  Link,
} from "lucide-react";
import { ChatBubble } from "@/components/chat-bubble";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppLayout } from "@/components/app-layout";
import { StatCard, SectionCard } from "@/components/ui-bits";
import { useEffect, useRef, useState } from "react";
import { fetchMetrics, type MetricsSnapshot } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { loadGatewayConfig, getLocalPortalUrl } from "@/lib/supabase";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — TTU-LoadShield" },
      { name: "description", content: "Live overview of portal protection, cache activity and traffic health." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string>(getLocalPortalUrl());
  const tickRef = useRef(0);
  const { user } = useAuth();

  // Load portal URL from Supabase on mount
  useEffect(() => {
    if (!user?.id) return;
    loadGatewayConfig(user.id).then((cfg) => {
      if (cfg?.portal_url) {
        setPortalUrl(cfg.portal_url);
        localStorage.setItem("loadshield_portal_url", cfg.portal_url);
      }
    });
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const m = await fetchMetrics();
        setError(false);
        setMetrics(m);
      } catch {
        setError(true);
      } finally {
        if (!cancelled) tickRef.current = window.setTimeout(poll, 2000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(tickRef.current);
    };
  }, []);

  const totals = metrics?.totals;
  const total = (totals?.allowed ?? 0) + (totals?.blocked ?? 0);
  const cacheKind = metrics?.cache?.kind ?? "memory";
  const storeKind = metrics?.store?.kind ?? "memory";

  // Build chart data from per-second series
  const chartData = (metrics?.perSecond ?? []).map((p) => ({
    hour: new Date(p.t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    allowed: p.allowed,
    blocked: p.blocked,
    slowed: 0, // throttled doesn't have per-second breakdown, comes from totals
  }));

  // Calculate cache-hit efficiency (backend saved = total - backend contacted)
  const backendInflight = metrics?.backend?.inflightSeries ?? [];
  const avgInflight =
    backendInflight.length > 0
      ? Math.round(backendInflight.reduce((a, b) => a + b, 0) / backendInflight.length)
      : 0;

  // Status: determine health from ratio
  const blockedRatio = total > 0 ? (totals?.blocked ?? 0) / total : 0;
  const status =
    error ? "offline" : blockedRatio > 0.4 ? "warning" : "healthy";

  const statusConfig = {
    healthy: {
      icon: ShieldCheck,
      color: "var(--success)",
      label: "Protected",
      headline: "Everything is running normally",
      sub: "Your student portal is safe, fast, and healthy.",
    },
    warning: {
      icon: AlertTriangle,
      color: "var(--warning)",
      label: "Under Pressure",
      headline: "Heavy traffic detected",
      sub: "LoadShield is actively blocking and slowing suspicious requests.",
    },
    offline: {
      icon: WifiOff,
      color: "var(--destructive)",
      label: "Offline",
      headline: "Cannot reach gateway",
      sub: "Make sure LoadShield is running on port 4000.",
    },
  }[status];

  const StatusIcon = statusConfig.icon;

  // Recent activity derived from real data
  const recentActivity = [
    totals && totals.banned > 0 && {
      icon: Ban,
      tone: "danger" as const,
      time: "recently",
      title: "IPs Banned",
      desc: `${totals.banned} IP address${totals.banned === 1 ? "" : "es"} temporarily banned for abuse.`,
    },
    totals && totals.suspicious > 0 && {
      icon: ActivityIcon,
      tone: "warning" as const,
      time: "today",
      title: "Suspicious Requests Detected",
      desc: `${totals.suspicious} suspicious login attempt${totals.suspicious === 1 ? "" : "s"} flagged.`,
    },
    totals && totals.throttled > 0 && {
      icon: Zap,
      tone: "warning" as const,
      time: "today",
      title: "Traffic Throttled",
      desc: `${totals.throttled.toLocaleString()} request${totals.throttled === 1 ? "" : "s"} slowed during peak load.`,
    },
    totals && totals.allowed > 0 && {
      icon: ShieldCheck,
      tone: "success" as const,
      time: "ongoing",
      title: "Portal Requests Served",
      desc: `${totals.allowed.toLocaleString()} request${totals.allowed === 1 ? "" : "s"} passed through safely.`,
    },
    metrics && {
      icon: Database,
      tone: "primary" as const,
      time: "now",
      title: `Cache Active (${cacheKind})`,
      desc: `${metrics.cache.enabled ? "Read-through cache is enabled" : "Cache is disabled"}. TTL: ${metrics.cache.ttlSeconds}s.`,
    },
  ].filter(Boolean) as Array<{
    icon: typeof Ban;
    tone: "danger" | "warning" | "success" | "primary";
    time: string;
    title: string;
    desc: string;
  }>;

  return (
    <AppLayout title="Dashboard">
      <div className="space-y-6">
        {/* Status banner */}
          <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        >
          <div className="grid gap-6 p-6 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
            <div
              className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl"
              style={{ background: `color-mix(in srgb, ${statusConfig.color} 15%, transparent)` }}
            >
              <StatusIcon className="h-8 w-8" style={{ color: statusConfig.color }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  {status === "healthy" && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--success)] opacity-60" />
                  )}
                  <span
                    className="relative inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ background: statusConfig.color }}
                  />
                </span>
                <span className="text-sm font-semibold" style={{ color: statusConfig.color }}>
                  {statusConfig.label}
                </span>
              </div>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                {statusConfig.headline}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{statusConfig.sub}</p>
              {portalUrl && (
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <Link className="h-3.5 w-3.5" />
                  {portalUrl}
                </a>
              )}
              {!portalUrl && (
                <a href="/connect" className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary">
                  <Link className="h-3.5 w-3.5" />
                  No portal connected — click to set one up
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Backend", value: error ? "Unknown" : "Healthy" },
                { label: "Cache", value: error ? "Unknown" : metrics?.cache.enabled ? "Active" : "Off" },
                { label: "Store", value: storeKind },
                {
                  label: "Uptime",
                  value: metrics
                    ? formatUptime(metrics.uptimeMs)
                    : "—",
                },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-background px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total Requests"
            value={total}
            hint="Since gateway started"
            icon={<Users className="h-4 w-4" />}
            tone="primary"
          />
          <StatCard
            label="Requests Allowed"
            value={totals?.allowed ?? 0}
            hint="Passed through safely"
            icon={<ShieldCheck className="h-4 w-4" />}
            tone="success"
          />
          <StatCard
            label="Requests Blocked"
            value={totals?.blocked ?? 0}
            hint="Suspicious traffic stopped"
            icon={<ShieldAlert className="h-4 w-4" />}
            tone="danger"
          />
          <StatCard
            label="Avg Backend Inflight"
            value={avgInflight}
            suffix=" req"
            hint="Concurrent backend requests"
            icon={<Zap className="h-4 w-4" />}
            tone="warning"
          />
        </div>

        {/* Chart + activity */}
        <div className="grid gap-6 xl:grid-cols-3">
          <SectionCard
            title="Traffic (last 2 min)"
            description="Requests allowed and blocked per second."
            className="xl:col-span-2"
            action={
              <div className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex">
                <LegendDot color="var(--success)" label="Allowed" />
                <LegendDot color="var(--destructive)" label="Blocked" />
              </div>
            }
          >
            {chartData.length > 0 ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gAllowed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#16A34A" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#16A34A" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gBlocked" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#DC2626" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#DC2626" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(chartData.length / 10))} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} labelStyle={{ color: "#0F172A", fontWeight: 600 }} />
                    <Area type="monotone" dataKey="allowed" stroke="#16A34A" strokeWidth={2} fill="url(#gAllowed)" />
                    <Area type="monotone" dataKey="blocked" stroke="#DC2626" strokeWidth={2} fill="url(#gBlocked)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                {error ? "Gateway unreachable — start it with npm run dev" : "Waiting for traffic data…"}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Recent activity" description="Live events from your portal.">
            {recentActivity.length > 0 ? (
              <ul className="space-y-4">
                {recentActivity.slice(0, 5).map((a, i) => {
                  const Icon = a.icon;
                  const toneClass =
                    a.tone === "success"
                      ? "bg-[color:var(--success)]/10 text-[color:var(--success)]"
                      : a.tone === "danger"
                        ? "bg-destructive/10 text-destructive"
                        : a.tone === "warning"
                          ? "bg-[color:var(--warning)]/10 text-[color:var(--warning)]"
                          : "bg-primary/10 text-primary";
                  return (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: 6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i }}
                      className="flex items-start gap-3"
                    >
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneClass}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{a.time}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{a.desc}</p>
                      </div>
                    </motion.li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                No activity yet. Send some requests to the gateway.
              </div>
            )}
          </SectionCard>
        </div>

        {/* Impact strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ImpactCard icon={TrendingUp} label="Requests Throttled" value={(totals?.throttled ?? 0).toLocaleString()} hint="Slowed instead of dropped" />
          <ImpactCard icon={Database} label="Cache TTL" value={`${metrics?.cache.ttlSeconds ?? 0}s`} hint={`Store: ${cacheKind}`} />
          <ImpactCard icon={CheckCircle2} label="Banned IPs" value={(totals?.banned ?? 0).toLocaleString()} hint="Currently blocked" />
        </div>
        {/* Fixed-position AI chat bubble — only on dashboard */}
        <ChatBubble />
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

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function ImpactCard({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: string; hint: string }) {
  return (
    <motion.div whileHover={{ y: -2 }} className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-4 flex items-center gap-1 text-xs font-medium text-[color:var(--success)]">
        <ArrowUpRight className="h-3.5 w-3.5" />
        Live data
      </div>
    </motion.div>
  );
}
