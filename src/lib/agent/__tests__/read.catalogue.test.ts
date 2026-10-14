import { beforeEach, describe, expect, it, vi } from "vitest";

const listProducts = vi.fn();
const getActiveProductsByIds = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/products/store", () => ({
  listProducts: (...a: unknown[]) => listProducts(...a),
  getActiveProductsByIds: (...a: unknown[]) => getActiveProductsByIds(...a),
  PRODUCT_TYPES: ["flooring", "material", "equipment"],
}));

import type { ProductDTO } from "@/lib/products/store";
import { AgentHttpError } from "../errors";
import {
  AVAILABILITY_MESSAGE,
  checkAvailability,
  compareProductSpecs,
  compareProductsByIds,
  getProductForAgent,
  matchesQuery,
  searchCatalogue,
} from "../read/catalogue";
import { pageByOffset, pageById, requireId } from "../read/shared";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

const product = (id: string, over: Partial<ProductDTO> = {}): ProductDTO => ({
  id,
  name: `Product ${id.slice(0, 2)}`,
  type: "flooring",
  description: "",
  sports: ["football"],
  category: "turf",
  heroImageUrl: null,
  videoUrl: null,
  specs: {},
  priceInr: null,
  unit: null,
  baseWork: null,
  featured: false,
  media: [],
  tdsFiles: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  listProducts.mockReset();
  getActiveProductsByIds.mockReset();
});

describe("compareProductSpecs", () => {
  const a = product(P1, { specs: { "Pile Height": "30mm", Gauge: "3/8 inch", Colour: "Green" }, priceInr: 100, unit: "sq.ft" });
  const b = product(P2, { specs: { "pile height": "30 mm", Gauge: "5/8 inch", Backing: "PU" } });
  const cmp = compareProductSpecs([a, b]);
  const row = (name: string) => cmp.specs.find((s) => s.spec === name)!;

  it("lines specs up case-insensitively and fills gaps with null", () => {
    expect(cmp.specs.map((s) => s.spec)).toEqual(["Pile Height", "Gauge", "Colour", "Backing"]);
    expect(row("Colour").values).toEqual({ [P1]: "Green", [P2]: null });
    expect(row("Backing").values).toEqual({ [P1]: null, [P2]: "PU" });
  });

  it("flags specs that differ, including one product not listing it", () => {
    expect(row("Gauge").differs).toBe(true);
    expect(row("Colour").differs).toBe(true);
    // "30mm" vs "30 mm" are different strings: not silently merged.
    expect(row("Pile Height").differs).toBe(true);
    expect(cmp.differingSpecs).toEqual(["Pile Height", "Gauge", "Colour", "Backing"]);
    expect(cmp.commonSpecs).toEqual([]);
  });

  it("treats identical values (ignoring case and spacing) as common", () => {
    const x = product(P1, { specs: { Colour: "Green  Mix" } });
    const y = product(P2, { specs: { colour: "green mix" } });
    const c = compareProductSpecs([x, y]);
    expect(c.commonSpecs).toEqual(["Colour"]);
    expect(c.differingSpecs).toEqual([]);
  });

  it("returns summary fields and an unconfirmed price, never a plain price", () => {
    expect(cmp.products[0]).toEqual({
      id: P1,
      name: a.name,
      type: "flooring",
      category: "turf",
      sports: ["football"],
      indicativePrice: { amountInr: 100, unit: "sq.ft", priceStatus: "indicative_unconfirmed" },
    });
    expect(cmp.products[1].indicativePrice).toBeNull();
    expect(JSON.stringify(cmp)).not.toMatch(/"priceInr"|"price"/);
  });
});

describe("compareProductsByIds", () => {
  it("needs two different products", async () => {
    await expect(compareProductsByIds([P1, P1])).rejects.toMatchObject({ code: "invalid_input", status: 400 });
    expect(getActiveProductsByIds).not.toHaveBeenCalled();
  });

  it("names the products that do not exist (or are archived)", async () => {
    getActiveProductsByIds.mockResolvedValue([product(P1)]);
    const err = await compareProductsByIds([P1, P2]).catch((e) => e);
    expect(err).toBeInstanceOf(AgentHttpError);
    expect(err.code).toBe("not_found");
    expect(err.message).toContain(P2);
    expect(err.message).not.toContain(P1);
  });

  it("compares live products", async () => {
    getActiveProductsByIds.mockResolvedValue([product(P1, { specs: { a: "1" } }), product(P2, { specs: { a: "1" } })]);
    const cmp = await compareProductsByIds([P1, P2, P2]);
    expect(getActiveProductsByIds).toHaveBeenCalledWith([P1, P2]);
    expect(cmp.commonSpecs).toEqual(["a"]);
  });
});

