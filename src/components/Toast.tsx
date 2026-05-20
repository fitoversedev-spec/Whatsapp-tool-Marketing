"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

type ToastKind = "success" | "error" | "info";

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastContextValue = {
  show: (kind: ToastKind, message: string) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++counter;
      setToasts((prev) => [...prev, { id, kind, message }]);
      const timer = setTimeout(() => dismiss(id), kind === "error" ? 6000 : 4000);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const value: ToastContextValue = {
    show,
    success: (m) => show("success", m),
    error: (m) => show("error", m),
    info: (m) => show("info", m),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-4 z-[100] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const styles: Record<ToastKind, { bg: string; border: string; text: string; icon: string }> = {
    success: { bg: "bg-green-50", border: "border-green-200", text: "text-green-900", icon: "✓" },
    error: { bg: "bg-red-50", border: "border-red-200", text: "text-red-900", icon: "✕" },
    info: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-900", icon: "ℹ" },
  };
  const s = styles[toast.kind];
  return (
    <div
      className={`${s.bg} ${s.border} ${s.text} pointer-events-auto border rounded-xl shadow-lg px-4 py-3 flex items-start gap-3 animate-slideIn`}
      role="alert"
    >
      <span className="text-base font-bold leading-tight shrink-0">{s.icon}</span>
      <div className="flex-1 text-sm leading-snug">{toast.message}</div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-slate-400 hover:text-slate-700 leading-none text-lg shrink-0"
      >
        ×
      </button>
      <style jsx>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        :global(.animate-slideIn) {
          animation: slideIn 200ms ease-out;
        }
      `}</style>
    </div>
  );
}
