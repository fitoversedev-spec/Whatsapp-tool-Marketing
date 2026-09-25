"use client";

import { useState, useEffect, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Pick up error / status from Google OAuth redirect query params
  useEffect(() => {
    const qError = searchParams.get("error");
    const qCode = searchParams.get("code");
    if (qError) {
      setError(qError);
    } else if (qCode === "pending") {
      setError("Your account is awaiting admin approval.");
      setErrorCode("pending");
    }
  }, [searchParams]);

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
    <main className="min-h-screen flex">
      {/* Left — brand hero (dark). Hidden on small screens. */}
      <aside className="hidden lg:flex flex-col justify-center relative overflow-hidden w-[46%] px-16 text-white"
        style={{ background: "radial-gradient(1100px 640px at 22% 12%, #123f2b 0%, #0B2018 46%, #07130E 100%)" }}>
        <div className="absolute rounded-full" style={{ width: 520, height: 520, right: -170, top: -160, background: "radial-gradient(circle at 40% 40%, rgba(115,202,240,.32), transparent 62%)" }} />
        <div className="absolute rounded-full" style={{ width: 420, height: 420, left: -150, bottom: -170, background: "radial-gradient(circle at 60% 40%, rgba(21,147,65,.4), transparent 66%)" }} />
        {/* Logo at natural size on a clean chip so it stays crisp and unstretched */}
        <div className="relative inline-flex bg-white rounded-2xl px-5 py-3.5 self-start shadow-lg mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/quotation-assets/image1.png" alt="Fitoverse" className="h-9 w-auto" />
        </div>
        <div className="relative text-[13px] font-bold tracking-[0.28em] text-[var(--ac)] mb-5">SPORTS INFRASTRUCTURE</div>
        <h1 className="relative text-[46px] leading-[1.06] font-extrabold tracking-tight max-w-[15ch]">
          From the first message to a{" "}
          <span style={{ background: "linear-gradient(90deg,#3FD07E,#73CAF0)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>closed deal.</span>
        </h1>
        <p className="relative text-lg text-white/70 mt-6 max-w-[36ch] leading-relaxed">WhatsApp marketing, quotations, court designs and a full CRM — in one tool.</p>
        <div className="relative h-1.5 w-32 rounded mt-9" style={{ background: "linear-gradient(90deg,var(--gd),var(--ac),var(--bd))" }} />
        <div className="absolute left-16 bottom-10 text-[13px] text-white/50 tracking-wide">© 2026 Fitoverse · Salem · Chennai · Bangalore</div>
      </aside>

      {/* Right — sign-in form */}
      <section className="flex-1 flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-[400px]">
          {/* Compact logo for mobile (brand panel is hidden there) */}
          <div className="lg:hidden mb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/quotation-assets/image1.png" alt="Fitoverse" className="h-9 w-auto" />
          </div>
          <span className="inline-block text-xs font-bold uppercase tracking-[0.16em] text-wa-green bg-wa-light px-3.5 py-1.5 rounded-full mb-5">Welcome back</span>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">Sign in to Fitoverse</h2>
          <p className="text-slate-500 mt-1.5 mb-7">Use your work email to access your dashboard.</p>

          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-guide="login-email"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base"
                placeholder="you@fitoverse.in"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">Password</label>
              <PasswordInput
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base"
                autoComplete="current-password"
              />
            </div>

            <div className="text-right -mt-2">
              <Link href="/forgot-password" data-guide="login-forgot" className="text-sm text-wa-dark hover:underline">Forgot password?</Link>
            </div>

            {error && (
              <div className={`text-sm border rounded-xl px-3 py-2.5 flex items-start gap-2 ${errorBg}`}>
                {errorIcon && <span className="shrink-0 text-base leading-tight">{errorIcon}</span>}
                <span className="flex-1">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              data-guide="login-submit"
              className="w-full bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition shadow-md shadow-wa-green/30"
            >
              {loading ? "Signing in…" : "Sign in →"}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
            <div className="relative flex justify-center"><span className="bg-slate-50 px-3 text-xs text-slate-400 uppercase tracking-wider">or</span></div>
          </div>
          <button
            type="button"
            onClick={() => window.location.href = "/api/auth/google"}
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold py-3.5 rounded-xl transition"
          >
            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </button>

          <p className="text-center text-sm text-slate-500 mt-7">
            New to the team?{" "}
            <Link href="/signup" data-guide="login-signup" className="text-wa-dark hover:underline font-semibold">Request access</Link>
          </p>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
