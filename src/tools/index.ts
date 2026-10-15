import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { query } from "../db.js";

/** Convierte un resultado en el contenido de texto que devuelve una tool MCP. */
export function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Respuesta de error legible para el cliente MCP (sin tirar el servidor). */
export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

/**
 * Registro de tools. Cada método de negocio va en su propio archivo dentro de src/tools/
 * y se registra acá.
 */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "db_health",
    {
      title: "Estado de la base",
      description:
        "Verifica la conexión con la base Plasticuer y devuelve servidor, base y versión de SQL Server.",
      inputSchema: {},
    },
    async () => {
      try {
        const [row] = await query(
          "SELECT @@SERVERNAME AS server, DB_NAME() AS [database], @@VERSION AS version",
        );
        return jsonResult({ ok: true, ...row });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // Acá se registran los métodos de negocio, por ejemplo:
  // registerClientesTools(server);
}
