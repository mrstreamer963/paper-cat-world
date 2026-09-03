import { test, expect } from "@playwright/test";

test("production bundle starts standalone and contains no debug instrumentation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) =>
    errors.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByText("Бумажный мир")).toBeVisible();
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.getByTestId("debug-stats")).toHaveCount(0);
  await expect(page.locator("main")).not.toHaveAttribute(
    "data-cat-blue-surface",
    /.+/,
  );
});
