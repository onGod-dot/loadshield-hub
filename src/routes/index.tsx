import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import logo from "@/assets/logo.png";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: Splash,
});

const MESSAGES = [
  "Initializing Protection...",
  "Connecting Services...",
  "Loading Dashboard...",
  "Preparing Security Engine...",
  "Almost Ready...",
];

function Splash() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [progress, setProgress] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);

  // Fast progress — completes in 2.5s
  useEffect(() => {
    const total = 2500;
    const tick = 30;
    const step = (tick / total) * 100;
    const t = setInterval(() => {
      setProgress((p) => Math.min(100, p + step));
    }, tick);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setMsgIdx((i) => (i + 1) % MESSAGES.length);
    }, 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    // Navigate after 2.5s — matches the progress bar
    const t = setTimeout(() => setLeaving(true), 2300);
    const n = setTimeout(() => {
      if (isAuthenticated) {
        navigate({ to: "/dashboard" });
      } else {
        navigate({ to: "/signin" });
      }
    }, 2700);
    return () => {
      clearTimeout(t);
      clearTimeout(n);
    };
  }, [navigate, isAuthenticated, authLoading]);

  return (
    <AnimatePresence>
      {!leaving && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="fixed inset-0 flex min-h-dvh items-center justify-center bg-white px-6"
        >
          <div className="flex w-full max-w-md flex-col items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="flex items-center gap-5"
            >
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <img
                  src={logo}
                  alt="LoadShield Logo"
                  width={96}
                  height={96}
                  className="object-contain"
                  style={{ width: 96, height: 96 }}
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5, duration: 0.7 }}
                className="flex flex-col leading-none"
              >
                <span className="text-sm font-medium tracking-[0.22em] text-[#64748B]">TTU</span>
                <span className="mt-1 text-4xl font-extrabold tracking-tight text-[#0F172A]">
                  LoadShield
                </span>
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.1, duration: 0.6 }}
              className="mt-14 w-full"
            >
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                <motion.div
                  className="h-full rounded-full bg-[#2563EB]"
                  style={{ width: `${progress}%` }}
                  transition={{ ease: "linear" }}
                />
              </div>
              <div className="mt-4 flex items-center justify-between">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={msgIdx}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.4 }}
                    className="text-sm font-medium text-[#64748B]"
                  >
                    {MESSAGES[msgIdx]}
                  </motion.span>
                </AnimatePresence>
                <span className="text-sm font-semibold tabular-nums text-[#0F172A]">
                  {Math.floor(progress)}%
                </span>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
