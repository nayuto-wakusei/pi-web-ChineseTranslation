import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Project, Workspace } from "./types.js";
import { appTestContext, registerAppTestHooks } from "./app.testSupport.js";
import { workspaceFilePreviewErrorResponsePolicy, workspaceFilePreviewResponsePolicy } from "./workspaces/filePreviewResponsePolicy.js";

registerAppTestHooks();

describe("workspace file preview HTTP contract", () => {
  it("serves HTML, PDF, and SVG with exact type-specific containment headers", async () => {
    const workspace = await registeredWorkspace("Preview formats");
    const fixtures = [
      { path: "report.html", body: "<h1>Report</h1><script>alert(1)</script>" },
      { path: "spec.pdf", body: "%PDF-1.4\n%mock\n" },
      { path: "diagram.svg", body: "<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"></svg>" },
    ];
    for (const fixture of fixtures) await writeFile(join(appTestContext.projectDir, fixture.path), fixture.body);

    for (const fixture of fixtures) {
      const policy = workspaceFilePreviewResponsePolicy(fixture.path);
      const path = `/projects/${workspace.projectId}/workspaces/${workspace.workspaceId}/file/preview?path=${encodeURIComponent(fixture.path)}`;
      const responses = await Promise.all([
        appTestContext.app.inject({ method: "GET", url: `/api${path}` }),
        appTestContext.app.inject({ method: "GET", url: `/api/machines/local${path}` }),
      ]);
      for (const response of responses) {
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toBe(policy.contentType);
        expect(response.headers["content-disposition"]).toBe(policy.contentDisposition);
        expect(response.headers["content-security-policy"]).toBe(policy.contentSecurityPolicy);
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
        expect(response.body).toBe(fixture.body);
      }
    }
  });

  it("serves unknown formats only as opaque attachment downloads", async () => {
    const workspace = await registeredWorkspace("Downloads");
    const filename = "résumé's notes.bin";
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    await writeFile(join(appTestContext.projectDir, filename), bytes);

    const previewPath = `/api/projects/${workspace.projectId}/workspaces/${workspace.workspaceId}/file/preview?path=${encodeURIComponent(filename)}`;
    const preview = await appTestContext.app.inject({ method: "GET", url: previewPath });
    expect(preview.statusCode).toBe(400);
    expect(preview.headers["content-security-policy"]).toBe(workspaceFilePreviewErrorResponsePolicy().contentSecurityPolicy);

    const download = await appTestContext.app.inject({ method: "GET", url: `${previewPath}&download=1` });
    const policy = workspaceFilePreviewResponsePolicy(filename, { download: true });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/octet-stream");
    expect(download.headers["content-disposition"]).toBe(policy.contentDisposition);
    expect(download.headers["content-security-policy"]).toBe(policy.contentSecurityPolicy);
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.rawPayload).toEqual(bytes);
    expect(download.headers["content-length"]).toBe(String(bytes.byteLength));
  });

  it("hardens traversal and unsupported-preview errors", async () => {
    const workspace = await registeredWorkspace("Preview errors");
    await writeFile(join(appTestContext.projectDir, "note.txt"), "hello");
    const policy = workspaceFilePreviewErrorResponsePolicy();

    for (const path of ["note.txt", "../escape<script>.html"]) {
      const response = await appTestContext.app.inject({
        method: "GET",
        url: `/api/projects/${workspace.projectId}/workspaces/${workspace.workspaceId}/file/preview?path=${encodeURIComponent(path)}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toBe(policy.contentType);
      expect(response.headers["content-disposition"]).toBe(policy.contentDisposition);
      expect(response.headers["content-security-policy"]).toBe(policy.contentSecurityPolicy);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    }
  });
});

async function registeredWorkspace(name: string): Promise<{ projectId: string; workspaceId: string }> {
  const added = await appTestContext.app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { name, path: appTestContext.projectDir, create: true },
  });
  const project = added.json<Project>();
  const listed = await appTestContext.app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces` });
  const workspace = listed.json<Workspace[]>()[0];
  if (workspace === undefined) throw new Error("Expected workspace");
  return { projectId: project.id, workspaceId: workspace.id };
}
