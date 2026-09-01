import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: "tests/production", use: { baseURL: "http://127.0.0.1:4174" }, webServer: { command: "npm run preview -- --host 127.0.0.1 --port 4174", url: "http://127.0.0.1:4174", reuseExistingServer: false }, projects: [{ name: "production-chromium", use: { ...devices["Desktop Chrome"] } }] });
