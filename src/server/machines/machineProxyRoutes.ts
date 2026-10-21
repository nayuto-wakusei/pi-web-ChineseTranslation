import type { FastifyInstance, FastifyReply } from "fastify";
import { createTranslator, userFacingErrorMessage, type Translator } from "../../shared/i18n.js";
import type { WebSocket } from "ws";
import type { PiWebAgentConfig } from "../../shared/apiTypes.js";
import { FEDERATED_HTTP_ROUTES, FEDERATED_WEBSOCKET_ROUTES, type FederatedHttpRouteSpec } from "../../shared/federatedRoutes.js";
import { mergeSelectedMachineConfig, parsePiWebConfigResponseBody, parseSelectedMachineConfigRequest, selectedMachineConfigResponse } from "../configRoutes.js";
import { bridgeSockets } from "../webSocketBridge.js";
import { RemoteMachineRequestError, type MachineClient, type MachineJsonResponse, type MachineRequestOptions } from "./machineClient.js";
import { MachineService } from "./machineService.js";

export const REMOTE_HTTP_ROUTES = FEDERATED_HTTP_ROUTES;
export const REMOTE_WEBSOCKET_ROUTES = FEDERATED_WEBSOCKET_ROUTES;

const SAFE_RESPONSE_HEADERS = new Set([
  "content-type",
  "content-length",
  "content-disposition",
  "cache-control",
  "last-modified",
  "etag",
  "content-security-policy",
  "x-content-type-options",
]);

export function registerMachineProxyRoutes(app: FastifyInstance, machines = new MachineService(), t: Translator = createTranslator("en", {})): void {
  for (const spec of REMOTE_HTTP_ROUTES) {
    app.route<{ Params: { machineId: string }; Body: unknown }>({
      method: spec.method,
      url: `/api/machines/:machineId${spec.path}`,
      handler: (request, reply) => proxyHttpRequest(machines, spec, request.params.machineId, request.method, request.url, request.body, request.headers["content-type"], reply, t),
    });
  }

  for (const path of REMOTE_WEBSOCKET_ROUTES) {
    app.get<{ Params: { machineId: string } }>(`/api/machines/:machineId${path}`, { websocket: true }, async (socket, request) => {
      await proxyWebSocket(machines, request.params.machineId, request.url, socket, t);
    });
  }
}

async function proxyHttpRequest(machines: MachineService, spec: FederatedHttpRouteSpec, machineId: string, method: string, requestUrl: string, body: unknown, contentType: string | string[] | undefined, reply: FastifyReply, t: Translator): Promise<FastifyReply> {
  if (machineId === "local") {
    return reply.code(501).send({ error: t("machineError.localRouteMissing", "Local machine route is not registered for this endpoint") });
  }

  const client = await machines.remoteClient(machineId);
  if (client === undefined) {
    return reply.code(404).send({ error: t("machineError.notFound", "Machine not found") });
  }

  try {
    const remotePath = remoteApiPath(machineId, requestUrl);
    if (spec.path === "/config") return await proxySelectedMachineConfigRequest(client, machineId, method, remotePath, body, reply, t);

    const requestOptions = proxyRequestOptions(spec, body, contentType);
    const upstream = requestOptions === undefined
      ? await client.request(method, remotePath, body)
      : await client.request(method, remotePath, body, requestOptions);
    reply.code(upstream.statusCode);
    applySafeHeaders(reply, upstream.headers);
    if (upstream.body === undefined) return await reply.send();
    return await reply.send(upstream.body);
  } catch (error) {
    if (isSelectedMachineConfigRequestError(error)) return reply.code(400).send({ error: userFacingErrorMessage(error, t) });
    return sendGatewayError(reply, machineId, error, t);
  }
}

async function proxySelectedMachineConfigRequest(client: MachineClient, machineId: string, method: string, remotePath: string, body: unknown, reply: FastifyReply, t: Translator): Promise<FastifyReply> {
  if (method === "GET") {
    return sendSelectedMachineConfigResponse(reply, await client.requestJson("GET", remotePath), machineId, t);
  }

  if (method === "PUT") {
    const patch = parseSelectedMachineConfigRequest(configPayload(body), "portable");
    const currentResponse = await client.requestJson("GET", remotePath);
    if (!isSuccessfulStatus(currentResponse.statusCode)) return sendUpstreamJsonResponse(reply, currentResponse, machineId, t);

    const current = parsePiWebConfigResponseBody(currentResponse.body, "Remote machine config response");
    const merged = mergeSelectedMachineConfig(current.config, patch);
    const updateResponse = await client.requestJson("PUT", remotePath, { config: merged });
    return sendSelectedMachineConfigResponse(reply, updateResponse, machineId, t, patch.agent);
  }

  return reply.code(405).send({ error: t("machineError.methodNotAllowed", "Method not allowed") });
}

