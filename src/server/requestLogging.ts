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
        "headers.authorization",
        "headers.cookie",
        "headers['x-pi-web-embed-token']",
        "headers['x-pi-web-management-context']",
      ],
      censor: REDACTED,
    },
    serializers: {
      req: serializeRequest,
    },
  };
}

export function redactRequestUrl(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;

  const fragmentStart = url.indexOf("#", queryStart);
  const queryEnd = fragmentStart === -1 ? url.length : fragmentStart;
  const searchParams = new URLSearchParams(url.slice(queryStart + 1, queryEnd));
  const tokenKeys = [...new Set(searchParams.keys())].filter((key) => key.toLowerCase() === "token");
  if (tokenKeys.length === 0) return url;

  for (const key of tokenKeys) searchParams.set(key, REDACTED);
  return `${url.slice(0, queryStart + 1)}${searchParams.toString()}${url.slice(queryEnd)}`;
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
