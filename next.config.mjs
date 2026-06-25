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
    // Empty array intentionally OVERRIDES Next.js's auto-included default
    // list (which contains recharts since 14.x). Without this override
    // recharts gets barrel-optimized and we hit the OneDrive race.
    optimizePackageImports: [],
  },

  webpack: (config, { dev }) => {
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

export default nextConfig;
