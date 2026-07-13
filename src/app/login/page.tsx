"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Login failed" }));
        setError(data.error ?? "Login failed");
        setErrorCode(data.code ?? null);
        return;
      }
      router.push("/inbox");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const errorIcon = errorCode === "pending" ? "⏳" : errorCode === "rejected" ? "🚫" : errorCode === "inactive" ? "🔒" : null;
  const errorBg =
    errorCode === "pending"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : errorCode === "rejected" || errorCode === "inactive"
      ? "bg-slate-50 border-slate-200 text-slate-700"
      : "bg-red-50 border-red-200 text-red-600";

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-wa-green text-white text-3xl font-bold mb-4 shadow-lg">
            W
          </div>
          <h1 className="text-3xl font-bold text-slate-900">WhatsApp Tool</h1>
          <p className="text-slate-500 mt-1">Marketing broadcasts &amp; inbox</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-white rounded-2xl shadow-xl p-8 space-y-5 border border-slate-200"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base"
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Password
            </label>
            <PasswordInput
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className={`text-sm border rounded-lg px-3 py-2 flex items-start gap-2 ${errorBg}`}>
              {errorIcon && <span className="shrink-0 text-base leading-tight">{errorIcon}</span>}
              <span className="flex-1">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition shadow-md"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          Don't have an account?{" "}
          <Link href="/signup" className="text-wa-green hover:underline font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
