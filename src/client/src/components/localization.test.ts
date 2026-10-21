// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import componentMessages from "../../../../pi-web-plugins/zh-cn/components.json";
import clientMessages from "../../../../pi-web-plugins/zh-cn/client.json";
import { setClientTranslations } from "../i18n";
import { AskUserCard } from "./AskUserCard";
import { chatActivityText, chatMessageMetadataLabel, chatMessageRoleLabel } from "./ChatView";
import { NormalAuthDialog } from "./NormalAuthDialog";
import { PromptEditor } from "./PromptEditor";
import { ToolExecutionView } from "./ToolExecutionView";

const dictionary = { ...componentMessages, ...clientMessages };

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  setClientTranslations("zh-CN", dictionary);
});

describe("component localization", () => {
  it.each(["en", "zh-CN"])("keeps remote activity copy unchanged in %s", (locale) => {
    setClientTranslations(locale, locale === "en" ? {} : dictionary);
    for (const label of ["Idle", "Running tool", "远端提示 <tag> {count}"]) {
      expect(chatActivityText("idle", { sessionId: "s", phase: "idle", label, at: "now" })).toBe(label);
    }
  });
  it.each(["en", "zh-CN"])("preserves tool names, paths, results and status values in %s", async (locale) => {
    setClientTranslations(locale, locale === "en" ? {} : dictionary);
    const execution = {
      type: "toolExecution" as const,
      toolName: "用户工具 <read>",
      summary: "User input {count}",
      args: { path: "用户文件/{count}.txt" },
      status: "success" as const,
      resultText: "Warning 未找到会话 <script>original</script>",
    };
    const before = structuredClone(execution);
    const view = new ToolExecutionView();
    view.execution = execution;
    document.body.append(view);
    await view.updateComplete;

    expect(view.shadowRoot?.querySelector("strong")?.textContent).toBe(execution.toolName);
    expect(view.shadowRoot?.querySelector(".path")?.textContent).toBe(execution.args.path);
    expect(view.shadowRoot?.textContent).toContain(execution.resultText);
    expect(view.shadowRoot?.querySelector("script")).toBeNull();
    expect(view.shadowRoot?.querySelector(".status-label")?.textContent).toBe(locale === "en" ? "Done" : "完成");
    expect(execution).toEqual(before);
  });

  it.each(["en", "zh-CN"])("formats dates with UI language %s, not the browser language", (locale) => {
    setClientTranslations(locale, locale === "en" ? {} : dictionary);
    const timestamp = "2026-10-20T12:00:00.000Z";
    const message = { role: "assistant" as const, parts: [], meta: { timestamp } };
    const expected = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(timestamp));
    expect(chatMessageMetadataLabel(message)).toBe(expected);
    if (locale === "en") expect(expected).not.toMatch(/\p{Script=Han}/u);
    expect(message.meta.timestamp).toBe(timestamp);
  });

  it.each([
    ["en", "Thinking level: High"],
    ["zh-CN", "思考级别：高"],
  ])("localizes thinking control labels in %s without changing status values", async (locale, label) => {
    setClientTranslations(locale, locale === "en" ? {} : dictionary);
    const editor = new PromptEditor();
    editor.status = {
      sessionId: "session-original",
      thinkingLevel: "high",
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      queuedMessages: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    };
    document.body.append(editor);
    await editor.updateComplete;

    const control = editor.shadowRoot?.querySelector(".select-thinking");
    expect(control?.getAttribute("title")).toBe(label);
    expect(control?.getAttribute("aria-label")).toBe(label);
    expect(editor.status.thinkingLevel).toBe("high");
  });

  it.each([
    ["en", "Enter password", "Password", "Assistant"],
    ["zh-CN", "输入密码", "密码", "助手"],
  ])("renders accessible labels in %s without translating remote errors", async (locale, heading, password, role) => {
    setClientTranslations(locale, locale === "en" ? {} : dictionary);
    const dialog = new NormalAuthDialog();
    dialog.error = "远端原始错误 <script>alert(1)</script>";
    document.body.append(dialog);
    await dialog.updateComplete;

    expect(dialog.shadowRoot?.querySelector("modal-surface")?.shadowRoot?.querySelector("[role=dialog]")?.getAttribute("aria-label")).toBe(heading);
    expect(dialog.shadowRoot?.textContent).toContain(password);
    expect(dialog.shadowRoot?.textContent).toContain(dialog.error);
    expect(dialog.shadowRoot?.querySelector("script")).toBeNull();
    expect(chatMessageRoleLabel("assistant")).toBe(role);
  });

  it.each([
    ["en", "Answered 0/1", "Questions"],
    ["zh-CN", "已回答 0/1", "问题"],
  ])("localizes complete progress messages in %s while preserving model content", async (locale, progress, heading) => {
    setClientTranslations(locale, locale === "en" ? {} : dictionary);
    const card = new AskUserCard();
    card.ask = {
      askId: "locale-test",
      askedAt: "2026-10-20T00:00:00.000Z",
      questions: [{ id: "choice", question: "模型原文 <b>keep</b>", options: [{ value: "unchanged", label: "用户选项" }] }],
    };
    document.body.append(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector("h2")?.textContent).toBe(heading);
    expect(card.shadowRoot?.querySelector("[aria-live]")?.textContent).toContain(progress);
    expect(card.shadowRoot?.textContent).toContain("模型原文 <b>keep</b>");
    expect(card.shadowRoot?.querySelector("b")).toBeNull();
    expect(card.shadowRoot?.querySelector("input")?.value).toBe("unchanged");
  });
});
