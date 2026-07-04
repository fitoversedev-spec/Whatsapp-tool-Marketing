// Chatbot flow dispatcher. Called from the WhatsApp webhook. Responsible
// for:
//   1. Starting a flow (greeting keyword or 4h+ timeout expired)
//   2. Advancing an active flow when the customer replies
//   3. Handing off to off-script when we can't parse the reply
//   4. Writing a BotLead row when the flow completes
//   5. Chaining catalogue-send + terminal steps in one turn
//
// Returns `true` if the flow claimed the message (so the legacy
// auto-reply dispatcher skips), `false` if the flow decided this
// message isn't its problem (falls through to L1/C1/A1 rules).

import { prisma } from "@/lib/prisma";
import {
  sendText,
  sendButtons,
  sendList,
  sendMedia,
  sendImageButtons,
} from "@/lib/whatsapp";
import { getSportMeta, type SportKey } from "@/lib/catalogue/sport-meta";
import {
  listProductsBySport,
  htmlToWhatsappText,
  type MvpProduct,
} from "@/lib/mvpv2/products";
import {
  getStep,
  type CollectedData,
  type StepSend,
} from "./steps";

// How many products to send when the customer picks a sport. Each
// product goes as one interactive message (image + short body + two
// quick-reply buttons), which arrive ~1/sec. 5 is a good balance
// between "real preview" and "not spammy".
const PRODUCTS_TO_SHOW = 5;

// The short description shown in each product's interactive body.
// WhatsApp interactive body limit is 1024 chars — we leave headroom
// so the *name* line + description + product page URL all fit.
const PRODUCT_SHORT_DESC_LIMIT = 500;

// When the customer taps "Read more" we send the full description
// as one or more text messages. WhatsApp text bodies cap at 4096
// chars; we chunk on paragraph boundaries below.
const PRODUCT_FULL_DESC_CHUNK = 3800;

// MVPv2 web base for the "View full details on our site" link. The
// per-product page is /products/<id>. Override via env if MVPv2 ever
// moves off fitoverse.vercel.app.
const MVPV2_WEB_URL = (
  process.env.MVPV2_WEB_URL ?? "https://fitoverse.vercel.app"
).replace(/\/$/, "");

function productPageUrl(productId: string): string {
  return `${MVPV2_WEB_URL}/products/${productId}`;
}

// 4-hour inactivity timeout: after that, next inbound restarts fresh.
const FLOW_TIMEOUT_MS = 4 * 60 * 60 * 1000;

// Keywords that bootstrap a flow if no flow is active. Matches the
// spirit of the previous G1 greeting rule so a customer's "hi" still
// gets a Fitoverse welcome — just now as an interactive menu.
const START_REGEX =
  /^\s*(hi+|hey+|hello+|helo+|halo+|namaste+|namaskaram+|namaskar+|vanakkam+|good\s*(morning|afternoon|evening|day)|greetings|menu|start)(\s+.*)?[\s!?.,]*$/i;

export type DispatchChatbotInput = {
  conversationId: string;
  contactPhone: string;
  inboundBody: string;
  interactiveReplyId: string | null;
};

