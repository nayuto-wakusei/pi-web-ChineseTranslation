import { expect, test } from "@playwright/test";

for (const scheme of ["light", "dark"] as const) {
  test(`custom UI ${scheme} keeps menu controls consistent and restores upstream without losing drafts`, async ({ page }, testInfo) => {
    await page.goto("/custom-ui.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate((value) => window.customUiFixture.setScheme(value), scheme);
    const navigation = page.locator("app-navigation-panel");
    await expect(navigation.locator(".codex-navigation")).toBeVisible();
    const actionsButton = navigation.locator(".actions-button");
    await expect(actionsButton.locator(".actions-label")).toHaveText("操作");
    await expect(actionsButton.locator(".actions-label")).toBeVisible();
    await expect(actionsButton.locator(".actions-icon")).toBeHidden();
    await actionsButton.click();
    await expect(page.locator("action-palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("action-palette")).toHaveCount(0);
    await page.locator("prompt-editor .attachment-input").setInputFiles({ name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("Fixture attachment") });
    await expect(page.locator("prompt-editor .attachments")).toContainText("draft.txt");
    const sessions = navigation.locator("session-list");
    await sessions.locator(".action-menu-toggle").first().click();
    const menu = sessions.locator(".action-menu-panel");
    await expect(menu).toBeVisible();
    const styles = await menu.locator("button").evaluateAll((buttons) => buttons.map((button) => {
      const style = getComputedStyle(button);
      return { border: style.borderTopWidth, fontSize: style.fontSize, textAlign: style.textAlign, radius: style.borderRadius };
    }));
    expect(new Set(styles.map((value) => JSON.stringify(value))).size).toBe(1);
    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) throw new Error("Missing menu geometry");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.screenshot({ path: testInfo.outputPath(`custom-ui-${scheme}.png`) });
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.customUiFixture.setEnabled(false));
    await expect(navigation.locator(".codex-navigation")).toHaveCount(0);
    expect(await actionsButton.locator(".actions-icon").evaluate((element) => getComputedStyle(element).display)).not.toBe("none");
    expect(await page.evaluate(() => window.customUiFixture.identity())).toEqual({ editor: true, chat: true, draft: "未发送的草稿" });
    await expect(page.locator("prompt-editor .attachments")).toContainText("draft.txt");
    await sessions.locator(".action-menu-toggle").first().click();
    await expect(menu).toBeVisible();
    const borders = await menu.locator("button").evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).borderTopWidth));
    expect(new Set(borders)).toEqual(new Set(["0px"]));
    await page.screenshot({ path: testInfo.outputPath(`upstream-ui-${scheme}.png`) });
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.customUiFixture.setEnabled(true));
    await expect(navigation.locator(".codex-navigation")).toBeVisible();
    await page.evaluate(() => window.customUiFixture.setView("chat"));
    const editorBox = await page.locator("prompt-editor").boundingBox();
    if (editorBox === null) throw new Error("Missing editor geometry");
    expect(editorBox.x).toBeGreaterThanOrEqual(0);
    expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.screenshot({ path: testInfo.outputPath(`custom-chat-${scheme}.png`) });
    await page.evaluate(() => window.customUiFixture.fail());
    await expect(navigation.locator(".codex-navigation")).toHaveCount(0);
    expect(await page.evaluate(() => window.customUiFixture.identity())).toEqual({ editor: true, chat: true, draft: "未发送的草稿" });
  });
}

