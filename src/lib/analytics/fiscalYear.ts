// Apr 1 – Mar 31 fiscal year helpers (Indian FY convention this business
// runs on). Pure date math, no Prisma import — importable from client
// components too, matching how types.ts stays Prisma-free.
export type FiscalYear = { start: Date; end: Date; label: string };

function fyLabel(startYear: number): string {
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  return `FY${startYear}-${endYY}`;
}

export function fyContaining(date: Date): FiscalYear {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1; // month 3 = April
  const start = new Date(startYear, 3, 1);
  const end = new Date(startYear + 1, 2, 31, 23, 59, 59, 999);
  return { start, end, label: fyLabel(startYear) };
}

export function currentFY(): FiscalYear {
  return fyContaining(new Date());
}

export function previousFY(fy: { start: Date; end: Date }): FiscalYear {
  const prevStartYear = fy.start.getFullYear() - 1;
  return fyContaining(new Date(prevStartYear, 3, 1));
}

export function fyPair(): { current: FiscalYear; previous: FiscalYear } {
  const current = currentFY();
  return { current, previous: previousFY(current) };
}
