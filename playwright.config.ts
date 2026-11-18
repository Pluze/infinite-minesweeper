import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.browser.ts",
  use: {
    baseURL: "http://127.0.0.1:5180",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
    viewport: { width: 1000, height: 760 },
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 5180 --strictPort",
    url: "http://127.0.0.1:5180",
  },
});
