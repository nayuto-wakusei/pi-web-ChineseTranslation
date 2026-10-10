import { expectTypeOf, it } from "vitest";
import type { TemplateResult } from "lit";
import type { ContentRendererContribution, PluginPeer, PluginRuntimeContext } from "./plugin-api";

it("requires a request or channel peer and exposes the upstream runtime contract", () => {
  expectTypeOf<object>().not.toExtend<PluginPeer>();
  expectTypeOf<{ request: NonNullable<PluginPeer["request"]> }>().toExtend<PluginPeer>();
  expectTypeOf<{ openChannel: NonNullable<PluginPeer["openChannel"]> }>().toExtend<PluginPeer>();
  expectTypeOf<PluginRuntimeContext["refreshWorkspacePanels"]>().not.toExtend<undefined>();
  expectTypeOf<Parameters<PluginRuntimeContext["selectMainView"]>[0]>().toEqualTypeOf<"navigation" | "chat" | "workspace">();
  expectTypeOf<ReturnType<ContentRendererContribution["render"]>>().toEqualTypeOf<TemplateResult>();
});
