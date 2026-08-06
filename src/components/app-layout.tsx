import { Link, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  PlugZap,
  Activity,
  Database,
  MonitorPlay,
  ShieldCheck,
  BarChart3,
  Settings,
  Menu,
  X,
  Bell,
  Search,
  CircleDot,
  LogOut,
  User,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { BrandMark } from "@/components/brand";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { ChatBubble } from "@/components/chat-bubble";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/connect", label: "Connect Portal", icon: PlugZap },
  { to: "/live", label: "Live Traffic", icon: Activity },
  { to: "/saved", label: "Saved Responses", icon: Database },
  { to: "/viewer", label: "Portal Viewer", icon: MonitorPlay },
  { to: "/security", label: "Security Center", icon: ShieldCheck },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/chat", label: "AI Assistant", icon: Sparkles },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppLayout({ children, title }: { children: ReactNode; title: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh w-full bg-background">
      {/* Sidebar - desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-card lg:flex">
        <SidebarContent pathname={pathname} onNavigate={() => {}} />
      </aside>

      {/* Sidebar - mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "tween", duration: 0.25 }}
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card lg:hidden"
            >
              <div className="flex items-center justify-between px-4 pt-4">
                <BrandMark size={32} />
                <button
                  aria-label="Close menu"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md p-2 text-muted-foreground hover:bg-accent"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="lg:pl-64">
        {/* Top status bar */}
        <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2">
              <button
                aria-label="Open menu"
                onClick={() => setMobileOpen(true)}
                className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
                {title}
              </h1>
            </div>
            <div className="hidden min-w-0 items-center md:flex">
              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  placeholder="Search endpoints, students, events..."
                  className="w-full rounded-md border border-input bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground sm:flex">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--success)] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--success)]" />
                </span>
                Protected
              </div>
              <button
                aria-label="Notifications"
                className="rounded-md p-2 text-muted-foreground hover:bg-accent"
              >
                <Bell className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
                {user?.avatar ? (
                  <img src={user.avatar} alt={user.name} className="h-6 w-6 rounded-full" />
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    <User className="h-3 w-3" />
                  </div>
                )}
                <span className="hidden text-xs font-medium text-foreground sm:block">{user?.name || "User"}</span>
              </div>
              <button
                aria-label="Sign out"
                onClick={() => {
                  signOut();
                  navigate({ to: "/signin" });
                }}
                className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
        >
          {children}
        </motion.main>
      </div>

      {/* Floating AI chat bubble — available on every page */}
      <ChatBubble />
    </div>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <>
      <div className="hidden items-center gap-2.5 px-5 pt-6 lg:flex">
        <BrandMark size={36} />
        <div className="flex flex-col leading-none">
          <span className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground">
            TTU
          </span>
          <span className="text-lg font-extrabold tracking-tight text-foreground">
            LoadShield
          </span>
        </div>
      </div>
      <nav className="mt-6 flex-1 space-y-1 px-3">
        {NAV.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-y-1 left-0 w-1 rounded-r bg-primary"
                />
              )}
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-4">
        <div className="flex items-start gap-2 rounded-md bg-accent/60 p-3">
          <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--success)]" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">All systems normal</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Uptime 99.98% this month
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
