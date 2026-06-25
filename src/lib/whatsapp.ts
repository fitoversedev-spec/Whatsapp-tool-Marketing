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
