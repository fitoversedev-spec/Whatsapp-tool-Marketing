import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/, "lowercase snake_case only").min(1).max(512),
  language: z.string().min(2).max(10),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  body: z.string().min(1).max(1024),
  footer: z.string().max(60).nullable().optional(),
  header: z.any().optional(),
  buttons: z.any().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "invalid" }, { status: 400 });
  }

  const tpl = await prisma.template.create({
    data: {
      name: parsed.data.name,
      language: parsed.data.language,
      category: parsed.data.category,
      body: parsed.data.body,
      footer: parsed.data.footer ?? null,
      header: parsed.data.header ? JSON.stringify(parsed.data.header) : null,
      buttons: parsed.data.buttons ? JSON.stringify(parsed.data.buttons) : null,
      status: "draft",
      draftedByUserId: user.id,
    },
  });

  return NextResponse.json({ template: { id: tpl.id, status: tpl.status } });
}
