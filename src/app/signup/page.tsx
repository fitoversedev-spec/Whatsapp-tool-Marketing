"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";

// Shared brand hero (dark) used on the left of login + signup.
function BrandHero() {
  return (
    <aside className="hidden lg:flex flex-col justify-center relative overflow-hidden w-[46%] px-16 text-white"
      style={{ background: "radial-gradient(1100px 640px at 22% 12%, #123f2b 0%, #0B2018 46%, #07130E 100%)" }}>
      <div className="absolute rounded-full" style={{ width: 520, height: 520, right: -170, top: -160, background: "radial-gradient(circle at 40% 40%, rgba(115,202,240,.32), transparent 62%)" }} />
      <div className="absolute rounded-full" style={{ width: 420, height: 420, left: -150, bottom: -170, background: "radial-gradient(circle at 60% 40%, rgba(21,147,65,.4), transparent 66%)" }} />
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
  );
}

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "sales">("sales");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Sign up failed");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 text-amber-700 text-3xl mb-4">⏳</div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mb-2">Awaiting approval</h1>
            <p className="text-slate-600 mb-4">
              Thanks, <strong>{name}</strong>! Your account has been created and is now pending review by an administrator.
            </p>
            <p className="text-sm text-slate-500 mb-6">
              You&apos;ll be able to sign in once an admin approves your request for <strong>{role}</strong> access.
            </p>
            <Link href="/login" className="inline-block bg-wa-green hover:bg-wa-green/90 text-white font-bold py-3 px-6 rounded-xl transition shadow-md shadow-wa-green/30">
              Back to sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex">
      <BrandHero />
      <section className="flex-1 flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden mb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/quotation-assets/image1.png" alt="Fitoverse" className="h-9 w-auto" />
          </div>
          <span className="inline-block text-xs font-bold uppercase tracking-[0.16em] text-wa-green bg-wa-light px-3.5 py-1.5 rounded-full mb-5">Join the team</span>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">Request access</h2>
          <p className="text-slate-500 mt-1.5 mb-7">Create your account — an admin approves it before you sign in.</p>

          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">Full name</label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base"
                placeholder="Jane Doe" autoComplete="name" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base"
                placeholder="you@fitoverse.in" autoComplete="email" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">Password</label>
              <PasswordInput required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base"
                autoComplete="new-password" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">Requesting role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "sales")}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base bg-white">
                <option value="sales">Sales Representative</option>
                <option value="admin">Administrator</option>
              </select>
              <p className="text-xs text-slate-500 mt-1.5">An admin will review your request before granting access.</p>
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">{error}</div>}

            <button type="submit" disabled={loading}
              className="w-full bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition shadow-md shadow-wa-green/30">
              {loading ? "Submitting…" : "Request access →"}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-7">
            Already have an account?{" "}
            <Link href="/login" className="text-wa-dark hover:underline font-semibold">Sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
