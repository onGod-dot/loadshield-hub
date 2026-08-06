import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Save } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { SectionCard } from "@/components/ui-bits";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — TTU-LoadShield" },
      { name: "description", content: "Configure protection, performance, notifications and appearance." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [devOpen, setDevOpen] = useState(false);
  return (
    <AppLayout title="Settings">
      <div className="mx-auto max-w-3xl space-y-6">
        <SectionCard title="General">
          <Field label="Organization name" defaultValue="Takoradi Technical University" />
          <Field label="Contact email" defaultValue="admin@ttu.edu.gh" type="email" />
        </SectionCard>

        <SectionCard title="Protection">
          <Toggle label="Enable Protection" hint="Turn LoadShield's defense layer on or off." defaultChecked />
          <Toggle label="Block suspicious traffic" hint="Automatically stop unusual bursts and known bad IPs." defaultChecked />
          <Toggle label="Slow down instead of block" hint="For borderline traffic, slow it instead of blocking." />
        </SectionCard>

        <SectionCard title="Performance">
          <Toggle label="Save responses" hint="Keep popular pages ready so students see them instantly." defaultChecked />
          <Field label="Keep responses fresh for (minutes)" defaultValue="60" type="number" />
        </SectionCard>

        <SectionCard title="Notifications">
          <Toggle label="Alert me about new threats" defaultChecked />
          <Toggle label="Weekly performance report" defaultChecked />
          <Toggle label="Portal offline alerts" defaultChecked />
        </SectionCard>

        <SectionCard title="Appearance">
          <Field label="Accent color" defaultValue="#2563EB" />
        </SectionCard>

        <div className="rounded-xl border border-border bg-card shadow-sm">
          <button
            onClick={() => setDevOpen((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div>
              <p className="text-sm font-semibold text-foreground">Developer options</p>
              <p className="text-xs text-muted-foreground">Advanced settings. Only change if you know what you're doing.</p>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${devOpen ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {devOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-t border-border"
              >
                <div className="p-5">
                  <Field label="API base URL" defaultValue="https://portal.school.edu/api" />
                  <Field label="Rate limit (requests / minute)" defaultValue="1200" type="number" />
                  <Toggle label="Verbose logging" hint="Emit detailed request logs (uses more storage)." />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex justify-end">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => toast.success("Settings saved")}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Save className="h-4 w-4" /> Save changes
          </motion.button>
        </div>
      </div>
    </AppLayout>
  );
}

function Field({ label, defaultValue, type = "text" }: { label: string; defaultValue?: string; type?: string }) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      <input
        type={type}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}
function Toggle({ label, hint, defaultChecked }: { label: string; hint?: string; defaultChecked?: boolean }) {
  const [on, setOn] = useState(!!defaultChecked);
  return (
    <div className="mb-4 flex items-start justify-between gap-4 last:mb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        onClick={() => setOn((v) => !v)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-accent"}`}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${on ? "left-[calc(100%-1.375rem)]" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}
