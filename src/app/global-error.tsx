"use client";

// Last-resort screen if the root layout itself fails. It replaces the whole
// document, so it brings its own <html>/<body> and inline styles (the app's
// stylesheet may not be there).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const button = { padding: "8px 16px", borderRadius: 8, border: "1px solid #159341", cursor: "pointer", fontSize: 14 };
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, background: "#f8fafc", color: "#0d2733" }}>
        <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Something went wrong.</h1>
        <p style={{ fontSize: 14, margin: "0 0 16px" }}>
          Please reload the page. If it keeps happening, tell the team{error?.digest ? ` (code ${error.digest})` : ""}.
        </p>
        <button type="button" onClick={() => window.location.reload()} style={{ ...button, background: "#159341", color: "#fff" }}>
          Reload page
        </button>{" "}
        <button type="button" onClick={reset} style={{ ...button, background: "#fff", color: "#159341" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
