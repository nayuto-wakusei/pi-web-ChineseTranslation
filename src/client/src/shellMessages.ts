import { t } from "./i18n";
import { textMessage } from "./chatMessages";
import type { ChatLine } from "./components/shared";
import type { SessionUiEvent } from "./sessionSocket";

export function shellStartMessage(command: string, excludeFromContext?: boolean): ChatLine {
  return textMessage("bash", `${excludeFromContext === true ? t("client.shellMessages.excluded.from.context.c75116", "Excluded from context\n\n") : ""}$ ${command}`);
}

export function appendShellChunk(messages: ChatLine[], chunk: string): ChatLine[] {
  const last = messages.at(-1);
  const lastPart = last?.parts.at(-1);
  if (last?.role !== "bash" || lastPart?.type !== "text") return [...messages, textMessage("bash", chunk)];
  const separator = hasShellOutput(lastPart.text) ? "" : "\n\n";
  return [...messages.slice(0, -1), { ...last, parts: [...last.parts.slice(0, -1), { ...lastPart, text: lastPart.text + separator + chunk }] }];
}

export function finalizeShellMessage(messages: ChatLine[], event: Extract<SessionUiEvent, { type: "shell.end" }>): ChatLine[] {
  const last = messages.at(-1);
  const lastPart = last?.parts.at(-1);
  if (last?.role !== "bash" || lastPart?.type !== "text") return messages;
  const notes: string[] = [];
  if (!lastPart.text.includes("\n\n") && (event.output === undefined || event.output === "")) notes.push(t("client.shellMessages.no.output.8ae64c", "(no output)"));
  if (event.isError === true) notes.push(event.output ?? t("client.shellMessages.bash.command.failed.afe8d1", "Bash command failed"));
  if (event.exitCode != null) notes.push(t("client.shellMessages.exit.code.2beadf", "Exit code {value1}", { value1: String(event.exitCode) }));
  if (event.cancelled === true) notes.push(t("client.shellMessages.cancelled.a37778", "Cancelled"));
  if (event.truncated === true) notes.push(t("client.shellMessages.output.truncated.07e9bf", "Output truncated"));
  if (event.fullOutputPath !== undefined && event.fullOutputPath !== "") notes.push(t("client.shellMessages.full.output.89763a", "Full output: {value1}", { value1: event.fullOutputPath }));
  if (notes.length === 0) return messages;
  return [...messages.slice(0, -1), { ...last, parts: [...last.parts.slice(0, -1), { ...lastPart, text: `${lastPart.text}\n\n${notes.join("\n")}` }] }];
}

function hasShellOutput(text: string): boolean {
  const outputStart = text.lastIndexOf("\n\n");
  const promptStart = text.lastIndexOf("$ ");
  return outputStart > promptStart;
}
