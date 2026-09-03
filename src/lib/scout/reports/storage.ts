import "server-only";

import { createHash } from "node:crypto";

import type { GetCommandOptions, PutCommandOptions } from "@vercel/blob";

import { prisma } from "@/lib/scout/db";
import { env } from "@/lib/scout/env";

/**
 * Where the generated PDF lives.
 *
 * ## Why this is an interface with one implementation
 *
 * Client requirement **B7** — object storage — has not been answered for this
 * repo. Rather than block the whole phase on it, or guess a provider and ship
 * an unexercised SDK integration, the bytes go into Postgres behind a
 * three-method interface.
 *
 * The host application Site Scout is being folded into **already has
 * `@vercel/blob` configured**, so the replacement is written: `blobStorage()`,
 * at the bottom of this file. It is not installed — see `reportStorage()`.
 *
 * Nothing else in the codebase changes when it is: the report row already
 * stores a `pdf_blob_key`, and the customer-facing link is signed by *this*
 * application rather than by the storage provider (see `signing.ts`), so
 * swapping the backend does not change any URL a customer already holds, and
 * the expiry keeps working.
 *
 * ## Is Postgres a reasonable place for this?
 *
 * At this volume, yes, and it is measured rather than assumed. A report is
 * budgeted at under 5 MB and typically lands well under 1 MB; `neondb` is
 * 16 MB today against a 0.5 GB free tier. A thousand reports at 1 MB would
 * exhaust it, which is the trigger to move — not a hypothetical. The bytes sit
 * in their own table so no ordinary query can drag one through the wire by
 * accident, and `bytea` is TOASTed out of line anyway.
 *
 * What Postgres does **not** give you is a CDN, ranged requests or a storage
 * lifecycle. The link route reads the whole file into memory and sends it.
 * That is fine for a 1 MB document and is exactly the thing object storage
 * would fix.
 */

/** WhatsApp rejects documents above its own limit; stay well under it. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

export class ReportTooLargeError extends Error {
  readonly code = "REPORT_TOO_LARGE";
  constructor(readonly byteSize: number) {
    super(
      `The generated report is ${(byteSize / 1024 / 1024).toFixed(2)} MB, above the ` +
        `${MAX_PDF_BYTES / 1024 / 1024} MB ceiling. WhatsApp refuses documents past its own limit, ` +
        `and it does so at the moment somebody is trying to send one to a customer.`,
    );
    this.name = "ReportTooLargeError";
  }
}

export interface StoredFile {
  readonly key: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly contentType: string;
}

export interface ReportStorage {
  readonly name: string;
  put(reportId: string, bytes: Buffer, contentType?: string): Promise<StoredFile>;
  get(reportId: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  remove(reportId: string): Promise<void>;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const postgresStorage: ReportStorage = {
  name: "postgres",

  async put(reportId, bytes, contentType = "application/pdf") {
    if (bytes.byteLength > MAX_PDF_BYTES) throw new ReportTooLargeError(bytes.byteLength);

    const digest = sha256(bytes);
    // One file per report. A regeneration is a *new report row*, so replacing
    // in place here can only ever mean a retry of the same generation.
    await prisma.reportFile.upsert({
      where: { reportId },
      create: {
        reportId,
        contentType,
        byteSize: bytes.byteLength,
        sha256: digest,
        // Prisma types `Bytes` as `Uint8Array<ArrayBuffer>`; a Node `Buffer` is
        // `Uint8Array<ArrayBufferLike>` and TypeScript will not narrow it.
        data: Uint8Array.from(bytes),
      },
      update: {
        contentType,
        byteSize: bytes.byteLength,
        sha256: digest,
        data: Uint8Array.from(bytes),
      },
    });

    return {
      key: `pg:report_files/${reportId}`,
      sha256: digest,
      byteSize: bytes.byteLength,
      contentType,
    };
  },

  async get(reportId) {
    const row = await prisma.reportFile.findUnique({
      where: { reportId },
      select: { data: true, contentType: true },
    });
    if (!row) return null;
    // Prisma returns `Bytes` as a `Uint8Array`, where Drizzle's `bytea` custom
    // type returned a Node `Buffer`. `Buffer.from` covers both, and the
    // interface still promises a Buffer to its callers.
    return { bytes: Buffer.from(row.data), contentType: row.contentType };
  },

  async remove(reportId) {
    await prisma.reportFile.deleteMany({ where: { reportId } });
  },
};

/**
 * Which implementation is installed.
 *
 * There are two below and this returns the Postgres one, on purpose.
 * `blobStorage()` needs a Blob store and a credential this repository does not
 * have, so installing it here would leave the whole suite — the report
 * pipeline, the `/r/{id}` route, the digest round trip — exercising a path that
 * cannot run. **The swap is a Stage B change, made in the host, after the
 * physical move.** Mirrors `reportDelivery()` in `./delivery.ts`, which is
 * deferred for the same reason.
 */
