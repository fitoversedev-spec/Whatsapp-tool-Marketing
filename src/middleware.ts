import { NextResponse, type NextRequest } from "next/server";

// Someone without a login cookie opening an app page — a bookmark, a link from
// WhatsApp or email, or after 7 days without use — goes straight to the login
// page from the edge, with ?next= so they land back on that page after
// signing in. A cookie that's present is checked as usual by the page itself
// (requireUser); this only looks at whether one exists.
//
// Runs only for full page loads of the signed-in sections (the matcher skips
// in-app navigations and link prefetches), so it adds nothing to clicks.
export function middleware(req: NextRequest) {
  if (req.cookies.has("whatsapp_tool_session")) return NextResponse.next();
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    {
      source:
        "/:section(inbox|contacts|broadcasts|reminders|leads|ad-campaigns|crm|deals|pipeline|quotations|invoices|court-images|products|templates|tags|analytics|admin|settings|users|profile|search|media|portfolio|connection|help|scout)/:path*",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
      ],
    },
  ],
};
