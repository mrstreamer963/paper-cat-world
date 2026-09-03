import { test, expect } from "@playwright/test";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" onload="alert('bad')">
  <script>alert('bad')</script>
  <rect width="120" height="80" rx="16" fill="#ff8a65"/>
  <image href="https://example.com/tracker.png" width="10" height="10"/>
</svg>`;

test("imports, moves and persists a sanitized SVG layer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый кот", exact: true }).click();
  await page.locator("[data-image-import]").setInputFiles({
    name: "face.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg),
  });
  await expect(
    page.getByRole("button", { name: "Удалить картинку", exact: true }),
  ).toBeVisible();

  const canvas = page.getByTestId("drawing-canvas"),
    box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30);
  await page.mouse.up();
  await page.getByRole("button", { name: "Создать кота", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("data-cat-count", "3");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const path = await (await downloadPromise).path(),
    text = await (await import("node:fs/promises")).readFile(path, "utf8"),
    envelope = JSON.parse(text),
    imported = Object.values(envelope.world.drawings).find(
      (drawing) => drawing.images?.length,
    ).images[0],
    cleanedSvg = Buffer.from(imported.source.split(",")[1], "base64").toString(
      "utf8",
    );

  expect(imported.transform.x).toBeGreaterThan(110);
  expect(imported.transform.y).toBeGreaterThan(150);
  expect(cleanedSvg).not.toContain("script");
  expect(cleanedSvg).not.toContain("onload");
  expect(cleanedSvg).not.toContain("example.com");
});

test("accepts a PNG layer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый кот", exact: true }).click();
  await page.locator("[data-image-import]").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(
    page.getByRole("button", { name: "Удалить картинку", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Создать кота", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const path = await (await downloadPromise).path(),
    text = await (await import("node:fs/promises")).readFile(path, "utf8"),
    envelope = JSON.parse(text);
  expect(
    Object.values(envelope.world.drawings).some((drawing) =>
      drawing.images?.some((image) => image.source.startsWith("data:image/png;base64,")),
    ),
  ).toBe(true);
});
