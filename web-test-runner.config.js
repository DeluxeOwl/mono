import { esbuildPlugin } from "@web/dev-server-esbuild";
import { playwrightLauncher } from "@web/test-runner-playwright";

const chromium = playwrightLauncher({ product: "chromium" });
const webkit = playwrightLauncher({ product: "webkit" });
const firefox = playwrightLauncher({ product: "firefox" });

export default {
  concurrentBrowsers: 3,
  nodeResolve: {
    browser: true,
  },

  plugins: [esbuildPlugin({ ts: true, target: "esnext" })],
  staticLogging: !!process.env.CI,
  testFramework: {
    config: {
      ui: "tdd",
      reporter: "html",
      timeout: 30000,
      retries: process.env.CI ? 3 : 0, // Firefox is flaky
    },
  },
  groups: [
    {
      name: "Main",
      files: ["src/**/*.test.ts"],
      browsers: [firefox, chromium, webkit],
    },
  ],
};
