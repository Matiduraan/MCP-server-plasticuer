#!/usr/bin/env node
import "dotenv/config";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { closePool } from "./db.js";
import { registerTools } from "./tools/index.js";

// Importante: con transporte stdio, stdout es el canal del protocolo.
// Todo log va a stderr (console.error).

function buildServer(): McpServer {
  const server = new McpServer({
    name: "plasticuer-server-mcp",
    version: "0.1.0",
  });
  registerTools(server);
  return server;
}

async function startStdio() {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error("[plasticuer-mcp] servidor iniciado (stdio)");
}

// ---------------------------------------------------------------------------
// Modo HTTP (Streamable HTTP, sin estado): pensado para exponerse con un túnel.
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 1_000_000;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null }, headers);
}

function isAuthorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true; // sin MCP_AUTH_TOKEN no se exige auth (solo para pruebas)
  const header = req.headers.authorization ?? "";
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function startHttp() {
  const host = process.env.MCP_HTTP_HOST || "127.0.0.1";
  const port = Number.parseInt(process.env.MCP_HTTP_PORT || "8000", 10);
  const path = process.env.MCP_HTTP_PATH || "/mcp";
  const token = process.env.MCP_AUTH_TOKEN || undefined;

  if (!token) {
    console.error("[plasticuer-mcp] ATENCIÓN: MCP_AUTH_TOKEN vacío, el endpoint no exige autenticación");
  }

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname !== path) {
      return sendJson(res, 404, { error: "not found" });
    }
    if (!isAuthorized(req, token)) {
      return rpcError(res, 401, "No autorizado", { "WWW-Authenticate": "Bearer" });
    }
    // Modo sin estado: no hay sesiones ni streams de servidor, solo POST.
    if (req.method !== "POST") {
      return rpcError(res, 405, "Método no permitido", { Allow: "POST" });
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      return rpcError(res, 400, "JSON inválido");
    }

    // Un servidor y un transporte por request (patrón recomendado por el SDK para modo sin estado).
    // El pool de SQL se comparte entre requests.
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("[plasticuer-mcp] error atendiendo request:", err);
      if (!res.headersSent) rpcError(res, 500, "Error interno");
    }
  });

  httpServer.listen(port, host, () => {
    console.error(`[plasticuer-mcp] servidor iniciado (http) en http://${host}:${port}${path}`);
  });
}

async function shutdown() {
  await closePool().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const mode = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();
const start = mode === "http" ? startHttp : startStdio;

start().catch((err) => {
  console.error("[plasticuer-mcp] error fatal:", err);
  process.exit(1);
});