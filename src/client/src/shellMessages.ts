
import { textMessage } from "./chatMessages";
import type { LiveShellPresentation } from "./chatPresentation";
import type { ChatLine } from "./chatTypes";
import type { SessionUiEvent } from "./sessionSocket";

export function shellStartMessage(command: string, excludeFromContext?: boolean): ChatLine {
  return { role: "bash", parts: [{ type: "text", text: `${excludeFromContext === true ? "excluded from context\n\n" : ""}$ ${command}`,
    presentation: { kind: "liveShell", command, excluded: excludeFromContext === true },
  }] };
}

export function appendShellChunk(messages: ChatLine[], chunk: string): ChatLine[] {
  const last = messages.at(-1);
  const lastPart = last?.parts.at(-1);
  if (last?.role !== "bash" || lastPart?.type !== "text") return [...messages, textMessage("bash", chunk)];
  const hasOutput = lastPart.presentation?.kind === "liveShell" ? lastPart.presentation.output !== undefined : hasShellOutput(lastPart.text);
  const separator = hasOutput ? "" : "\n\n";
  const presentation = lastPart.presentation?.kind === "liveShell"
    ? { presentation: { ...lastPart.presentation, output: (lastPart.presentation.output ?? "") + chunk } } : {};
  return [...messages.slice(0, -1), { ...last, parts: [...last.parts.slice(0, -1), { ...lastPart, ...presentation, text: lastPart.text + separator + chunk }] }];
}

export function finalizeShellMessage(messages: ChatLine[], event: Extract<SessionUiEvent, { type: "shell.end" }>): ChatLine[] {
  const last = messages.at(-1);
  const lastPart = last?.parts.at(-1);
  if (last?.role !== "bash" || lastPart?.type !== "text") return messages;
  const notes: string[] = [];
  const noOutput = lastPart.presentation?.kind === "liveShell" ? lastPart.presentation.output === undefined : !lastPart.text.includes("\n\n");
  if (noOutput && (event.output === undefined || event.output === "")) notes.push("(no output)");
  if (event.isError === true) notes.push(event.output ?? "Bash command failed");
  if (event.exitCode != null) notes.push(`exit ${String(event.exitCode)}`);
  if (event.cancelled === true) notes.push("cancelled");
  if (event.truncated === true) notes.push("output truncated");
  if (event.fullOutputPath !== undefined && event.fullOutputPath !== "") notes.push(`full output: ${event.fullOutputPath}`);
  const presentation = lastPart.presentation?.kind === "liveShell" ? { presentation: {
    ...lastPart.presentation,
    completion: shellCompletion(lastPart.presentation, event),
  } } : {};
  if (notes.length === 0 && lastPart.presentation?.kind !== "liveShell") return messages;
  const text = notes.length === 0 ? lastPart.text : `${lastPart.text}\n\n${notes.join("\n")}`;
  return [...messages.slice(0, -1), { ...last, parts: [...last.parts.slice(0, -1), { ...lastPart, ...presentation, text }] }];
}

function shellCompletion(presentation: LiveShellPresentation, event: Extract<SessionUiEvent, { type: "shell.end" }>): NonNullable<LiveShellPresentation["completion"]> {
  return {
    noOutput: presentation.output === undefined && (event.output === undefined || event.output === ""),
    failed: event.isError === true,
    cancelled: event.cancelled === true,
    truncated: event.truncated === true,
    ...(event.isError === true && event.output !== undefined ? { failureOutput: event.output } : {}),
    ...(event.exitCode == null ? {} : { exitCode: String(event.exitCode) }),
    ...(event.fullOutputPath === undefined || event.fullOutputPath === "" ? {} : { fullOutputPath: event.fullOutputPath }),
  };
}

function hasShellOutput(text: string): boolean {
  const outputStart = text.lastIndexOf("\n\n");
  const promptStart = text.lastIndexOf("$ ");
  return outputStart > promptStart;
}
