import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInsightLink } from "@/lib/insights/signing";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { searchParams } = req.nextUrl;
  const e = Number(searchParams.get("e"));
  const s = searchParams.get("s") ?? "";

  const check = verifyInsightLink(params.id, e, s);
  if (!check.ok) {
    const status = check.reason === "expired" ? 410 : 404;
    const message =
      check.reason === "expired"
        ? "This link has expired. Please ask the sender for a new one."
        : "Invalid link.";
    return new NextResponse(errorPage(message), {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const doc = await prisma.insightDocument.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, body: true, deletedAt: true, updatedAt: true },
  });
  if (!doc || doc.deletedAt) {
    return new NextResponse(errorPage("This document is no longer available."), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new NextResponse(viewPage(doc.title, doc.body, doc.updatedAt), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
    },
  });
}

function viewPage(title: string, body: string, updatedAt: Date): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const dateStr = updatedAt.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — Fitoverse CRM</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Roboto, Arial, sans-serif;
      background: #f8fafc;
      color: #1e293b;
      line-height: 1.6;
    }
    .header {
      background: #0f172a;
      color: white;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header .brand { font-weight: 700; font-size: 16px; }
    .header .brand span { color: #22c55e; }
    .container {
      max-width: 800px;
      margin: 24px auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .title-bar {
      padding: 24px 32px;
      border-bottom: 1px solid #e2e8f0;
    }
    .title-bar h1 { font-size: 22px; font-weight: 700; color: #0f172a; }
    .title-bar .meta { font-size: 12px; color: #94a3b8; margin-top: 4px; }
    .content {
      padding: 24px 32px 40px;
      font-size: 14px;
    }
    .content h1 { font-size: 20px; font-weight: 700; margin: 20px 0 10px; }
    .content h2 { font-size: 17px; font-weight: 600; margin: 16px 0 8px; }
    .content h3 { font-size: 14px; font-weight: 600; margin: 12px 0 6px; }
    .content p { margin: 6px 0; }
    .content ul { list-style-type: disc; padding-left: 24px; margin: 8px 0; }
    .content ol { list-style-type: decimal; padding-left: 24px; margin: 8px 0; }
    .content li { margin: 4px 0; }
    .content li p { margin: 0; }
    .content blockquote {
      border-left: 3px solid #cbd5e1;
      padding-left: 12px;
      color: #64748b;
      margin: 10px 0;
    }
    .content table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    .content th, .content td {
      border: 1px solid #94a3b8;
      padding: 6px 10px;
      text-align: left;
      font-size: 13px;
    }
    .content th { background: #f1f5f9; font-weight: 600; }
    .content hr { border: none; border-top: 1px solid #e2e8f0; margin: 16px 0; }
    .content img { max-width: 100%; height: auto; border-radius: 6px; }
    .actions {
      padding: 16px 32px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
    }
    .actions button {
      background: #0f172a;
      color: white;
      border: none;
      padding: 10px 24px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .actions button:hover { background: #1e293b; }
    @media print { .header, .actions { display: none; } .container { box-shadow: none; margin: 0; } }
    @media (max-width: 640px) {
      .title-bar, .content, .actions { padding-left: 16px; padding-right: 16px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">FIT<span>O</span>VERSE</div>
  </div>
  <div class="container">
    <div class="title-bar">
      <h1>${esc(title)}</h1>
      <div class="meta">Last updated ${dateStr}</div>
    </div>
    <div class="content">${body}</div>
    <div class="actions">
      <button onclick="window.print()">Download / Print</button>
    </div>
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fitoverse CRM</title>
  <style>
    body {
      font-family: 'Segoe UI', Roboto, Arial, sans-serif;
      background: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      text-align: center;
      max-width: 400px;
    }
    h1 { font-size: 18px; color: #0f172a; margin-bottom: 8px; }
    p { font-size: 14px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Fitoverse CRM</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
