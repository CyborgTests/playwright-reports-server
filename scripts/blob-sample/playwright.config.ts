import { defineConfig } from "@playwright/test";

/** Minimal test run → `out/report.zip` for manual upload / CI smoke. */
export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  reporter: [["blob", { outputDir: "out" }]],
  use: { trace: "off" },
});
