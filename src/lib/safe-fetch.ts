// fetch() for save / send / delete buttons. It never throws on a network drop
// and never hands back an HTML error page:
// - offline, or the connection dropped → a 503 with a readable JSON error;
// - a crashed or timed-out request (an HTML error page) → JSON with its status.
// So the caller's usual `if (!res.ok) toast.error(data.error)` path always
// runs, and "Saving…" buttons always reset. Successful responses are untouched;
// a deliberate cancel (AbortController) still throws, as with fetch().

// Careful wording: the request may have reached the server before the
// connection dropped, so "just try again" could send or save something twice.
const NETWORK_ERROR = "Connection problem — this may not have gone through. Please check before trying again.";

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    return jsonError(NETWORK_ERROR, 503);
  }
  if (!res.ok && !(res.headers.get("content-type") ?? "").includes("application/json")) {
    return jsonError(`Something went wrong on the server (error ${res.status}). Please try again.`, res.status);
  }
  return res;
}
