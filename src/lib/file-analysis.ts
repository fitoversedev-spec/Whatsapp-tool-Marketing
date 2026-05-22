// Analyzes an uploaded contact file (parsed rows) and auto-detects which column
// is phone / country code / name / AllowCampaign by inspecting BOTH header names
// AND the actual cell content. Everything else becomes a saved field.

export type Confidence = "high" | "medium" | "low";

export type Detection = {
  role: "phone" | "countryCode" | "name" | "allowCampaign";
  column: string; // header label
  letter: string; // A, B, C…
  confidence: Confidence;
  reason: string;
};

export type FileAnalysis = {
  rowCount: number;
  columnCount: number;
  headers: string[];
  phoneColumn: string;
  countryCodeColumn: string;
  nameColumn: string;
  allowCampaignColumn: string;
  fieldColumns: string[];
  detections: Detection[];
};

type ColStat = {
  index: number;
  header: string;
  letter: string;
  numericRatio: number; // pure-number cells
  tenDigitRatio: number; // cells whose digits == 10
  shortNumericRatio: number; // 1–4 digit numbers (country codes)
  booleanRatio: number; // TRUE/FALSE/yes/no
  textRatio: number; // has letters
  distinctCount: number;
  nonEmpty: number;
};

const TRUE_SET = new Set(["true", "1", "yes", "y"]);
const FALSE_SET = new Set(["false", "0", "no", "n"]);

function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function computeStats(headers: string[], dataRows: any[][]): ColStat[] {
  const stats: ColStat[] = [];
  for (let c = 0; c < headers.length; c++) {
    const sample: string[] = [];
    for (let r = 0; r < dataRows.length && sample.length < 50; r++) {
      const v = String(dataRows[r]?.[c] ?? "").trim();
      if (v) sample.push(v);
    }
    const n = sample.length || 1;
    let numeric = 0,
      tenDigit = 0,
      shortNum = 0,
      bool = 0,
      text = 0;
    const distinct = new Set<string>();
    for (const v of sample) {
      distinct.add(v.toLowerCase());
      const digits = v.replace(/\D/g, "");
      const stripped = v.replace(/[\s\-+()]/g, "");
      if (stripped.length > 0 && /^\d+$/.test(stripped)) numeric++;
      if (digits.length === 10) tenDigit++;
      if (digits.length >= 1 && digits.length <= 4 && /^\+?\d+$/.test(stripped)) shortNum++;
      const lv = v.toLowerCase();
      if (TRUE_SET.has(lv) || FALSE_SET.has(lv)) bool++;
      if (/[a-z]/i.test(v)) text++;
    }
    stats.push({
      index: c,
      header: headers[c],
      letter: colLetter(c),
      numericRatio: numeric / n,
      tenDigitRatio: tenDigit / n,
      shortNumericRatio: shortNum / n,
      booleanRatio: bool / n,
      textRatio: text / n,
      distinctCount: distinct.size,
      nonEmpty: sample.length,
    });
  }
  return stats;
}

function pickBest(
  stats: ColStat[],
  used: Set<number>,
  score: (s: ColStat) => number,
  minScore: number
): ColStat | null {
  let best: ColStat | null = null;
  let bestScore = minScore;
  for (const s of stats) {
    if (used.has(s.index)) continue;
    const sc = score(s);
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return best;
}

export function analyzeFile(rows: any[][]): FileAnalysis {
  const rawHeaders = rows[0] ?? [];
  const headers = rawHeaders.map((h: any, i: number) => {
    const t = String(h ?? "").trim();
    return t || `Column ${colLetter(i)}`;
  });
  const dataRows = rows.slice(1);
  const stats = computeStats(headers, dataRows);
  const used = new Set<number>();
  const detections: Detection[] = [];

  const add = (role: Detection["role"], s: ColStat, confidence: Confidence, reason: string) => {
    used.add(s.index);
    detections.push({ role, column: s.header, letter: s.letter, confidence, reason });
  };

  // ── PHONE ────────────────────────────────────────────────────────────────
  const phone = pickBest(
    stats,
    used,
    (s) => {
      let score = s.tenDigitRatio * 80;
      if (/phone|mobile|whats\s*app|^number$|^ph$|^msisdn$/i.test(s.header)) score += 120;
      else if (/contact|cell|tel/i.test(s.header)) score += 40;
      return score;
    },
    20
  );
  if (phone) {
    const headerHit = /phone|mobile|whats\s*app|^number$|contact|cell/i.test(phone.header);
    add(
      "phone",
      phone,
      headerHit ? "high" : phone.tenDigitRatio > 0.7 ? "medium" : "low",
      headerHit
        ? `header "${phone.header}"`
        : `${Math.round(phone.tenDigitRatio * 100)}% of values are 10-digit numbers`
    );
  }

  // ── COUNTRY CODE ─────────────────────────────────────────────────────────
  const cc = pickBest(
    stats,
    used,
    (s) => {
      let score = 0;
      if (/country.?code|^cc$|^isd$|dial.?code/i.test(s.header)) score += 120;
      // Short numbers that repeat a lot (few distinct values) → country code
      if (s.shortNumericRatio > 0.8 && s.distinctCount <= 6) score += 60;
      return score;
    },
    50
  );
  if (cc) {
    const headerHit = /country.?code|^cc$|^isd$|dial.?code/i.test(cc.header);
    add(
      "countryCode",
      cc,
      headerHit ? "high" : "medium",
      headerHit ? `header "${cc.header}"` : `short repeating numeric values`
    );
  }

  // ── ALLOW CAMPAIGN ───────────────────────────────────────────────────────
  // Among boolean columns, prefer the one whose header mentions campaign/consent.
  const allow = pickBest(
    stats,
    used,
    (s) => {
      let score = 0;
      if (/allow.?campaign|^campaign$|consent|opt.?in/i.test(s.header)) score += 150;
      else if (s.booleanRatio > 0.8 && /allow|campaign|whats/i.test(s.header)) score += 70;
      // never auto-pick a generic SMS column for the campaign role
      if (/sms/i.test(s.header) && !/campaign/i.test(s.header)) score -= 200;
      return score;
    },
    50
  );
  if (allow) {
    const headerHit = /allow.?campaign|^campaign$|consent|opt.?in/i.test(allow.header);
    add(
      "allowCampaign",
      allow,
      headerHit ? "high" : "medium",
      headerHit ? `header "${allow.header}"` : `boolean column`
    );
  }

  // ── NAME ─────────────────────────────────────────────────────────────────
  const name = pickBest(
    stats,
    used,
    (s) => {
      let score = 0;
      if (/^name$|full.?name|business|customer|company|^contact name$/i.test(s.header)) score += 120;
      else if (/name/i.test(s.header)) score += 80;
      // Mostly-text columns are name candidates
      score += s.textRatio * 40;
      return score;
    },
    25
  );
  if (name) {
    const headerHit = /name|business|customer|company/i.test(name.header);
    add(
      "name",
      name,
      headerHit ? "high" : name.textRatio > 0.7 ? "medium" : "low",
      headerHit ? `header "${name.header}"` : `mostly text values`
    );
  }

  // ── REMAINING → SAVED FIELDS ─────────────────────────────────────────────
  const fieldColumns = stats.filter((s) => !used.has(s.index)).map((s) => s.header);

  return {
    rowCount: dataRows.length,
    columnCount: headers.length,
    headers,
    phoneColumn: phone?.header ?? "",
    countryCodeColumn: cc?.header ?? "",
    nameColumn: name?.header ?? "",
    allowCampaignColumn: allow?.header ?? "",
    fieldColumns,
    detections,
  };
}
