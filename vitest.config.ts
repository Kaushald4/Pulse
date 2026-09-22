import { defineConfig } from "vitest/config";

/**
 * Unit tests for the pure modules, which is where the feed's logic lives.
 *
 * Node environment, not jsdom: the modules under test take plain data and return
 * plain data, so there is no DOM to stand up. Component tests would need jsdom
 * and a renderer, and are deliberately not part of this setup.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The suite is meant to land before the first module it covers, so an empty
    // run is a pass rather than a failure.
    passWithNoTests: true,
  },
});
