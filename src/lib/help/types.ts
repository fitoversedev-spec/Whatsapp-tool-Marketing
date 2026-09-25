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
    /** Actions run after the page loads and before annotating, to reach the state the guide describes (open a dialog, open the first record...). */
    setup?: ScreenshotSetupAction[];
    /** Override the 1440x900 capture size (phone-sized for mobile guides, taller when a control sits below the fold). Widths under 600 emulate a phone. */
    viewport?: { width: number; height: number };
  };
};

export type RecordingAction =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "hover"; selector: string }
  | { type: "scroll"; selector?: string; direction: "down" | "up"; amount?: number }
  | { type: "type"; selector: string; text: string }
  | { type: "wait"; duration: number }
  | { type: "highlight"; selector: string; label?: string }
  | { type: "caption"; text: string; duration?: number };

export type ScreenshotSetupAction = Extract<
  RecordingAction,
  { type: "navigate" | "click" | "hover" | "scroll" | "type" | "wait" }
>;

export type SectionRecording = {
  slug: string;
  title: string;
  section: GuideSectionId;
  startUrl: string;
  actions: RecordingAction[];
};
