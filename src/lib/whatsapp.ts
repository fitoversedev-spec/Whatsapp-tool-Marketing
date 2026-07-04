import axios, { AxiosError } from "axios";
import { getMetaAccessToken } from "./token-manager";

const API_VERSION = process.env.META_GRAPH_API_VERSION || "v21.0";
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || "";
const WABA_ID = process.env.META_WABA_ID || "";

const messagesUrl = () => `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
const wabaTemplatesUrl = () => `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates`;

async function authHeaders() {
  const token = await getMetaAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export type TemplateComponent =
  | { type: "header"; parameters?: Array<{ type: string; text?: string; image?: { link: string } }> }
  | { type: "body"; parameters: Array<{ type: "text"; text: string }> }
  | { type: "button"; sub_type: string; index: number; parameters: Array<{ type: string; payload?: string; text?: string }> };

export async function sendTemplate(args: {
  to: string;
  templateName: string;
  language: string;
  components?: TemplateComponent[];
}): Promise<{ waMessageId: string }> {
  const res = await axios.post(
    messagesUrl(),
    {
      messaging_product: "whatsapp",
      to: args.to,
      type: "template",
      template: {
        name: args.templateName,
        language: { code: args.language },
        components: args.components ?? [],
      },
    },
    { headers: await authHeaders() }
  );
  return { waMessageId: res.data?.messages?.[0]?.id ?? "" };
}

export async function sendText(args: { to: string; body: string }): Promise<{ waMessageId: string }> {
  const res = await axios.post(
    messagesUrl(),
    {
      messaging_product: "whatsapp",
      to: args.to,
      type: "text",
      text: { body: args.body, preview_url: false },
    },
    { headers: await authHeaders() }
  );
  return { waMessageId: res.data?.messages?.[0]?.id ?? "" };
}

// Send any media type via a publicly accessible URL. mediaType drives both
// the Meta payload shape and which extra fields (filename for documents,
// caption for image/video/document) are included.
export async function sendMedia(args: {
  to: string;
  mediaType: "image" | "video" | "audio" | "document";
  url: string;
  caption?: string;
  filename?: string; // recommended for documents
}): Promise<{ waMessageId: string }> {
  const mediaPayload: Record<string, unknown> = { link: args.url };
  if (args.caption && args.mediaType !== "audio") mediaPayload.caption = args.caption;
  if (args.mediaType === "document" && args.filename) mediaPayload.filename = args.filename;

  const res = await axios.post(
    messagesUrl(),
    {
      messaging_product: "whatsapp",
      to: args.to,
      type: args.mediaType,
      [args.mediaType]: mediaPayload,
    },
    { headers: await authHeaders() }
  );
  return { waMessageId: res.data?.messages?.[0]?.id ?? "" };
}

// Send an interactive button message. Up to 3 buttons. Each button has
// an `id` we get back in the webhook as `interactive.button_reply.id`
// so the flow dispatcher knows which option the customer tapped.
// `title` is what the customer sees on the button (max 20 chars per
// Meta's limits).
export async function sendButtons(args: {
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
  header?: string;
  footer?: string;
}): Promise<{ waMessageId: string }> {
  if (args.buttons.length < 1 || args.buttons.length > 3) {
    throw new Error("sendButtons requires 1-3 buttons");
  }
  const interactive: Record<string, unknown> = {
    type: "button",
    body: { text: args.body },
    action: {
      buttons: args.buttons.map((b) => ({
        type: "reply",
        reply: { id: b.id, title: b.title.slice(0, 20) },
      })),
    },
  };
  if (args.header) interactive.header = { type: "text", text: args.header };
  if (args.footer) interactive.footer = { text: args.footer };
  const res = await axios.post(
    messagesUrl(),
    {
      messaging_product: "whatsapp",
      to: args.to,
      type: "interactive",
      interactive,
    },
    { headers: await authHeaders() }
  );
  return { waMessageId: res.data?.messages?.[0]?.id ?? "" };
}

// Send an interactive list message. Up to 10 rows total, grouped in
// sections (also useful for categorising). Each row has an `id` we get
// back in the webhook as `interactive.list_reply.id`. The `buttonText`
// is what the customer taps to open the list (e.g. "See options").
export async function sendList(args: {
  to: string;
  body: string;
  buttonText: string;
  sections: Array<{
    title?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
  header?: string;
  footer?: string;
}): Promise<{ waMessageId: string }> {
  const totalRows = args.sections.reduce((n, s) => n + s.rows.length, 0);
  if (totalRows < 1 || totalRows > 10) {
    throw new Error("sendList requires 1-10 total rows");
  }
  const interactive: Record<string, unknown> = {
    type: "list",
    body: { text: args.body },
    action: {
      button: args.buttonText.slice(0, 20),
      sections: args.sections.map((s) => ({
        title: s.title,
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title.slice(0, 24),
          description: r.description?.slice(0, 72),
        })),
      })),
    },
  };
  if (args.header) interactive.header = { type: "text", text: args.header };
  if (args.footer) interactive.footer = { text: args.footer };
  const res = await axios.post(
    messagesUrl(),
    {
      messaging_product: "whatsapp",
      to: args.to,
      type: "interactive",
      interactive,
    },
    { headers: await authHeaders() }
  );
  return { waMessageId: res.data?.messages?.[0]?.id ?? "" };
}

// Download an inbound media file. Meta gives us a media_id in the webhook;
// we exchange it for a short-lived signed URL (step 1), then fetch the
// bytes with the access token (step 2). Caller decides where to persist.
export async function fetchInboundMedia(mediaId: string): Promise<{
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}> {
  const token = await getMetaAccessToken();
  const metaRes = await axios.get(
    `https://graph.facebook.com/${API_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const url: string = metaRes.data?.url;
  const mimeType: string = metaRes.data?.mime_type ?? "application/octet-stream";
  if (!url) throw new Error("Meta media metadata missing url");

  const fileRes = await axios.get<ArrayBuffer>(url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: "arraybuffer",
  });

  const fileName =
    metaRes.data?.file_name ||
    `inbound-${mediaId}.${mimeType.split("/")[1] ?? "bin"}`;
  return {
    bytes: Buffer.from(fileRes.data),
    mimeType,
    fileName,
  };
}