export function reportStorage(): ReportStorage {
  return postgresStorage;
}

/* ------------------------------------------------------------------------- *
 *  Vercel Blob
 *
 *  Written now, installed later. `reportStorage()` above still returns
 *  `postgresStorage` and must keep doing so until the host wires this up.
 * ------------------------------------------------------------------------- */

/**
 * ## Access control, and why these blobs are private
 *
 * This is the decision that matters in this file, so it is written down rather
 * than left in the options object.
 *
 * A report is one customer's site assessment. `signing.ts` protects it with a
 * link the *application* signs — `/r/{id}?e={expiry}&s={signature}` — which
 * expires, defaults to 90 days, and dies with the report row. `/r/{id}`'s route
 * checks the signature, checks the row's own expiry, and only then reads the
 * bytes. That is the access-control model the rest of the system relies on.
 *
 * A Vercel Blob written with `access: "public"` is readable by anyone who has
 * the URL, for as long as the blob exists. There is no expiry on it, and there
 * is no way to add one. Storing the report that way would create a **second,
 * permanent, unsigned route to the same document**, sitting beside the signed
 * one and quietly outliving it: the 90-day link would lapse exactly as designed
 * while the blob URL kept serving the PDF for ever. `addRandomSuffix` does not
 * fix that — it makes the URL unguessable, not revocable, and the URL is
 * precisely the thing that gets forwarded, logged by a CDN, and pasted into a
 * chat. Security by unguessability is what the HMAC exists to replace.
 *
 * So: **`access: "private"`**. Reads go through `get(pathname, { access:
 * "private" })`, which is authenticated with the store token and is therefore
 * only possible from the server. The blob has no anonymously-readable URL at
 * all. The signed link stays the one and only way a customer reaches the
 * document, the expiry keeps meaning what it says, and `/r/{id}` does not
 * change by a line — it already streams the bytes through the application.
 *
 * `@vercel/blob` v2 does support this; the sketch this file used to carry said
 * public was "Vercel Blob's only mode", and that has not been true since v2
 * added private blobs. It is checked against the installed types, not from
 * memory: `BlobAccessType = 'public' | 'private'`.
 *
 * ### The cost, stated plainly
 *
 * A private blob is not served straight from the CDN to the customer. Every
 * download is proxied by the application — the same as today with Postgres —
 * so this buys correctness and gives up the edge delivery that was one of the
 * reasons to move off `bytea` at all. That is the right trade for a customer's
 * site assessment, and it is reversible in one place if the client decides
 * otherwise.
 *
 * ### What is deliberately *not* used
 *
 * `presignUrl()` mints a Blob-side URL with its own `validUntil`, which looks
 * like it would let the PDF be handed to a customer or to Meta's servers
 * directly. It is not used here, because the expiry would then live in two
 * places with two different clocks and two different revocation stories, and
 * `/r/{id}`'s extra checks — the report row still exists, its status is
 * `generated`, the row's own `expires_at` has not been shortened since — would
 * be bypassed entirely. One expiry, in `signing.ts`.
 *
 * **`delivery.ts` is the one caller that may need to revisit this.** A Cloud
 * API document message gives Meta a `link` its servers fetch unauthenticated;
 * `DeliveryDocument.url` is documented as the signed report link, which works
 * precisely because `/r/{id}` needs no session. Private blobs do not change
 * that. If a future change ever points Meta at a blob URL instead, this
 * decision has to be reopened.
 */

