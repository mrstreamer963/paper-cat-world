import { test, expect } from "@playwright/test";
test("scene exposes mouse and touch controls without hover", async ({ page }) => { await page.goto("/"); await expect(page.getByText("Бумажный мир")).toBeVisible(); await expect(page.getByRole("button", { name: "Показать весь стол" })).toBeVisible(); const canvas = page.locator("canvas"); await expect(canvas).toBeVisible(); const box = await page.getByRole("button", { name: "Показать весь стол" }).boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); });
test("wheel zoom and fit stay operational", async ({ page }, testInfo) => { test.skip(testInfo.project.name === "mobile-webkit", "wheel is desktop input"); await page.goto("/"); const canvas = page.locator("canvas"); await canvas.hover({ position: { x: 300, y: 300 } }); await page.mouse.wheel(0, -300); await page.getByRole("button", { name: "Показать весь стол" }).click(); await expect(canvas).toBeVisible(); });

test("creates sheets and notebooks and switches all notebook spreads", async ({ page }) => {
  await page.goto("/"); const main = page.locator("main");
  await page.getByRole("button", { name: "Новый лист" }).click();
  await expect(main).toHaveAttribute("data-selected-entity", /sheet-created-/); await expect(main).toHaveAttribute("data-selected-state", "closed");
  await page.getByRole("button", { name: "Открыть", exact: true }).click(); await expect(main).toHaveAttribute("data-selected-state", "open");
  await page.waitForTimeout(260); await page.getByRole("button", { name: "Закрыть", exact: true }).click(); await expect(main).toHaveAttribute("data-selected-state", "closed");
  await page.getByRole("button", { name: "Новая тетрадь" }).click(); await expect(main).toHaveAttribute("data-selected-entity", /notebook-created-/);
  await page.getByRole("button", { name: "Открыть", exact: true }).click(); await page.waitForTimeout(260);
  await expect(main).toHaveAttribute("data-active-spread", "0"); await page.getByRole("button", { name: "Комната →" }).click(); await expect(main).toHaveAttribute("data-active-spread", "1");
  await page.waitForTimeout(210); await page.getByRole("button", { name: "Комната →" }).click(); await expect(main).toHaveAttribute("data-active-spread", "2");
});

async function drawPath(page, points) {
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.mouse.up();
}

async function worldScreen(page, x, y) {
  const box = await page.getByTestId("world-canvas").boundingBox();
  const zoom = Math.max(.35, Math.min(3, (box.width - 110) / 1400, (box.height - 110) / 900));
  return { x: box.x + (box.width - 1400 * zoom) / 2 + x * zoom, y: box.y + (box.height - 900 * zoom) / 2 + y * zoom };
}

async function dragWorld(page, from, to) { await drawPath(page, [await worldScreen(page, ...from), await worldScreen(page, ...to)]); }

async function touchDragWorld(page, from, to) {
  const a = await worldScreen(page, ...from), b = await worldScreen(page, ...to);
  await page.evaluate(async ({ a, b }) => { const canvas = document.querySelector("[data-testid=world-canvas]"), fire = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 71, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons, pressure: buttons ? .5 : 0 })); fire("pointerdown", a.x, a.y, 1); for (let i = 1; i <= 8; i++) { fire("pointermove", a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, 1); await new Promise((resolve) => setTimeout(resolve, 16)); } fire("pointerup", b.x, b.y, 0); }, { a, b });
}

test("transports a cat in a closed sheet and restores it after opening", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-webkit", "covered by the touch-only transport test"); await page.goto("/"); const main = page.locator("main");
  await page.getByRole("button", { name: "Новый лист" }).click(); await page.getByRole("button", { name: "Открыть", exact: true }).click(); await page.waitForTimeout(260);
  await dragWorld(page, [335, 585], [650, 500]); await expect(main).toHaveAttribute("data-cat-blue-surface", "sheet-created-1-inside");
  await page.mouse.click(...Object.values(await worldScreen(page, 555, 345))); await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(main).not.toHaveAttribute("data-visible-entities", /cat-blue/); await page.waitForTimeout(260);
  await dragWorld(page, [710, 345], [840, 500]); await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(main).toHaveAttribute("data-visible-entities", /cat-blue/);
});

