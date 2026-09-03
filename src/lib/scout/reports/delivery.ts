/**
 * How a finished report reaches the person it was written for.
 *
 * ## Why this is an interface rather than a `wa.me` call
 *
 * Client answer **E1** was "share link", so the shipped implementation is a
 * `wa.me` deep link: the salesperson opens WhatsApp with the message already
 * written, picks the recipient themselves, and sends from their own number.
 * Nothing is sent on anyone's behalf, no Business API, no Meta verification, no
 * template approval — and that was the right call for a build with no messaging
 * infrastructure.
 *
 * The host application Site Scout is being folded into **already has the
 * WhatsApp Cloud API wired up and sending**. That changes what is possible:
 * a report could be delivered from a company number, programmatically, with a
 * delivery receipt — the thing originally costed as out of scope.
 *
 * `cloudApiDelivery` below is that implementation, written against a one-function
 * injection seam (`WhatsAppDocumentSender`) rather than against the host's
 * module directly, because this repository cannot see that module and inventing
 * an import path for it would be shipping code nobody can compile. The host
 * supplies the function in Stage B.
 *
 * **`reportDelivery()` still returns `waMeDelivery`, and the swap happens in the
 * host, not here.** Flipping the factory in this repository would leave the
 * whole suite exercising a code path with no credentials behind it. And
 * `waMeDelivery` is not a stepping stone to be deleted afterwards: it is the
 * fallback for every case the Cloud API cannot serve — no approved template, a
 * recipient whose number nobody has, a token outage mid-demo.
 *
 * ## The one thing the interface has to make visible
 *
 * `mode`. A handoff and a send are different promises. With `wa.me` the
 * application has **not** delivered anything — it has opened a compose window,
 * and whether the message was sent is unknown to us. With the Cloud API it has,
 * and there is a provider id to prove it. A caller that cannot tell those apart
 * will eventually write "Sent to Deepa" on a dashboard for a message nobody
 * sent. So `mode` is on the result, not implied by which implementation
 * happens to be installed, and the UI wording keys off it.
 *
 * ## What a `CloudApiDelivery` has to do that this one does not
 *
 * - Send to a phone number, which means collecting and validating one. Today
 *   the recipient is a *name*, recorded for the dashboard; a number is a
 *   different field with different consent implications.
 * - Handle the 24-hour customer-service window: outside it, only an approved
 *   template may be sent, which means a template per report type and an
 *   approval round with Meta.
 * - Persist the provider message id and reconcile delivery webhooks against it.
 *
 * None of that changes the report, the PDF or the signed link, which is the
 * point of putting the boundary here.
 */

import { shareMessage, whatsappShareUrl, type ShareMessageInput } from "./share";

export type DeliveryMode =
  /** The application prepared a message; a person sends it. */
  | "handoff"
  /** The application sent it, and can say so. */
  | "sent";

export interface DeliveryRequest extends ShareMessageInput {
  readonly channel: "whatsapp" | "pdf" | "email";

  /**
   * The customer's WhatsApp number in E.164 (`+919876543210`).
   *
   * Optional because `waMeDelivery` must never have one: it deliberately opens
   * WhatsApp's own contact picker rather than guessing which of a customer's
   * numbers they use. An implementation whose `mode` is `"sent"` requires it,
   * and says so rather than sending to nobody.
   */
  readonly recipientPhone?: string | null;

  /**
   * The generated PDF, for an implementation that attaches it itself.
   *
   * `waMeDelivery` never reads this — under a deep link the customer opens the
   * signed page (`url`) and downloads from there. A Cloud API document message
   * needs the file, and needs to know how big it is before it tries.
   */
  readonly document?: DeliveryDocument | null;
}

/** The report PDF as a sending implementation needs to see it. */
export interface DeliveryDocument {
  /**
   * A URL Meta's servers can fetch the bytes from, unauthenticated. The signed
   * report link works: it carries its own expiry and signature in the query.
   */
  readonly url: string;
  /** What the file is called in the customer's chat. Include the extension. */
  readonly filename: string;
  /** Byte length, checked against the ceiling *before* a send is attempted. */
  readonly byteSize: number;
}

