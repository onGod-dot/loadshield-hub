import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Check, ChevronRight, Shield, ShieldCheck, ShieldAlert, ArrowRight, Link as LinkIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { fetchHealth, LOADSHIELD_BASE } from "@/lib/api";
import { savePortalUrl, saveGatewayConfig } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/connect")({
  head: () => ({
    meta: [
      { title: "Connect Portal — TTU-LoadShield" },
      { name: "description", content: "Guided setup to protect and accelerate your student portal." },
    ],
  }),
  component: ConnectPage,
});

const LEVELS = [
  {
    id: "light",
    title: "Light",
    icon: Shield,
    tagline: "Gentle protection with high performance",
    desc: "Best for internal portals with mostly trusted traffic. Fast caching, light filtering.",
  },
  {
    id: "recommended",
    title: "Recommended",
    icon: ShieldCheck,
    tagline: "Balanced for most universities",
    desc: "Strong protection, smart caching, and automatic tuning during busy periods.",
    badge: "Most schools pick this",
  },
  {
    id: "maximum",
    title: "Maximum",
    icon: ShieldAlert,
    tagline: "Toughest defense during exam season",
    desc: "Aggressive filtering, strict rate limits, and deep caching for peak traffic days.",
  },
] as const;

function ConnectPage() {
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState(localStorage.getItem("loadshield_portal_url") ?? "");
  const [level, setLevel] = useState<string>(localStorage.getItem("loadshield_protection_level") ?? "recommended");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gatewayOk, setGatewayOk] = useState<boolean | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  function validate() {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
      setUrlError(null);
      return true;
    } catch {
      setUrlError("Please enter a valid URL starting with https://");
      return false;
    }
  }

  async function checkGateway() {
    setChecking(true);
    setGatewayOk(null);
    try {
      await fetchHealth();
      setGatewayOk(true);
    } catch {
      setGatewayOk(false);
    } finally {
      setChecking(false);
    }
  }

  return (
    <AppLayout title="Connect Portal">
      <div className="mx-auto max-w-3xl">
        <Stepper step={step} />
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div key="s1" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
                <h2 className="text-xl font-bold text-foreground">Where does your portal live?</h2>
                <p className="mt-1 text-sm text-muted-foreground">Enter the address your students use to reach the portal.</p>
                <div className="mt-6">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Portal URL</label>
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                    <LinkIcon className="h-4 w-4 text-muted-foreground" />
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://portal.school.edu/api"
                      className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  {urlError && <p className="mt-2 text-xs text-destructive">{urlError}</p>}
                </div>
                <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Your LoadShield gateway</span> is running at{" "}
                  <code className="rounded bg-accent px-1">{LOADSHIELD_BASE}</code>. It will forward requests from your
                  students to the portal URL you enter here.
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={checkGateway}
                    disabled={checking}
                    className="inline-flex items-center gap-2 rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60"
                  >
                    {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {checking ? "Checking…" : "Check Gateway"}
                  </button>
                  {gatewayOk === true && <span className="text-xs font-medium text-[color:var(--success)]">✓ Gateway reachable</span>}
                  {gatewayOk === false && <span className="text-xs font-medium text-destructive">✗ Gateway unreachable — start it with npm run dev</span>}
                </div>
                <div className="mt-8 flex justify-end">
                  <PrimaryButton
                    onClick={() => {
                      if (validate()) setStep(1);
                    }}
                  >
                    Continue <ArrowRight className="h-4 w-4" />
                  </PrimaryButton>
                </div>
              </motion.div>
            )}
            {step === 1 && (
              <motion.div key="s2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
                <h2 className="text-xl font-bold text-foreground">Choose a protection level</h2>
                <p className="mt-1 text-sm text-muted-foreground">You can change this any time from Settings.</p>
                <div className="mt-6 grid gap-3">
                  {LEVELS.map((l) => {
                    const Icon = l.icon;
                    const active = level === l.id;
                    return (
                      <button
                        key={l.id}
                        onClick={() => setLevel(l.id)}
                        className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 rounded-xl border p-4 text-left transition-all ${
                          active
                            ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                            : "border-border bg-background hover:border-primary/40"
                        }`}
                      >
                        <span className={`grid h-10 w-10 place-items-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-accent text-foreground"}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{l.title}</p>
                            {"badge" in l && l.badge && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                {l.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-medium text-muted-foreground">{l.tagline}</p>
                          <p className="mt-1 text-sm text-foreground">{l.desc}</p>
                        </div>
                        <span
                          className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                            active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                          }`}
                        >
                          {active && <Check className="h-3 w-3" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-8 flex items-center justify-between">
                  <GhostButton onClick={() => setStep(0)}>Back</GhostButton>
                  <PrimaryButton onClick={() => setStep(2)}>
                    Continue <ArrowRight className="h-4 w-4" />
                  </PrimaryButton>
                </div>
              </motion.div>
            )}
            {step === 2 && (
              <motion.div key="s3" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
                <div className="text-center">
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 220, damping: 18 }}
                    className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[color:var(--success)]/10"
                  >
                    <Check className="h-8 w-8 text-[color:var(--success)]" />
                  </motion.div>
                  <h2 className="mt-4 text-2xl font-bold text-foreground">Everything looks great</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Your portal is ready to be protected by LoadShield.</p>
                </div>
                <ul className="mx-auto mt-6 grid max-w-md gap-2">
                  {["Portal Connected", "Protection Ready", "Cache Enabled", "Everything Ready"].map((t) => (
                    <li key={t} className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-[color:var(--success)]/10 text-[color:var(--success)]">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-sm font-medium text-foreground">{t}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8 flex justify-center">
                  <PrimaryButton
                    size="lg"
                    onClick={async () => {
                      setSaving(true);
                      try {
                        // Save portal URL + protection level to Supabase
                        if (user?.id) {
                          await saveGatewayConfig(user.id, {
                            portal_url: url,
                            protection_level: level as "light" | "recommended" | "maximum",
                          });
                        }
                        // Also save locally for instant access
                        localStorage.setItem("loadshield_portal_url", url);
                        localStorage.setItem("loadshield_protection_level", level);

                        toast.success("Portal Connected Successfully", {
                          description: `LoadShield at ${LOADSHIELD_BASE} is now protecting ${url}`,
                        });
                        navigate({ to: "/dashboard" });
                      } catch (err: any) {
                        toast.error("Saved locally — Supabase save failed: " + (err?.message ?? "unknown error"));
                        localStorage.setItem("loadshield_portal_url", url);
                        localStorage.setItem("loadshield_protection_level", level);
                        navigate({ to: "/dashboard" });
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    {saving ? <><span className="animate-spin">⟳</span> Saving…</> : <>Start Protecting <ArrowRight className="h-4 w-4" /></>}
                  </PrimaryButton>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </AppLayout>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = ["Portal URL", "Protection", "Confirm"];
  return (
    <ol className="grid grid-cols-3 gap-2">
      {steps.map((s, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                done
                  ? "bg-[color:var(--success)] text-white"
                  : active
                    ? "bg-primary text-primary-foreground"
                    : "bg-accent text-muted-foreground"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={`truncate text-xs font-medium ${active || done ? "text-foreground" : "text-muted-foreground"}`}>
              {s}
            </span>
            {i < steps.length - 1 && <ChevronRight className="ml-auto hidden h-4 w-4 text-muted-foreground sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}

function PrimaryButton({ children, onClick, size = "md" }: { children: React.ReactNode; onClick?: () => void; size?: "md" | "lg" }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 ${
        size === "lg" ? "px-6 py-3 text-base" : "px-4 py-2 text-sm"
      }`}
    >
      {children}
    </motion.button>
  );
}
function GhostButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
      {children}
    </button>
  );
}
