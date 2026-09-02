import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  User, Mail, Lock, Save, Shield, Zap, Bell, Trash2,
  Eye, EyeOff, LogOut, AlertTriangle, CheckCircle,
  Database, RefreshCw, ChevronRight, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { SectionCard } from "@/components/ui-bits";
import { useAuth } from "@/lib/auth";
import {
  supabase,
  loadGatewayConfig,
  saveGatewayConfig,
  type GatewayConfig,
} from "@/lib/supabase";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — TTU-LoadShield" },
      { name: "description", content: "Manage your profile, gateway configuration and account." },
    ],
  }),
  component: SettingsPage,
});

// ── Reusable primitives ───────────────────────────────────────────────────────

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-primary" : "bg-accent"}`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${checked ? "left-[calc(100%-1.375rem)]" : "left-0.5"}`}
      />
    </button>
  );
}

function NumberInput({
  value, onChange, min, max, suffix,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(Number(e.target.value))}
        className="w-24 rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function ProtectionBadge({ level }: { level: "light" | "recommended" | "maximum" }) {
  const map = {
    light:       { label: "Light",       color: "bg-[color:var(--success)]/10 text-[color:var(--success)]" },
    recommended: { label: "Recommended", color: "bg-primary/10 text-primary" },
    maximum:     { label: "Maximum",     color: "bg-destructive/10 text-destructive" },
  };
  const { label, color } = map[level];
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{label}</span>;
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SettingsPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  // ── Profile state ─────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState(user?.name ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Change password
  const [currentPw, setCurrentPw]   = useState("");
  const [newPw, setNewPw]           = useState("");
  const [confirmPw, setConfirmPw]   = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw]         = useState(false);
  const [savingPw, setSavingPw]           = useState(false);

  // ── Gateway config state ──────────────────────────────────────────────────
  const [config, setConfig] = useState<GatewayConfig>({
    portal_url: "",
    protection_level: "recommended",
    rate_limit_per_min: 100,
    cache_ttl_seconds: 8,
    cache_enabled: true,
  });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // ── Danger zone state ─────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deletingData, setDeletingData]   = useState(false);

  // Load gateway config on mount
  useEffect(() => {
    if (!user?.id) return;
    setDisplayName(user.name ?? "");
    loadGatewayConfig(user.id).then(cfg => {
      if (cfg) setConfig(cfg);
      setConfigLoaded(true);
    });
  }, [user?.id, user?.name]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSaveProfile() {
    if (!user?.id) return;
    setSavingProfile(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: displayName },
      });
      if (error) throw error;
      toast.success("Profile updated");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    if (!newPw || !confirmPw) { toast.error("Please fill in all password fields"); return; }
    if (newPw !== confirmPw)  { toast.error("New passwords do not match"); return; }
    if (newPw.length < 8)     { toast.error("Password must be at least 8 characters"); return; }
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      toast.success("Password changed successfully");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to change password");
    } finally {
      setSavingPw(false);
    }
  }

  async function handleSaveConfig() {
    if (!user?.id) return;
    setSavingConfig(true);
    try {
      await saveGatewayConfig(user.id, config);
      toast.success("Gateway settings saved");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save settings");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleDeleteData() {
    if (!user?.id) return;
    if (confirmDelete !== "DELETE") { toast.error('Type DELETE to confirm'); return; }
    setDeletingData(true);
    try {
      await Promise.all([
        supabase.from("portal_snapshots").delete().eq("user_id", user.id),
        supabase.from("portal_changes").delete().eq("user_id", user.id),
      ]);
      toast.success("All portal history deleted");
      setConfirmDelete("");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete data");
    } finally {
      setDeletingData(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/signin" });
  }

  const cfg = (patch: Partial<GatewayConfig>) => setConfig(c => ({ ...c, ...patch }));

  return (
    <AppLayout title="Settings">
      <div className="mx-auto max-w-2xl space-y-6">

        {/* ── Profile ── */}
        <SectionCard
          title="Profile"
          description="Your name and email shown across LoadShield."
        >
          {/* Avatar + identity */}
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-lg font-extrabold text-primary-foreground select-none">
              {(displayName || user?.name || "U").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{user?.name || "—"}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          {/* Display name */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Display name
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {savingProfile ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </button>
            </div>
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Email address
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                value={user?.email ?? ""}
                readOnly
                className="w-full rounded-lg border border-input bg-muted/40 py-2 pl-9 pr-3 text-sm text-muted-foreground cursor-not-allowed"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Email cannot be changed here.</p>
          </div>
        </SectionCard>

        {/* ── Change Password ── */}
        <SectionCard
          title="Change Password"
          description="Choose a strong password of at least 8 characters."
        >
          <div className="space-y-3">
            {[
              { label: "New password",     value: newPw,     set: setNewPw,     show: showNewPw,     setShow: setShowNewPw },
              { label: "Confirm password", value: confirmPw, set: setConfirmPw, show: showNewPw,     setShow: setShowNewPw },
            ].map(({ label, value, set, show, setShow }) => (
              <div key={label}>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={show ? "text" : "password"}
                    value={value}
                    onChange={e => set(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Password strength indicator */}
          {newPw.length > 0 && (
            <div className="mt-3">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map(i => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      newPw.length >= i * 3
                        ? newPw.length >= 12 ? "bg-[color:var(--success)]"
                          : newPw.length >= 8 ? "bg-primary"
                          : "bg-[color:var(--warning)]"
                        : "bg-muted"
                    }`}
                  />
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {newPw.length < 8 ? "Too short" : newPw.length < 12 ? "Good" : "Strong"}
              </p>
            </div>
          )}

          <button
            onClick={handleChangePassword}
            disabled={savingPw || !newPw || !confirmPw}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {savingPw ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
            Update password
          </button>
        </SectionCard>

        {/* ── Gateway Configuration ── */}
        <SectionCard
          title="Gateway Configuration"
          description="Controls how LoadShield protects and caches your portal traffic."
        >
          {!configLoaded ? (
            <div className="flex h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {/* Protection level */}
              <SettingRow label="Protection level" hint="Light is permissive, Maximum is strict about traffic anomalies.">
                <div className="flex gap-2">
                  {(["light", "recommended", "maximum"] as const).map(lvl => (
                    <button
                      key={lvl}
                      onClick={() => cfg({ protection_level: lvl })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors border ${
                        config.protection_level === lvl
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </SettingRow>

              {/* Rate limit */}
              <SettingRow label="Rate limit" hint="Maximum requests per minute per user before throttling kicks in.">
                <NumberInput
                  value={config.rate_limit_per_min}
                  onChange={v => cfg({ rate_limit_per_min: v })}
                  min={10} max={10000}
                  suffix="req / min"
                />
              </SettingRow>

              {/* Cache */}
              <SettingRow label="Response caching" hint="Cache API responses so repeated requests are served instantly.">
                <Toggle
                  checked={config.cache_enabled}
                  onChange={v => cfg({ cache_enabled: v })}
                />
              </SettingRow>

              <SettingRow label="Cache TTL" hint="How long cached responses stay fresh before being re-fetched.">
                <NumberInput
                  value={config.cache_ttl_seconds}
                  onChange={v => cfg({ cache_ttl_seconds: v })}
                  min={1} max={3600}
                  suffix="seconds"
                />
              </SettingRow>

              {/* Current config summary */}
              <div className="mt-4 flex flex-wrap gap-2 rounded-xl border border-border bg-accent/30 px-4 py-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Shield className="h-3.5 w-3.5" />
                  <ProtectionBadge level={config.protection_level} />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" />
                  <span>{config.rate_limit_per_min} req/min</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Database className="h-3.5 w-3.5" />
                  <span>Cache {config.cache_enabled ? `on · ${config.cache_ttl_seconds}s TTL` : "off"}</span>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {savingConfig ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save configuration
                </button>
              </div>
            </>
          )}
        </SectionCard>

        {/* ── Notifications ── */}
        <SectionCard
          title="Notifications"
          description="Choose what LoadShield alerts you about."
        >
          <SettingRow label="Content change alerts" hint="Get notified when your results or fees page changes.">
            <Toggle checked={true} onChange={() => toast("Notification preferences coming soon")} />
          </SettingRow>
          <SettingRow label="Gateway offline alerts" hint="Alert when LoadShield can't reach the backend.">
            <Toggle checked={true} onChange={() => toast("Notification preferences coming soon")} />
          </SettingRow>
          <SettingRow label="Weekly summary" hint="A weekly digest of your portal activity.">
            <Toggle checked={false} onChange={() => toast("Notification preferences coming soon")} />
          </SettingRow>
        </SectionCard>

        {/* ── Account ── */}
        <SectionCard title="Account">
          {/* Sign out */}
          <SettingRow label="Sign out" hint="End your current session on this device.">
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </SettingRow>
        </SectionCard>

        {/* ── Danger Zone ── */}
        <div className="rounded-xl border border-destructive/40 bg-destructive/5">
          <div className="border-b border-destructive/20 px-5 py-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <p className="text-sm font-semibold text-destructive">Danger Zone</p>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These actions are permanent and cannot be undone.
            </p>
          </div>

          <div className="px-5 py-4">
            <p className="text-sm font-medium text-foreground">Delete portal history</p>
            <p className="mt-0.5 text-xs text-muted-foreground mb-4">
              Permanently deletes all saved snapshots and change records from your account. Your account itself is not affected.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={confirmDelete}
                onChange={e => setConfirmDelete(e.target.value)}
                placeholder='Type DELETE to confirm'
                className="flex-1 rounded-lg border border-destructive/40 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-destructive/50"
              />
              <button
                onClick={handleDeleteData}
                disabled={deletingData || confirmDelete !== "DELETE"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {deletingData ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete all data
              </button>
            </div>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