test("nests one sheet in another and moves the hidden tree", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-webkit", "desktop nesting acceptance"); await page.goto("/"); const main = page.locator("main");
  await page.getByRole("button", { name: "Новый лист" }).click(); await page.getByRole("button", { name: "Открыть", exact: true }).click(); await page.waitForTimeout(260);
  await page.getByRole("button", { name: "Новый лист" }).click(); await dragWorld(page, [720, 430], [760, 450]);
  await expect(main).toHaveAttribute("data-created-sheet-surface", "sheet-created-1-inside");
  await page.mouse.click(...Object.values(await worldScreen(page, 555, 345))); await page.getByRole("button", { name: "Закрыть", exact: true }).click(); await expect(main).not.toHaveAttribute("data-visible-entities", /sheet-created-2/);
  await page.waitForTimeout(260); await dragWorld(page, [710, 345], [850, 500]); await expect(main).toHaveAttribute("data-created-sheet-surface", "sheet-created-1-inside");
});

test("keeps furniture in its notebook room while paging", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-webkit", "desktop room acceptance"); await page.goto("/"); const main = page.locator("main");
  await page.getByRole("button", { name: "Новая тетрадь" }).click(); await page.getByRole("button", { name: "Открыть", exact: true }).click(); await page.waitForTimeout(260);
  await dragWorld(page, [700, 235], [650, 390]); await expect(main).toHaveAttribute("data-note-pink-surface", "notebook-created-1-room-1");
  await page.mouse.click(...Object.values(await worldScreen(page, 510, 310))); await page.getByRole("button", { name: "Комната →" }).click(); await expect(main).not.toHaveAttribute("data-visible-entities", /note-pink/);
  await page.waitForTimeout(210); await page.getByRole("button", { name: "← Комната" }).click(); await expect(main).toHaveAttribute("data-visible-entities", /note-pink/);
});

test("mobile-webkit transports a cat using touch pointers only", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-webkit", "touch-only acceptance"); await page.goto("/"); const main = page.locator("main");
  await page.getByRole("button", { name: "Новый лист" }).tap(); await page.getByRole("button", { name: "Открыть", exact: true }).tap(); await page.waitForTimeout(260);
  await touchDragWorld(page, [335, 585], [650, 500]); await expect(main).toHaveAttribute("data-cat-blue-surface", "sheet-created-1-inside");
});

test("double tap, action button and drag never toggle a sheet twice", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-webkit", "desktop gesture conflict acceptance"); await page.goto("/"); const main = page.locator("main");
  await page.getByRole("button", { name: "Новый лист" }).click(); const point = await worldScreen(page, 710, 350);
  await page.mouse.dblclick(point.x, point.y, { delay: 80 }); await expect(main).toHaveAttribute("data-selected-state", "open");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click(); await expect(page.getByRole("status")).toContainText("Дождитесь окончания анимации"); await expect(main).toHaveAttribute("data-selected-state", "open");
  await page.waitForTimeout(260); await dragWorld(page, [560, 350], [760, 480]); await expect(main).toHaveAttribute("data-selected-state", "open");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click(); await expect(main).toHaveAttribute("data-selected-state", "closed");
});

