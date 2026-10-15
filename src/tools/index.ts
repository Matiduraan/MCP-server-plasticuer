import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { query } from "../db.js";
import { registerProductosTools } from "./productos.js";
import { errorResult, jsonResult } from "./util.js";

export { errorResult, jsonResult };

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

  registerProductosTools(server);
}
