import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("real flight, pause, camera intervention, recording export and replay", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("READY TO FLY", { exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Record flight", exact: true })
    .click();
  await page.getByRole("button", { name: "Launch flight" }).click();
  await expect(page.getByText("IN FLIGHT", { exact: true })).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        (await page.locator(".camera-time").innerText()).match(/[\d.]+/)?.[0],
      ),
    )
    .toBeGreaterThan(1.5);
  await page.getByRole("button", { name: "Pause flight" }).click();
  const t = await page.locator(".camera-time").innerText();
  await page.waitForTimeout(250);
  expect(await page.locator(".camera-time").innerText()).toBe(t);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export recording" }).click();
  const file = await downloaded;
  const path = info.outputPath("flight.json");
  await file.saveAs(path);
  const data = JSON.parse(await readFile(path, "utf8"));
  expect(data.version).toBe("drone-fly-recording-v1");
  expect(data.frames.length).toBeGreaterThan(10);
  expect(data.frames.at(-1).position[0]).toBeGreaterThan(0.5);
  expect(
    data.frames.at(-1).activity.some((v: number) => Math.abs(v) > 0.01),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Camera blackout", exact: true })
    .click();
  await expect(page.getByText("NOT VISIBLE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Intact", exact: true }).click();
  await expect(page.getByText("ACQUIRED", { exact: true })).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(path);
  await expect(page.getByText("REPLAY", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play replay", exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("slider", { name: "Replay timeline" })
          .inputValue(),
      ),
    )
    .toBeGreaterThan(3);
  await page.getByRole("button", { name: "Back to live", exact: true }).click();
  await page.getByRole("button", { name: "Reset course", exact: true }).click();
  await expect(page.locator(".camera-time")).toContainText("0.00");
  await page.screenshot({
    path: info.outputPath("desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("experiment table, cancellable training and methods", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Experiments02" }).click();
  await expect(
    page.getByRole("heading", { name: "Does the wiring matter?" }),
  ).toBeVisible();
  await expect(page.locator(".results tbody tr")).toHaveCount(8);
  await page
    .getByRole("button", { name: "Train readouts", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel experiment", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel experiment", exact: true })
    .click();
  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "How it works03" }).click();
  await expect(
    page.getByRole("heading", {
      name: "A real circuit. An engineered experiment.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Fly Dino by Mert Cobanov" }),
  ).toBeVisible();
});

test("mobile layout has no horizontal overflow and live controls work", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("READY TO FLY", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("NAVIGATION CONTROLLER").selectOption("servo");
  await expect(page.getByLabel("NAVIGATION CONTROLLER")).toHaveValue("servo");
  await page.getByRole("button", { name: "Launch flight" }).click();
  await expect(page.getByText("IN FLIGHT", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause flight" }).click();
  await page.screenshot({
    path: info.outputPath("mobile.png"),
    fullPage: true,
  });
});
