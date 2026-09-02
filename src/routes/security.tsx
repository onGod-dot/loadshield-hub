import { createFileRoute } from "@tanstack/react-router";
import { motion, useMotionValue, animate, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Users, ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { StatCard, SectionCard } from "@/components/ui-bits";
import { fetchMetrics, type MetricsSnapshot } from "@/lib/api";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security Center — TTU-LoadShield" },
      { name: "description", content: "See how LoadShield is protecting your portal today." },
    ],
  }),
  component: SecurityPage,
});

function SecurityPage() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState(false);
  const tickRef = useRef(0);

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
        if (!cancelled) tickRef.current = window.setTimeout(poll, 3000);
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

  // Security score: starts at 100, deducts for blocked ratio and suspicious activity
  const blockedRatio = total > 0 ? (totals?.blocked ?? 0) / total : 0;
  const suspiciousPenalty = Math.min(20, (totals?.suspicious ?? 0) * 2);
  const score = metrics ? Math.max(0, Math.round(100 - blockedRatio * 40 - suspiciousPenalty)) : 0;

  const checks = [
    {
      t: "Gateway is online",
      d: error ? "Cannot reach LoadShield gateway." : "LoadShield is running and accepting requests.",
      tone: error ? "warning" : "success",
    },
    {
      t: "Rate limiting active",
      d: metrics ? "Requests are being rate-limited per user and per IP." : "Waiting for metrics...",
      tone: metrics && !error ? "success" : "warning",
    },
    {
      t: (totals?.suspicious ?? 0) > 0 ? "Login abuse detected" : "No credential attacks",
      d:
        (totals?.suspicious ?? 0) > 0
          ? `${totals!.suspicious} suspicious login attempt${totals!.suspicious === 1 ? "" : "s"} flagged.`
          : "Login patterns look normal.",
      tone: (totals?.suspicious ?? 0) > 0 ? "warning" : "success",
    },
  ] as const;

  return (
    <AppLayout title="Security Center">
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <WifiOff className="h-4 w-4 shrink-0" />
          Cannot reach LoadShield gateway. Start it with <code className="mx-1 rounded bg-destructive/10 px-1">npm run dev</code> in the project root.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <SectionCard title="Overall Security Score" description="How well your portal is protected right now.">
          <div className="flex flex-col items-center py-4">
            <ScoreRing value={score} />
            <p
              className="mt-4 text-sm font-semibold"
              style={{ color: score >= 80 ? "var(--success)" : score >= 50 ? "var(--warning)" : "var(--destructive)" }}
            >
              {score >= 80 ? "Excellent" : score >= 50 ? "Moderate" : "Needs Attention"}
            </p>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              {error
                ? "Gateway is offline. Score cannot be calculated."
                : "LoadShield is actively defending against unusual traffic and speeding up trusted requests."}
            </p>
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label="Requests Allowed"
            value={totals?.allowed ?? 0}
            icon={<Users className="h-4 w-4" />}
            tone="primary"
            hint="Passed safely"
          />
          <StatCard
            label="Threats Blocked"
            value={totals?.blocked ?? 0}
            icon={<ShieldAlert className="h-4 w-4" />}
            tone="danger"
            hint="Blocked by gateway"
          />
          <StatCard
            label="IPs Banned"
            value={totals?.banned ?? 0}
            icon={<ShieldCheck className="h-4 w-4" />}
            tone="success"
            suffix=" banned"
          />
          <StatCard
            label="Suspicious Requests"
            value={totals?.suspicious ?? 0}
            icon={<ShieldAlert className="h-4 w-4" />}
            tone="warning"
            hint="Flagged by abuse detector"
          />
        </div>
      </div>

      <SectionCard className="mt-6" title="Today's protection at a glance" description="A summary of what LoadShield handled for you.">
        <div className="grid gap-4 md:grid-cols-3">
          {checks.map((c) => (
            <div key={c.t} className="rounded-xl border border-border bg-card p-4">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  c.tone === "success"
                    ? "bg-[color:var(--success)]/10 text-[color:var(--success)]"
                    : "bg-[color:var(--warning)]/10 text-[color:var(--warning)]"
                }`}
              >
                {c.tone === "success" ? "All good" : "Watchful"}
              </span>
              <p className="mt-2 text-sm font-semibold text-foreground">{c.t}</p>
              <p className="mt-1 text-xs text-muted-foreground">{c.d}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </AppLayout>
  );
}

function ScoreRing({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const label = useTransform(mv, (v) => Math.round(v).toString());
  const dash = useTransform(mv, (v) => 339.29 - (339.29 * v) / 100);
  const stroke = value >= 80 ? "#16A34A" : value >= 50 ? "#F59E0B" : "#DC2626";
  useEffect(() => {
    const c = animate(mv, value, { duration: 1.4, ease: "easeOut" });
    return c.stop;
  }, [mv, value]);
  return (
    <div className="relative h-48 w-48">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r="54" fill="none" stroke="#E2E8F0" strokeWidth="10" />
        <motion.circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray="339.29"
          style={{ strokeDashoffset: dash }}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <motion.p className="text-5xl font-bold tabular-nums text-foreground">{label}</motion.p>
          <p className="text-xs font-medium text-muted-foreground">out of 100</p>
        </div>
      </div>
    </div>
  );
}
