import { expect, it } from "vitest";
import { appendShellChunk, finalizeShellMessage, shellStartMessage } from "./shellMessages";
import type { ChatLine } from "./chatTypes";

function part(lines: ChatLine[]) {
  const value = lines.at(-1)?.parts.at(-1);
  if (value?.type !== "text") throw new Error("Expected shell text");
  return value;
}

it("keeps live shell provenance separate from unchanged commands, chunks and English completion text", () => {
  const command = "printf '$ \\n\\n<raw>'";
  const start = [shellStartMessage(command, true)];
  const first = appendShellChunk(start, "output truncated\n\n$ ");
  const streamed = appendShellChunk(first, "<img src=x> العربية");
  const output = "output truncated\n\n$ <img src=x> العربية";
  expect(part(start)).toMatchObject({ text: `excluded from context\n\n$ ${command}`, presentation: { kind: "liveShell", command, excluded: true } });
  expect(part(start).presentation).not.toHaveProperty("output");
  expect(part(streamed)).toMatchObject({ text: `excluded from context\n\n$ ${command}\n\n${output}`, presentation: { output } });
  expect(part(first).presentation).toHaveProperty("output", "output truncated\n\n$ ");
  const completed = finalizeShellMessage(streamed, { type: "shell.end", exitCode: 1234, cancelled: true, truncated: true, fullOutputPath: "/raw/<path>" });
  expect(part(completed)).toMatchObject({
    text: `excluded from context\n\n$ ${command}\n\n${output}\n\nexit 1234\ncancelled\noutput truncated\nfull output: /raw/<path>`,
    presentation: { kind: "liveShell", command, excluded: true, output,
      completion: { noOutput: false, failed: false, exitCode: "1234", cancelled: true, truncated: true, fullOutputPath: "/raw/<path>" } },
  });
  expect(part(streamed).presentation).not.toHaveProperty("completion");
});

it("retains empty-output and error facts without treating diagnostic text as generated prose", () => {
  const start = [shellStartMessage("true")];
  expect(part(finalizeShellMessage(start, { type: "shell.end", exitCode: 0 }))).toMatchObject({
    text: "$ true\n\n(no output)\nexit 0",
    presentation: { completion: { noOutput: true, failed: false, exitCode: "0" } },
  });
  expect(part(finalizeShellMessage(start, { type: "shell.end", isError: true }))).toMatchObject({
    text: "$ true\n\n(no output)\nBash command failed",
    presentation: { completion: { noOutput: true, failed: true } },
  });
  expect(part(finalizeShellMessage(start, { type: "shell.end", isError: true, output: "Bash command failed" }))).toMatchObject({
    presentation: { completion: { noOutput: false, failed: true, failureOutput: "Bash command failed" } },
  });
  const emptyChunk = appendShellChunk(start, "");
  expect(part(finalizeShellMessage(emptyChunk, { type: "shell.end", exitCode: null }))).toMatchObject({
    presentation: { output: "", completion: { noOutput: false } },
  });
});

it("does not invent provenance for orphan output or legacy shell lines", () => {
  const orphan = appendShellChunk([], "cancelled");
  expect(part(orphan)).toEqual({ type: "text", text: "cancelled" });
  expect(part(finalizeShellMessage(orphan, { type: "shell.end", exitCode: 1 })).presentation).toBeUndefined();
  const interrupted: ChatLine[] = [shellStartMessage("ls"), { role: "user", parts: [{ type: "text", text: "raw" }] }];
  expect(finalizeShellMessage(interrupted, { type: "shell.end", exitCode: 1 })).toBe(interrupted);
});
