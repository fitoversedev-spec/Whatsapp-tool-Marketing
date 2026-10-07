// Tracks the in-app pages visited since the last full page load, so BackButton
// can distinguish "there is a previous in-app page to go back to" (use
// router.back) from "this page was loaded directly or from an external site"
// (fall back to the page's logical parent).
//
// Why not window.history? Two reasons: (1) window.history.length also counts
// pages from OTHER origins visited in the same tab, so a deep link opened next to
// Gmail/WhatsApp Web would wrongly look like in-app history; (2) Next 14's App
// Router does NOT expose a history index (there is no window.history.state.idx —
// its state is __PRIVATE_NEXTJS_INTERNALS_TREE), so an idx-based check is always
// 0 and never fires router.back().
//
// It's a stack, not a counter: going Back (browser or in-app) pops it, so after
// A → B → Back the first page correctly has nothing in-app to go back to (a
// counter kept growing and sent router.back() out of the app).
//
// Module-level state is the right lifetime: it survives App Router client
// navigations (the JS bundle is not reloaded) and resets on a full page load
// (fresh tab, typed URL, external referrer, F5). NavigationTracker (mounted in
// the app layouts) reports every pathname.

const visited: string[] = [];
let fromHistory = false; // the next path change came from Back / Forward

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    fromHistory = true;
  });
}

export function recordInAppPath(path: string): void {
  const wentBack = fromHistory;
  fromHistory = false;
  if (visited[visited.length - 1] === path) return;
  if (wentBack && visited[visited.length - 2] === path) visited.pop();
  else visited.push(path);
}

export function hasInAppHistory(): boolean {
  return visited.length > 1;
}
