import { createRequire } from "node:module";
import { readingBrowserExecutable } from "./reading-renderer";

export interface CloudBrowserCheck {
  passed: true;
  architecture: string;
  checkedAt: string;
}

/** Run before serving Cloud MCP, and in the native local verification image. */
export async function checkCloudBrowser(): Promise<CloudBrowserCheck> {
  const require = createRequire(import.meta.url);
  const { chromium } =
    require("playwright-core") as typeof import("playwright-core");
  const browser = await chromium.launch({
    executablePath: await readingBrowserExecutable(),
    headless: true,
    timeout: 15000,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
    page.setDefaultTimeout(5000);
    await page.route(/^https?:/, (route) => route.abort());
    await page.setContent("<html><body><h1>ShowAI</h1></body></html>");
    const bounds = await page.locator("h1").boundingBox();
    const png = await page.screenshot({ timeout: 5000 });
    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || png.length < 100)
      throw new Error("Cloud MCP Chromium did not render the verification page.");
    return {
      passed: true,
      architecture: process.arch,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}
