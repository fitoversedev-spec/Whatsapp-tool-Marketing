import { UpstreamTimeoutError, isTimeoutError, withTimeout } from "@/lib/http";

const SHEETS_TIMEOUT_MS = 15_000;

// googleapis is huge; it is imported inside the functions that need it so
// routes that only use parseSheetId / colIndex don't load it.
async function getAuth() {
  const { google } = await import("googleapis");
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 not set");
  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  return new google.auth.GoogleAuth({
    credentials: json,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export function parseSheetId(input: string): string {
  // Accepts a full URL like https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0 OR the bare ID
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return input.trim();
}

export async function readSheet(args: {
  sheetUrlOrId: string;
  range: string; // e.g. "Sheet1!A2:D"
}): Promise<string[][]> {
  const spreadsheetId = parseSheetId(args.sheetUrlOrId);
  try {
    // 15 s for the whole call (auth + read). The per-request timeout also
    // cancels the HTTP request; withTimeout covers the token fetch.
    const res = await withTimeout(
      (async () => {
        const { google } = await import("googleapis");
        const auth = await getAuth();
        const sheets = google.sheets({ version: "v4", auth });
        return sheets.spreadsheets.values.get(
          {
            spreadsheetId,
            range: args.range,
            valueRenderOption: "UNFORMATTED_VALUE",
          },
          { timeout: SHEETS_TIMEOUT_MS },
        );
      })(),
      SHEETS_TIMEOUT_MS,
      "Google Sheets",
    );
    return (res.data.values as string[][]) ?? [];
  } catch (e) {
    if (isTimeoutError(e)) throw new UpstreamTimeoutError("Google Sheets", SHEETS_TIMEOUT_MS);
    throw e;
  }
}

// Column letter (A, B, ..., AA) -> zero-based index
export function colIndex(letter: string): number {
  const s = letter.toUpperCase();
  let idx = 0;
  for (let i = 0; i < s.length; i++) {
    idx = idx * 26 + (s.charCodeAt(i) - 64);
  }
  return idx - 1;
}
