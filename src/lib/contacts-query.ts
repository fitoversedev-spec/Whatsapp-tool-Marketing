import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseFields } from "@/lib/contacts";

// Database-side contact list queries. They replace "load every contact, parse
// every `fields` blob, filter in JS" so a page of 50 costs one small query.
// (Server-only: src/lib/contacts.ts is imported by client components.)

export const CONTACTS_PAGE_SIZE = 50;
export const MAX_SEARCH_CHARS = 200;

export type ContactListFilter = {
  search?: string | null;
  field?: string | null;
  value?: string | null;
  tag?: string | null;
};

export type ContactListRow = {
  id: string;
  phone: string;
  name: string | null;
  allowCampaign: boolean;
  fields: Record<string, string>;
  createdAt: string;
  tagIds: string[];
  tags: { id: string; name: string; color: string }[];
  accountContactId: string | null;
};

type RawRow = {
  id: string;
  phone: string;
  name: string | null;
  allowCampaign: boolean;
  fields: string;
  createdAt: Date | string;
  accountContactId: string | null;
  tags: ContactListRow["tags"] | string | null;
  total: number;
};

// `fields` is TEXT holding a JSON object. Anything that doesn't start with "{"
// — or isn't valid JSON — counts as empty, the way parseFields() treats it,
// so one bad row can't fail the whole list (pg_input_is_valid: Postgres 16+).
const FJ = Prisma.sql`(CASE WHEN c.fields ~ '^\\s*\\{' AND pg_input_is_valid(c.fields, 'jsonb') THEN c.fields::jsonb ELSE '{}'::jsonb END)`;

// What JS trim() strips; Postgres btrim() only strips spaces unless told.
const TRIM_CHARS = " \t\n\r\f\v   　﻿";

// Postgres text can't hold NUL bytes — a stray one would fail the whole query.
const clean = (s: string | null | undefined) => (s ?? "").replace(/\u0000/g, "");

function normalize(f: ContactListFilter) {
  return {
    search: clean(f.search).trim().toLowerCase().slice(0, MAX_SEARCH_CHARS),
    field: clean(f.field).trim(),
    value: clean(f.value).trim(),
    tag: clean(f.tag).trim(),
  };
}
type NormFilter = ReturnType<typeof normalize>;

// Same matching as the old in-memory filter; all conditions are ANDed.
function whereSql(f: NormFilter): Prisma.Sql {
  const conds: Prisma.Sql[] = [];

  if (f.tag) {
    conds.push(
      Prisma.sql`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ${f.tag}::text)`
    );
  }

  if (f.search) {
    // strpos (not ILIKE) so "%" and "_" in the search stay literal. The text
    // may match the phone, the name, or any field VALUE (never a key).
    const s = f.search;
    conds.push(Prisma.sql`(
      strpos(c.phone_e164, ${s}::text) > 0
      OR strpos(lower(coalesce(c.name, '')), ${s}::text) > 0
      OR EXISTS (SELECT 1 FROM jsonb_each_text(${FJ}) AS kv WHERE strpos(lower(kv.value), ${s}::text) > 0)
    )`);
  }

  if (f.field && f.value) {
    const { field, value } = f;
    if (field.toLowerCase() === "name") {
      conds.push(
        Prisma.sql`lower(btrim(coalesce(c.name, ''), ${TRIM_CHARS}::text)) = lower(${value}::text)`
      );
    } else {
      // Exact key first; only when it's missing (or null) fall back to a
      // case/space-insensitive key match — as contactPassesFilters() does.
      conds.push(Prisma.sql`(CASE
        WHEN coalesce(jsonb_typeof(${FJ} -> ${field}::text), 'null') <> 'null'
          THEN lower(btrim(${FJ} ->> ${field}::text, ${TRIM_CHARS}::text)) = lower(${value}::text)
        ELSE EXISTS (
          SELECT 1 FROM jsonb_each_text(${FJ}) AS kv
          WHERE lower(btrim(kv.key, ${TRIM_CHARS}::text)) = lower(${field}::text)
            AND lower(btrim(kv.value, ${TRIM_CHARS}::text)) = lower(${value}::text)
        )
      END)`);
    }
  }

  return conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty;
}

function parseTags(raw: RawRow["tags"]): ContactListRow["tags"] {
  if (!raw) return [];
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// One mapper for every contact list, so the page and the API stay identical.
function toContactRow(r: RawRow): ContactListRow {
  const tags = parseTags(r.tags);
  return {
    id: r.id,
    phone: r.phone,
    name: r.name,
    allowCampaign: r.allowCampaign,
    fields: parseFields(r.fields),
    createdAt: new Date(r.createdAt).toISOString(),
    tagIds: tags.map((t) => t.id),
    tags,
    accountContactId: r.accountContactId,
  };
}

async function countNormalized(f: NormFilter): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: number }[]>(
    Prisma.sql`SELECT count(*)::int AS total FROM contacts c ${whereSql(f)}`
  );
  return rows[0]?.total ?? 0;
}

export function countContacts(filter: ContactListFilter): Promise<number> {
  return countNormalized(normalize(filter));
}

// One page (newest first) plus the total number of matches, in one statement.
export async function listContacts(
  filter: ContactListFilter,
  page: number
): Promise<{ contacts: ContactListRow[]; total: number }> {
  const f = normalize(filter);
  const pg = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const offset = (pg - 1) * CONTACTS_PAGE_SIZE;

  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT c.id,
           c.phone_e164 AS phone,
           c.name,
           c.allow_campaign AS "allowCampaign",
           c.fields,
           c.created_at AS "createdAt",
           c.account_contact_id AS "accountContactId",
           count(*) OVER ()::int AS total,
           COALESCE((
             SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY ct.tagged_at, ct.tag_id)
             FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
             WHERE ct.contact_id = c.id
           ), '[]'::json) AS tags
    FROM contacts c
    ${whereSql(f)}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${CONTACTS_PAGE_SIZE}::int OFFSET ${offset}::bigint
  `);

  // An empty page past the end has no row to carry the window total.
  const total = rows.length > 0 ? rows[0].total : pg > 1 ? await countNormalized(f) : 0;
  return { contacts: rows.map(toContactRow), total };
}

// Every matching id, newest first, unpaged ("Select all N matching").
export async function listContactIds(filter: ContactListFilter): Promise<string[]> {
  const f = normalize(filter);
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT c.id FROM contacts c ${whereSql(f)} ORDER BY c.created_at DESC, c.id DESC`
  );
  return rows.map((r) => r.id);
}

// Every distinct key used in any contact's `fields` (column headers + filter UI).
export async function distinctFieldKeys(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ key: string }[]>(
    Prisma.sql`SELECT DISTINCT jsonb_object_keys(${FJ}) AS key FROM contacts c`
  );
  return rows.map((r) => r.key).sort();
}
