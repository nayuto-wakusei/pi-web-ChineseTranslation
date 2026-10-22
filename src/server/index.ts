#!/usr/bin/env node
import { networkInterfaces } from "node:os";
import { effectivePiWebConfig, maxUploadBytes } from "../config.js";
import { loadNodeTranslator } from "../localization.js";
import { buildApp } from "./app.js";
import { startupUrlLines } from "./startupUrls.js";
import { startupLogger } from "./startupLogger.js";

const { config } = effectivePiWebConfig();
const t = loadNodeTranslator("server", config);
const app = await buildApp({ bodyLimit: maxUploadBytes(process.env, config), logger: startupLogger, translator: t });
await app.listen({ port: config.port ?? 8504, host: config.host ?? "127.0.0.1" });
const bound = app.server.address();
if (bound === null || typeof bound === "string") throw new Error("Expected a bound TCP address after listen");
console.log(`\n  ${t("startup.ready", "PI WEB is ready")}\n\n${startupUrlLines(bound, networkInterfaces(), t).join("\n")}\n`);
