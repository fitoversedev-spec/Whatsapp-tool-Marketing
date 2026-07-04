// Submit the Fitoverse product carousel template to Meta for approval.
//
// Once run and approved (Meta review: usually 1-3 days), the chatbot's
// Product Listing branch sends this template with dynamic per-card
// content (image, name, description, product id in the button payload)
// instead of one-image-at-a-time messages.
//
// Run:   npx tsx scripts/submit-product-carousel-template.ts
// Undo:  delete the template in Business Manager → Message Templates.
//
// Meta requires a sample media handle for the IMAGE header in each
// card. We upload ONE real product photo from MVPv2 via the Resumable
// Upload API and reuse the returned handle across all 5 cards — Meta
// approves the STRUCTURE, not the specific image, so at send time we
// pass different URLs per card.

import "dotenv/config";
import { listProductsBySport } from "@/lib/mvpv2/products";
import { submitTemplate } from "@/lib/whatsapp";
import { getMetaAccessToken } from "@/lib/token-manager";

const APP_ID = process.env.META_APP_ID || "";
const API = process.env.META_GRAPH_API_VERSION || "v21.0";

const TEMPLATE_NAME = "fitoverse_product_carousel_v1";
const LANGUAGE = "en";
const CARD_COUNT = 5;

async function uploadResumable(
  fileUrl: string,
  token: string,
): Promise<string> {
  const fetched = await fetch(fileUrl);
  if (!fetched.ok) {
    throw new Error(
      `Fetch sample image failed: ${fetched.status} ${fetched.statusText}`,
    );
  }
  const contentType =
    fetched.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await fetched.arrayBuffer());
  const fileName = decodeURIComponent(fileUrl.split("/").pop() ?? "sample.jpg");

  const initParams = new URLSearchParams({
    file_length: String(buffer.length),
    file_type: contentType,
    file_name: fileName,
    access_token: token,
  });
  const initRes = await fetch(
    `https://graph.facebook.com/${API}/${APP_ID}/uploads?${initParams}`,
    { method: "POST" },
  );
  const initJson: any = await initRes.json();
  if (!initRes.ok || !initJson?.id) {
    throw new Error(`Upload init failed: ${JSON.stringify(initJson)}`);
  }
  const sessionId: string = initJson.id;

  const upRes = await fetch(`https://graph.facebook.com/${API}/${sessionId}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      file_offset: "0",
      "Content-Type": contentType,
    },
    body: buffer,
  });
  const upJson: any = await upRes.json();
  if (!upRes.ok || !upJson?.h) {
    throw new Error(`Upload push failed: ${JSON.stringify(upJson)}`);
  }
  return upJson.h;
}

async function main() {
  if (!APP_ID) throw new Error("META_APP_ID missing from env");
  const token = await getMetaAccessToken();
  if (!token) throw new Error("META_ACCESS_TOKEN missing");

  console.log("Fetching sample products from MVPv2...");
  const footballProducts = await listProductsBySport("football");
  const samples = footballProducts
    .filter((p) => !!p.image_url)
    .slice(0, CARD_COUNT);
  if (samples.length < CARD_COUNT) {
    throw new Error(
      `Need at least ${CARD_COUNT} MVPv2 football products with images. Got ${samples.length}.`,
    );
  }

  console.log("Uploading sample hero image via Resumable Upload API...");
  const handle = await uploadResumable(samples[0].image_url!, token);
  console.log("Sample handle:", handle);

  const bodySample = "Football";
  const cardSamples = samples.map((s) => ({
    name: s.name.trim(),
    // Take a short first-line description for the sample. Meta accepts
    // any real-looking values; runtime we'll pass proper text.
    desc: "FIFA-approved artificial turf with monofilament PE fibres.",
  }));

  const components = [
    {
      type: "BODY",
      text: "Here are our top {{1}} products. Tap any card to see specs and get a quote.",
      example: { body_text: [[bodySample]] },
    },
    {
      type: "CAROUSEL",
      cards: cardSamples.map((c) => ({
        components: [
          {
            type: "HEADER",
            format: "IMAGE",
            example: { header_handle: [handle] },
          },
          {
            type: "BODY",
            text: "*{{1}}*\n{{2}}",
            example: { body_text: [[c.name, c.desc]] },
          },
          {
            type: "BUTTONS",
            buttons: [{ type: "QUICK_REPLY", text: "I'm interested" }],
          },
        ],
      })),
    },
  ];

  console.log(`Submitting template "${TEMPLATE_NAME}"...`);
  const result = await submitTemplate({
    name: TEMPLATE_NAME,
    language: LANGUAGE,
    category: "MARKETING",
    components,
  });
  console.log("Submitted:", result);
  console.log(
    "\nNext: check status in Business Manager → Message Templates.",
    "\nMeta review usually takes 1-3 days.",
    "\nOnce APPROVED, set env PRODUCT_CAROUSEL_TEMPLATE=" + TEMPLATE_NAME,
    "on Vercel and the chatbot will start using the carousel automatically.",
  );
}

main().catch((err) => {
  console.error("Submit failed:");
  console.error(err.response?.data ?? err);
  process.exit(1);
});