test("management presentation keeps ordinary project trust unavailable", async ({ page }) => {
  await page.goto("/custom-ui.html?management");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const projects = page.locator("project-list");
  await projects.getByRole("button", { name: "示例项目 的操作", exact: true }).click();
  await expect(projects.locator("folder-project-trust")).toHaveCount(0);
  await expect(page.locator(".codex-commands").getByRole("button", { name: "添加项目", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.customUiFixture.openSettings());
  const settings = page.locator("settings-dialog");
  await expect(settings.locator(".codex-settings-navigation")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
});

test("plugin composes a real tree and full-page settings while retaining attachment controls", async ({ page }, testInfo) => {
  await page.goto("/custom-ui.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const projects = page.locator("project-list");
  await expect(projects.locator(".tree-children session-list")).toBeVisible();
  const disclosure = projects.locator(".tree-disclosure");
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("session-list")).toHaveCount(0);
  await disclosure.click();
  await expect(projects.locator(".tree-children session-list")).toBeVisible();
  await page.locator(".codex-footer").getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.locator("settings-dialog");
  await expect(settings.locator(".settings-back-label")).toBeVisible();
  const viewport = page.viewportSize();
  const surface = await settings.locator(".surface").boundingBox();
  if (viewport === null || surface === null) throw new Error("Missing settings viewport");
  expect(surface.x).toBeCloseTo(0, 0);
  expect(surface.y).toBeCloseTo(0, 0);
  expect(surface.width).toBeCloseTo(viewport.width, 0);
  expect(surface.height).toBeCloseTo(viewport.height, 0);
  await page.screenshot({ path: testInfo.outputPath("codex-settings-general.png") });
  await settings.getByRole("button", { name: "键盘", exact: false }).click();
  await expect(settings.locator("settings-shortcuts-panel")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("codex-settings.png") });
  await settings.locator(".close-button").click();
  await expect(settings).toHaveCount(0);
  await page.evaluate(() => window.customUiFixture.setView("chat"));
  const editor = page.locator("prompt-editor");
  await editor.locator(".attachment-input").setInputFiles({ name: "retained.txt", mimeType: "text/plain", buffer: Buffer.from("retained upload") });
  await editor.getByRole("button", { name: "移除 retained.txt", exact: true }).click();
  await expect(editor.locator(".attachment-chip")).toHaveCount(0);
  const attach = await editor.locator(".editor-attach").boundingBox();
  const send = await editor.locator(".send-button").boundingBox();
  if (attach === null || send === null) throw new Error("Missing composer controls");
  expect(attach.x).toBeLessThan(send.x);
  expect(Math.abs(attach.y - send.y)).toBeLessThanOrEqual(4);
  const editorBox = await editor.boundingBox();
  if (editorBox === null) throw new Error("Missing editor");
  expect(editorBox.width).toBeLessThanOrEqual(760);
  expect(editorBox.x).toBeGreaterThanOrEqual(0);
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(viewport.width + 1);
  await page.screenshot({ path: testInfo.outputPath("codex-conversation.png") });
  await page.evaluate(() => window.customUiFixture.setEnabled(false));
  await page.evaluate(() => window.customUiFixture.openSettings());
  await expect(page.locator("settings-dialog .settings-back-label")).toBeHidden();
});

test("tree retains workspace menus and nests sessions only under the selected workspace", async ({ page }) => {
  await page.goto("/custom-ui.html?worktrees");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const workspaces = page.locator("project-list .tree-children workspace-list");
  await expect(workspaces).toBeVisible();
  await expect(workspaces.locator(".workspace-branch")).toHaveCount(2);
  const selected = workspaces.locator(".workspace-branch").first();
  await expect(selected.locator(".tree-children session-list")).toBeVisible();
  await expect(workspaces.locator(".workspace-branch").nth(1).locator("session-list")).toHaveCount(0);
  await selected.locator(".workspace-row > .action-menu > .action-menu-toggle").click();
  await expect(workspaces.locator(".workspace-menu-trust input[type=checkbox]")).toBeVisible();
  await page.keyboard.press("Escape");
  await selected.locator(".tree-disclosure").click();
  await expect(page.locator("session-list")).toHaveCount(0);
  await selected.locator(".tree-disclosure").click();
  await expect(selected.locator("session-list")).toBeVisible();
});

test("tree keeps large session lists batched until their outer scroll reaches the loader", async ({ page }) => {
  await page.goto("/custom-ui.html?large");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const rows = page.locator("session-list .action-row");
  await expect(rows).toHaveCount(50);
  // Let observer deliveries settle; an unbounded inner observer used to drain every batch.
  await page.evaluate(async () => {
    for (let frame = 0; frame < 12; frame++) await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
  });
  expect(await rows.count()).toBe(50);
  await page.locator(".codex-project-tree").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => rows.count()).toBeGreaterThan(50);
  await page.evaluate(async () => {
    for (let frame = 0; frame < 12; frame++) await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
  });
  expect(await rows.count()).toBeLessThan(1000);
});

test("switching the plugin closes a project popup and its replacement opens on the first click", async ({ page }) => {
  await page.goto("/custom-ui.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const projectActions = page.locator("project-list").getByRole("button", { name: "示例项目 的操作", exact: true });
  await projectActions.click();
  await expect(page.locator("project-list .action-menu-panel")).toBeVisible();
  await page.evaluate(() => window.customUiFixture.setEnabled(false));
  await expect(page.locator("project-list .action-menu-panel")).toHaveCount(0);
  await page.evaluate(() => window.customUiFixture.focusSection("projects"));
  await projectActions.click();
  await expect(page.locator("project-list .action-menu-panel")).toBeVisible();
  await page.evaluate(() => window.customUiFixture.setEnabled(true));
  await expect(page.locator("project-list .action-menu-panel")).toHaveCount(0);
  await projectActions.click();
  await expect(page.locator("project-list .action-menu-panel")).toBeVisible();
});

for (const worktrees of [false, true]) {
  test(`tree reveals folded ancestors using real navigation state (worktrees=${String(worktrees)})`, async ({ page }) => {
    await page.goto(`/custom-ui.html${worktrees ? "?worktrees" : ""}`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await expect(page.locator("session-list .action-row")).toHaveCount(3);
    const projects = page.locator("project-list");
    const workspaces = page.locator("workspace-list");
    if (worktrees) {
      await workspaces.locator(".tree-disclosure").first().click();
      await expect(page.locator("session-list")).toHaveCount(0);
      expect(await page.evaluate(() => window.customUiFixture.focusSection("sessions"))).toBe(true);
      await expect(page.locator("session-list .action-row")).toHaveCount(3);
    }
    await projects.getByRole("button", { name: "示例项目", exact: true }).click();
    await expect(page.locator("session-list")).toHaveCount(0);
    expect(await page.evaluate(() => window.customUiFixture.focusSection("sessions"))).toBe(true);
    await expect(page.locator("session-list .action-row")).toHaveCount(3);
    const selectedFocused = await page.locator("session-list").evaluate((element) => element.shadowRoot?.activeElement?.classList.contains("action-row"));
    expect(selectedFocused).toBe(true);
  });
}

test("left-side attachment sources remain readable and usable on touch screens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, "Attachment source chooser requires touch input");
  await page.goto("/custom-ui.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => window.customUiFixture.setView("chat"));
  const editor = page.locator("prompt-editor");
  await editor.getByRole("button", { name: "附加文件", exact: true }).click();
  const panel = editor.locator(".attach-source-panel");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error("Missing attachment menu");
  expect(box.width).toBeGreaterThanOrEqual(210);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  const labelsFit = await panel.locator(".attach-source-label").evaluateAll((labels) => labels.every((label) => label.scrollWidth <= label.clientWidth + 1));
  expect(labelsFit).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("codex-mobile-attachment-sources.png") });
  const chooser = page.waitForEvent("filechooser");
  await panel.getByRole("button", { name: "文件", exact: true }).click();
  await (await chooser).setFiles({ name: "mobile.txt", mimeType: "text/plain", buffer: Buffer.from("mobile attachment") });
  await expect(editor.locator(".attachments")).toContainText("mobile.txt");
  await expect(panel).not.toBeVisible();
});

test("legacy theme selections stay available and only normalize on explicit save", async ({ page }) => {
  await page.goto("/custom-ui.html?legacy-theme=graphite");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => window.customUiFixture.openSettings());
  const panel = page.locator("settings-theme-panel");
  await expect(panel.locator("select")).toHaveValue("pi-web.custom-ui-codex:graphite");
  await expect(panel.locator("#theme-unavailable-help")).toHaveCount(0);
  expect(await page.evaluate(() => window.customUiFixture.savedTheme())).toBeUndefined();
  await panel.locator("input[type=checkbox]").uncheck();
  await panel.getByRole("button", { name: "在此浏览器使用", exact: true }).click();
  expect(await page.evaluate(() => window.customUiFixture.savedTheme())).toEqual({ themeId: "pi-web.custom-ui-codex:graphite", auto: false });
});
