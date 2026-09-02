import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "convex/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.node_modules.evicted-backup/**",
      "web/**",
      "mobile/**",
      "macos/**",
      "telephony-worker/**",
    ],
  },
});
