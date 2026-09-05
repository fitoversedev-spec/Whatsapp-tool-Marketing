/**
 * WhatsApp sharing — a `wa.me` deep link, per client answer **E1**.
 *
 * The salesperson picks the recipient inside WhatsApp and sends from their own
 * number. No Business API, no dedicated number, no Meta verification, no
 * template approval. That was the client's choice and it is also the one that
 * puts a person's name on the message rather than a brand's.
 *
 * ## What goes in the message, and what does not
 *
 * Area, radius, the headline verdict with its score, and the signed link.
 * Deliberately **not** the component breakdown — a WhatsApp preview that
 * carried the number and a paragraph of justification would let a reader stop
 * at the message, and the rule this build is organised around is that the
 * score never travels without its five components. The message says the number
 * is explained in the report and points at it.
 *
 * Pure. The signed URL is minted elsewhere and passed in.
 */

export interface ShareMessageInput {
  readonly areaLabel: string;
  readonly radiusLabel: string;
  readonly verdictLabel: string | null;
  readonly scoreTotal: number | null;
  readonly basisLabel: string | null;
  readonly url: string;
  readonly preparedBy: string;
  readonly recipientName?: string | null;
  /** ISO-8601 date the link stops working, already formatted for a reader. */
  readonly expiresOnLabel: string | null;
  readonly caption?: string | null;
}

/** The pre-filled WhatsApp body. Plain text — WhatsApp renders no markup. */
export function shareMessage(input: ShareMessageInput): string {
  const lines: string[] = [];
  const greeting = input.recipientName?.trim();
  lines.push(greeting ? `Hi ${greeting},` : "Hi,");
  lines.push("");
  lines.push(
    `Here is the Site Scout report for ${input.areaLabel} — a ${input.radiusLabel} catchment.`,
  );

  if (input.verdictLabel && input.scoreTotal !== null) {
    const basis = input.basisLabel ? ` (${input.basisLabel.toLowerCase()})` : "";
    lines.push(
      `Headline: ${input.verdictLabel} — ${Math.round(input.scoreTotal)} out of 100${basis}. ` +
        `The report shows all five components behind that number.`,
    );
  } else {
    lines.push("The report sets out what the scan found, category by category.");
  }

  lines.push("");
  lines.push(input.url);
  if (input.expiresOnLabel) lines.push(`(This link works until ${input.expiresOnLabel}.)`);
  if (input.caption?.trim()) {
    lines.push("");
    lines.push(input.caption.trim());
  }

  lines.push("");
  lines.push(
    `${input.preparedBy} · Fitoverse. It is a desk survey for screening — happy to walk through it.`,
  );

  return lines.join("\n");
}

/**
 * The `wa.me` URL.
 *
 * No phone number in the path: WhatsApp then opens its own contact picker,
 * which is the correct interaction. A salesperson knows who they are sending
 * to; the application does not, and it must not guess from a scan's customer
 * name and get it wrong in front of the customer.
 */
export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/**
 * Whether a recipient name is worth recording.
 *
 * The dashboard shows "Sent to Deepa", so the name is asked for at share time
 * and stored — but an empty box is not a failure, and a blank string must not
 * become the literal name on a card.
 */
export function normaliseRecipient(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, 200);
  return value.length > 0 ? value : null;
}
