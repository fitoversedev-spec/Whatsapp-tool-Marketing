import { prisma } from "./prisma";
import { readSheet, colIndex } from "./sheets";
import { normalizePhone } from "./phone";
import { sendTemplate, describeMetaError } from "./whatsapp";

const PACE_MS = parseInt(process.env.SENDER_PACE_MS || "120", 10); // ~8/sec
const CHUNK_SIZE = parseInt(process.env.SENDER_CHUNK_SIZE || "50", 10);

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FilterRule = {
  column: string;
  condition: "equals" | "contains" | "starts_with" | "not_empty";
  value?: string;
};

function matchesFilter(cellValue: string, rule: FilterRule): boolean {
  const cell = String(cellValue ?? "").trim().toLowerCase();
  const val = String(rule.value ?? "").trim().toLowerCase();
  switch (rule.condition) {
    case "equals": return cell === val;
    case "contains": return cell.includes(val);
    case "starts_with": return cell.startsWith(val);
    case "not_empty": return cell.length > 0;
    default: return true;
  }
}

export async function runBroadcast(broadcastId: string): Promise<void> {
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
    include: { template: true },
  });
  if (!broadcast) throw new Error("broadcast not found");
  if (broadcast.status === "completed" || broadcast.status === "failed") return;

  const mapping = JSON.parse(broadcast.variableMapping) as {
    phoneColumn: string;
    countryCodeColumn?: string | null;
    nameColumn?: string | null;
    variables: Record<string, string>;
    filterRules?: FilterRule[];
  };

  // Materialise recipients if not done
  let recipientCount = await prisma.broadcastRecipient.count({ where: { broadcastId } });
  if (recipientCount === 0) {
    let headers: string[] = [];
    let dataRows: string[][];

    if (broadcast.fileData) {
      const parsed = JSON.parse(broadcast.fileData) as string[][];
      headers = parsed[0] || [];
      dataRows = parsed.slice(1);
    } else if (broadcast.sheetId && broadcast.sheetRange) {
      dataRows = await readSheet({ sheetUrlOrId: broadcast.sheetId, range: broadcast.sheetRange });
    } else {
      throw new Error("No data source configured for broadcast");
    }

    const optOuts = new Set(
      (await prisma.optOut.findMany({ select: { phoneE164: true } })).map((o) => o.phoneE164)
    );

    // Column resolver: header name → numeric → letter
    const getColumnIndex = (colKey: string): number => {
      if (!colKey) return -1;
      const byHeader = headers.findIndex(
        (h) => String(h).trim().toLowerCase() === colKey.trim().toLowerCase()
      );
      if (byHeader >= 0) return byHeader;
      if (/^\d+$/.test(colKey)) return parseInt(colKey, 10);
      try { return colIndex(colKey); } catch { return -1; }
    };

    const phoneIdx = getColumnIndex(mapping.phoneColumn);
    const countryCodeIdx = mapping.countryCodeColumn ? getColumnIndex(mapping.countryCodeColumn) : -1;
    const nameIdx = mapping.nameColumn ? getColumnIndex(mapping.nameColumn) : -1;

    // Resolve filter column indices once
    const activeFilters = (mapping.filterRules ?? []).filter((r) => r.column?.trim());
    const filterIndices = activeFilters.map((r) => ({ rule: r, idx: getColumnIndex(r.column) }));

    const insertData: Array<{ broadcastId: string; phoneE164: string; name: string | null; variables: string }> = [];

    for (const row of dataRows) {
      // Apply filter rules
      if (filterIndices.length > 0) {
        const passes = filterIndices.every(({ rule, idx }) => {
          if (idx < 0) return false;
          return matchesFilter(String(row[idx] ?? ""), rule);
        });
        if (!passes) continue;
      }

      // Build phone — combine country code + phone if provided
      let rawPhone = String(row[phoneIdx] ?? "").trim();
      if (countryCodeIdx >= 0) {
        const cc = String(row[countryCodeIdx] ?? "").replace(/\D/g, "");
        rawPhone = cc + rawPhone.replace(/\D/g, "");
      }

      const phone = normalizePhone(rawPhone);
      if (!phone || optOuts.has(phone)) continue;

      const variables: Record<string, string> = {};
      for (const [k, col] of Object.entries(mapping.variables)) {
        variables[k] = String(row[getColumnIndex(col)] ?? "");
      }
      insertData.push({
        broadcastId,
        phoneE164: phone,
        name: nameIdx >= 0 ? String(row[nameIdx] ?? "") : null,
        variables: JSON.stringify(variables),
      });
    }

    if (insertData.length > 0) {
      await prisma.broadcastRecipient.createMany({ data: insertData, skipDuplicates: true });
    }

    recipientCount = insertData.length;
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { total: recipientCount, status: "running", launchedAt: new Date() },
    });
  } else {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: "running" },
    });
  }

  // Process queued recipients in chunks
  while (true) {
    const batch = await prisma.broadcastRecipient.findMany({
      where: { broadcastId, status: "queued" },
      take: CHUNK_SIZE,
    });
    if (batch.length === 0) break;

    for (const r of batch) {
      try {
        const rVars = JSON.parse(r.variables) as Record<string, string>;
        const components = [
          {
            type: "body" as const,
            parameters: Object.entries(rVars)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([, value]) => ({ type: "text" as const, text: value })),
          },
        ];
        const result = await sendTemplate({
          to: r.phoneE164,
          templateName: broadcast.template.name,
          language: broadcast.template.language,
          components,
        });
        await prisma.broadcastRecipient.update({
          where: { id: r.id },
          data: { status: "sent", waMessageId: result.waMessageId, sentAt: new Date() },
        });
      } catch (err) {
        const e = describeMetaError(err);
        await prisma.broadcastRecipient.update({
          where: { id: r.id },
          data: { status: "failed", errorCode: e.code, errorMessage: e.message },
        });
      }
      await sleep(PACE_MS);
    }

    // Recompute counters
    const groups = await prisma.broadcastRecipient.groupBy({
      by: ["status"],
      where: { broadcastId },
      _count: { _all: true },
    });
    const counters: Record<string, number> = {};
    for (const g of groups) counters[g.status] = g._count._all;
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        sent: counters.sent ?? 0,
        delivered: counters.delivered ?? 0,
        read: counters.read ?? 0,
        failed: counters.failed ?? 0,
      },
    });
  }

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: "completed", completedAt: new Date() },
  });
}
