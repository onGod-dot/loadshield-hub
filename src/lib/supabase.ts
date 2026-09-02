import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env"
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ── Database types ────────────────────────────────────────────────────────────

export interface GatewayConfig {
  id?: string;
  user_id?: string;
  portal_url: string | null;
  protection_level: "light" | "recommended" | "maximum";
  rate_limit_per_min: number;
  cache_ttl_seconds: number;
  cache_enabled: boolean;
  updated_at?: string;
}

export interface PortalSessionRow {
  id?: string;
  session_id: string;
  ip: string | null;
  first_seen?: string;
  last_seen?: string;
  page_trail: Array<{ path: string; time: number; status: number; latencyMs: number }>;
  request_count: number;
}

// ── Portal Snapshot & Change types ───────────────────────────────────────────

export interface PortalSnapshotRow {
  id?: string;
  user_id?: string;
  session_id: string;
  path: string;
  content_type: string;
  hash: string;
  text: string;
  captured_at: string; // ISO string
}

export interface PortalChangeRow {
  id?: string;
  user_id?: string;
  session_id: string;
  path: string;
  content_type: string;
  before_text: string;
  before_captured_at: string; // ISO string
  after_text: string;
  after_captured_at: string;  // ISO string
  detected_at: string;        // ISO string
}

// ── Gateway config helpers ────────────────────────────────────────────────────

export async function loadGatewayConfig(userId: string): Promise<GatewayConfig | null> {
  const { data, error } = await supabase
    .from("gateway_config")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows found — not an error for us
    console.error("[supabase] loadGatewayConfig:", error.message);
  }
  return data ?? null;
}

export async function saveGatewayConfig(
  userId: string,
  config: Partial<GatewayConfig>
): Promise<void> {
  const { error } = await supabase
    .from("gateway_config")
    .upsert(
      { ...config, user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("[supabase] saveGatewayConfig:", error.message);
    throw error;
  }
}

export async function savePortalUrl(userId: string, portalUrl: string): Promise<void> {
  await saveGatewayConfig(userId, { portal_url: portalUrl });
  // Also persist locally for instant access
  localStorage.setItem("loadshield_portal_url", portalUrl);
}

export function getLocalPortalUrl(): string {
  return localStorage.getItem("loadshield_portal_url") ?? "";
}

// ── Portal Snapshot helpers ───────────────────────────────────────────────────

/**
 * Upsert a snapshot for a (session_id, path) pair.
 * Uses the unique constraint on (session_id, path) — updates hash+text if changed.
 */
export async function upsertPortalSnapshot(
  userId: string,
  snap: Omit<PortalSnapshotRow, "id" | "user_id">
): Promise<void> {
  const { error } = await supabase
    .from("portal_snapshots")
    .upsert(
      { ...snap, user_id: userId },
      { onConflict: "session_id,path" }
    );
  if (error) {
    console.error("[supabase] upsertPortalSnapshot:", error.message);
    throw error;
  }
}

/**
 * Insert a new change record. Always appends — never overwrites.
 */
export async function insertPortalChange(
  userId: string,
  change: Omit<PortalChangeRow, "id" | "user_id">
): Promise<void> {
  const { error } = await supabase
    .from("portal_changes")
    .insert({ ...change, user_id: userId });
  if (error) {
    console.error("[supabase] insertPortalChange:", error.message);
    throw error;
  }
}

/**
 * Load all snapshots for the current user — used to populate the history view
 * on return visits without needing the gateway to be running.
 */
export async function loadPortalSnapshots(
  userId: string
): Promise<PortalSnapshotRow[]> {
  const { data, error } = await supabase
    .from("portal_snapshots")
    .select("*")
    .eq("user_id", userId)
    .order("captured_at", { ascending: false });
  if (error) {
    console.error("[supabase] loadPortalSnapshots:", error.message);
    return [];
  }
  return data ?? [];
}

/**
 * Load all change records for the current user — newest first.
 */
export async function loadPortalChanges(
  userId: string
): Promise<PortalChangeRow[]> {
  const { data, error } = await supabase
    .from("portal_changes")
    .select("*")
    .eq("user_id", userId)
    .order("detected_at", { ascending: false });
  if (error) {
    console.error("[supabase] loadPortalChanges:", error.message);
    return [];
  }
  return data ?? [];
}