/**
 * The slice of `@vercel/blob` this module uses.
 *
 * Narrowed to three methods and injectable so tests exercise the real logic —
 * the ceiling, the digest, the pathname, the error wrapping — against a stub,
 * with no network and no credentials. The default is the real SDK.
 *
 * The adapter buffers the response stream, so the interface deals in `Buffer`
 * and a stub is four lines rather than a `ReadableStream` fixture.
 */
export interface ReportBlobClient {
  put(
    pathname: string,
    bytes: Buffer,
    options: { readonly contentType: string; readonly token: string },
  ): Promise<{ readonly url: string; readonly pathname: string }>;
  get(
    pathname: string,
    options: { readonly token: string },
  ): Promise<{ readonly bytes: Buffer; readonly contentType: string | null } | null>;
  del(pathname: string, options: { readonly token: string }): Promise<void>;
}

/**
 * A Blob operation failed.
 *
 * Distinct from `ReportTooLargeError`, which is not a storage failure at all —
 * it is a document somebody has to make smaller, and it is raised before
 * anything is uploaded. This one means the store said no.
 */
export class ReportStorageError extends Error {
  readonly code = "REPORT_STORAGE_FAILED";
  constructor(
    readonly operation: "put" | "get" | "remove",
    readonly reportId: string,
    cause: unknown,
  ) {
    super(
      `The report file could not be ${{ put: "stored", get: "read", remove: "deleted" }[operation]}. ` +
        `Blob storage reported: ${redactToken(describeCause(cause))}`,
      { cause },
    );
    this.name = "ReportStorageError";
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  const text = String(cause);
  return text === "[object Object]" ? "no detail beyond the failure itself" : text;
}

/**
 * Strip anything shaped like a store token out of text on its way to a log.
 *
 * Belt and braces. The token is never interpolated into a message here, but it
 * *is* passed to the SDK on every call, and an SDK that ever echoed a request
 * URL or an authorization header into an error message would otherwise put a
 * read/write credential for every report ever generated into the `reports.error`
 * column — which is rendered on screen and, unlike a log, is kept.
 */
function redactToken(text: string): string {
  return text.replace(/vercel_blob_rw_[A-Za-z0-9_-]+/g, "vercel_blob_rw_[redacted]");
}

/**
 * A report id must not be able to steer the pathname.
 *
 * Ids are UUIDs from the database, so this cannot fire today. It is here
 * because the cost is one regex and the failure it prevents is a `../` writing
 * outside the prefix — into whatever else the host keeps in its shared store.
 */
function blobPathname(prefix: string, reportId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(reportId)) {
    throw new Error(`Refusing to build a blob pathname from an unexpected report id: ${reportId}`);
  }
  return `${prefix}/${reportId}.pdf`;
}

async function bufferStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * The options every report upload is written with.
 *
 * Exported, and typed as the SDK's own `PutCommandOptions`, for two reasons:
 * `tsc` then checks the shape against the installed `@vercel/blob` rather than
 * against a hand-copied guess, and a test can assert `access: "private"`
 * directly instead of grepping this file. The access decision is the one thing
 * here that is a security property rather than a tuning knob, and it needs to
 * be provable without a Blob store.
 */
export function reportPutOptions(contentType: string, token: string): PutCommandOptions {
  return {
    // See the access-control note above. Never "public".
    access: "private",
    contentType,
    token,
    // The pathname is derived from the report id, so it must be stable:
    // `get` and `del` recompute it rather than reading it back off the row.
    addRandomSuffix: false,
    // A regeneration mints a *new* report id and therefore a new pathname (see
    // the header). The only write that can land on an existing pathname is a
    // retry of one generation, so overwriting is the correct behaviour and
    // matches the Postgres implementation's upsert.
    allowOverwrite: true,
    // The document is immutable for the life of its id. Five minutes still
    // bounds the one case where it is not — a retry after `put` succeeded but
    // the row write failed — so a stale edge copy cannot outlive the
    // generation that replaced it.
    cacheControlMaxAge: 300,
  };
}

/**
 * The options every report read is made with.
 *
 * `access: "private"` here is not a request for privacy — it tells the SDK to
 * authenticate the read. It must match how the blob was written, so the two
 * builders sit next to each other.
 */
