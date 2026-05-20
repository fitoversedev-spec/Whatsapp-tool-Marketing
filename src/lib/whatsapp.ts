import axios, { AxiosError } from "axios";

const API_VERSION = process.env.META_GRAPH_API_VERSION || "v21.0";
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || "";
const WABA_ID = process.env.META_WABA_ID || "";
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "";

const messagesUrl = () => `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
const wabaTemplatesUrl = () => `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates`;

function authHeaders() {
  return {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
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
    { headers: authHeaders() }
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
    { headers: authHeaders() }
  );
  return { waMessageId: res.data?.messages?.[0]?.id ?? "" };
}

export async function listTemplates() {
  const res = await axios.get(wabaTemplatesUrl(), {
    headers: authHeaders(),
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
    { headers: authHeaders() }
  );
  return { id: res.data?.id ?? "", status: res.data?.status ?? "submitted" };
}

export function isMetaConfigured() {
  return !!(PHONE_NUMBER_ID && WABA_ID && ACCESS_TOKEN);
}

export function describeMetaError(err: unknown): { code: string; message: string } {
  if (err instanceof AxiosError && err.response?.data?.error) {
    const e = err.response.data.error;
    return { code: String(e.code ?? "unknown"), message: e.message ?? "Meta error" };
  }
  if (err instanceof Error) return { code: "client", message: err.message };
  return { code: "unknown", message: "Unknown error" };
}