function configPayload(body: unknown): unknown {
  return isRecord(body) ? body["config"] : undefined;
}

function sendSelectedMachineConfigResponse(reply: FastifyReply, upstream: MachineJsonResponse, machineId: string, t: Translator, expectedAgentProfile?: PiWebAgentConfig): FastifyReply {
  if (!isSuccessfulStatus(upstream.statusCode)) return sendUpstreamJsonResponse(reply, upstream, machineId, t);
  const response = parsePiWebConfigResponseBody(upstream.body, "Remote machine config response");
  if (expectedAgentProfile !== undefined && !sameAgentProfile(response.config.agent, expectedAgentProfile)) {
    return reply.code(409).send({
      error: t("machineError.profileNotPersisted", "Remote machine did not persist the requested agent profile"),
      machineId,
      detail: t("machineError.profileUpdateRequired", "Update and restart PI WEB on the remote machine before changing its agent profile."),
    });
  }
  reply.code(upstream.statusCode);
  applySafeHeaders(reply, upstream.headers);
  return reply.send(selectedMachineConfigResponse(response));
}

function sameAgentProfile(actual: PiWebAgentConfig | undefined, expected: PiWebAgentConfig): boolean {
  return actual !== undefined && actual.command === expected.command && actual.dir === expected.dir;
}

function sendUpstreamJsonResponse(reply: FastifyReply, upstream: MachineJsonResponse, machineId: string, t: Translator): FastifyReply {
  reply.code(upstream.statusCode);
  applySafeHeaders(reply, upstream.headers);
  return reply.send(upstream.body ?? { error: t("machineError.configRequestFailed", "Remote machine config request failed"), machineId, statusCode: upstream.statusCode });
}

function isSuccessfulStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

async function proxyWebSocket(machines: MachineService, machineId: string, requestUrl: string, socket: WebSocket, t: Translator): Promise<void> {
  if (machineId === "local") {
    socket.close(1011, t("machineError.localRouteMissing", "Local machine route is not registered for this endpoint"));
    return;
  }

  const client = await machines.remoteClient(machineId);
  if (client === undefined) {
    socket.close(1008, t("machineError.notFound", "Machine not found"));
    return;
  }

  try {
    bridgeSockets(socket, client.connectWebSocket(remoteApiPath(machineId, requestUrl)));
  } catch {
    socket.close(1011, t("machineError.unavailable", "Remote machine unavailable"));
  }
}

function remoteApiPath(machineId: string, requestUrl: string): string {
  const machinePrefix = `/api/machines/${encodeURIComponent(machineId)}`;
  const stripped = requestUrl.startsWith(machinePrefix) ? requestUrl.slice(machinePrefix.length) : requestUrl;
  const compatPath = stripped.startsWith("/") ? stripped : `/${stripped}`;
  return `/api${compatPath}`;
}

function proxyRequestOptions(spec: Pick<FederatedHttpRouteSpec, "timeoutMs">, body: unknown, contentType: string | string[] | undefined): MachineRequestOptions | undefined {
  const options: MachineRequestOptions = {};
  if (spec.timeoutMs !== undefined) options.timeoutMs = spec.timeoutMs;
  if (isRawProxyBody(body)) {
    const value = firstHeaderValue(contentType);
    if (value !== undefined && value !== "") options.contentType = value;
  }
  return Object.keys(options).length === 0 ? undefined : options;
}

function isRawProxyBody(body: unknown): boolean {
  return typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function applySafeHeaders(reply: FastifyReply, headers: Record<string, string | string[] | undefined>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (!SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    reply.header(name, value);
  }
}

function isSelectedMachineConfigRequestError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("PI WEB selected-machine config");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendGatewayError(reply: FastifyReply, machineId: string, error: unknown, t: Translator): FastifyReply {
  const statusCode = error instanceof RemoteMachineRequestError ? error.statusCode : 502;
  const label = statusCode === 504 ? t("machineError.timeout", "Remote machine timeout") : t("machineError.unavailable", "Remote machine unavailable");
  return reply.code(statusCode).send({
    error: label,
    machineId,
    statusCode,
    detail: userFacingErrorMessage(error, t),
  });
}
