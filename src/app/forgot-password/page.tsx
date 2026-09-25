"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Something went wrong" }));
        setError(data.error ?? "Something went wrong");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex">
      {/* Left -- brand hero (dark). Hidden on small screens. */}
      <aside
        className="hidden lg:flex flex-col justify-center relative overflow-hidden w-[46%] px-16 text-white"
        style={{
          background:
            "radial-gradient(1100px 640px at 22% 12%, #123f2b 0%, #0B2018 46%, #07130E 100%)",
        }}
      >
        <div
          className="absolute rounded-full"
          style={{
            width: 520,
            height: 520,
            right: -170,
            top: -160,
            background:
              "radial-gradient(circle at 40% 40%, rgba(115,202,240,.32), transparent 62%)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: 420,
            height: 420,
            left: -150,
            bottom: -170,
            background:
              "radial-gradient(circle at 60% 40%, rgba(21,147,65,.4), transparent 66%)",
          }}
        />
        <div className="relative inline-flex bg-white rounded-2xl px-5 py-3.5 self-start shadow-lg mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/quotation-assets/image1.png"
            alt="Fitoverse"
            className="h-9 w-auto"
          />
        </div>
        <div className="relative text-[13px] font-bold tracking-[0.28em] text-[var(--ac)] mb-5">
          SPORTS INFRASTRUCTURE
        </div>
        <h1 className="relative text-[46px] leading-[1.06] font-extrabold tracking-tight max-w-[15ch]">
          From the first message to a{" "}
          <span
            style={{
              background: "linear-gradient(90deg,#3FD07E,#73CAF0)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            closed deal.
          </span>
        </h1>
        <p className="relative text-lg text-white/70 mt-6 max-w-[36ch] leading-relaxed">
          WhatsApp marketing, quotations, court designs and a full CRM — in one
          tool.
        </p>
        <div
          className="relative h-1.5 w-32 rounded mt-9"
          style={{
            background:
              "linear-gradient(90deg,var(--gd),var(--ac),var(--bd))",
          }}
        />
        <div className="absolute left-16 bottom-10 text-[13px] text-white/50 tracking-wide">
          © 2026 Fitoverse · Salem · Chennai · Bangalore
        </div>
      </aside>

      {/* Right -- forgot password form */}
      <section className="flex-1 flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-[400px]">
          {/* Compact logo for mobile */}
          <div className="lg:hidden mb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/quotation-assets/image1.png"
              alt="Fitoverse"
              className="h-9 w-auto"
            />
          </div>
          <span className="inline-block text-xs font-bold uppercase tracking-[0.16em] text-wa-green bg-wa-light px-3.5 py-1.5 rounded-full mb-5">
            Password reset
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Forgot your password?
          </h2>
          <p className="text-slate-500 mt-1.5 mb-7">
            Enter your email and we&apos;ll send you a link to reset it.
          </p>

          {submitted ? (
            <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-4">
              <p className="font-semibold mb-1">Check your inbox</p>
              <p>
                If an account exists with this email, we&apos;ve sent a password
                reset link. It expires in 1 hour.
              </p>
              <Link
                href="/login"
                className="inline-block mt-4 text-wa-dark hover:underline font-semibold"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={onSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-guide="forgot-email"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base"
                    placeholder="you@fitoverse.in"
                    autoComplete="email"
                  />
                </div>

                {error && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  data-guide="forgot-submit"
                  className="w-full bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition shadow-md shadow-wa-green/30"
                >
                  {loading ? "Sending..." : "Send reset link"}
                </button>
              </form>

              <p className="text-center text-sm text-slate-500 mt-7">
                Remember your password?{" "}
                <Link
                  href="/login"
                  className="text-wa-dark hover:underline font-semibold"
                >
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
