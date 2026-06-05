import { describe, expect, it } from "vitest";
import { parseTasksConfigText } from "./config";

describe("workspace tasks config", () => {
  it("parses a minimal version 1 config", () => {
    expect(parseTasksConfigText(JSON.stringify({
      version: 1,
      tasks: [
        { id: "db.reset", title: "Reset DB", command: "go -C klingit-go run ./cli db reset" },
      ],
    }))).toEqual({
      ok: true,
      config: {
        version: 1,
        tasks: [
          { id: "db.reset", title: "Reset DB", command: "go -C klingit-go run ./cli db reset", confirm: false },
        ],
      },
    });
  });

  it("parses optional group, description, and confirm fields", () => {
    expect(parseTasksConfigText(JSON.stringify({
      version: 1,
      tasks: [
        {
          id: "docker.start",
          title: "Start Docker",
          description: "Start the dev stack.",
          group: "Docker",
          command: "./docker/scripts/docker-compose-dev up -d",
          confirm: true,
        },
      ],
    }))).toEqual({
      ok: true,
      config: {
        version: 1,
        tasks: [
          {
            id: "docker.start",
            title: "Start Docker",
            description: "Start the dev stack.",
            group: "Docker",
            command: "./docker/scripts/docker-compose-dev up -d",
            confirm: true,
          },
        ],
      },
    });
  });

  it("accepts an empty tasks array", () => {
    expect(parseTasksConfigText(JSON.stringify({ version: 1, tasks: [] }))).toEqual({
      ok: true,
      config: { version: 1, tasks: [] },
    });
  });

  it("rejects invalid JSON and unsupported versions", () => {
    expect(parseTasksConfigText("{")).toMatchObject({ ok: false });
    expect(parseTasksConfigText(JSON.stringify({ version: 2, tasks: [] }))).toEqual({
      ok: false,
      error: "配置 version 必须是 1",
    });
  });

  it("rejects missing, empty, or duplicate required fields", () => {
    expect(parseTasksConfigText(JSON.stringify({ version: 1 }))).toEqual({
      ok: false,
      error: "配置 tasks 必须是数组",
    });
    expect(parseTasksConfigText(JSON.stringify({ version: 1, tasks: [{ id: "", title: "T", command: "cmd" }] }))).toEqual({
      ok: false,
      error: "任务 1 id 必须是非空字符串",
    });
    expect(parseTasksConfigText(JSON.stringify({
      version: 1,
      tasks: [
        { id: "one", title: "One", command: "cmd" },
        { id: "one", title: "Again", command: "cmd" },
      ],
    }))).toEqual({
      ok: false,
      error: "任务 id 重复: one",
    });
  });

  it("rejects invalid optional field types", () => {
    expect(parseTasksConfigText(JSON.stringify({ version: 1, tasks: [{ id: "one", title: "One", command: "cmd", confirm: "yes" }] }))).toEqual({
      ok: false,
      error: "任务 1 confirm 必须是布尔值",
    });
    expect(parseTasksConfigText(JSON.stringify({ version: 1, tasks: [{ id: "one", title: "One", command: "cmd", group: "" }] }))).toEqual({
      ok: false,
      error: "任务 1 group 提供时必须是非空字符串",
    });
  });
});
