"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";

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
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 text-amber-700 text-3xl mb-4">
              ⏳
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Awaiting approval</h1>
            <p className="text-slate-600 mb-4">
              Thanks, <strong>{name}</strong>! Your account has been created and is now pending review by an administrator.
            </p>
            <p className="text-sm text-slate-500 mb-6">
              You&apos;ll be able to sign in once an admin approves your request for <strong>{role}</strong> access.
            </p>
            <Link
              href="/login"
              className="inline-block bg-wa-green hover:bg-wa-green/90 text-white font-semibold py-2.5 px-6 rounded-lg transition shadow-md"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-wa-green text-white text-3xl font-bold mb-4 shadow-lg">
            W
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Create an Account</h1>
          <p className="text-slate-500 mt-1">Join the workspace</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-white rounded-2xl shadow-xl p-8 space-y-5 border border-slate-200"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base"
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
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
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base"
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Requesting role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "sales")}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none transition text-base bg-white"
            >
              <option value="sales">Sales Representative</option>
              <option value="admin">Administrator</option>
            </select>
            <p className="text-xs text-slate-500 mt-1.5">An admin will review your request before granting access.</p>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition shadow-md"
          >
            {loading ? "Submitting…" : "Request access"}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-wa-green hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
