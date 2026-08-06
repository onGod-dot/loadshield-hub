import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Trash2, PlayCircle, ChevronDown, Search, WifiOff, Info } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { SectionCard } from "@/components/ui-bits";
import {
  fetchThroughGateway,
  deleteCacheEntry,
  buildCacheKey,
  fetchCacheEntry,
  putCacheEntry,
  LOADSHIELD_BASE,
} from "@/lib/api";

export const Route = createFileRoute("/saved")({
  head: () => ({
    meta: [
      { title: "Saved Responses — TTU-LoadShield" },
      { name: "description", content: "Manage the responses LoadShield has saved to keep your portal fast." },
    ],
  }),
  component: SavedPage,
});

// The available API endpoints on the demo backend
const PORTAL_ENDPOINTS = [
  { label: "Data (general)", path: "/api/data" },
] as const;

type TestResult = {
  endpoint: string;
  studentId: string;
  time: number;
  source: "Cache" | "Portal" | "Error";
  status: number;
  body: unknown;
  cacheKey: string;
};

type CacheRow = {
  id: string;
  key: string;
  endpoint: string;
  student: string;
  status: "Live" | "Stale";
};

function SavedPage() {
  const [q, setQ] = useState("");
  const [cacheRows, setCacheRows] = useState<CacheRow[]>([]);

  // ── Portal Tester ────────────────────────────────────────────────────────────
  const [endpoint, setEndpoint] = useState(PORTAL_ENDPOINTS[0].path);
  const [student, setStudent] = useState("STU-100118");
  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function runTest() {
    setLoading(true);
    setResult(null);
    try {
      const { data, cacheStatus, latencyMs, status } = await fetchThroughGateway(endpoint, student);
      const source = cacheStatus === "HIT" ? "Cache" : cacheStatus === "MISS" ? "Portal" : "Portal";
      const key = buildCacheKey(endpoint, student);
      const newResult: TestResult = {
        endpoint,
        studentId: student,
        time: latencyMs,
        source,
        status,
        body: data,
        cacheKey: key,
      };
      setResult(newResult);
      toast.success(`Retrieved from ${source}`, {
        description: `${latencyMs}ms · ${status === 200 ? "Success" : `Status ${status}`}`,
      });

      // After a real request, check if the key is now in cache
      if (cacheStatus === "MISS" || cacheStatus === "HIT") {
        const row: CacheRow = {
          id: key,
          key,
          endpoint,
          student,
          status: "Live",
        };
        setCacheRows((prev) => {
          const exists = prev.find((r) => r.key === key);
          if (exists) return prev;
          return [row, ...prev];
        });
      }
    } catch {
      setResult({ endpoint, studentId: student, time: 0, source: "Error", status: 0, body: null, cacheKey: "" });
      toast.error("Request failed — is the gateway running?");
    } finally {
      setLoading(false);
    }
  }

  async function removeRow(key: string) {
    try {
      await deleteCacheEntry(key);
      setCacheRows((prev) => prev.filter((r) => r.key !== key));
      toast("Cache entry removed");
    } catch {
      // Gateway may not have the key — remove from UI anyway
      setCacheRows((prev) => prev.filter((r) => r.key !== key));
      toast("Entry removed from view");
    }
  }

  async function refreshRow(row: CacheRow) {
    try {
      // Re-fetch through the gateway to refresh the cache
      await fetchThroughGateway(row.endpoint, row.student);
      toast.success("Response refreshed", { description: `${row.endpoint} — ${row.student}` });
      setCacheRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, status: "Live" } : r)));
    } catch {
      toast.error("Refresh failed");
    }
  }

  async function clearAll() {
    for (const row of cacheRows) {
      try {
        await deleteCacheEntry(row.key);
      } catch {
        // best-effort
      }
    }
    setCacheRows([]);
    toast.success("All saved responses removed");
  }

  const filtered = cacheRows.filter(
    (r) => r.endpoint.toLowerCase().includes(q.toLowerCase()) || r.student.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <AppLayout title="Saved Responses">
      {/* Info banner explaining the cache */}
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="font-medium">How this works</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Use the tester below to send a real request through LoadShield. The first time (
            <span className="font-mono text-xs">MISS</span>) fetches from the backend and saves the response.
            Every request after that (
            <span className="font-mono text-xs">HIT</span>) comes from the saved copy — even if the portal is down.
            Cache entries you test appear in the table above so you can inspect or clear them.
          </p>
        </div>
      </div>

      <SectionCard
        title="Cached keys observed this session"
        description="Entries your test requests have written to the cache."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search endpoint or student"
                className="w-48 rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {cacheRows.length > 0 && (
              <button
                onClick={clearAll}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear all
              </button>
            )}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <Th>Endpoint</Th>
                <Th>Student ID</Th>
                <Th>Cache Key</Th>
                <Th>Status</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-border/60 last:border-0 hover:bg-accent/40"
                >
                  <Td className="font-mono text-xs text-foreground">{r.endpoint}</Td>
                  <Td className="text-muted-foreground">{r.student}</Td>
                  <Td>
                    <span className="max-w-[200px] truncate font-mono text-[10px] text-muted-foreground block" title={r.key}>
                      {r.key}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        r.status === "Live"
                          ? "bg-[color:var(--success)]/10 text-[color:var(--success)]"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {r.status}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        aria-label="Refresh"
                        onClick={() => refreshRow(r)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <button
                        aria-label="Remove"
                        onClick={() => removeRow(r.key)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                </motion.tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-sm text-muted-foreground">
                    {cacheRows.length === 0
                      ? "No cache entries yet. Run a test below to create one."
                      : "No results match your search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard className="mt-6" title="Test your portal" description="Send a real request through LoadShield and see the cache in action.">
        <PortalTester
          endpoint={endpoint}
          student={student}
          result={result}
          loading={loading}
          onEndpointChange={setEndpoint}
          onStudentChange={setStudent}
          onRun={runTest}
        />
      </SectionCard>
    </AppLayout>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-3 font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-3 align-middle ${className}`}>{children}</td>;
}

function PortalTester({
  endpoint,
  student,
  result,
  loading,
  onEndpointChange,
  onStudentChange,
  onRun,
}: {
  endpoint: string;
  student: string;
  result: TestResult | null;
  loading: boolean;
  onEndpointChange: (v: string) => void;
  onStudentChange: (v: string) => void;
  onRun: () => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Endpoint</label>
          <div className="relative mt-2">
            <select
              value={endpoint}
              onChange={(e) => onEndpointChange(e.target.value)}
              className="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {PORTAL_ENDPOINTS.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.label} ({p.path})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Student ID</label>
          <input
            value={student}
            onChange={(e) => onStudentChange(e.target.value)}
            placeholder="STU-100118"
            className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Gateway: <code className="rounded bg-accent px-1">{LOADSHIELD_BASE}</code>
        </p>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onRun}
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <PlayCircle className="h-4 w-4" /> {loading ? "Running..." : "Send Request"}
        </motion.button>
      </div>
      <div className="min-h-[240px] rounded-xl border border-border bg-background p-4">
        {!result && !loading && (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Send a request to see the result here.
          </div>
        )}
        {loading && (
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-accent" />
            <div className="h-24 w-full animate-pulse rounded bg-accent" />
          </div>
        )}
        {result && result.source !== "Error" && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-[color:var(--success)]">Success!</p>
                <p className="text-sm font-semibold text-foreground">
                  {result.time}ms · Retrieved from {result.source}
                </p>
                <p className="text-xs text-muted-foreground">HTTP {result.status}</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  result.source === "Cache"
                    ? "bg-primary/10 text-primary"
                    : "bg-[color:var(--warning)]/10 text-[color:var(--warning)]"
                }`}
              >
                {result.source === "Cache" ? "⚡ Saved (fast!)" : "🌐 Live Portal"}
              </span>
            </div>
            <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-[#0F172A] p-4 text-xs leading-relaxed text-slate-100">
              {JSON.stringify(result.body, null, 2)}
            </pre>
          </motion.div>
        )}
        {result && result.source === "Error" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-destructive">
            <WifiOff className="h-8 w-8" />
            <p className="text-sm font-semibold">Request failed</p>
            <p className="text-xs text-muted-foreground">Make sure LoadShield is running on port 4000.</p>
          </div>
        )}
      </div>
    </div>
  );
}
