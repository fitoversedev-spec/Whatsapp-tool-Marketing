import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitTemplate, describeMetaError } from "@/lib/whatsapp";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const tpl = await prisma.template.findUnique({ where: { id: params.id } });
  if (!tpl) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (tpl.status !== "pending_admin") {
    return NextResponse.json({ error: "Only pending_admin templates can be submitted" }, { status: 422 });
  }

  // Build components in Meta format
  const components: Record<string, unknown>[] = [];
  if (tpl.header) components.push({ type: "HEADER", ...(JSON.parse(tpl.header) as any) });
  components.push({ type: "BODY", text: tpl.body });
  if (tpl.footer) components.push({ type: "FOOTER", text: tpl.footer });
  if (tpl.buttons) components.push({ type: "BUTTONS", ...(JSON.parse(tpl.buttons) as any) });

  try {
    const result = await submitTemplate({
      name: tpl.name,
      language: tpl.language,
      category: tpl.category as "MARKETING" | "UTILITY" | "AUTHENTICATION",
      components,
    });

    await prisma.template.update({
      where: { id: tpl.id },
      data: {
        status: "submitted",
        metaTemplateId: result.id || null,
        approvedByUserId: user.id,
        submittedAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true, metaTemplateId: result.id });
  } catch (err) {
    const e = describeMetaError(err);
    return NextResponse.json({ error: `Meta rejected submission: ${e.message}`, code: e.code }, { status: 502 });
  }
}