export interface DeliveryResult {
  readonly channel: "whatsapp" | "pdf" | "email";
  readonly mode: DeliveryMode;
  /** The URL a person opens to finish the send. `null` when `mode` is "sent". */
  readonly handoffUrl: string | null;
  /** The provider's id for a message actually sent. `null` for a handoff. */
  readonly providerMessageId: string | null;
  /** The message body, so the caller can show what will be, or was, sent. */
  readonly message: string;
}

export interface ReportDelivery {
  readonly name: string;
  readonly mode: DeliveryMode;
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
}

/**
 * The shipped implementation: a `wa.me` deep link with no phone number in it,
 * so WhatsApp opens its own contact picker.
 *
 * Deliberately not pre-filling the recipient. The application knows a
 * *customer name* on the scan; it does not know which of that person's numbers
 * they use for WhatsApp, and guessing wrong sends a customer's site assessment
 * to a stranger.
 */
export const waMeDelivery: ReportDelivery = {
  name: "wa.me",
  mode: "handoff",

  async deliver(request) {
    const message = shareMessage(request);
    return {
      channel: request.channel,
      mode: "handoff",
      handoffUrl: whatsappShareUrl(message),
      providerMessageId: null,
      message,
    };
  },
};

/**
 * Which implementation is installed.
 *
 * A function, not a constant, so a host application can swap it without this
 * module's importers changing.
 *
 * There are two implementations below and this returns the handoff one, on
 * purpose. `cloudApiDelivery` needs a sender only the host can supply and
 * credentials this repository does not have, so installing it here would leave
 * the suite exercising a path that cannot run. **The swap is a Stage B change,
 * made in the host.**
 */
export function reportDelivery(): ReportDelivery {
  return waMeDelivery;
}

/* ------------------------------------------------------------------------- *
 *  WhatsApp Cloud API
 *
 *  Written now, installed later. `reportDelivery()` above still returns
 *  `waMeDelivery` and must keep doing so until the host wires this up in
 *  Stage B — that is what keeps this repository's test suite meaningful.
 * ------------------------------------------------------------------------- */

/**
 * The document ceiling, mirroring `MAX_PDF_BYTES` in `./storage.ts`.
 *
 * Re-declared rather than imported, deliberately. `storage.ts` opens with
 * `import "server-only"` and pulls in `@/db`, which builds a connection pool at
 * module scope. *This* module is imported by two `"use client"` screens
 * (`ReportStudio.tsx`, `ReportScreen.tsx`) for `deliveryNote(reportDelivery().mode)`,
 * so importing the constant would drag `server-only` and the database into the
 * browser bundle and fail the build.
 *
 * The drift that invites is closed at the wiring point instead:
 * `cloudApiDelivery` takes `maxDocumentBytes`, and Stage B should pass the real
 * `MAX_PDF_BYTES` there, from a server module that may legally import it.
 */
export const MAX_WHATSAPP_DOCUMENT_BYTES = 5 * 1024 * 1024;

/* -------------------------------------------------------- the injection seam */

/**
 * ## What the host must implement in Stage B
 *
 * The whole seam is one function. The host has its own `whatsapp-delivery.ts`
 * with the Cloud API access token, the Graph endpoint, retries and whatever
 * else it already does; this module has no business knowing any of it, and
 * pointedly does not — see the "no secrets" note below.
 *
 * ```ts
 * // in the host, at the wiring point — NOT in this file
 * import { sendWhatsAppMessage } from "@/lib/scout/whatsapp-delivery";
 * import { cloudApiDelivery, type WhatsAppDocumentSender } from "@/lib/scout/reports/delivery";
 *
 * const send: WhatsAppDocumentSender = async (message) => {
 *   // …translate `message` into whatever shape the host module takes,
 *   // await it, and map the outcome onto WhatsAppSendResult.
 * };
 *
 * export const delivery = cloudApiDelivery({ send });
 * ```
 *
 * ### The contract, precisely
 *
 * - **Resolve, do not reject, on a Cloud API error.** Return
 *   `{ ok: false, failure }` carrying Meta's own `error` object. A rejection is
 *   tolerated (it is normalised into a `CloudApiSendError`) but it throws away
 *   the fields that tell an expired token apart from an unapproved template
 *   apart from a bad number, and those are the three things that actually go
 *   wrong. Rejecting is the lossy path; returning is the contract.
 * - **Reject only for what is genuinely exceptional** — a socket that never
 *   opened, a body that was not JSON.
 * - **Send exactly what it is given.** Do not substitute a plain text message
 *   when the template lookup fails; that is the silent failure this seam exists
 *   to prevent (see `templateName` below).
 * - **Never log the token or the request headers.** Nothing in this file has
 *   access to either, which is the point of the seam being drawn here: the
 *   credential lives on the host's side of it and cannot leak through a stack
 *   trace this module produces.
 */
