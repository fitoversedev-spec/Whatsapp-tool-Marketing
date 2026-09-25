import type { Role } from "@/lib/rbac";
import type { GuideEntry, GuideSectionId, SectionRecording } from "./types";
import { VIDEO_URLS } from "./video-manifest";
import { WHATSAPP_ENTRIES, WHATSAPP_RECORDING } from "./entries/whatsapp";
import { CRM_ENTRIES, CRM_RECORDING } from "./entries/crm";
import { SCOUT_ENTRIES, SCOUT_RECORDING } from "./entries/scout";
import { PLATFORM_ENTRIES, PLATFORM_RECORDING } from "./entries/platform";

export const GUIDE_SECTIONS: {
  id: GuideSectionId;
  label: string;
  icon: string;
  description: string;
}[] = [
  { id: "platform", label: "Getting Started", icon: "\u{1F680}", description: "Account, Installation, Navigation, Theme" },
  { id: "whatsapp", label: "WhatsApp", icon: "\u{1F4AC}", description: "Inbox, Contacts, Broadcasts, Templates, Reminders, Quotations, Media" },
  { id: "crm", label: "CRM", icon: "\u{1F9ED}", description: "Dashboard, Contacts, Leads, Deals, Pipeline, Activities, Analytics" },
  { id: "scout", label: "Site Scout", icon: "\u{1F4CD}", description: "Scanning, Discovery, Comparison, Reports, AI Analysis" },
];

export const ALL_GUIDE_ENTRIES: GuideEntry[] = [
  ...PLATFORM_ENTRIES,
  ...WHATSAPP_ENTRIES,
  ...CRM_ENTRIES,
  ...SCOUT_ENTRIES,
];

const SECTION_RECORDINGS: SectionRecording[] = [
  PLATFORM_RECORDING,
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
  const stopWords = new Set(["how", "to", "the", "a", "an", "in", "on", "of", "and", "or", "is", "it", "do", "i", "we", "can", "my", "for", "with", "from", "by", "what", "where", "which", "this", "that"]);
  const words = q.split(/\s+/).filter((w) => !stopWords.has(w) && w.length > 1);
  if (words.length === 0) return entries;

  const scored = entries.map((e) => {
    const haystack = [
      e.title,
      e.summary,
      e.category,
      ...(e.keywords ?? []),
      ...e.steps.map((s) => s.text),
    ]
      .join(" ")
      .toLowerCase();
    const hits = words.filter((w) => haystack.includes(w)).length;
    return { entry: e, score: hits / words.length };
  });

  const minScore = words.length === 1 ? 1 : 0.4;
  return scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.entry);
}

export function getRecordingForSection(
  section: GuideSectionId,
): { recording: SectionRecording; videoUrl: string | null } | null {
  const recording = SECTION_RECORDINGS.find((r) => r.section === section);
  if (!recording) return null;
  return { recording, videoUrl: VIDEO_URLS[recording.slug] ?? null };
}
