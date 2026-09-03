/**
 * `GET /r/{reportId}?e={expiry}&s={signature}` — the customer-facing link.
 *
 * This is the only route in the application that serves something without a
 * session, and it is deliberately the shortest path in the app: it is typed
 * into nothing and tapped in WhatsApp, on a phone, by a land owner who has no
 * account and never will.
 *
 * ## Signed, expiring, and unguessable
 *
 * A UUID plus an HMAC over `(reportId, expiry)`. Editing the expiry breaks the
 * signature, so a link cannot extend itself. Default life is 90 days
 * (`REPORT_LINK_TTL_DAYS`). Deleting the report row also kills the link, since
 * the row is read before anything is served.
 *
 * ## Expired shows a page, not a stack trace
 *
 * The most likely reader of a lapsed link is the customer this report was
 * written for, four months later, wondering where it went. They get a plain
 * page telling them what happened and what to do — ask for a fresh link —
 * rather than a 500 or a bare "Forbidden". An invalid signature gets the same
 * page in its "not found" wording: distinguishing "expired" from "forged" for
 * the reader is useful; distinguishing "this id exists" from "it does not" for
 * a stranger is not.
 */

import { env } from "@/lib/scout/env";
import { getPublicReportRow } from "@/lib/scout/reports/repository";
import { reportStorage } from "@/lib/scout/reports/storage";
import { verifyReportLink } from "@/lib/scout/reports/signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(status: number, heading: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<style>
  :root{color-scheme:light}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#ededed;color:#1c1c1e;
       font-family:"Segoe UI",Helvetica,Arial,sans-serif;padding:24px}
  main{max-width:34rem;background:#fff;border-radius:16px;padding:28px 26px;
       box-shadow:0 4px 16px rgba(10,10,10,.1)}
  h1{font-size:1.25rem;margin:0 0 12px}
  p{font-size:.95rem;line-height:1.6;margin:0 0 10px;color:#3a3a3c}
  .brand{font-size:.7rem;letter-spacing:.13em;text-transform:uppercase;color:#6e6e73;margin-bottom:14px}
</style></head>
<body><main>
  <div class="brand">Fitoverse Site Scout</div>
  <h1>${heading}</h1>
  ${body}
</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function expired(): Response {
  return page(
  410,
  "This report link has expired",
  `<p>Report links stop working after a set period so a site assessment does not stay
      permanently readable by anyone who has ever had the address.</p>
   <p>Ask whoever sent it to you for a fresh link — it takes them a moment, and the report
      itself has not gone anywhere.</p>`,
  );
}

function notFound(): Response {
  return page(
  404,
  "This report is not available",
  `<p>The link is not valid. It may have been copied incompletely, or the report may have
      been withdrawn.</p>
   <p>Ask whoever sent it to you to send the link again.</p>`,
  );
}

function notReady(): Response {
  return page(
  409,
  "This report is still being produced",
  `<p>The document behind this link has not finished generating. Try again in a minute.</p>`,
  );
}

function safeFilename(areaLabel: string, version: number): string {
  const base = areaLabel.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "SiteScout";
  return `${base}_SiteScout_v${version}.pdf`;
}

export async function GET(request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const url = new URL(request.url);
  const expiry = Number(url.searchParams.get("e"));
  const signature = url.searchParams.get("s") ?? "";

  const check = verifyReportLink(id, expiry, signature, env.reportLinkSecret);
  if (!check.ok) return check.reason === "expired" ? expired() : notFound();

  const row = await getPublicReportRow(id);
  if (!row) return notFound();
  if (row.status === "generating") return notReady();
  if (row.status !== "generated" && row.status !== "delivered") return notFound();

  // The row's own expiry is authoritative as well as the signature's: shortening
  // it in the database must take effect on links already handed out.
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return expired();

  const file = await reportStorage().get(id);
  if (!file) return notFound();

  return new Response(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      // `inline` so WhatsApp's in-app viewer and Safari render it rather than
      // dropping a file into Downloads that the reader then has to find.
      "Content-Disposition": `inline; filename="${safeFilename(row.areaLabel, row.version)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      // A customer's site assessment must not end up in a search index or a
      // shared CDN cache.
      "Referrer-Policy": "no-referrer",
    },
  });
}
