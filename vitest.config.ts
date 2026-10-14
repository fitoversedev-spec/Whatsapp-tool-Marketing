import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(new URL("./vitest.stubs/server-only.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // `server-only` throws on import outside a React server build; the tests
      // run in plain Node, so it resolves to an empty module here.
      { find: /^server-only$/, replacement: serverOnlyStub },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
