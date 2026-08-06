import type {
  FastifyRequest,
  FastifyServerOptions,
} from "fastify";

const REDACTED = "[REDACTED]";

type RequestLoggerOptions = Exclude<FastifyServerOptions["logger"], boolean | undefined>;

export function requestLoggerOptions(stream?: { write(message: string): void }): RequestLoggerOptions {
  return {
    ...(stream === undefined ? {} : { stream }),
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-pi-web-embed-token']",
        "req.headers['x-pi-web-management-context']",
        "req.headers['x-pi-web-workbench-access-handle']",
        "headers.authorization",
        "headers.cookie",
        "headers['x-pi-web-embed-token']",
        "headers['x-pi-web-management-context']",
        "headers['x-pi-web-workbench-access-handle']",
      ],
      censor: REDACTED,
    },
    serializers: {
      req: serializeRequest,
    },
  };
}

export function redactRequestUrl(url: string): string {
  const withoutWorkbenchHandle = url.replace(
    /(\/_internal\/workbench\/access-states\/)[^/?#]+/u,
    "$1[REDACTED]",
  );
  const queryStart = withoutWorkbenchHandle.indexOf("?");
  if (queryStart === -1) return withoutWorkbenchHandle;

  const fragmentStart = withoutWorkbenchHandle.indexOf("#", queryStart);
  const queryEnd = fragmentStart === -1 ? withoutWorkbenchHandle.length : fragmentStart;
  const searchParams = new URLSearchParams(withoutWorkbenchHandle.slice(queryStart + 1, queryEnd));
  const tokenKeys = [...new Set(searchParams.keys())].filter((key) => key.toLowerCase() === "token");
  if (tokenKeys.length === 0) return withoutWorkbenchHandle;

  for (const key of tokenKeys) searchParams.set(key, REDACTED);
  return `${withoutWorkbenchHandle.slice(0, queryStart + 1)}${searchParams.toString()}${withoutWorkbenchHandle.slice(queryEnd)}`;
}

function serializeRequest(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: redactRequestUrl(request.url),
    version: request.headers["accept-version"],
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  };
}
