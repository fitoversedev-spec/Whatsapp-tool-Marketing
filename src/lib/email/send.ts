// Email delivery — provider-agnostic, wired but dormant until an env
// key is set (per the "decide the provider later" call).
//
// Currently supports Resend via its REST API (no SDK / new dependency —
// just fetch). To enable: set RESEND_API_KEY and EMAIL_FROM in the env.
// Without them, sendEmail() returns { sent: false, reason:
// "not_configured" } so callers degrade gracefully.
//
// Adding another provider (SMTP / SendGrid) later = another branch here;
// the callers don't change.

export type EmailAttachment = {
  filename: string;
  // Base64-encoded file content.
  content: string;
  contentType?: string;
};

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
};

export type SendEmailResult =
  | { sent: true; id?: string }
  | { sent: false; reason: string };

const RESEND_KEY = process.env.RESEND_API_KEY ?? "";
const EMAIL_FROM =
  process.env.EMAIL_FROM ?? "Fitoverse <noreply@fitoverse.in>";

export function isEmailConfigured(): boolean {
  return !!RESEND_KEY;
}

export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  if (!RESEND_KEY) {
    return { sent: false, reason: "not_configured" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
        })),
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { sent: false, reason: `resend_${r.status}: ${body.slice(0, 200)}` };
    }
    const j = (await r.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: j.id };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "unknown_error",
    };
  }
}