export type WhatsAppDocumentSender = (
  message: WhatsAppDocumentMessage,
) => Promise<WhatsAppSendResult>;

/** Everything the host needs to build one Cloud API request. Nothing secret. */
export interface WhatsAppDocumentMessage {
  /** Recipient, E.164 with the leading `+`. */
  readonly to: string;
  /** Which business number to send from — the Cloud API phone number id. */
  readonly fromPhoneNumberId: string;
  /** The approved template. A business-initiated message may use nothing else. */
  readonly template: {
    readonly name: string;
    readonly language: string;
    /** Positional `{{1}}`, `{{2}}`… substitutions for the template body. */
    readonly bodyVariables: readonly string[];
  };
  /** Goes in the template's document header component. */
  readonly document: {
    readonly link: string;
    readonly filename: string;
  };
}

export type WhatsAppSendResult =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly failure: WhatsAppApiFailure };

/**
 * Meta's structured error, flattened.
 *
 * Every field is optional because Meta does not promise all of them, and a
 * partially-filled failure is still far more use than "request failed". `code`
 * 190 is an expired or revoked token, 132001 an unapproved or missing template,
 * 131026 a number that cannot receive — which is exactly the discrimination the
 * person holding the phone needs.
 */
export interface WhatsAppApiFailure {
  readonly httpStatus?: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly message?: string;
  /** Meta's `error_data.details`, usually the most specific string available. */
  readonly details?: string;
  readonly fbtraceId?: string;
}

/* ------------------------------------------------------------------ errors */

/**
 * Something the deployment has not been told, or has been told wrongly.
 *
 * Separate from a send failure because the fix is different: this one is an
 * environment variable or a missing argument, not a retry.
 */
export class DeliveryConfigurationError extends Error {
  readonly code = "DELIVERY_CONFIGURATION";
  constructor(message: string) {
    super(message);
    this.name = "DeliveryConfigurationError";
  }
}

/**
 * The PDF is past the ceiling.
 *
 * Its own class because it is the one failure a salesperson can clear without
 * anybody's help, and the message says how.
 */
export class DocumentTooLargeError extends Error {
  readonly code = "DOCUMENT_TOO_LARGE";
  constructor(
    readonly byteSize: number,
    readonly maxBytes: number,
  ) {
    super(
      `This report is ${(byteSize / 1024 / 1024).toFixed(2)} MB and WhatsApp will not accept a ` +
        `document over ${(maxBytes / 1024 / 1024).toFixed(0)} MB, so the send would fail on the ` +
        `customer's screen rather than here. Open the report, switch off the heaviest optional ` +
        `sections — the map image and any photos are almost always the cause — and generate it ` +
        `again. The signed link is unaffected: you can send the link on its own right now and ` +
        `follow up with the file.`,
    );
    this.name = "DocumentTooLargeError";
  }
}

/** A send the Cloud API refused, with as much of Meta's own body as survived. */
export class CloudApiSendError extends Error {
  readonly code = "CLOUD_API_SEND_FAILED";
  constructor(readonly failure: WhatsAppApiFailure) {
    super(`WhatsApp refused the message. ${describeFailure(failure)}`);
    this.name = "CloudApiSendError";
  }
}