export async function listTemplates() {
  const res = await axios.get(wabaTemplatesUrl(), {
    headers: await authHeaders(),
    params: { limit: 200 },
  });
  return res.data?.data ?? [];
}

export async function submitTemplate(args: {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  components: Array<Record<string, unknown>>;
}): Promise<{ id: string; status: string }> {
  const res = await axios.post(
    wabaTemplatesUrl(),
    {
      name: args.name,
      language: args.language,
      category: args.category,
      components: args.components,
    },
    { headers: await authHeaders() }
  );
  return { id: res.data?.id ?? "", status: res.data?.status ?? "submitted" };
}

// Send an interactive button message with an IMAGE header. Same 1-3
// button limit as sendButtons but the header shows a hero image the
// customer sees above the body text — used by the chatbot's product
// listing to render "one card per product" without needing a Meta-
// approved template. Body text supports the same WhatsApp formatting
// (*bold*, _italic_) as any other message. Buttons come back in the
// webhook as `interactive.button_reply.id`, same as sendButtons.
export async function sendImageButtons(args: {
  to: string;
  imageUrl: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
  footer?: string;
}): Promise<{ waMessageId: string }> {
  if (args.buttons.length < 1 || args.buttons.length > 3) {
    throw new Error("sendImageButtons requires 1-3 buttons");
  }
  const interactive: Record<string, unknown> = {
    type: "button",
    header: { type: "image", image: { link: args.imageUrl } },
    body: { text: args.body.slice(0, 1024) },
    action: {
      buttons: args.buttons.map((b) => ({
        type: "reply",
        reply: { id: b.id, title: b.title.slice(0, 20) },
      })),
    },
  };
  if (args.footer) {
    interactive.footer = { text: args.footer.slice(0, 60) };
  }
  const res = await axios.post(
    messagesUrl(),
    {
      messaging_product: "whatsapp",
      to: args.to,
      type: "interactive",
      interactive,
    },
    { headers: await authHeaders() },
  );
  return { waMessageId: res.data?.messages?.[0]?.id ?? "" };
}

export async function isMetaConfigured() {
  const token = await getMetaAccessToken();
  return !!(PHONE_NUMBER_ID && WABA_ID && token);
}

export function describeMetaError(err: unknown): { code: string; message: string } {
  if (err instanceof AxiosError && err.response?.data?.error) {
    const e = err.response.data.error;
    return { code: String(e.code ?? "unknown"), message: e.message ?? "Meta error" };
  }
  if (err instanceof Error) return { code: "client", message: err.message };
  return { code: "unknown", message: "Unknown error" };
}
