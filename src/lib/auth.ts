import { useState, useEffect } from "react";

export type AuthState = {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
};

export type User = {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  provider: "google" | "email";
};

const AUTH_STORAGE_KEY = "loadshield_auth";

function getStoredAuth(): AuthState {
  if (typeof window === "undefined") {
    return { isAuthenticated: false, user: null, isLoading: false };
  }
  
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        isAuthenticated: !!parsed.user,
        user: parsed.user || null,
        isLoading: false,
      };
    }
  } catch {
    // Ignore storage errors
  }
  
  return { isAuthenticated: false, user: null, isLoading: false };
}

function setStoredAuth(auth: AuthState) {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
        isAuthenticated: auth.isAuthenticated,
        user: auth.user,
      }));
    } catch {
      // Ignore storage errors
    }
  }
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({ isAuthenticated: false, user: null, isLoading: true });

  useEffect(() => {
    // Check auth state on mount
    const stored = getStoredAuth();
    setAuth(stored);
  }, []);

  const signIn = async (provider: "google" | "email", email?: string, password?: string) => {
    setAuth(prev => ({ ...prev, isLoading: true }));
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock user data
    const user: User = {
      id: "user_" + Date.now(),
      email: email || "user@example.com",
      name: "LoadShield User",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=LoadShield",
      provider,
    };
    
    const newAuth: AuthState = { isAuthenticated: true, user, isLoading: false };
    setAuth(newAuth);
    setStoredAuth(newAuth);
    
    return user;
  };

  const signUp = async (email: string, password: string, name: string) => {
    setAuth(prev => ({ ...prev, isLoading: true }));
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const user: User = {
      id: "user_" + Date.now(),
      email,
      name,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      provider: "email",
    };
    
    const newAuth: AuthState = { isAuthenticated: true, user, isLoading: false };
    setAuth(newAuth);
    setStoredAuth(newAuth);
    
    return user;
  };

  const signOut = () => {
    const newAuth: AuthState = { isAuthenticated: false, user: null, isLoading: false };
    setAuth(newAuth);
    setStoredAuth(newAuth);
  };

  return {
    ...auth,
    signIn,
    signUp,
    signOut,
  };
}