export function reportGetOptions(token: string): GetCommandOptions {
  return { access: "private", token };
}

/** The real SDK, adapted to `ReportBlobClient`. Never constructed in tests. */
const vercelBlobClient: ReportBlobClient = {
  async put(pathname, bytes, options) {
    const { put } = await import("@vercel/blob");
    const result = await put(pathname, bytes, reportPutOptions(options.contentType, options.token));
    return { url: result.url, pathname: result.pathname };
  },

  async get(pathname, options) {
    const { get } = await import("@vercel/blob");
    const result = await get(pathname, reportGetOptions(options.token));
    if (!result) return null;
    // A 304. Nothing conditional is sent, so this is unreachable; treating it
    // as a miss is safer than asserting a stream that is typed as null.
    if (result.statusCode !== 200) return null;
    return { bytes: await bufferStream(result.stream), contentType: result.blob.contentType };
  },

  async del(pathname, options) {
    const { del } = await import("@vercel/blob");
    await del(pathname, { token: options.token });
  },
};

export interface BlobStorageOptions {
  /** Defaults to the real `@vercel/blob`. Tests pass a stub. */
  readonly client?: ReportBlobClient;
  /** Defaults to `env.reportBlobPrefix` (`REPORT_BLOB_PREFIX`, else `reports`). */
  readonly prefix?: string;
  /** Defaults to `env.requireBlobReadWriteToken()`. Tests pass a dummy. */
  readonly token?: string;
}

/**
 * Report PDFs in Vercel Blob, private, behind the application's signed link.
 *
 * **Not installed.** `reportStorage()` returns `postgresStorage`. This is wired
 * up in the host, in Stage B.
 *
 * `put` returns the blob URL as `key`, so `reports.pdf_blob_key` holds a URL
 * rather than a `pg:` locator once this is installed. Nothing reads that column
 * to fetch the file — `get` and `remove` take a report id and recompute the
 * pathname — so the column is a record of where the bytes went, and an old
 * `pg:` value in a row generated before the swap does not break anything.
 */
export function blobStorage(options: BlobStorageOptions = {}): ReportStorage {
  const client = options.client ?? vercelBlobClient;
  // Resolved per call, never at module scope: reading a required variable on
  // import would make merely importing this module throw in every environment
  // that has not configured Blob yet — including this repository's test suite.
  const token = () => options.token ?? env.requireBlobReadWriteToken();
  const prefix = () => options.prefix ?? env.reportBlobPrefix;

  return {
    name: "vercel-blob",

    async put(reportId, bytes, contentType = "application/pdf") {
      // Before the upload, and before the credential is even read. An
      // oversized report is not a storage problem: under the `wa.me` flow it
      // merely failed to attach, but `cloudApiDelivery` makes it a hard refusal
      // from Meta in front of the customer, so it must fail here, saying what
      // is too big and what to do — not "upload failed".
      if (bytes.byteLength > MAX_PDF_BYTES) throw new ReportTooLargeError(bytes.byteLength);

      const digest = sha256(bytes);
      const pathname = blobPathname(prefix(), reportId);

      let url: string;
      try {
        ({ url } = await client.put(pathname, bytes, { contentType, token: token() }));
      } catch (cause) {
        throw new ReportStorageError("put", reportId, cause);
      }

      return { key: url, sha256: digest, byteSize: bytes.byteLength, contentType };
    },

    async get(reportId) {
      const pathname = blobPathname(prefix(), reportId);

      let found: { bytes: Buffer; contentType: string | null } | null;
      try {
        found = await client.get(pathname, { token: token() });
      } catch (cause) {
        // A missing blob is `null`, not a throw. Anything that does throw is a
        // real failure — an expired token, a suspended store — and must not be
        // flattened into "not found", which `/r/{id}` renders as a 404 telling
        // a customer their perfectly good link is invalid.
        throw new ReportStorageError("get", reportId, cause);
      }
      if (!found) return null;

      return { bytes: found.bytes, contentType: found.contentType ?? "application/pdf" };
    },

    async remove(reportId) {
      const pathname = blobPathname(prefix(), reportId);
      try {
        await client.del(pathname, { token: token() });
      } catch (cause) {
        throw new ReportStorageError("remove", reportId, cause);
      }
    },
  };
}
