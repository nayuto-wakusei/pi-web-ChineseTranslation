// Isolated production auth/HTTP/WS gate. Not a full sessiond or model workload.
// Run: node --import tsx scripts/perf-auth-fixture.mjs OUTPUT_DIRECTORY
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { NormalModeAuthService, registerNormalAuthRoutes, registerNormalModeAuthGate } from "../src/server/normalAuth.ts";

const directory = process.argv[2];
if (!directory) throw new Error("Output directory is required");
await mkdir(directory, { recursive: true });
let config = {};
const response = () => ({ config, effectiveConfig: config });
const auth = new NormalModeAuthService({ read: response, write: (next) => { config = next; return response(); } });
const password = randomBytes(24).toString("hex");
await auth.setup(password);
const app = Fastify({ logger: false });
await app.register(websocket);
const attempts = registerNormalAuthRoutes(app, auth);
registerNormalModeAuthGate(app, auth, undefined, attempts);
app.get("/api/test-health", () => ({ ok: true }));
app.get("/api/events", { websocket: true }, socket => { socket.send(JSON.stringify({ type: "fixture.ready" })); });
const url = await app.listen({ host: "127.0.0.1", port: 0 });
await writeFile(join(directory, "password.txt"), password, { mode: 0o600 });
await writeFile(join(directory, "fixture.json"), JSON.stringify({ url, pid: process.pid, coverage: "production auth gate only; no sessiond" }));
console.log(JSON.stringify({ url, pid: process.pid }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
