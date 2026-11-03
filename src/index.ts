#!/usr/bin/env node
import "dotenv/config";
import { createServer } from "node:http";
import { createApiHandler } from "./api.js";
import { closePool, getPool } from "./db.js";
import { listProducts } from "./productos.js";

// API_* son las variables nuevas; MCP_* se aceptan para no romper un .env de la versión MCP.
const env = (name: string, legacy?: string) => process.env[name] || (legacy ? process.env[legacy] : undefined);

const host = env("API_HOST", "MCP_HTTP_HOST") || "127.0.0.1";
const port = Number.parseInt(env("API_PORT", "MCP_HTTP_PORT") || "8000", 10);
const authToken = env("API_AUTH_TOKEN", "MCP_AUTH_TOKEN");
const corsOrigin = env("API_CORS_ORIGIN");

if (!authToken) {
  console.error("[plasticuer-api] ATENCIÓN: API_AUTH_TOKEN vacío, /products no exige autenticación");
}

const handler = createApiHandler({ listProducts, authToken, corsOrigin });

const server = createServer((req, res) => {
  handler(req, res).catch((err) => {
    console.error("[plasticuer-api] error no controlado:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: { code: "internal_error", message: "Error interno" } }));
    }
  });
});

server.listen(port, host, () => {
  console.log(`[plasticuer-api] escuchando en http://${host}:${port} (GET /products, GET /health)`);
  // Abre la conexión a la base al arrancar para detectar errores de configuración temprano.
  getPool()
    .then(() => console.log("[plasticuer-api] conexión a la base OK"))
    .catch((err) => console.error("[plasticuer-api] no se pudo conectar a la base (se reintenta en cada request):", err.message));
});

async function shutdown() {
  server.close();
  await closePool().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
