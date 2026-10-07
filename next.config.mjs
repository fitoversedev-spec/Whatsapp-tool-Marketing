import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // <SwRegister /> registers the worker inside the signed-in layouts only —
  // not on /login or the customer-facing share pages (/p, /q, /view …).
  register: false,
  // Serwist's default reloads the page on every "online" event (Wi-Fi ↔ 4G
  // switch, laptop waking up), throwing away typed replies and open wizards.
  reloadOnOnline: false,
  // Precache only the icons, the web manifest and the UI fonts (~0.6 MB).
  // The default "**/*" pulled all of public/ — ~69 MB of help videos and
  // quotation artwork — onto every device on its first visit.
  globPublicPatterns: ["*.png", "manifest.webmanifest", "fonts/*.woff2"],
  // …and none of the build's JS/CSS chunks: they're content-hashed, so the
  // browser's HTTP cache already keeps them, and precaching all of them meant
  // ~1.6 MB downloaded up front, mostly for pages a user never opens.
  exclude: [/./],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The project lives under a OneDrive-synced folder. OneDrive briefly locks
  // files during sync, which surfaces as Windows errno -4094 "UNKNOWN: unknown
  // error, read" inside webpack's filesystem reads. We mitigate it three ways:
  //
  // 1. Disable Next.js's automatic barrel optimization (which creates virtual
  //    modules that need to be re-read on every compile). We do this by
  //    explicitly opting out for the packages we use (recharts, @dnd-kit).
  // 2. Disable webpack's persistent filesystem cache and use memory cache
  //    instead — eliminates the "Caching failed for pack" warnings.
  // 3. Switch the file watcher to polling — fs events from OneDrive-mediated
  //    files arrive out of order and webpack misreads them.
  experimental: {
    // Disable the client-side Router Cache so every navigation fetches fresh
    // server data. The default (30s dynamic / 5min static) causes stale lists
    // after mutations (delete deal → navigate back → old list until manual F5).
    // `static: 30` only lets a link's prefetched loading.tsx skeleton be shown
    // instantly on click (for up to 30 s after the prefetch); the page data is
    // still fetched fresh on every navigation because `dynamic` stays 0.
    staleTimes: { dynamic: 0, static: 30 },
    // Empty array intentionally OVERRIDES Next.js's auto-included default
    // list (which contains recharts since 14.x). Without this override
    // recharts gets barrel-optimized and we hit the OneDrive race.
    optimizePackageImports: [],
    // pdf-lib is pure JS with no native deps or runtime file reads — no
    // special handling needed. (We previously had @react-pdf/renderer here
    // but switched to pdf-lib because react-pdf's internal dynamic
    // imports race with OneDrive's file lock on Windows.)
    //
    // sharp (used to convert WEBP product photos to PNG for pdf-lib embedding)
    // ships a native binary — webpack trying to bundle it breaks at runtime
    // ("Could not load the sharp module..."). Keep it as a plain Node
    // `require` instead of bundling it. Next 14's stable location for this
    // moved to the top-level `serverExternalPackages` in Next 15+.
    serverComponentsExternalPackages: ["sharp", "@sparticuz/chromium"],
  },

  webpack: (config, { dev }) => {
    // Konva's UMD bundle has an opt-in import of the native `canvas` package
    // for headless Node rendering. We never want that on the server — the
    // editor is wrapped in next/dynamic({ ssr: false }) — so externalise the
    // `canvas` module name so webpack leaves it as an unresolved runtime
    // require (which never executes).
    config.externals = [
      ...(config.externals ?? []),
      { canvas: "commonjs canvas" },
    ];

    if (dev) {
      // Persistent pack-file cache lives under .next/cache/webpack and is
      // the prime victim of OneDrive locks. Memory cache loses nothing
      // except restart speed.
      config.cache = { type: "memory" };

      // Native fs events get racey under OneDrive — poll instead.
      config.watchOptions = {
        ...(config.watchOptions || {}),
        poll: 1000,
        aggregateTimeout: 300,
        ignored: ["**/node_modules/**", "**/.next/**", "**/.git/**"],
      };

      // Don't snapshot OneDrive-managed paths; webpack will re-check on each
      // build instead of trusting fs mtime which OneDrive lies about.
      config.snapshot = {
        ...(config.snapshot || {}),
        managedPaths: [],
        immutablePaths: [],
      };
    }
    return config;
  },
};

export default withSerwist(nextConfig);
