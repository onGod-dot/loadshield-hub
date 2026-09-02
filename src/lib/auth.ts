/**
 * auth.ts — real authentication via Supabase
 * Replaces the previous mock implementation.
 */

import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import type { User as SupabaseUser, Session } from "@supabase/supabase-js";

export type User = {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  provider: "google" | "email";
};

export type AuthState = {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  session: Session | null;
};

function toUser(u: SupabaseUser): User {
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? "",
    name:
      meta.full_name ??
      meta.name ??
      (u.email ? u.email.split("@")[0] : "User"),
    avatar:
      meta.avatar_url ??
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.id}`,
    provider: (u.app_metadata?.provider as "google" | "email") ?? "email",
  };
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    isLoading: true,
    session: null,
  });

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuth({
        isAuthenticated: !!session?.user,
        user: session?.user ? toUser(session.user) : null,
        isLoading: false,
        session: session ?? null,
      });
    });

    // Listen for auth state changes (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth({
        isAuthenticated: !!session?.user,
        user: session?.user ? toUser(session.user) : null,
        isLoading: false,
        session: session ?? null,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Sign in with email + password ─────────────────────────────────────────
  const signIn = async (
    _provider: "google" | "email",
    email?: string,
    password?: string
  ) => {
    if (_provider === "google") {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/dashboard` },
      });
      if (error) throw error;
      return null; // redirect happens, no user returned synchronously
    }

    if (!email || !password) throw new Error("Email and password required");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data.user ? toUser(data.user) : null;
  };

  // ── Sign up with email + password ─────────────────────────────────────────
  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });
    if (error) throw error;
    return data.user ? toUser(data.user) : null;
  };

  // ── Sign out ──────────────────────────────────────────────────────────────
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return {
    ...auth,
    signIn,
    signUp,
    signOut,
  };
}
