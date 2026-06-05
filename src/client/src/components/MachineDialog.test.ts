import { describe, expect, it } from "vitest";
import { machineBaseUrlValidationMessage, suggestedMachineNameFromUrl } from "./MachineDialog";

describe("suggestedMachineNameFromUrl", () => {
  it("suggests the host without protocol or port", () => {
    expect(suggestedMachineNameFromUrl("http://127.0.0.1:8504")).toBe("127.0.0.1");
    expect(suggestedMachineNameFromUrl("https://devbox.example.test:8504/pi-web")).toBe("devbox.example.test");
  });

  it("also suggests a host while the URL protocol is being typed", () => {
    expect(suggestedMachineNameFromUrl("devbox.local:8504")).toBe("devbox.local");
  });
});

describe("machineBaseUrlValidationMessage", () => {
  it("accepts http and https base URLs", () => {
    expect(machineBaseUrlValidationMessage("http://127.0.0.1:8504")).toBeUndefined();
    expect(machineBaseUrlValidationMessage("https://devbox.example.test/pi-web")).toBeUndefined();
  });

  it("explains invalid machine URLs", () => {
    expect(machineBaseUrlValidationMessage("")).toBe("必须填写远程 PI WEB URL。");
    expect(machineBaseUrlValidationMessage("devbox.local:8504")).toBe("请使用 http:// 或 https:// URL。");
    expect(machineBaseUrlValidationMessage("ftp://devbox.example.test")).toBe("请使用 http:// 或 https:// URL。");
    expect(machineBaseUrlValidationMessage("https://user@devbox.example.test")).toBe("机器 URL 中不要包含凭据。");
    expect(machineBaseUrlValidationMessage("https://devbox.example.test?q=1")).toBe("不要包含查询字符串或片段。");
  });
});
