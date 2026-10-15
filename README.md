# plasticuer-server-mcp

Servidor [MCP](https://modelcontextprotocol.io) que se conecta a la base SQL Server **plasticuer** y expone sus operaciones como tools para Claude u otros clientes MCP.

## Requisitos

- Node.js 20 o superior
- Acceso de red al servidor SQL (está en la VPN, `25.133.131.194:1433`)

## Puesta en marcha

```bash
npm install
cp .env.example .env    # completar DB_USER y DB_PASSWORD
npm run build
```

Probar la conexión y las tools con el inspector de MCP:

```bash
npm run inspector
```

## Relevar el schema

```bash
npm run introspect
```

Genera `docs/schema.md` (legible) y `docs/schema.json` (completo): tablas con filas, columnas, PK, FK, índices, triggers, vistas, stored procedures, funciones y los permisos del usuario de conexión.

## Registrar el servidor en Claude

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "plasticuer": {
      "command": "node",
      "args": ["C:/ruta/a/plasticuer-server-mcp/dist/index.js"],
      "env": {
        "DB_SERVER": "25.133.131.194",
        "DB_NAME": "plasticuer",
        "DB_USER": "...",
        "DB_PASSWORD": "..."
      }
    }
  }
}
```

Claude Code:

```bash
claude mcp add plasticuer -- node /ruta/a/plasticuer-server-mcp/dist/index.js
```

Si el proceso arranca desde la carpeta del proyecto, toma las credenciales del `.env`; si no, pasarlas con `env` como arriba.

## Estructura

```
src/
  index.ts         arranque del servidor (stdio)
  config.ts        configuración de conexión desde variables de entorno
  db.ts            pool de conexiones y helpers query / execProcedure (siempre parametrizados)
  tools/index.ts   registro de tools (hoy: db_health)
scripts/
  introspect-schema.ts
docs/
  schema.md / schema.json   (generados)
```

## Agregar un método

1. Crear `src/tools/<area>.ts` con una función `register<Area>Tools(server)` que use `server.registerTool(...)`, validando la entrada con `zod`.
2. Usar `query("... WHERE id = @id", { id })`: nunca concatenar valores en el SQL.
3. Registrarla en `src/tools/index.ts`.

Las credenciales viven solo en `.env` (excluido de git).
