import type { Role } from "@/lib/rbac";

export type GuideSectionId = "whatsapp" | "crm" | "scout" | "platform";

export type GuideStep = {
  text: string;
  target?: string;
  annotation?: "circle" | "arrow";
};

export type GuideEntry = {
  slug: string;
  title: string;
  summary: string;
  section: GuideSectionId;
  category: string;
  roles?: Role[];
  keywords?: string[];
  steps: GuideStep[];
  screenshot: {
    path: string;
    file: string;
    alt: string;
  };
};

export type RecordingAction =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "hover"; selector: string }
  | { type: "scroll"; selector?: string; direction: "down" | "up"; amount?: number }
  | { type: "type"; selector: string; text: string }
  | { type: "wait"; duration: number }
  | { type: "highlight"; selector: string; label?: string };

export type SectionRecording = {
  slug: string;
  title: string;
  section: GuideSectionId;
  startUrl: string;
  actions: RecordingAction[];
};
