/**
 * Field mode's component set.
 *
 * These compose the Phase 0 design system (`@/components/scout/ui`,
 * `@/components/scout/patterns`, `<SiteMap />`) rather than forking it. Where the
 * phone needs something the shared set does not have — a bottom sheet, a
 * compact score, a sticky safe-area footer — it lives here, not in `ui/`,
 * because it is a Field-mode shape and the desktop screens have no use for it.
 */

export { FieldHeader, type FieldHeaderProps } from "./FieldHeader";
export { OfflineBanner, type OfflineBannerProps } from "./OfflineBanner";
export { SaturationRow, type SaturationRowProps } from "./SaturationRow";
export { ScoreBlock, ScorePending, type ScoreBlockProps } from "./ScoreBlock";
export { ServiceWorker } from "./ServiceWorker";
export { Sheet, type SheetProps } from "./Sheet";
export { StickyFooter, type StickyFooterProps } from "./StickyFooter";
export {
  SurveyChecklist,
  useDebounced,
  type ChecklistPayload,
  type SurveyChecklistProps,
} from "./SurveyChecklist";

export { apiFetch, ApiError, CACHE_DATE_HEADER, type ApiResult } from "./apiFetch";
export { fieldNavItems, type FieldNavContext, type FieldNavItem } from "./nav";
export { useGeolocation, type FixedPosition, type GeolocationStatus } from "./useGeolocation";
export { useOnline } from "./useOnline";
export {
  formatAgo,
  formatCount,
  formatDate,
  formatDistance,
  formatMinuteOfDay,
  formatNumber,
  formatRadius,
  formatRating,
  verdictLabel,
  verdictTone,
} from "./format";