export async function dispatchChatbot(
  input: DispatchChatbotInput
): Promise<boolean> {
  const { conversationId, contactPhone, inboundBody, interactiveReplyId } = input;

  // Product listing button taps. The flow closes right after sending
  // the products, so these arrive on a closed flow — handle them here
  // BEFORE the flow lookup so they always work.
  //   product_more:<id>       — customer wants the full description
  //   product_interested:<id> — customer wants us to follow up (BotLead)
  if (interactiveReplyId?.startsWith("product_more:")) {
    const productId = interactiveReplyId.slice("product_more:".length);
    await sendProductDetails(contactPhone, productId).catch((err) =>
      console.error("[chatbot] product details send failed", err),
    );
    return true;
  }
  if (interactiveReplyId?.startsWith("product_interested:")) {
    const productId = interactiveReplyId.slice(
      "product_interested:".length,
    );
    await captureProductInterest(conversationId, contactPhone, productId).catch(
      (err) => console.error("[chatbot] product interest capture failed", err),
    );
    return true;
  }

  // Opt-out gate — never auto-message someone who's said STOP.
  try {
    const optOut = await prisma.optOut.findUnique({
      where: { phoneE164: contactPhone },
    });
    if (optOut) return false;
  } catch (err) {
    console.error("[chatbot] opt-out check failed", err);
    return false;
  }

  // Look up any existing flow. If it's stale (> 4h), we treat it as
  // gone and either restart from the menu or fall through.
  let flow = await prisma.conversationFlow.findUnique({
    where: { conversationId },
  });

  if (flow && flow.endedAt) {
    // Flow already completed — check if this is a new greeting worth
    // restarting. Otherwise pass through.
    if (isStartTrigger(inboundBody, interactiveReplyId)) {
      flow = null; // will re-create below
    } else {
      return false;
    }
  }

  if (flow) {
    const age = Date.now() - flow.updatedAt.getTime();
    if (age > FLOW_TIMEOUT_MS) {
      // Timed out — mark and re-check if the current message is a fresh
      // greeting worth restarting.
      await prisma.conversationFlow
        .update({
          where: { id: flow.id },
          data: { endedAt: new Date(), endReason: "timeout" },
        })
        .catch(() => null);
      flow = null;
      if (!isStartTrigger(inboundBody, interactiveReplyId)) return false;
    }
  }

  // No active flow — is this a greeting that should start one?
  if (!flow) {
    if (!isStartTrigger(inboundBody, interactiveReplyId)) return false;
    // Upsert, not create — the ConversationFlow.conversationId column
    // is @unique, so a customer who's completed or timed-out a previous
    // flow already has a row. `create` would violate the constraint,
    // silently fail the chatbot, and let the legacy G1 greeting fire.
    flow = await prisma.conversationFlow.upsert({
      where: { conversationId },
      create: {
        conversationId,
        currentStep: "menu",
        collectedData: "{}",
      },
      update: {
        currentStep: "menu",
        collectedData: "{}",
        path: null,
        endedAt: null,
        endReason: null,
        startedAt: new Date(),
      },
    });
    // Fresh flow: enter the menu step immediately, no advance from the
    // triggering inbound (the "hi" itself doesn't pick a menu option).
    await enterStep(contactPhone, "menu", flow, {}, conversationId);
    return true;
  }

  // Active flow — pass the inbound through the current step's advance.
  const step = getStep(flow.currentStep);
  if (!step) {
    // Corrupted state (probably a step id was removed). Reset.
    await prisma.conversationFlow
      .update({
        where: { id: flow.id },
        data: { endedAt: new Date(), endReason: "off_script" },
      })
      .catch(() => null);
    return false;
  }

  const data = safeParse(flow.collectedData);
  const result = step.advance({
    data,
    inboundText: inboundBody,
    interactiveReplyId,
  });

  const nextData = { ...data, ...(result.dataPatch ?? {}) };

  if (result.next === null) {
    // Terminate flow. `send` on the current step is the terminal
    // message — send it if not already sent (it may have been the
    // very step we just came from, in which case the previous enter
    // already sent it). Simplest: don't re-send; just close.
    await finaliseFlow(flow.id, nextData, result.endReason, conversationId, contactPhone, flow.path);
    return true;
  }

  await prisma.conversationFlow.update({
    where: { id: flow.id },
    data: {
      currentStep: result.next,
      collectedData: JSON.stringify(nextData),
      path: derivePath(result.next, flow.path),
    },
  });

  const updatedFlow = { ...flow, currentStep: result.next, collectedData: JSON.stringify(nextData) };
  await enterStep(contactPhone, result.next, updatedFlow, nextData, conversationId);

  return true;
}

// ─── Helpers ────────────────────────────────────────────────────────

function isStartTrigger(inboundBody: string, interactiveReplyId: string | null): boolean {
  if (interactiveReplyId) return false; // taps only advance existing flows
  return START_REGEX.test(inboundBody);
}

// Path is derived from the step id namespace so the bot lead knows
// which branch the customer took even mid-flow. p1a_* → turnkey_new,
// p1b_* → turnkey_maintenance, p3_* → consultation, p2_* → product.
function derivePath(stepId: string, existing: string | null): string | null {
  if (stepId.startsWith("p1a_")) return "turnkey_new";
  if (stepId.startsWith("p1b_")) return "turnkey_maintenance";
  if (stepId.startsWith("p3_")) return "consultation";
  if (stepId.startsWith("p2_")) return "product";
  return existing;
}

function safeParse(json: string): CollectedData {
  try {
    return JSON.parse(json) as CollectedData;
  } catch {
    return {};
  }
}

