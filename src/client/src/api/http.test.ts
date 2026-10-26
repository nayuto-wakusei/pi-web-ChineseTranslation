import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequestError, NetworkRequestError, request, requestOptional, setApiScope } from "./http";

const fetchMock = vi.fn<typeof fetch>();
const transportStages: ("fetch" | "body")[] = ["fetch", "body"];

beforeEach(() => {
  setApiScope("normal");
  fetchMock.mockReset();
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setApiScope("normal");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("optional reads and scoped transport", () => {
  it("forwards cancellation on optional management reads without dropping embed scope", async () => {
    setApiScope("management");
    vi.stubGlobal("location", { href: "https://pi.example.test/?embed=management" });
    const controller = new AbortController();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(requestOptional("api/read", (body) => body, { signal: controller.signal })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("https://pi.example.test/api/read?embed=management", { signal: controller.signal });
  });
  it.each(transportStages)("classifies optional %s transport failures without retrying", async (stage) => {
    const failure = new TypeError("Offline");
    rejectTransport(stage, failure);
    await expect(requestOptional("api/read", (body) => body)).rejects.toMatchObject({ name: "NetworkRequestError", cause: failure });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([204, 404])("keeps optional HTTP %s empty and skips its parser", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    const parse = vi.fn((body: unknown) => body);
    await expect(requestOptional("api/read", parse)).resolves.toBeUndefined();
    expect(parse).not.toHaveBeenCalled();
  });

  it("does not reclassify an optional parser TypeError", async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    const failure = new TypeError("Invalid shape");
    await expect(requestOptional("api/read", () => { throw failure; })).rejects.toBe(failure);
  });

  it("does not reclassify an unreadable optional HTTP error", async () => {
    const response = new Response(null, { status: 403, statusText: "Forbidden" });
    vi.spyOn(response, "json").mockRejectedValue(new TypeError("Offline"));
    fetchMock.mockResolvedValue(response);
    await expect(requestOptional("api/read", (body) => body)).rejects.toMatchObject({ name: "HttpRequestError", status: 403 });
  });

  it("leaves header construction failures outside the transport boundary", async () => {
    const pending = request("api/read", (body) => body, { headers: { "invalid header": "value" } });
    await expect(pending).rejects.toBeInstanceOf(TypeError);
    await expect(pending).rejects.not.toBeInstanceOf(NetworkRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([request, requestOptional])("keeps a normal in-flight read from consuming a later management entry token", async (read) => {
    let resolveFetch: (response: Response) => void = () => { throw new Error("Fetch did not start"); };
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const replaceState = vi.fn();
    vi.stubGlobal("history", { state: null, replaceState });
    const pending = read("api/read", (body) => body);
    setApiScope("management");
    vi.stubGlobal("location", { href: "https://pi.example.test/?embed=management&token=entry-b" });
    resolveFetch(Response.json({ ok: true }));
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://pi.example.test/api/read");
    expect(replaceState).not.toHaveBeenCalled();
  });
});

function rejectTransport(stage: "fetch" | "body", error: unknown): void {
  if (stage === "fetch") {
    fetchMock.mockRejectedValue(error);
  } else {
    const response = new Response("{}");
    vi.spyOn(response, "json").mockRejectedValue(error);
    fetchMock.mockResolvedValue(response);
  }
}

describe.each(transportStages)("request %s transport boundary", (stage) => {
  it("classifies TypeError with its original cause and message", async () => {
    const cause = new TypeError("Failed to fetch");
    rejectTransport(stage, cause);
    const parse = vi.fn((body: unknown) => body);

    const failure: unknown = await request("api/read", parse).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw new Error("Expected a network failure");
    expect(failure.name).toBe("NetworkRequestError");
    expect(failure.message).toBe(cause.message);
    expect(failure.cause).toBe(cause);
    expect(parse).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves AbortError cancellation", async () => {
    const cancellation = new DOMException("Request cancelled", "AbortError");
    rejectTransport(stage, cancellation);

    await expect(request("api/read", (body) => body)).rejects.toBe(cancellation);
  });

  it("does not classify a TypeError named AbortError", async () => {
    const cancellation = new TypeError("Request cancelled");
    cancellation.name = "AbortError";
    rejectTransport(stage, cancellation);

    await expect(request("api/read", (body) => body)).rejects.toBe(cancellation);
  });

  it("preserves TypeError when the signal is aborted before rejection settles", async () => {
    const controller = new AbortController();
    const cancellation = new TypeError("Request cancelled");
    rejectTransport(stage, cancellation);

    const pending = request("api/read", (body) => body, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toBe(cancellation);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves non-TypeError failures", async () => {
    const failure = new Error("Unexpected failure");
    rejectTransport(stage, failure);

    await expect(request("api/read", (body) => body)).rejects.toBe(failure);
  });
});

describe("request", () => {
  it("returns the parsed result after a successful JSON read", async () => {
    fetchMock.mockResolvedValue(new Response('{"value":1}'));
    const result = { parsed: true };
    const parse = vi.fn((body: unknown) => { void body; return result; });

    await expect(request("api/read", parse)).resolves.toBe(result);

    expect(parse).toHaveBeenCalledExactlyOnceWith({ value: 1 });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://pi.example.test/api/read", { headers: new Headers() });
  });

  it("preserves JSON SyntaxError without invoking the parser", async () => {
    const response = new Response("not json");
    const syntaxError = new SyntaxError("Invalid JSON");
    vi.spyOn(response, "json").mockRejectedValue(syntaxError);
    fetchMock.mockResolvedValue(response);
    const parse = vi.fn((body: unknown) => body);

    await expect(request("api/read", parse)).rejects.toBe(syntaxError);

    expect(parse).not.toHaveBeenCalled();
  });

  it.each([new TypeError("Invalid shape"), new SyntaxError("Invalid value"), new Error("Parser bug")])("preserves parser errors: %s", async (failure) => {
    fetchMock.mockResolvedValue(new Response("{}"));

    await expect(request("api/read", () => { throw failure; })).rejects.toBe(failure);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not classify URL construction TypeError as a network failure", async () => {
    vi.stubGlobal("document", { baseURI: "not a URL" });

    const pending = request("api/read", (body) => body);

    await expect(pending).rejects.toBeInstanceOf(TypeError);
    await expect(pending).rejects.not.toBeInstanceOf(NetworkRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains the HTTP status and JSON error message", async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"Access denied"}', { status: 403, statusText: "Forbidden" }));
    const parse = vi.fn((body: unknown) => body);

    const pending = request("api/read", parse);

    await expect(pending).rejects.toBeInstanceOf(HttpRequestError);
    await expect(pending).rejects.toMatchObject({ status: 403, message: "Access denied" });
    expect(parse).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([new TypeError("Body transport failure"), new SyntaxError("Invalid JSON"), new DOMException("Cancelled", "AbortError")])("retains HTTP failure fallback when its body is unreadable: %s", async (failure) => {
    const response = new Response("", { status: 503, statusText: "Service Unavailable" });
    vi.spyOn(response, "json").mockRejectedValue(failure);
    fetchMock.mockResolvedValue(response);

    const pending = request("api/read", (body) => body);

    await expect(pending).rejects.toBeInstanceOf(HttpRequestError);
    await expect(pending).rejects.toMatchObject({ status: 503, message: "Service Unavailable" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["GET", "POST", "PUT", "DELETE"])("never globally retries %s requests", async (method) => {
    fetchMock.mockRejectedValue(new TypeError("Offline"));

    await expect(request("api/resource", (body) => body, { method })).rejects.toBeInstanceOf(NetworkRequestError);

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
