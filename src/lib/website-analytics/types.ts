// Shapes of /api/website-leads/analytics: the sections, the date range they were
// built for, and each section's data. The UI imports these types.
import type { SourceGroup } from "./sources";

export const ANALYTICS_SECTIONS = ["overview", "live", "sources", "ai", "pages", "search", "leadsBySource"] as const;
export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number];

export const RANGE_PRESETS = ["7d", "30d", "this_month", "last_month", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** All dates are YYYY-MM-DD on the Asia/Kolkata calendar, both ends included. */
export type ResolvedRange = {
  preset: RangePreset;
  from: string;
  to: string;
  prevFrom: string; // the period of the same length immediately before
  prevTo: string;
  days: number;
};

/** A number for the chosen range and the same number for the previous period. */
export type Stat = { value: number; previous: number };

export type OverviewData = {
  visitors: Stat; // GA active users
  visits: Stat; // GA sessions
  pageViews: Stat;
  avgEngagementSec: Stat; // seconds of engaged time per visitor
  newVisitors: Stat;
  returningVisitors: Stat;
  /** One entry for every day of the range (zeros filled in). */
  series: { date: string; visitors: number; leads: number }[];
  /** Website leads from our own database (live leads only). rate = leads / visitors as a fraction (0.034 = 3.4%); null when there were no visitors. */
  leads: { total: number; previous: number; rate: number | null; previousRate: number | null };
};

export type LiveData = {
  windowMinutes: number;
  activeUsers: number;
  pages: { page: string; users: number }[]; // top 10
  devices: { device: string; users: number }[];
};

export type SourcesData = {
  totalSessions: number;
  /** Sessions per group after the shared classifier (AI assistants get their own group). share is a fraction. */
  channels: { group: SourceGroup; sessions: number; share: number }[];
  topSources: { source: string; medium: string; label: string; group: SourceGroup; sessions: number }[]; // top 10
  cities: { city: string; visitors: number; sessions: number }[]; // top 10
  devices: { device: string; visitors: number; sessions: number }[];
};

export type AiData = {
  totalSessions: number;
  assistants: { label: string; sessions: number; visitors: number }[]; // only assistants that sent visits
  trend: { date: string; sessions: number }[]; // every day of the range
  landingPages: { page: string; sessions: number }[]; // top 10 landing pages of AI sessions
};

export type BuildStepKey = "viewed_build" | "designer_step" | "generate_lead" | "contact_click";
export type PagesData = {
  pages: { path: string; views: number; visitors: number; avgEngagementSec: number }[]; // top 15
  /** "Build a court": how many people did each thing. Separate counts, NOT a strict funnel. */
  buildSteps: { key: BuildStepKey; label: string; people: number }[];
};

export type SearchRow = { clicks: number; impressions: number; ctr: number; position: number }; // ctr is a fraction
export type SearchData = {
  /** The dates actually asked of Search Console: its data runs delayDays behind, so `to` can be earlier than the range's end. */
  from: string;
  to: string;
  requestedTo: string;
  delayDays: number;
  note: string;
  queries: (SearchRow & { query: string })[]; // top 25
  pages: (SearchRow & { page: string })[]; // top 10, full URLs
};

export type LeadsBySourceData = {
  total: number;
  /** Leads with no attribution are labelled "Unknown". */
  sources: { label: string; group: SourceGroup; count: number }[];
  groups: { group: SourceGroup; count: number }[];
};

export type SectionData = {
  overview: OverviewData;
  live: LiveData;
  sources: SourcesData;
  ai: AiData;
  pages: PagesData;
  search: SearchData;
  leadsBySource: LeadsBySourceData;
};

export type AnalyticsResponse<S extends AnalyticsSection = AnalyticsSection> =
  | {
      ok: true;
      connected: true;
      section: S;
      range: ResolvedRange | null; // null for "live"
      generatedAt: string; // ISO; when this data was fetched from Google (cached up to an hour)
      data: SectionData[S];
    }
  | { ok: true; connected: false; section: S; missing: string[] } // names of the missing server settings
  | { ok: false; error: string }; // friendly text, safe to show