// Enter a step: run its `send`, dispatch the outbound message. If the
// step emits a `catalogue` or terminal `final` — the flow auto-advances
// through zero-input steps by chaining recursively.
async function enterStep(
  contactPhone: string,
  stepId: string,
  flow: { id: string; conversationId: string; path: string | null; collectedData: string },
  data: CollectedData,
  conversationId: string
): Promise<void> {
  const step = getStep(stepId);
  if (!step) return;

  const response = step.send(data);
  const waMessageId = await sendResponse(contactPhone, response).catch((err) => {
    console.error("[chatbot] send failed", stepId, err);
    return null;
  });

  await mirrorOutbound(conversationId, response, waMessageId);

  // Terminal steps (kind: final, or send-and-continue kinds like
  // catalogue) — auto-advance without waiting for an inbound.
  if (response.kind === "final") {
    // Wait: the final step's advance returns null so the state
    // machine ends. But we've already sent the terminal message here.
    // Terminate now.
    await finaliseFlow(
      flow.id,
      data,
      "completed",
      conversationId,
      contactPhone,
      derivePath(stepId, flow.path)
    );
    return;
  }

  if (response.kind === "catalogue" || response.kind === "product_listing") {
    // Auto-advance: this step has done its work, immediately move to
    // whatever step its advance returns (usually the "end" step).
    const result = step.advance({ data, inboundText: "", interactiveReplyId: null });
    if (result.next === null) {
      await finaliseFlow(
        flow.id,
        { ...data, ...(result.dataPatch ?? {}) },
        result.endReason,
        conversationId,
        contactPhone,
        derivePath(stepId, flow.path)
      );
      return;
    }
    const nextData = { ...data, ...(result.dataPatch ?? {}) };
    await prisma.conversationFlow.update({
      where: { id: flow.id },
      data: {
        currentStep: result.next,
        collectedData: JSON.stringify(nextData),
        path: derivePath(result.next, flow.path),
      },
    });
    await enterStep(
      contactPhone,
      result.next,
      { ...flow, currentStep: result.next, collectedData: JSON.stringify(nextData) } as any,
      nextData,
      conversationId
    );
  }
}

async function sendResponse(
  contactPhone: string,
  response: StepSend
): Promise<string | null> {
  switch (response.kind) {
    case "text":
    case "final":
      return (
        await sendText({ to: contactPhone, body: response.body })
      ).waMessageId;
    case "buttons":
      return (
        await sendButtons({
          to: contactPhone,
          body: response.body,
          buttons: response.buttons,
        })
      ).waMessageId;
    case "list":
      // If the step supplied a preText (used by the menu step for the
      // full Fitoverse welcome), send that as a plain text message
      // FIRST so the customer sees the greeting, then the picker.
      if (response.preText) {
        await sendText({
          to: contactPhone,
          body: response.preText,
        }).catch((err) =>
          console.error("[chatbot] list preText failed", err),
        );
      }
      return (
        await sendList({
          to: contactPhone,
          body: response.body,
          buttonText: response.buttonText,
          sections: response.sections,
        })
      ).waMessageId;
    case "catalogue":
      return sendCatalogue(contactPhone, response.sport);
    case "product_listing":
      return sendProductListing(contactPhone, response.sport);
  }
}

async function sendProductListing(
  contactPhone: string,
  sport: SportKey,
): Promise<string | null> {
  const meta = getSportMeta(sport);
  const sportLabel = meta?.label ?? sport;

  let products: MvpProduct[] = [];
  try {
    products = await listProductsBySport(sport);
  } catch (err) {
    console.error("[chatbot] MVPv2 product fetch failed", sport, err);
    // Fall through as if empty — MVPv2 down should not crash the flow.
  }

  if (products.length === 0) {
    const body = `We're finalising our ${sportLabel} product range right now — our team will share the full catalogue with you within 24 hours. If you'd like a tailored quote, reply with your plot size and location.`;
    return (await sendText({ to: contactPhone, body })).waMessageId;
  }

  const intro = `Here are ${Math.min(PRODUCTS_TO_SHOW, products.length)} of our ${sportLabel} products. Tap *Read more* under any card for full specs, or *Interested* to have our team follow up.`;
  await sendText({ to: contactPhone, body: intro }).catch((err) =>
    console.error("[chatbot] product intro failed", err),
  );

  let lastWaId: string | null = null;
  const toShow = products.slice(0, PRODUCTS_TO_SHOW);
  for (let i = 0; i < toShow.length; i++) {
    const p = toShow[i];
    if (!p.image_url) continue;
    // Trim descriptions to fit inside the interactive body limit. Full
    // spec lives behind the "Read more" button, so this preview only
    // needs to hook the customer — the first paragraph is enough.
    const short = htmlToWhatsappText(p.description)
      .split(/\n{2,}/)[0]
      .slice(0, PRODUCT_SHORT_DESC_LIMIT);
    // Product page URL inline in the body so customers who prefer the
    // full web experience can tap through directly. WhatsApp auto-
    // linkifies http(s) URLs, so no markup needed.
    const url = productPageUrl(p.id);
    const body =
      `*${i + 1}. ${p.name.trim()}*\n\n${short}\n\nFull specs: ${url}`.trim();
    try {
      const r = await sendImageButtons({
        to: contactPhone,
        imageUrl: p.image_url,
        body,
        buttons: [
          { id: `product_more:${p.id}`, title: "Read more" },
          { id: `product_interested:${p.id}`, title: "Interested" },
        ],
      });
      lastWaId = r.waMessageId;
    } catch (err) {
      // If the interactive send fails for any reason (e.g. WA rate-
      // limit at Tier 250), fall back to a plain image with caption
      // so the customer at least sees the product.
      console.error("[chatbot] product interactive send failed", p.id, err);
      try {
        const r = await sendMedia({
          to: contactPhone,
          mediaType: "image",
          url: p.image_url,
          caption: body,
        });
        lastWaId = r.waMessageId;
      } catch (err2) {
        console.error("[chatbot] product image fallback failed", p.id, err2);
      }
    }
  }

  return lastWaId;
}

