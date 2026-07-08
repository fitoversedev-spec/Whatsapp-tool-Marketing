// Normalise a picked image to a PDF-embeddable format (JPEG).
//
// pdf-lib (used to build the combined court-design PDF) can only embed PNG
// and JPEG. A WEBP / AVIF / HEIC upload therefore silently fails to render —
// which is why an equipment photo attached in the tool showed up blank in the
// PDF. We convert anything that isn't already PNG/JPEG to JPEG in the browser
// (via a canvas) before upload, so every product/equipment photo embeds.
//
// Browser-only: uses createImageBitmap + <canvas>. Import from client
// components only.

export async function toEmbeddableImage(file: File): Promise<File> {
  const type = (file.type || "").toLowerCase();

  // Already embeddable — leave PNG/JPEG untouched to keep original quality.
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/png") {
    return file;
  }

  // Not a raster image we can convert (e.g. SVG, or a non-image) — pass through.
  const looksConvertible =
    type.startsWith("image/") ||
    /\.(webp|avif|heic|heif|gif|bmp|tiff?)$/i.test(file.name);
  if (!looksConvertible) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // White backdrop so a transparent source doesn't turn black once flattened
    // to JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    if (!blob) return file;
    const newName = file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    // Conversion failed (e.g. a format the browser can't decode) — fall back
    // to the original upload rather than blocking the save.
    return file;
  }
}
