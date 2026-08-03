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
        <div className="relative text-[13px] font-bold tracking-[0.28em] text-[#8FE3FF] mb-5">SPORTS INFRASTRUCTURE</div>
        <h1 className="relative text-[46px] leading-[1.06] font-extrabold tracking-tight max-w-[15ch]">
          From the first message to a{" "}
          <span style={{ background: "linear-gradient(90deg,#3FD07E,#73CAF0)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>closed deal.</span>
        </h1>
        <p className="relative text-lg text-white/70 mt-6 max-w-[36ch] leading-relaxed">WhatsApp marketing, quotations, court designs and a full CRM — in one tool.</p>
        <div className="relative h-1.5 w-32 rounded mt-9" style={{ background: "linear-gradient(90deg,#159341,#73CAF0,#C81124)" }} />
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

            {error && (
              <div className={`text-sm border rounded-xl px-3 py-2.5 flex items-start gap-2 ${errorBg}`}>
                {errorIcon && <span className="shrink-0 text-base leading-tight">{errorIcon}</span>}
                <span className="flex-1">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition shadow-md shadow-wa-green/30"
            >
              {loading ? "Signing in…" : "Sign in →"}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-7">
            New to the team?{" "}
            <Link href="/signup" className="text-wa-dark hover:underline font-semibold">Request access</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