async function sendCatalogue(
  contactPhone: string,
  sport: SportKey
): Promise<string | null> {
  const setting = await prisma.setting.findUnique({
    where: { key: `catalogue_${sport}_url` },
  });
  const pdfUrl = setting?.value ?? null;
  if (!pdfUrl) {
    // Fallback: no catalogue uploaded for this sport yet. Send text.
    const meta = getSportMeta(sport);
    const body = `Thanks for asking about ${meta?.label ?? sport}. Our team will share the full catalogue and details with you shortly.`;
    return (await sendText({ to: contactPhone, body })).waMessageId;
  }
  const meta = getSportMeta(sport);
  const caption = `Fitoverse ${meta?.label ?? sport} catalogue. Reply with your plot size and location for a tailored quote.`;
  const filename = `fitoverse-${sport}-catalogue.pdf`;
  // Text-before-media pattern: some clients hide the caption on PDFs.
  await sendText({ to: contactPhone, body: caption }).catch((err) =>
    console.error("[chatbot] catalogue caption failed", err)
  );
  return (
    await sendMedia({
      to: contactPhone,
      mediaType: "document",
      url: pdfUrl,
      caption,
      filename,
    })
  ).waMessageId;
}

// Write the outbound to the inbox so sales sees the bot's side of the
// thread. Interactive messages get flattened to text for the inbox
// view — the body preserves the prompt so it reads naturally.
async function mirrorOutbound(
  conversationId: string,
  response: StepSend,
  waMessageId: string | null
): Promise<void> {
  let body: string;
  let type: "text" | "document" = "text";
  let mediaUrl: string | null = null;
  switch (response.kind) {
    case "text":
    case "final":
      body = response.body;
      break;
    case "buttons":
      body = `${response.body}\n\nOptions: ${response.buttons
        .map((b) => `[${b.title}]`)
        .join(" ")}`;
      break;
    case "list":
      body = `${response.preText ? response.preText + "\n\n" : ""}${response.body}\n\nOptions: ${response.sections
        .flatMap((s) => s.rows)
        .map((r) => `[${r.title}]`)
        .join(" ")}`;
      break;
    case "catalogue":
      body = `[Catalogue] ${response.sport}`;
      type = "document";
      break;
    case "product_listing":
      body = `[Product listing] ${response.sport}`;
      break;
  }
  await prisma.message
    .create({
      data: {
        conversationId,
        direction: "outbound",
        type,
        body,
        mediaUrl,
        waMessageId,
        status: "sent",
      },
    })
    .catch((err) => console.error("[chatbot] mirror failed", err));

  await prisma.conversation
    .update({
      where: { id: conversationId },
      data: { lastOutboundAt: new Date() },
    })
    .catch(() => null);
}

// Close the flow and write a BotLead row so sales has this in the
// data sheet. Path drives which fields go into the lead. Even
// off-script terminations write a lead — we don't want to lose
// captured info.
async function finaliseFlow(
  flowId: string,
  data: CollectedData,
  endReason: "completed" | "off_script",
  conversationId: string,
  contactPhone: string,
  path: string | null
): Promise<void> {
  await prisma.conversationFlow
    .update({
      where: { id: flowId },
      data: { endedAt: new Date(), endReason },
    })
    .catch((err) => console.error("[chatbot] flow close failed", err));

  // Skip lead write if we haven't gathered ANYTHING meaningful (rare —
  // customer taps menu then immediately types garbage on step 1).
  const hasData =
    data.name || data.location || data.landSizeFt || data.sport ||
    data.maintenanceType || data.preferredDateTime;
  if (!hasData && !path) return;

  const preferredDateTime = parseMaybeDate(data.preferredDateTime);

  await prisma.botLead
    .create({
      data: {
        conversationId,
        contactPhone,
        contactName: data.name ?? null,
        path: path ?? "unknown",
        location: data.location ?? null,
        sizeFt:
          data.landSizeFt ?? data.turfSizeFt ?? null,
        sport: data.sport ?? null,
        maintenanceType: data.maintenanceType ?? null,
        productCategory: data.productCategory ?? null,
        preferredDateTime,
        notes: endReason === "off_script" ? "Ended off-script mid-flow" : null,
      },
    })
    .catch((err) => console.error("[chatbot] lead write failed", err));
}

