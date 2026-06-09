import { describe, expect, it } from "vitest";
import { cleanSessionName, fallbackSessionName } from "./sessionNameGenerator.js";

describe("sessionNameGenerator", () => {
  it("cleans model-generated titles", () => {
    expect(cleanSessionName('Title: "Fix Session Naming."\nextra')).toBe("Fix Session Naming");
  });

  it("builds a concise fallback from the first request", () => {
    expect(fallbackSessionName("Seems like auto name for sessions is not working, I still get the first message as a name."))
      .toBe("Seems like auto name for sessions");
  });

  it("ignores skill blocks in fallback names", () => {
    expect(fallbackSessionName('<skill name="x" location="/x">\nDo x\n</skill>\n\nCheck the UI now'))
      .toBe("Check the UI now");
  });

  it("skips fallback names when the first request is missing", () => {
    expect(fallbackSessionName(undefined)).toBeUndefined();
  });
});
