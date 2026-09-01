import { test, expect } from "@playwright/test";

test("export/import round-trip is atomic and resets undo history", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-webkit", "file download round-trip is covered in Chromium");
  await page.goto("/"); const main = page.locator("main"), initial = Number(await main.getAttribute("data-entity-count"));
  await page.getByRole("button", { name: "Новый лист" }).click(); const savedCount = Number(await main.getAttribute("data-entity-count")); expect(savedCount).toBeGreaterThan(initial);
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Экспорт" }).click(); const download = await downloadPromise, path = await download.path(); expect(download.suggestedFilename()).toMatch(/^paper-cat-world-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await (await import("node:fs/promises")).readFile(path, "utf8"), envelope = JSON.parse(text);
  expect(envelope).toMatchObject({ format: "paper-cat-world", schemaVersion: 1 }); expect(envelope.world.rules).toBeUndefined(); expect(Object.keys(envelope.world.entities)).toEqual(Object.keys(envelope.world.entities).sort());
  await page.getByRole("button", { name: "Новая тетрадь" }).click(); expect(Number(await main.getAttribute("data-entity-count"))).toBeGreaterThan(savedCount);
  await page.locator("[data-import]").setInputFiles(path); await expect(main).toHaveAttribute("data-entity-count", String(savedCount));
  await page.keyboard.press("ControlOrMeta+z"); await expect(main).toHaveAttribute("data-entity-count", String(savedCount));
});

test("two different cats are visually identical after JSON round-trip", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-webkit", "visual file round-trip is covered on desktop engines"); await page.goto("/"); const canvas = page.getByTestId("world-canvas"), main = page.locator("main"); await expect(canvas).toBeVisible(); const before = await canvas.evaluate((node) => node.toDataURL()); await expect(main).toHaveAttribute("data-cat-count", "2");
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Экспорт" }).click(); const path = await (await downloadPromise).path(); await page.getByRole("button", { name: "Новый лист" }).click(); await page.locator("[data-import]").setInputFiles(path); await expect(main).toHaveAttribute("data-cat-count", "2"); expect(await canvas.evaluate((node) => node.toDataURL())).toBe(before);
});

test("corrupt and future imports leave the current scene untouched", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-webkit", "file import errors are covered in Chromium");
  await page.goto("/"); await page.getByRole("button", { name: "Новый лист" }).click(); const main = page.locator("main"), count = await main.getAttribute("data-entity-count"), selected = await main.getAttribute("data-selected-entity");
  await page.locator("[data-import]").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{no") }); await expect(page.getByRole("status")).toContainText("повреждён");
  await expect(main).toHaveAttribute("data-entity-count", count); await expect(main).toHaveAttribute("data-selected-entity", selected);
  await page.locator("[data-import]").setInputFiles({ name: "future.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "paper-cat-world", schemaVersion: 999 })) }); await expect(page.getByRole("status")).toContainText("более новой версией"); await expect(main).toHaveAttribute("data-entity-count", count);
});

test("reload offers the latest autosave and restore recreates it", async ({ page }) => {
  await page.goto("/"); const main = page.locator("main"), initial = Number(await main.getAttribute("data-entity-count")); await page.getByRole("button", { name: "Новый лист" }).click(); const changed = Number(await main.getAttribute("data-entity-count")); expect(changed).toBeGreaterThan(initial); await page.waitForTimeout(550);
  await page.reload(); await expect(page.getByRole("heading", { name: "Восстановить мир?" })).toBeVisible(); await page.getByRole("button", { name: "Восстановить" }).click(); await expect(main).toHaveAttribute("data-entity-count", String(changed));
  await page.keyboard.press("ControlOrMeta+z"); await expect(main).toHaveAttribute("data-entity-count", String(changed));
});

test("declining autosave starts clean and replaces the recovery snapshot", async ({ page }) => {
  await page.goto("/"); const main = page.locator("main"); await expect(main).toHaveAttribute("data-entity-count", /\d+/); const initial = await main.getAttribute("data-entity-count"); await page.getByRole("button", { name: "Новый лист" }).click(); await page.waitForTimeout(550); await page.reload(); await page.getByRole("button", { name: "Начать новый мир" }).click(); await expect(main).toHaveAttribute("data-entity-count", initial); await page.waitForTimeout(550); await page.reload(); await page.getByRole("button", { name: "Восстановить" }).click(); await expect(main).toHaveAttribute("data-entity-count", initial);
});

test("a corrupt autosave is reported and retained for diagnostics", async ({ page }) => {
  await page.goto("/"); await page.evaluate(() => localStorage.setItem("paper-cat-world:autosave:v1", "{broken")); await page.reload(); await expect(page.getByRole("status")).toContainText("повреждён"); expect(await page.evaluate(() => localStorage.getItem("paper-cat-world:autosave:v1"))).toBe("{broken"); await expect(page.getByRole("heading", { name: "Восстановить мир?" })).toBeHidden();
});

test("all visible interactive controls meet the 44px target", async ({ page }) => {
  await page.goto("/"); const boxes = await page.locator("button:visible,input:visible").evaluateAll((nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); return { label: node.textContent || node.getAttribute("aria-label"), width: box.width, height: box.height }; }));
  expect(boxes.length).toBeGreaterThan(0); for (const box of boxes) { expect(box.width, box.label).toBeGreaterThanOrEqual(44); expect(box.height, box.label).toBeGreaterThanOrEqual(44); }
});

test("fit-to-table leaves no model-visible branch culled", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Показать весь стол" }).click(); await expect(page.getByTestId("debug-stats")).toContainText("culled 0");
});
