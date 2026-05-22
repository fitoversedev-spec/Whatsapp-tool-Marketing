// Shared helpers for working with the persistent Contact pool.

export type ContactFilterRule = {
  field: string;
  condition: "equals" | "contains" | "starts_with" | "not_empty";
  value?: string;
};

export function matchesContactFilter(
  fieldValue: unknown,
  rule: ContactFilterRule
): boolean {
  const cell = String(fieldValue ?? "").trim().toLowerCase();
  const val = String(rule.value ?? "").trim().toLowerCase();
  switch (rule.condition) {
    case "equals":
      return cell === val;
    case "contains":
      return cell.includes(val);
    case "starts_with":
      return cell.startsWith(val);
    case "not_empty":
      return cell.length > 0;
    default:
      return true;
  }
}

// A contact's "fields" column is JSON. This safely parses it.
export function parseFields(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj as Record<string, string>;
    return {};
  } catch {
    return {};
  }
}

// Returns true if the contact (name + fields) passes ALL filter rules.
export function contactPassesFilters(
  contact: { name: string | null; fields: Record<string, string> },
  rules: ContactFilterRule[]
): boolean {
  if (!rules || rules.length === 0) return true;
  return rules.every((rule) => {
    if (!rule.field?.trim()) return true;
    // "name" is a top-level field; everything else is in fields{}
    const value =
      rule.field.toLowerCase() === "name"
        ? contact.name ?? ""
        : contact.fields[rule.field] ?? findFieldCaseInsensitive(contact.fields, rule.field);
    return matchesContactFilter(value, rule);
  });
}

function findFieldCaseInsensitive(fields: Record<string, string>, key: string): string {
  const lower = key.trim().toLowerCase();
  for (const [k, v] of Object.entries(fields)) {
    if (k.trim().toLowerCase() === lower) return v;
  }
  return "";
}
