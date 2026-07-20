// Per-target field definitions for the guided CRM import wizard. Each
// target lists the columns a spreadsheet can map to, which are required,
// and the template header row offered as a starting point.
export type ImportTarget = "CONTACTS" | "COMPANIES" | "LEADS" | "DEALS";

export type ImportFieldDef = {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
};

export const IMPORT_FIELDS: Record<ImportTarget, ImportFieldDef[]> = {
  COMPANIES: [
    { key: "name", label: "Company name", required: true },
    { key: "city", label: "City" },
    { key: "businessType", label: "Business type (B2B/B2C/B2G)" },
    { key: "gstin", label: "GSTIN" },
    { key: "notes", label: "Notes" },
  ],
  CONTACTS: [
    { key: "accountName", label: "Company name", required: true, hint: "Matched by exact name; created if not found" },
    { key: "name", label: "Contact name", required: true },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "designation", label: "Designation" },
    { key: "siteCity", label: "Location" },
    { key: "customerProfileName", label: "Customer type", hint: "Matched by exact name against the Customer Type taxonomy" },
    { key: "businessType", label: "Business type (B2B/B2C/B2G)" },
    { key: "leadSourceName", label: "Lead source", hint: "Matched by exact name against the Lead Source taxonomy" },
    { key: "sourceDetail", label: "Lead source detail" },
    { key: "notes", label: "What this lead wants" },
  ],
  LEADS: [
    { key: "name", label: "Name", required: true },
    { key: "phone", label: "Phone", required: true },
    { key: "email", label: "Email" },
    { key: "city", label: "City" },
    { key: "leadSourceName", label: "Lead source", hint: "Matched by exact name against the Lead Source taxonomy" },
    { key: "interestNote", label: "Interest note" },
  ],
  DEALS: [
    { key: "title", label: "Deal title", required: true },
    { key: "accountName", label: "Company name", required: true, hint: "Matched by exact name; created if not found" },
    { key: "siteCity", label: "Site city" },
    { key: "estimatedValue", label: "Estimated value (INR)" },
    { key: "leadSourceName", label: "Lead source", hint: "Matched by exact name against the Lead Source taxonomy" },
  ],
};

export const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = {
  CONTACTS: "Contacts",
  COMPANIES: "Companies",
  LEADS: "Leads",
  DEALS: "Deals",
};

export function templateHeaders(target: ImportTarget): string[] {
  return IMPORT_FIELDS[target].map((f) => f.label);
}

// Best-effort auto-match: a spreadsheet header matches a field if it
// contains the field's key or label (case-insensitive) — same lightweight
// heuristic already used by the Contact import's own column detection
// (src/lib/contacts.ts), not a full fuzzy-match library.
export function autoMatchColumns(target: ImportTarget, headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of IMPORT_FIELDS[target]) {
    const idx = headers.findIndex((h) => {
      const norm = h.trim().toLowerCase();
      return norm === field.key.toLowerCase() || norm === field.label.toLowerCase() || norm.includes(field.key.toLowerCase());
    });
    if (idx >= 0) result[field.key] = headers[idx];
  }
  return result;
}
