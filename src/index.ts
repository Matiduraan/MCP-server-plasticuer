#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closePool } from "./db.js";
import { registerTools } from "./tools/index.js";

// Importante: con transporte stdio, stdout es el canal del protocolo.
// Todo log va a stderr (console.error).

const server = new McpServer({
  name: "plasticuer-server-mcp",
  version: "0.1.0",
});

registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[plasticuer-mcp] servidor iniciado (stdio)");
}

async function shutdown() {
  await closePool().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[plasticuer-mcp] error fatal:", err);
  process.exit(1);
});
