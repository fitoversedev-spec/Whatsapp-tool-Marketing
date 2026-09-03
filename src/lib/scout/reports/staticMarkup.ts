import type { ReactElement } from "react";

/**
 * `renderToStaticMarkup`, reached through a dynamic import.
 *
 * ## Why it cannot be a plain import
 *
 * Next's App Router refuses a static `import … from "react-dom/server"`
 * anywhere in the server graph:
 *
 * > You're importing a component that imports react-dom/server. To fix it,
 * > render or return the content directly as a Server Component instead.
 *
 * That rule is aimed at a real mistake — hand-rendering a React tree to a
 * string inside a page that Next is already rendering. This is not that. The
 * report renderer produces a **complete standalone HTML document**: its own
 * `<!DOCTYPE>`, its own `<head>`, its own inline stylesheet, destined for a
 * headless Chromium that has never heard of Next. There is no Server Component
 * that could return it, because the output is a file, not a page.
 *
 * A dynamic import keeps `react-dom/server` out of the module graph Next
 * analyses while leaving the behaviour identical. The cost is that the
 * renderers become async, which they would have had to be anyway — every
 * caller is a route handler or a background job.
 *
 * ## Why `renderToStaticMarkup` and not `renderToString`
 *
 * Hydration markers would be dead weight in a document nobody hydrates, and
 * they would churn the golden files on a React upgrade for no reason. That
 * matters here specifically: the host application this is being folded into
 * runs **React 18**, and the fewer version-sensitive artefacts the golden files
 * carry, the smaller that port is.
 */
export async function renderStaticMarkup(element: ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(element);
}
