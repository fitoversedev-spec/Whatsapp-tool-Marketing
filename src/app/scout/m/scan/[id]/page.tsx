import { ResultsScreen } from "./ResultsScreen";

export const metadata = { title: "Results — Site Scout" };

/**
 * Screen 02, server side.
 *
 * A thin shell on purpose. The scan result is fetched client-side so the
 * service worker can mediate it: a network-first read that falls back to a
 * saved copy **stamped with its age**, which is what lets the screen say
 * "offline — last updated 3 hours ago" instead of presenting stale competitor
 * counts as current. Server-rendering the data would put it inside an HTML
 * document the worker would have to cache wholesale, with no way to tell the
 * reader how old it is.
 *
 * It also keeps customer data out of the cached document: the shell caches, the
 * numbers do not.
 */
export default async function ResultsPage({ params }: { params: { id: string } }) {
  const { id } = params;
  return <ResultsScreen scanId={id} />;
}
