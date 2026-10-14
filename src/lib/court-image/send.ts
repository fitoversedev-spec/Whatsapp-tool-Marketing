// Pure pieces of "send a court design on WhatsApp", shared by
// POST /api/court-images/[id]/send and the AI agent's send_design so both send
// the same pictures, in the same order, with the same caption and inbox record.

export type DesignFormat = "2d" | "3d-image" | "3d-video";

export const DESIGN_FORMAT_ORDER: DesignFormat[] = ["2d", "3d-image", "3d-video"];

export type DesignSendItem = {
  format: DesignFormat;
  url: string;
  mediaType: "image" | "video";
  fileExt: "png" | "mp4";
};

export type DesignMediaFields = {
  imageUrl: string | null;
  image2dUrl: string | null;
  image3dUrl: string | null;
  video3dUrl: string | null;
};

/** The saved picture for one format. The 2D plan falls back to the primary imageUrl. */
export function designFormatUrl(row: DesignMediaFields, format: DesignFormat): string | null {
  return format === "2d" ? row.image2dUrl ?? row.imageUrl : format === "3d-image" ? row.image3dUrl : row.video3dUrl;
}

/** Which formats already exist on the record. */
export function existingDesignFormats(row: DesignMediaFields): DesignFormat[] {
  return DESIGN_FORMAT_ORDER.filter((f) => !!designFormatUrl(row, f));
}

/**
 * The messages to send, in the order 2d -> 3d-image -> 3d-video, or the first
 * requested format that has no saved picture.
 */
export function buildDesignSendItems(
  row: DesignMediaFields,
  requested: readonly DesignFormat[],
): { ok: true; items: DesignSendItem[] } | { ok: false; missing: DesignFormat } {
  const items: DesignSendItem[] = [];
  for (const f of DESIGN_FORMAT_ORDER) {
    if (!requested.includes(f)) continue;
    const url = designFormatUrl(row, f);
    if (!url) return { ok: false, missing: f };
    items.push({
      format: f,
      url,
      mediaType: f === "3d-video" ? "video" : "image",
      fileExt: f === "3d-video" ? "mp4" : "png",
    });
  }
  return { ok: true, items };
}

/** The intro text sent before the pictures. */
export function designCaption(row: { caption: string | null; number: string; customerName: string }): string {
  return row.caption?.trim() || `Court design ${row.number} from Fitoverse — ${row.customerName}`;
}

/** The inbox Message fields (besides conversation, direction, id and sender) for one sent picture. */
export function designMirrorMedia(row: { number: string }, item: { format: string; url: string | null; isVideo: boolean }) {
  return {
    type: item.isVideo ? "video" : "image",
    body: `Court design ${row.number} sent (${item.format})`,
    mediaUrl: item.url ?? undefined,
    mediaMimeType: item.isVideo ? "video/mp4" : "image/png",
    mediaFileName: `${row.number}-${item.format}.${item.isVideo ? "mp4" : "png"}`,
  };
}