describe("search_catalogue", () => {
  const catalogue = [
    product(P1, { name: "Turf 30mm", specs: { Pile: "30mm" }, description: "Non-infill football turf" }),
    product(P2, { name: "Acrylic Court", category: "acrylic", description: "Hard court surface" }),
    product(P3, { name: "Goal Post", type: "equipment", category: "goal" }),
  ];

  it("filters on every word of q across name, description, category and specs", () => {
    expect(matchesQuery(catalogue[0], "turf football")).toBe(true);
    expect(matchesQuery(catalogue[0], "30MM")).toBe(true);
    expect(matchesQuery(catalogue[0], "turf tennis")).toBe(false);
    expect(matchesQuery(catalogue[1], "acrylic")).toBe(true);
  });

  it("passes type and sport to listProducts, pages by id, and maps to agent products", async () => {
    listProducts.mockResolvedValue(catalogue);
    const first = await searchCatalogue({ q: undefined, sport: "Football", type: "flooring", limit: 2, cursor: undefined });
    expect(listProducts).toHaveBeenCalledWith({ type: "flooring", sport: "football" });
    expect(first.items.map((i) => i.id)).toEqual([P1, P2]);
    expect(first.nextCursor).toBe(P2);
    const second = await searchCatalogue({ q: undefined, sport: undefined, type: undefined, limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((i) => i.id)).toEqual([P3]);
    expect(second.nextCursor).toBeNull();
  });

  it("applies the text filter before paging", async () => {
    listProducts.mockResolvedValue(catalogue);
    const r = await searchCatalogue({ q: "court", sport: undefined, type: undefined, limit: 20, cursor: undefined });
    expect(r.items.map((i) => i.id)).toEqual([P2]);
    expect(r.nextCursor).toBeNull();
  });

  it("rejects a cursor that is not in the list", async () => {
    listProducts.mockResolvedValue(catalogue);
    await expect(searchCatalogue({ q: undefined, sport: undefined, type: undefined, limit: 20, cursor: "nope" })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});

describe("get_product and check_availability", () => {
  it("404s on a malformed id without touching the store", async () => {
    await expect(getProductForAgent("not-an-id")).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(checkAvailability(undefined)).rejects.toMatchObject({ code: "not_found" });
    expect(getActiveProductsByIds).not.toHaveBeenCalled();
  });

  it("404s on an archived or missing product", async () => {
    getActiveProductsByIds.mockResolvedValue([]);
    await expect(getProductForAgent(P1)).rejects.toMatchObject({ code: "not_found" });
    await expect(checkAvailability(P1)).rejects.toMatchObject({ code: "not_found" });
  });

  it("availability is always unknown", async () => {
    getActiveProductsByIds.mockResolvedValue([product(P1)]);
    expect(await checkAvailability(P1)).toEqual({
      productId: P1,
      status: "unknown",
      message: "Stock and delivery are confirmed by the Fitoverse team.",
    });
    expect(AVAILABILITY_MESSAGE).toBe("Stock and delivery are confirmed by the Fitoverse team.");
  });
});

describe("paging helpers", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` }));

  it("pageById walks a list and ends with a null cursor", () => {
    const p1 = pageById(items, 2, undefined);
    expect(p1.items.map((i) => i.id)).toEqual(["i0", "i1"]);
    const p2 = pageById(items, 2, p1.nextCursor!);
    expect(p2.items.map((i) => i.id)).toEqual(["i2", "i3"]);
    const p3 = pageById(items, 2, p2.nextCursor!);
    expect(p3).toEqual({ items: [{ id: "i4" }], nextCursor: null });
    expect(pageById([], 2, undefined)).toEqual({ items: [], nextCursor: null });
    expect(pageById(items, 5, undefined).nextCursor).toBeNull();
  });

  it("pageByOffset validates the cursor", () => {
    const p1 = pageByOffset(items, 3, undefined);
    expect(p1.nextCursor).toBe("3");
    expect(pageByOffset(items, 3, "3")).toEqual({ items: [{ id: "i3" }, { id: "i4" }], nextCursor: null });
    for (const bad of ["-1", "1.5", "abc", "1234567"]) {
      expect(() => pageByOffset(items, 3, bad), bad).toThrow(AgentHttpError);
    }
  });

  it("requireId answers 404 for anything that is not an id", () => {
    expect(requireId(P1, "Thing")).toBe(P1);
    for (const bad of [undefined, "", "abc", "1; drop table", `${P1}x`]) {
      expect(() => requireId(bad, "Thing"), String(bad)).toThrow(/Thing not found/);
    }
  });
});
