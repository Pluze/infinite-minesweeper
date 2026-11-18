import { defineConfig } from "@playwright/test";

const configuredBrowser = process.env.PLAYWRIGHT_BROWSER;
const browserName =
  configuredBrowser === "firefox" || configuredBrowser === "webkit"
    ? configuredBrowser
    : "chromium";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.browser.ts",
  use: {
    baseURL: "http://127.0.0.1:5180",
    browserName,
    channel:
      browserName === "chromium" ? process.env.PLAYWRIGHT_CHANNEL : undefined,
    launchOptions:
      browserName === "chromium"
        ? { args: ["--enable-unsafe-swiftshader"] }
        : undefined,
    viewport: { width: 1000, height: 760 },
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 5180 --strictPort",
    url: "http://127.0.0.1:5180",
  },
});