/**
 * Turn Meta's error object into one line that names the actual problem.
 *
 * The three codes below are called out because they are the three that happen,
 * they look identical in a generic handler, and they have completely different
 * fixes — one is an operations job, one is a Meta approval, one is a typo.
 * Anything else is passed through rather than flattened, so an unfamiliar code
 * still arrives intact instead of becoming "request failed".
 */
function describeFailure(failure: WhatsAppApiFailure): string {
  const parts: string[] = [];

  switch (failure.code) {
    case 190:
      parts.push(
        "The access token has expired or been revoked — this is a configuration problem, not " +
          "anything about this report or this customer. Nobody should retry until it is reissued.",
      );
      break;
    case 132000:
    case 132001:
    case 132005:
    case 132007:
      parts.push(
        "The template was rejected — it is missing, not approved, or the values supplied do not " +
          "match the approved wording. Sending will keep failing until the template is fixed " +
          "with Meta.",
      );
      break;
    case 131026:
    case 131030:
      parts.push(
        "The number cannot receive this message. Check the digits and the country code, and " +
          "confirm the customer uses WhatsApp on that number.",
      );
      break;
    default:
      break;
  }

  // Meta's own words, kept verbatim and last, so an unrecognised failure is
  // still diagnosable from the log line alone.
  const raw = [
    failure.details ?? failure.message,
    failure.type,
    failure.code === undefined ? undefined : `code ${failure.code}`,
    failure.subcode === undefined ? undefined : `subcode ${failure.subcode}`,
    failure.httpStatus === undefined ? undefined : `HTTP ${failure.httpStatus}`,
    failure.fbtraceId === undefined ? undefined : `fbtrace_id ${failure.fbtraceId}`,
  ].filter((part): part is string => Boolean(part));

  if (raw.length > 0) parts.push(`WhatsApp reported: ${raw.join(" · ")}.`);
  if (parts.length === 0) parts.push("WhatsApp gave no detail beyond refusing it.");

  return parts.join(" ");
}

/* ----------------------------------------------------------- configuration */

/**
 * The settings that change per deployment.
 *
 * None of these is a secret — the access token stays on the host's side of the
 * seam and is never read here.
 */
export interface CloudApiConfig {
  /**
   * `WHATSAPP_PHONE_NUMBER_ID` — the Cloud API id of the number to send from.
   *
   * Configuration rather than source because it will change: a second number, a
   * different market, a test number during rollout. The production number as of
   * this writing is a business number in India; which one it is belongs in the
   * deployment's environment, not in a file in git.
   */
  readonly phoneNumberId: string;

  /**
   * `WHATSAPP_SENDER_NUMBER` — optional, human-readable, diagnostics only.
   *
   * Never sent anywhere. It exists so an error can say which number a failing
   * send was going out from without anyone having to look up a numeric id.
   */
  readonly senderDisplayNumber: string | null;

  /**
   * `WHATSAPP_REPORT_TEMPLATE` — the approved template name.
   *
   * A report going to a customer who has not messaged in the last 24 hours is
   * business-initiated, and WhatsApp permits only a pre-approved template for
   * that. As of this writing **nobody has confirmed such a template exists**,
   * so an unset value is a hard failure here rather than a quiet downgrade to a
   * plain text message. The downgrade is the worse outcome by a distance: it
   * looks like it worked, and it fails at Meta, in front of the customer.
   */
  readonly templateName: string;

  /** `WHATSAPP_REPORT_TEMPLATE_LANGUAGE` — the template's locale. Defaults to `en`. */
  readonly templateLanguage: string;
}

/** The `.env.example` placeholder is not a value. Mirrors `src/lib/env.ts`. */
function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return !value || value === "PASTE_HERE" ? undefined : value;
}

/**
 * Resolve settings, overrides first, environment second.
 *
 * Read lazily inside `deliver()` and never at module scope: this module is
 * imported by client components, and evaluating environment access on import
 * would run in the browser bundle where none of it is defined.
 */
