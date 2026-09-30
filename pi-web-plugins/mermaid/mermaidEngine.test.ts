import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("loads a module-relative engine once for concurrent previews", async () => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response("bundled engine")));
  vi.stubGlobal("fetch", fetchMock);
  const { loadMermaidEngine } = await import("./mermaidEngine.js");
  const first = loadMermaidEngine();
  expect(loadMermaidEngine()).toBe(first);
  expect(await first).toBe("bundled engine");
  const url = fetchMock.mock.calls[0]?.[0];
  expect(url).toBeInstanceOf(URL);
  if (!(url instanceof URL)) throw new Error("Expected a module-relative URL");
  expect(url.pathname).toMatch(/\/mermaid\/mermaidRuntime\.js$/u);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("retries failed asset loads rather than caching a rejected promise", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("missing", { status: 404 }))
    .mockResolvedValueOnce(new Response("recovered engine"));
  vi.stubGlobal("fetch", fetchMock);
  const { loadMermaidEngine } = await import("./mermaidEngine.js");
  await expect(loadMermaidEngine()).rejects.toThrow("图表引擎不可用");
  expect(await loadMermaidEngine()).toBe("recovered engine");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("escapes closing script tags without interpolating diagram source", async () => {
  const { mermaidFrameDocument } = await import("./mermaidEngine.js");
  const frame = mermaidFrameDocument('const text = "</script><script>";');
  expect(frame.match(/<\/script>/gu)).toHaveLength(1);
  expect(frame).toContain("default-src 'none'");
  expect(frame).toContain("<\\/script>");
});
