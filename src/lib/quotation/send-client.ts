// Browser-side "send this quote to the customer". The server refuses a second
// send of the same quote within 10 minutes unless it's confirmed (409
// "recently_sent"), so a double click, a second tab or a retried request can't
// send the customer a duplicate. This asks the user and re-sends only on "OK".
//
// Returns the final response, or null when the user chose not to re-send.
export async function postQuoteSend(id: string, body: Record<string, unknown> = {}): Promise<Response | null> {
  const post = (extra: Record<string, unknown> = {}) =>
    fetch(`/api/quotations/${id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
    });

  const res = await post();
  if (res.status !== 409) return res;
  const data = await res
    .clone()
    .json()
    .catch(() => ({}));
  if (data?.error !== "recently_sent") return res;

  const mins = data.sentAt ? Math.round((Date.now() - new Date(data.sentAt).getTime()) / 60_000) : 0;
  const when = mins >= 1 ? `${mins} minute${mins === 1 ? "" : "s"} ago` : "a moment ago";
  if (!window.confirm(`This quote was already sent ${when}. Send it to the customer again?`)) return null;
  return post({ confirmResend: true });
}