// Very lenient — most customer date/time replies are natural language
// ("Tomorrow 4pm"). We store the raw string in preferredDateTime as
// text; this only fills the DateTime column if the string parses.
// Customer tapped "Read more" on a product card. Fetch the full record
// from MVPv2 and send the description as text — WhatsApp text bodies
// cap at 4096 chars so we chunk on paragraph boundaries if needed.
// The MVPv2 web page URL is appended at the end for the full spec
// table + gallery view.
async function sendProductDetails(
  contactPhone: string,
  productId: string,
): Promise<void> {
  const { getProduct, specsToWhatsappBlock } = await import(
    "@/lib/mvpv2/products"
  );
  const p = await getProduct(productId);
  if (!p) {
    await sendText({
      to: contactPhone,
      body: "Sorry, we couldn't load that product right now. Please try again in a moment or reply *hi* to see the menu.",
    }).catch(() => null);
    return;
  }
  const url = productPageUrl(p.id);
  const specs = specsToWhatsappBlock(p.specs);
  const fullDesc = htmlToWhatsappText(p.description);

  const header = `*${p.name.trim()}*`;
  const footer = `_View gallery + full spec sheet:_ ${url}`;

  const bodyParts: string[] = [header];
  if (fullDesc) bodyParts.push(fullDesc);
  if (specs) bodyParts.push(specs);
  bodyParts.push(footer);
  const combined = bodyParts.join("\n\n");

  // Chunk if the whole message exceeds WhatsApp's 4096-char text limit.
  const chunks = chunkText(combined, PRODUCT_FULL_DESC_CHUNK);
  for (const chunk of chunks) {
    await sendText({ to: contactPhone, body: chunk }).catch((err) =>
      console.error("[chatbot] product details chunk failed", err),
    );
  }
}

// Split a long string on paragraph boundaries so each piece is under
// maxLen. Falls back to hard-splitting a paragraph that's itself too
// long to fit on its own.
function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = "";
  for (const para of paragraphs) {
    const joiner = buf ? "\n\n" : "";
    if ((buf + joiner + para).length <= maxLen) {
      buf += joiner + para;
      continue;
    }
    if (buf) {
      chunks.push(buf);
      buf = "";
    }
    if (para.length <= maxLen) {
      buf = para;
    } else {
      for (let i = 0; i < para.length; i += maxLen) {
        chunks.push(para.slice(i, i + maxLen));
      }
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

// Customer tapped "Interested" on a product card. Look up the product
// name for a friendlier lead row + reply, then write a BotLead
// (path: product) with the productId in the productCategory column so
// sales knows exactly which SKU. Silent-fail everywhere.
async function captureProductInterest(
  conversationId: string,
  contactPhone: string,
  productId: string,
): Promise<void> {
  // Best-effort product name lookup for a nicer thank-you and lead row.
  // Import lazily so the chatbot doesn't hard-depend on MVPv2 at boot.
  let productName = productId;
  try {
    const { getProduct } = await import("@/lib/mvpv2/products");
    const p = await getProduct(productId);
    if (p) productName = p.name.trim();
  } catch (err) {
    console.error("[chatbot] product name lookup failed", err);
  }

  await sendText({
    to: contactPhone,
    body: `Thanks for your interest in *${productName}*. Our team will contact you within 24 hours with pricing and next steps.\n\nFor reference: ${productPageUrl(productId)}`,
  }).catch((err) => console.error("[chatbot] interest ack failed", err));

  await prisma.botLead
    .create({
      data: {
        conversationId,
        contactPhone,
        path: "product",
        productCategory: productId,
        notes: `Interested in ${productName}`,
      },
    })
    .catch((err) => console.error("[chatbot] interest lead write failed", err));

  await prisma.conversation
    .update({
      where: { id: conversationId },
      data: { lastOutboundAt: new Date() },
    })
    .catch(() => null);
}

function parseMaybeDate(raw?: string): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (isNaN(t)) return null;
  return new Date(t);
}
