// Tracks how many CLIENT-SIDE (in-app) navigations have happened since the last
// full page load, so BackButton can distinguish "there is a previous in-app page
// to go back to" (use router.back) from "this page was loaded directly or from an
// external site" (fall back to the page's logical parent).
//
// Why not window.history? Two reasons: (1) window.history.length also counts
// pages from OTHER origins visited in the same tab, so a deep link opened next to
// Gmail/WhatsApp Web would wrongly look like in-app history; (2) Next 14's App
// Router does NOT expose a history index (there is no window.history.state.idx —
// its state is __PRIVATE_NEXTJS_INTERNALS_TREE), so an idx-based check is always
// 0 and never fires router.back().
//
// Module-level state is the right lifetime: it survives App Router client
// navigations (the JS bundle is not reloaded) and resets to 0 on a full page load
// (fresh tab, typed URL, external referrer, F5). NavigationTracker (mounted once
// in the dashboard layout) bumps the counter on every real pathname change.

let inAppNavCount = 0;

export function markInAppNav(): void {
  inAppNavCount += 1;
}

export function hasInAppHistory(): boolean {
  return inAppNavCount > 0;
}
