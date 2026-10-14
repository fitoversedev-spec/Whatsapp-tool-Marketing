/**
 * Copies ids from the URL path into the JSON body before withAgent sees the
 * request. withAgent stores only the body when it queues an approval, so an
 * approval for "PATCH /leads/{id}/phone" that left the id in the path would
 * lose which lead it was about. The path always wins over anything the caller
 * put in the body under the same name.
 */
type RouteFn = (req: Request, routeCtx?: { params?: Record<string, string> }) => Promise<Response>;

/** `map` is { pathParam: bodyKey }, e.g. { id: "leadId" }. */
export function withPathIds(route: RouteFn, map: Record<string, string>): RouteFn {
  return async (req, routeCtx) => {
    const text = await req.text();
    let body: Record<string, unknown> = {};
    if (text.trim()) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return route(rebuild(req, text), routeCtx);
        body = parsed as Record<string, unknown>;
      } catch {
        // Not JSON: let withAgent report it in the standard error shape.
        return route(rebuild(req, text), routeCtx);
      }
    }
    const params = routeCtx?.params ?? {};
    for (const [param, key] of Object.entries(map)) body[key] = params[param];
    return route(rebuild(req, JSON.stringify(body)), routeCtx);
  };
}

function rebuild(req: Request, body: string): Request {
  const headers = new Headers(req.headers);
  // The body length changed; a stale Content-Length would be wrong.
  headers.delete("content-length");
  return new Request(req.url, { method: req.method, headers, body });
}
