import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Parser and library tests are pure functions — no DOM needed. API route
    // tests (Phase 1+) also run against handlers directly in node.
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
