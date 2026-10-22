import { expect, it } from "vitest";
import { ChatScrollController, findScrollAnchor, type ChatScrollElement, type ChatScrollScheduler, type ChatScrollStorage, type ChatScrollViewport } from "./chatScrollPosition";

class MemoryScrollStorage implements ChatScrollStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class ManualScheduler implements ChatScrollScheduler {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  setTimeout(callback: () => void): number {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return id;
  }

  clearTimeout(id: number): void {
    this.callbacks.delete(id);
  }

  run(id: number): void {
    const callback = this.callbacks.get(id);
    if (callback === undefined) return;
    this.callbacks.delete(id);
    callback();
  }

  runAll(): void {
    const ids = [...this.callbacks.keys()];
    for (const id of ids) this.run(id);
  }
}

class FakeScroller implements ChatScrollViewport {
  constructor(
    public scrollTop: number,
    public scrollHeight: number,
    public clientHeight: number,
    private readonly top: number,
    private readonly bottom: number,
  ) {}

  getBoundingClientRect(): Pick<DOMRectReadOnly, "top" | "bottom"> {
    return { top: this.top, bottom: this.bottom };
  }
}

class FakeArticle implements ChatScrollElement {
  readonly dataset: { readonly scrollAnchorId?: string | undefined };

  constructor(
    private readonly top: number,
    private readonly bottom: number,
    anchorId?: string,
  ) {
    this.dataset = {
      ...(anchorId === undefined ? {} : { scrollAnchorId: anchorId }),
    };
  }

  getBoundingClientRect(): Pick<DOMRectReadOnly, "top" | "bottom"> {
    return { top: this.top, bottom: this.bottom };
  }
}

it("saves and restores an offscreen anchor without requiring viewport intersection", () => {
    const storage = new MemoryScrollStorage();
    const controller = new ChatScrollController(storage, new ManualScheduler());
    const scroller = new FakeScroller(200, 1000, 300, 100, 400);
    expect(controller.savePosition("s1", scroller, [new FakeArticle(-100, -50, "m:durable")])).toBe("saved");
    expect(controller.readPosition("s1")).toEqual({ mode: "anchor", anchorId: "m:durable", offset: -200 });
    expect(controller.restorePosition("s1", scroller, [new FakeArticle(50, 80, "m:durable")])).toEqual({ status: "restored" });
    expect(scroller.scrollTop).toBe(350);
  });

it("does not restore to a zero-height anchor retained inside a closed disclosure", () => {
    const controller = new ChatScrollController(new MemoryScrollStorage(), new ManualScheduler());
    const scroller = new FakeScroller(200, 1000, 100, 100, 200);
    const hidden = new FakeArticle(0, 0, "e:4");
    const position = { mode: "anchor" as const, anchorId: "e:4", offset: -20 };
    expect(controller.restoreExplicitPosition(position, scroller, [hidden])).toEqual({ status: "missing", position });
    expect(scroller.scrollTop).toBe(200);
  });

it("uses the nearest offscreen anchor when no durable anchor is visible", () => {
    const scroller = new FakeScroller(200, 1000, 100, 100, 200);
    const above = new FakeArticle(20, 50, "m:above");
    const below = new FakeArticle(220, 250, "m:below");
    const transient = new FakeArticle(100, 180);
    const hidden = new FakeArticle(0, 0, "m:hidden");

    expect(findScrollAnchor(scroller, [hidden, transient, above, below])).toBe(above);
    expect(findScrollAnchor(scroller, [hidden, transient])).toBeUndefined();
    // Equal distance is resolved by DOM order, independent of array sorting.
    const tiedBelow = new FakeArticle(180, 200, "m:tied");
    const shortViewport = new FakeScroller(200, 1000, 50, 100, 150);
    expect(findScrollAnchor(shortViewport, [above, tiedBelow])).toBe(above);
  });

it("prefers a visible anchor over a closer offscreen anchor", () => {
    const scroller = new FakeScroller(200, 1000, 100, 100, 200);
    const above = new FakeArticle(80, 90, "m:above");
    const visible = new FakeArticle(180, 200, "m:visible");
    expect(findScrollAnchor(scroller, [above, visible])).toBe(visible);
  });
