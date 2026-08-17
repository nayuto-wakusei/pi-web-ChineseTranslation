import { readFile, writeFile } from "node:fs/promises";
import { isRecord } from "./sessionFileFormat.js";

/** Rewrite a header in place while preserving its byte length. */
export async function rewriteHeaderWithoutParentSession(path: string): Promise<void> {
  const content = await readFile(path, "utf8");
  const newlineIndex = content.indexOf("\n");
  const original = content.slice(0, newlineIndex);
  const parsed: unknown = JSON.parse(original);
  if (!isRecord(parsed)) throw new Error("Invalid session file header");
  delete parsed["parentSession"];
  const padKeyOverhead = JSON.stringify({ ...parsed, pad: "" }).length - JSON.stringify(parsed).length;
  const padLength = original.length - JSON.stringify(parsed).length - padKeyOverhead;
  if (padLength < 0) throw new Error("Header cannot be padded back to its original length");
  const rewritten = JSON.stringify({ ...parsed, pad: "x".repeat(padLength) });
  if (rewritten.length !== original.length) throw new Error("Padded header length does not match the original");
  await writeFile(path, `${rewritten}${content.slice(newlineIndex)}`, "utf8");
}