test("creates a cat atomically and draws wearable clothing that attaches", async ({ page }) => {
  await page.goto("/"); const main = page.locator("main");
  await expect(main).toHaveAttribute("data-cat-count", "2");
  await page.getByRole("button", { name: "Новый кот" }).click();
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Отмена" }).click();
  await expect(main).toHaveAttribute("data-cat-count", "2");
  await page.getByRole("button", { name: "Новый кот" }).click();
  const catCanvas = await page.getByTestId("drawing-canvas").boundingBox();
  await drawPath(page, [{ x: catCanvas.x + catCanvas.width / 2, y: catCanvas.y + catCanvas.height * .35 }, { x: catCanvas.x + catCanvas.width / 2, y: catCanvas.y + catCanvas.height * .65 }]);
  await page.getByRole("button", { name: "Создать кота" }).click();
  await expect(main).toHaveAttribute("data-cat-count", "3");
  await page.getByRole("button", { name: "Новый кот" }).click();
  const secondCatCanvas = await page.getByTestId("drawing-canvas").boundingBox();
  await page.locator("[data-color]").fill("#d85f73");
  await drawPath(page, [{ x: secondCatCanvas.x + secondCatCanvas.width * .43, y: secondCatCanvas.y + secondCatCanvas.height * .3 }, { x: secondCatCanvas.x + secondCatCanvas.width * .57, y: secondCatCanvas.y + secondCatCanvas.height * .7 }]);
  await page.getByRole("button", { name: "Создать кота" }).click();
  await expect(main).toHaveAttribute("data-cat-count", "4");

  await page.getByRole("button", { name: "Новая одежда" }).click();
  const canvas = page.getByTestId("drawing-canvas"), box = await canvas.boundingBox();
  const zoom = Math.min((box.width - 80) / 350, (box.height - 150) / 430, 4), ox = box.x + (box.width - 350 * zoom) / 2, oy = box.y + (box.height - 430 * zoom) / 2;
  const screen = (x, y) => ({ x: ox + x * zoom, y: oy + y * zoom });
  await page.locator("[data-size]").fill("32");
  await drawPath(page, [screen(70, 105), screen(175, 82), screen(280, 105)]);
  await page.getByRole("button", { name: "✂ Контур" }).click();
  await drawPath(page, [screen(45, 122), screen(305, 122), screen(260, 72), screen(90, 72), screen(45, 122)]);
  await expect(main).toHaveAttribute("data-wearable-count", "2");
  await expect(canvas).toBeHidden();

  const world = await page.getByTestId("world-canvas").boundingBox();
  const worldZoom = Math.max(.35, Math.min(3, (world.width - 110) / 1400, (world.height - 110) / 900)), worldX = (world.width - 1400 * worldZoom) / 2, worldY = (world.height - 900 * worldZoom) / 2;
  const toScreen = (x, y) => ({ x: world.x + worldX + x * worldZoom, y: world.y + worldY + y * worldZoom });
  await drawPath(page, [toScreen(760, 390), toScreen(339, 516)]);
  await expect(page.getByRole("button", { name: "Снять", exact: true })).toBeVisible();
  await expect(main).toHaveAttribute("data-attachment-cat", "cat-blue");
  expect(Number(await main.getAttribute("data-selected-contour-width"))).toBeGreaterThan(220);
  await page.getByRole("button", { name: "Снять", exact: true }).click();
  await expect(main).toHaveAttribute("data-attachment-cat", "");
  await drawPath(page, [toScreen(384, 527), toScreen(339, 502)]);
  await expect(main).toHaveAttribute("data-attachment-cat", "cat-blue");
  await drawPath(page, [toScreen(339, 502), toScreen(1088, 136)]);
  await expect(main).toHaveAttribute("data-attachment-cat", "cat-orange");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(main).toHaveAttribute("data-attachment-cat", "cat-blue");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(main).toHaveAttribute("data-attachment-cat", "cat-orange");
  await page.mouse.click(toScreen(1080, 250).x, toScreen(1080, 250).y);
  await expect(main).toHaveAttribute("data-selected-entity", "cat-orange");
  await page.getByRole("button", { name: "Повернуть по часовой стрелке" }).click();
  await expect(main).toHaveAttribute("data-orange-attachments", "1");
});
