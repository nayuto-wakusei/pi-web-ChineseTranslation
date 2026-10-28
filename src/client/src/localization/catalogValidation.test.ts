import { expect, it } from "vitest";
import type { MessageDefinitions } from "../../../shared/localization.js";
import { validateMessages } from "./catalog.js";

// Source-only modules have no registration/browser effects. New core and bundled-plugin
// catalogs join CI validation automatically by using the *.messages.ts convention.
const sources = import.meta.glob<{ default: MessageDefinitions }>([
  "../**/*.messages.ts",
  "../../../../pi-web-plugins/**/*.messages.ts",
  "../../../../pi-packages/**/*.messages.ts",
  "../../../../examples/**/*.messages.ts",
], { eager: true });

it("all repository English source catalogs have valid ICU and translator descriptions", () => {
  const errors = Object.entries(sources).flatMap(([path, module]) =>
    validateMessages(module.default).map((error) => `${path}: ${error}`));
  expect(errors).toEqual([]);
});