function resolveConfig(overrides?: Partial<CloudApiConfig>): CloudApiConfig {
  const phoneNumberId = overrides?.phoneNumberId ?? envValue("WHATSAPP_PHONE_NUMBER_ID");
  if (!phoneNumberId) {
    throw new DeliveryConfigurationError(
      "WHATSAPP_PHONE_NUMBER_ID is not set, so there is no number to send from. Put the Cloud " +
        "API phone number id of the business number in the deployment environment. It is the " +
        "numeric id from the WhatsApp Manager, not the dialling number itself.",
    );
  }

  const templateName = overrides?.templateName ?? envValue("WHATSAPP_REPORT_TEMPLATE");
  if (!templateName) {
    throw new DeliveryConfigurationError(
      "WHATSAPP_REPORT_TEMPLATE is not set. A report sent to a customer who has not messaged in " +
        "the last 24 hours is business-initiated, and WhatsApp accepts only a pre-approved " +
        "template for that. Get a template approved with a document header, then set its name " +
        "here. Nothing is sent as plain text instead — WhatsApp would refuse it in front of the " +
        "customer, which is worse than refusing it here.",
    );
  }

  return {
    phoneNumberId,
    senderDisplayNumber:
      overrides?.senderDisplayNumber ?? envValue("WHATSAPP_SENDER_NUMBER") ?? null,
    templateName,
    templateLanguage:
      overrides?.templateLanguage ?? envValue("WHATSAPP_REPORT_TEMPLATE_LANGUAGE") ?? "en",
  };
}

/**
 * E.164, checked only as far as it can be checked without a lookup.
 *
 * Leading `+`, then 8 to 15 digits. Enough to catch a local number typed
 * without a country code, which is the mistake that actually happens, without
 * pretending to know which number ranges a carrier has issued.
 */
