// Parses a MetaLead's raw field_data JSON string into label/value pairs.
// field_data is produced by the lead-ingest path; parse defensively and support
// both Meta's [{ name, values: [...] }] array form and a plain { key: value }
// object. Shared by the ad-campaign Leads table row-detail page and any other
// place that needs to render every raw form answer.
export type ParsedField = { name: string; value: string };

export function parseFieldData(raw: string): ParsedField[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((f: { name?: unknown; value?: unknown; values?: unknown }) => ({
          name: String(f?.name ?? ""),
          value: Array.isArray(f?.values) ? f.values.join(", ") : String(f?.value ?? (f?.values as unknown) ?? ""),
        }))
        .filter((f) => f.name);
    }
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>).map(([name, value]) => ({
        name,
        value: Array.isArray(value) ? value.join(", ") : String(value),
      }));
    }
  } catch {
    /* not JSON — nothing to expand */
  }
  return [];
}
