// Phase 5 (analytics v2) — the weekly-digest JOB. This is the single seam
// where insights.ts and digest.ts finally compose: digest.ts deliberately
// does NOT import generateInsights (so the two files never race on each
// other's on-disk presence and buildDigest stays testable), so SOMETHING has
// to generate the insights and hand them to buildDigest. That something is
// here — the cron-driven job, not a UI route.
//
// Flow per admin recipient:
//   generateInsights(admin, weekFilter)  → Insight[]
//     → mapped to DigestInsight[]        (down-project to the 4-ish fields the digest needs)
//     → buildDigest(admin, weekFilter, …) → DigestData   (KPI headline composed once)
//     → renderWeeklyDigestEmail(digest)  → { subject, html, text }
//     → sendEmail(...)                   (dormant until RESEND_API_KEY is set)
//
// RESILIENCE: this function NEVER throws. The weekly digest is a dormant,
// best-effort feature (email transport isn't even configured in prod yet), so
// a digest failure must never break the cron sweep that also fires reminders
// and launches scheduled broadcasts. Every failure path returns a result
// object with a `skipped` reason instead of throwing; a per-recipient
// try/catch means one bad send can't abort the rest.
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/rbac";
import { generateInsights } from "./insights";
import { buildDigest, type DigestInsight } from "./digest";
import type { AnalyticsFilter } from "./types";
import { renderWeeklyDigestEmail } from "@/lib/email/templates/weeklyDigest";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";

// The digest window: the trailing 7 days ending now. A trailing window (rather
// than a calendar Mon–Sun block) is robust regardless of which weekday the
// cron gate fires on — the label ("Week of <from>", set by digest.ts) reads
// off this `from` either way. Kept here as the one place the window is defined
// so both insight generation and the KPI headline see the exact same range.
function currentWeekFilter(now: Date): AnalyticsFilter {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  return { from, to: now };
}

// Insight → DigestInsight: down-projects the richer engine output to just the
// fields the digest surface renders. `n` carries through so digest.ts can sort
// "warnings first, then n desc" honestly (that's why DigestInsight.n exists).
function toDigestInsight(i: {
  title: string;
  detail: string;
  recommendedAction: string;
  severity: "info" | "warning";
  n: number;
}): DigestInsight {
  return {
    title: i.title,
    detail: i.detail,
    recommendedAction: i.recommendedAction,
    severity: i.severity,
    n: i.n,
  };
}

export async function runWeeklyDigest(): Promise<{
  recipients: number;
  sent: number;
  skipped: string;
}> {
  try {
    // Company-wide digest goes to admins (the 2-tier model's only company-wide
    // scope — see scope.ts). Same active/approved/not-deleted filter every
    // other user-listing query in the app uses.
    const admins = await prisma.user.findMany({
      where: { role: "admin", isActive: true, approvalStatus: "approved", deletedAt: null },
      select: { id: true, email: true, role: true },
    });

    // Not configured → do the cheap recipient count, skip all the digest work,
    // and report it plainly. isEmailConfigured() is false until RESEND_API_KEY
    // is set in prod, at which point this starts sending with no code change.
    if (!isEmailConfigured()) {
      console.warn(`[digest] email not configured — skipping ${admins.length} recipient(s)`);
      return { recipients: admins.length, sent: 0, skipped: "email_not_configured" };
    }

    const now = new Date();
    const filter = currentWeekFilter(now);

    let sent = 0;
    for (const admin of admins) {
      // Per-recipient try/catch: one admin's digest failing (a bad email
      // address, a transient DB hiccup mid-build) must not stop the others.
      try {
        const user = { id: admin.id, role: admin.role as Role };
        const insights = await generateInsights(user, filter);
        const digestInsights = insights.map(toDigestInsight);
        const digest = await buildDigest(user, filter, digestInsights);
        const { subject, html, text } = renderWeeklyDigestEmail(digest);
        const result = await sendEmail({ to: admin.email, subject, html, text });
        if (result.sent) {
          sent += 1;
        } else {
          console.error(`[digest] send failed for ${admin.email}: ${result.reason}`);
        }
      } catch (err) {
        console.error(`[digest] build/send threw for ${admin.email}`, err);
      }
    }

    return { recipients: admins.length, sent, skipped: "" };
  } catch (err) {
    // Top-level guard: even the admin query throwing must not surface to the
    // cron sweep as an exception. Report it as a skip reason instead.
    console.error("[digest] runWeeklyDigest failed", err);
    return { recipients: 0, sent: 0, skipped: err instanceof Error ? err.message : "unknown_error" };
  }
}
