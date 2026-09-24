import type { Role } from "@/lib/rbac";
import type { GuideEntry, GuideSectionId, SectionRecording } from "./types";
import { VIDEO_URLS } from "./video-manifest";
import { WHATSAPP_ENTRIES, WHATSAPP_RECORDING } from "./entries/whatsapp";
import { CRM_ENTRIES, CRM_RECORDING } from "./entries/crm";
import { SCOUT_ENTRIES, SCOUT_RECORDING } from "./entries/scout";

export const GUIDE_SECTIONS: {
  id: GuideSectionId;
  label: string;
  icon: string;
  description: string;
}[] = [
  { id: "whatsapp", label: "WhatsApp", icon: "\u{1F4AC}", description: "Inbox, Contacts, Broadcasts, Templates, Reminders, Quotations, Media" },
  { id: "crm", label: "CRM", icon: "\u{1F9ED}", description: "Dashboard, Contacts, Leads, Deals, Pipeline, Activities, Analytics" },
  { id: "scout", label: "Site Scout", icon: "\u{1F4CD}", description: "Scanning, Discovery, Comparison, Reports, AI Analysis" },
];

export const ALL_GUIDE_ENTRIES: GuideEntry[] = [
  ...WHATSAPP_ENTRIES,
  ...CRM_ENTRIES,
  ...SCOUT_ENTRIES,
];

const SECTION_RECORDINGS: SectionRecording[] = [
  WHATSAPP_RECORDING,
  CRM_RECORDING,
  SCOUT_RECORDING,
];

export function entriesForRole(role: Role): GuideEntry[] {
  return ALL_GUIDE_ENTRIES.filter(
    (e) => !e.roles || e.roles.includes(role),
  );
}

export function searchEntries(entries: GuideEntry[], query: string): GuideEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return entries;
  return entries.filter((e) => {
    const haystack = [
      e.title,
      e.summary,
      e.category,
      ...(e.keywords ?? []),
      ...e.steps.map((s) => s.text),
    ]
      .join(" ")
      .toLowerCase();
    return q.split(/\s+/).every((word) => haystack.includes(word));
  });
}

export function getRecordingForSection(
  section: GuideSectionId,
): { recording: SectionRecording; videoUrl: string | null } | null {
  const recording = SECTION_RECORDINGS.find((r) => r.section === section);
  if (!recording) return null;
  return { recording, videoUrl: VIDEO_URLS[recording.slug] ?? null };
}
