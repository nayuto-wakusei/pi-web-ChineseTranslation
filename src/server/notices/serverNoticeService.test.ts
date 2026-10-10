import { describe, expect, it } from "vitest";
import type { GlobalSessionEvent } from "../../shared/apiTypes.js";
import { ServerNoticeStore } from "./serverNoticeStore.js";
import { ServerNoticeService } from "./serverNoticeService.js";
import { SERVER_PLUGIN_NOTICE_PER_SOURCE_LIMIT } from "../../shared/serverNoticeContract.js";

describe("ServerNoticeService", () => {
  it("publishes one atomic snapshot containing retention evictions for each occurrence", () => {
    const events: GlobalSessionEvent[] = [];
    let nextId = 0;
    const service = new ServerNoticeService(
      new ServerNoticeStore({ daemonInstanceId: "daemon-a", createNoticeId: () => String(++nextId) }),
      { publishGlobal: (event) => { events.push(event); } },
    );
    for (let index = 0; index <= SERVER_PLUGIN_NOTICE_PER_SOURCE_LIMIT; index += 1) {
      service.record({ severity: "info", message: String(index), source: "plugin:alpha" });
    }
    expect(events).toHaveLength(SERVER_PLUGIN_NOTICE_PER_SOURCE_LIMIT + 1);
    const last = events.at(-1);
    if (last?.type !== "notices.updated") throw new Error("Expected notice snapshot");
    expect(last.snapshot.revision).toBe(SERVER_PLUGIN_NOTICE_PER_SOURCE_LIMIT + 1);
    expect(last.snapshot.notices).toHaveLength(SERVER_PLUGIN_NOTICE_PER_SOURCE_LIMIT);
    expect(last.snapshot.notices.some((notice) => notice.message === "0")).toBe(false);
  });
  it("publishes the changed current snapshot for records and exact dismissals", () => {
    const events: GlobalSessionEvent[] = [];
    const service = new ServerNoticeService(
      new ServerNoticeStore({ daemonInstanceId: "daemon-a", createNoticeId: () => "notice-1" }),
      { publishGlobal: (event) => { events.push(event); } },
    );

    const notice = service.record({ severity: "error", message: "Failed", scope: { projectId: "project-1" },
      context: Object.freeze({ targets: Object.freeze(["workspace-1"]) }),
    });
    const dismissed = service.dismiss({ daemonInstanceId: "daemon-a", noticeId: notice.id });
    service.dismiss({ daemonInstanceId: "daemon-a", noticeId: notice.id });

    expect(events).toEqual([
      { type: "notices.updated", snapshot: { daemonInstanceId: "daemon-a", revision: 1, notices: [notice] } },
      { type: "notices.updated", snapshot: dismissed },
    ]);
  });
});
