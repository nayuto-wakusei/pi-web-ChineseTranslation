import { afterEach, describe, expect, it, vi } from "vitest";
import { createExplorerViewStateStore, type ExplorerViewState } from "./explorerViewState";

const prefix = "pi-web.workspace.files.explorer.v1:";
const scope = JSON.stringify(["machine", "project", "workspace"]);
const state: ExplorerViewState = { expandedPaths: ["src", "src/components", "日本語"], scrollTop: 123.5 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("explorer view state store", () => {
  it("restores presentation through a new store using the exact scoped storage key", () => {
    const storage = fakeStorage();
    const store = createExplorerViewStateStore(storage);
    expect(store.read(scope)).toBeUndefined();
    store.write(scope, state);
    expect(storage.getItem(prefix + scope)).toBe(JSON.stringify(state));
    expect(createExplorerViewStateStore(storage).read(scope)).toEqual(state);
  });

  it("isolates machine, project, and workspace identities", () => {
    const store = createExplorerViewStateStore(fakeStorage());
    store.write(scope, state);
    for (const identity of [
      ["other", "project", "workspace"],
      ["machine", "other", "workspace"],
      ["machine", "project", "other"],
    ]) {
      expect(store.read(JSON.stringify(identity))).toBeUndefined();
    }
  });

  it("uses browser sessionStorage by default without touching localStorage", () => {
    const sessionStorage = fakeStorage();
    const localStorage = fakeStorage();
    vi.stubGlobal("window", { sessionStorage, localStorage });
    createExplorerViewStateStore().write(scope, state);
    expect(createExplorerViewStateStore().read(scope)).toEqual(state);
    expect(localStorage.getItem(prefix + scope)).toBeNull();
  });

  it("owns snapshots rather than sharing mutable arrays with callers", () => {
    const storage = fakeStorage();
    const store = createExplorerViewStateStore(storage);
    const input = { expandedPaths: ["src"], scrollTop: 1 };
    store.write(scope, input);
    input.expandedPaths.push("mutated");
    const restored = createExplorerViewStateStore(storage);
    for (const reader of [store, restored]) {
      const result = reader.read(scope);
      result?.expandedPaths.push("also-mutated");
      if (result) result.scrollTop = 999;
      expect(reader.read(scope)).toEqual({ expandedPaths: ["src"], scrollTop: 1 });
    }
  });

  it.each([
    "not json", "null", "[]", "{}", "true",
    JSON.stringify({ expandedPaths: "src", scrollTop: 0 }),
    JSON.stringify({ expandedPaths: [1], scrollTop: 0 }),
    JSON.stringify({ expandedPaths: [], scrollTop: "0" }),
    JSON.stringify({ expandedPaths: [], scrollTop: -1 }),
    '{"expandedPaths":[],"scrollTop":1e999}',
  ])("ignores malformed persisted state: %s", (serialized) => {
    const storage = fakeStorage();
    storage.setItem(prefix + scope, serialized);
    expect(createExplorerViewStateStore(storage).read(scope)).toBeUndefined();
  });

  it.each(["", "/", ".", "..", "/src", "src/", "src//child", "src/../child", "src/./child", "src\\child", "C:/src", "src\0child"])(
    "rejects unsafe directory paths on both read and write: %j", (path) => {
      const storage = fakeStorage();
      const invalid = { expandedPaths: [path], scrollTop: 0 };
      storage.setItem(prefix + scope, JSON.stringify(invalid));
      const store = createExplorerViewStateStore(storage);
      expect(store.read(scope)).toBeUndefined();
      store.write(scope, state);
      store.write(scope, invalid);
      expect(store.read(scope)).toEqual(state);
      expect(createExplorerViewStateStore(storage).read(scope)).toEqual(state);
    },
  );

  it.each([NaN, Infinity, -Infinity, -1])("rejects invalid scroll offsets on write: %s", (scrollTop) => {
    const storage = fakeStorage();
    const store = createExplorerViewStateStore(storage);
    store.write(scope, { expandedPaths: [], scrollTop });
    expect(store.read(scope)).toBeUndefined();
    expect(storage.getItem(prefix + scope)).toBeNull();
  });

  it("accepts an empty expansion list and zero scroll", () => {
    const storage = fakeStorage();
    createExplorerViewStateStore(storage).write(scope, { expandedPaths: [], scrollTop: 0 });
    expect(createExplorerViewStateStore(storage).read(scope)).toEqual({ expandedPaths: [], scrollTop: 0 });
  });

  it("keeps independent in-memory state without a browser", () => {
    vi.stubGlobal("window", undefined);
    const store = createExplorerViewStateStore();
    store.write(scope, state);
    expect(store.read(scope)).toEqual(state);
    expect(createExplorerViewStateStore().read(scope)).toBeUndefined();
  });

  it.each(["access", "read", "write"])("warns once and preserves subsequent updates after a storage %s failure", (failure) => {
    const error = new Error("storage unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const storage = fakeStorage();
    if (failure === "read") vi.spyOn(storage, "getItem").mockImplementation(() => { throw error; });
    if (failure === "write") vi.spyOn(storage, "setItem").mockImplementation(() => { throw error; });
    vi.stubGlobal("window", {
      get sessionStorage() {
        if (failure === "access") throw error;
        return storage;
      },
    });
    const store = createExplorerViewStateStore();
    expect(store.read(scope)).toBeUndefined();
    store.write(scope, state);
    store.write(scope, { expandedPaths: ["docs"], scrollTop: 42 });
    store.write("other", state);
    expect(store.read(scope)).toEqual({ expandedPaths: ["docs"], scrollTop: 42 });
    expect(store.read("other")).toEqual(state);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("using memory only"), error);
  });
});

function fakeStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}