export function normaliseE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.replace(/[\s()\-.]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

/* ------------------------------------------------------------ the delivery */

export interface CloudApiDeliveryOptions {
  /** The one thing the host provides. See `WhatsAppDocumentSender`. */
  readonly send: WhatsAppDocumentSender;

  /**
   * Settings that would otherwise come from the environment. The host normally
   * passes nothing; tests pass everything, so they never touch `process.env`.
   */
  readonly config?: Partial<CloudApiConfig>;

  /** Defaults to `MAX_WHATSAPP_DOCUMENT_BYTES`. See the note on that constant. */
  readonly maxDocumentBytes?: number;

  /**
   * How the report becomes the template's positional variables.
   *
   * Overridable because the approved template does not exist yet, so its shape
   * is genuinely unknown; the default below is a guess at a sensible one and
   * must be checked against the real template before Stage B ships. Guessing
   * wrong is not silent — Meta rejects a mismatched parameter count with code
   * 132000, which `describeFailure` names.
   */
  readonly templateVariables?: (request: DeliveryRequest) => readonly string[];
}

/** Recipient, area, catchment, expiry. Positional `{{1}}`–`{{4}}`. */
function defaultTemplateVariables(request: DeliveryRequest): readonly string[] {
  return [
    request.recipientName?.trim() || "there",
    request.areaLabel,
    request.radiusLabel,
    request.expiresOnLabel ?? "the date in the report",
  ];
}

/**
 * Send the report from the company number, over the WhatsApp Cloud API.
 *
 * `mode` is `"sent"`, and that is a stronger claim than `waMeDelivery` makes:
 * there is a provider message id on the result and a dashboard may honestly say
 * the thing was delivered.
 *
 * **Not installed.** `reportDelivery()` returns `waMeDelivery`. This is wired up
 * in the host, in Stage B, against the host's own Cloud API module.
 *
 * A channel other than `"whatsapp"` falls through to `waMeDelivery` rather than
 * failing: the Cloud API is not the right sender for a `"pdf"` or `"email"`
 * share, and the result carries `mode: "handoff"`, so no caller is misled about
 * what happened. That is precisely why `mode` lives on the result.
 */
export function cloudApiDelivery(options: CloudApiDeliveryOptions): ReportDelivery {
  const maxDocumentBytes = options.maxDocumentBytes ?? MAX_WHATSAPP_DOCUMENT_BYTES;
  const buildVariables = options.templateVariables ?? defaultTemplateVariables;

  return {
    name: "whatsapp-cloud-api",
    mode: "sent",

    async deliver(request) {
      if (request.channel !== "whatsapp") return waMeDelivery.deliver(request);

      // Configuration first: a deployment that cannot send should say so before
      // anyone reads a file or formats a message.
      const config = resolveConfig(options.config);

      const to = normaliseE164(request.recipientPhone);
      if (!to) {
        throw new DeliveryConfigurationError(
          "A WhatsApp number is needed to send this report, and the one on the share is missing " +
            "or is not in international format. Enter it with the country code and a leading " +
            "plus, for example +919876543210.",
        );
      }

      const document = request.document;
      if (!document) {
        throw new DeliveryConfigurationError(
          "The generated report file was not passed to the delivery step, so there is nothing to " +
            "attach. Generate the report before sending it.",
        );
      }

      // Before the send, not after. Over a deep link an oversized PDF merely
      // failed to attach and the link still worked; as a Cloud API document it
      // is a hard refusal, and finding out from Meta is finding out too late.
      if (document.byteSize > maxDocumentBytes) {
        throw new DocumentTooLargeError(document.byteSize, maxDocumentBytes);
      }

      const message = shareMessage(request);

      let result: WhatsAppSendResult;
      try {
        result = await options.send({
          to,
          fromPhoneNumberId: config.phoneNumberId,
          template: {
            name: config.templateName,
            language: config.templateLanguage,
            bodyVariables: buildVariables(request),
          },
          document: { link: document.url, filename: document.filename },
        });
      } catch (cause) {
        // A sender that rejected rather than returning. Lossy, and the seam
        // documentation says not to, but losing the diagnosis entirely would be
        // worse than salvaging what is on the error.
        throw new CloudApiSendError(failureFromUnknown(cause, config));
      }

      if (!result.ok) throw new CloudApiSendError(result.failure);

      return {
        channel: request.channel,
        mode: "sent",
        // Nothing left for a person to do, so there is no handoff URL to give
        // them. A caller that shows one anyway would be inviting a second send.
        handoffUrl: null,
        providerMessageId: result.messageId,
        // The substance of what the customer received. Under a template the
        // exact wording on the wire is Meta's approved copy with
        // `template.bodyVariables` substituted, which this module cannot
        // reproduce; this is the same text the handoff path shows, and it
        // carries the same facts.
        message,
      };
    },
  };
}

/**
 * Salvage a structured failure from a sender that threw.
 *
 * Reads the shapes the Graph API and the common wrappers actually produce
 * without trusting any of them, and never assumes a field is a string.
 */
function failureFromUnknown(cause: unknown, config: CloudApiConfig): WhatsAppApiFailure {
  const from = config.senderDisplayNumber
    ? ` (sending from ${config.senderDisplayNumber})`
    : ` (sending from phone number id ${config.phoneNumberId})`;

  if (typeof cause !== "object" || cause === null) {
    return { message: `${String(cause)}${from}` };
  }

  const record = cause as Record<string, unknown>;
  const nested =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : record;
  const errorData =
    typeof nested.error_data === "object" && nested.error_data !== null
      ? (nested.error_data as Record<string, unknown>)
      : undefined;

  const num = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  const message = str(nested.message) ?? str(record.message);

  return {
    httpStatus: num(record.status) ?? num(nested.status),
    code: num(nested.code),
    subcode: num(nested.error_subcode),
    type: str(nested.type),
    message: message === undefined ? `Unknown send failure${from}` : `${message}${from}`,
    details: str(errorData?.details),
    fbtraceId: str(nested.fbtrace_id),
  };
}

/** Wording that must change with the mode, kept next to the mode itself. */
export function deliveryNote(mode: DeliveryMode): string {
  return mode === "sent"
    ? "Sent from the company WhatsApp number. The delivery receipt is recorded against this report."
    : "WhatsApp opens with the message written and the link in it. You pick the recipient and send " +
        "it from your own number — nothing is sent on your behalf.";
}
