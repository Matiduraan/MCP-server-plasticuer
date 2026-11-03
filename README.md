# plasticuer-api

API REST de solo lectura sobre la base SQL Server **plasticuer**: devuelve productos paginados con su precio y su stock.

## Requisitos

- Node.js 20 o superior
- Acceso de red al servidor SQL (está en la VPN, `25.133.131.194:1433`)

## Puesta en marcha

```bash
npm install
cp .env.example .env    # completar DB_USER, DB_PASSWORD y API_AUTH_TOKEN
npm run build
npm start               # escucha en http://127.0.0.1:8000
```

Para desarrollo, con recarga automática: `npm run dev`.

## Endpoint

### `GET /products`

| Query param | Tipo | Default | Descripción |
|---|---|---|---|
| `offset` | entero ≥ 0 | `0` | Cantidad de productos a saltear. |
| `limit` | entero 1–50 | `20` | Cantidad de productos a devolver (máximo 50). |
| `query` | texto (hasta 100 caracteres) | — | Busca en el nombre y en la descripción. Si tiene varias palabras, tienen que aparecer todas, en cualquier orden. Primero aparece la coincidencia exacta del nombre, después los que empiezan con el texto y después el resto, en orden alfabético. |
| `include` | `stock`, `price` o `stock,price` | ambos | Qué datos agregar a cada producto. También acepta el parámetro repetido: `include=stock&include=price`. |

Solo devuelve productos activos. Si hay token configurado, exige el header `Authorization: Bearer <API_AUTH_TOKEN>`.

Ejemplo:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8000/products?query=taza%20ceramica&offset=0&limit=2"
```

```json
{
  "data": [
    {
      "id": 303577,
      "name": "TAZA CERAMICA",
      "description": null,
      "barcodes": ["303577001"],
      "price": { "A": 7500, "B": 9297, "C": 6787.33 },
      "stock": {
        "total": 7,
        "branches": [{ "id": 1, "name": "Pasteur", "stock": 7 }]
      }
    }
  ],
  "pagination": { "offset": 0, "limit": 2, "total": 141 }
}
```

- `price`: precio en cada lista de venta (A, B, C). `null` = sin precio cargado en esa lista. La lista COSTO no se expone.
- `stock`: stock total y por sucursal, tomado de `stocks_locales`. Puede ser negativo.
- `pagination.total`: cantidad total de productos que cumplen la búsqueda. Sirve para calcular las páginas.
- Con `include=stock` no aparece `price`, y con `include=price` no aparece `stock`.

Errores, siempre con el formato `{ "error": { "code", "message" } }`:

| Status | `code` | Cuándo |
|---|---|---|
| 400 | `bad_request` | Parámetro inválido (ej. `limit=51`, `include=foo`). |
| 401 | `unauthorized` | Falta el token o es incorrecto. |
| 404 | `not_found` | Ruta inexistente. |
| 405 | `method_not_allowed` | Método distinto de GET. |
| 500 | `internal_error` | Error consultando la base (el detalle queda en el log del servidor). |

### `GET /health`

Devuelve `{ "ok": true }`. No exige token; sirve para monitorear el túnel.

## Configuración

Todo se configura con variables de entorno (ver `.env.example`):

| Variable | Default | |
|---|---|---|
| `API_HOST` | `127.0.0.1` | Con Cloudflare Tunnel en la misma máquina no hace falta exponerla en otra interfaz. |
| `API_PORT` | `8000` | |
| `API_AUTH_TOKEN` | — | Token Bearer. Si está vacío, `/products` queda abierto (solo para pruebas). |
| `API_CORS_ORIGIN` | — | Origen permitido si se llama desde un navegador. |
| `DB_*` | | Conexión a SQL Server. |

Las variables `MCP_HTTP_HOST`, `MCP_HTTP_PORT` y `MCP_AUTH_TOKEN` de la versión anterior siguen funcionando como alternativa.

## Scripts

| Script | |
|---|---|
| `npm test` | Tests del manejo HTTP y de la validación de parámetros (no usa la base). |
| `npm run probar` | Ejecuta consultas reales contra la base y deja el resultado en `docs/prueba-productos.json`. |
| `npm run introspect` | Releva el schema de la base en `docs/schema.md` y `docs/schema.json`. |

## Estructura

```
src/
  index.ts       arranque del servidor HTTP
  api.ts         ruteo, autenticación y validación de query params (sin dependencias de la base)
  productos.ts   consulta de productos con precio y stock
  db.ts          pool de conexiones y helper query (siempre parametrizado)
  config.ts      configuración de conexión desde variables de entorno
test/
  api.test.ts
```

## Notas sobre la base

- Es SQL Server 2008 R2: no usar `OFFSET/FETCH`, `STRING_AGG`, `IIF`, `TRY_CONVERT` ni `FORMAT`. Para paginar se usa `ROW_NUMBER()`.
- Solo acepta TLS 1.0, por eso `DB_TLS_MIN_VERSION=TLSv1`.
- El usuario de conexión solo tiene permisos de lectura (`db_datareader`).
- Las credenciales van solo en `.env`, que está excluido de git.
