import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buscarProductos } from "../productos.js";
import { errorResult, jsonResult } from "./util.js";

const DESCRIPCION_PRODUCTO = `Cada producto incluye: código interno, descripción, códigos de barras, línea, rubro, rubro web,
proveedor, unidad, precios por lista de venta (A, B, C) y stock total y por sucursal (Pasteur, Muñiz).
El stock puede ser negativo (ventas registradas sin ingreso de mercadería).`;

export function registerProductosTools(server: McpServer): void {
  server.registerTool(
    "obtener_producto",
    {
      title: "Obtener producto",
      description: `Busca un producto puntual por código interno, código de barras o nombre, con sus precios y stock.
Indicar al menos uno de: codigo, codigoBarras o nombre.
- codigo y codigoBarras son búsquedas exactas e incluyen productos inactivos.
- nombre busca productos activos cuya descripción contenga todas las palabras; si hay varias
  coincidencias devuelve hasta 10 candidatos (primero la coincidencia exacta) para elegir.
${DESCRIPCION_PRODUCTO}`,
      inputSchema: {
        codigo: z.number().int().positive().optional().describe("Código interno del producto (idArticulo)"),
        codigoBarras: z
          .string()
          .min(1)
          .optional()
          .describe("Código de barras (EAN) o código de origen del proveedor"),
        nombre: z.string().min(2).optional().describe("Nombre o parte de la descripción, ej. 'taza ceramica'"),
      },
    },
    async ({ codigo, codigoBarras, nombre }) => {
      try {
        if (codigo === undefined && !codigoBarras && !nombre) {
          return errorResult(new Error("Indicá codigo, codigoBarras o nombre."));
        }

        const resultado =
          codigo !== undefined
            ? await buscarProductos({ codigos: [codigo], incluirInactivos: true, porPagina: 1 })
            : codigoBarras
              ? await buscarProductos({ codigoBarras, incluirInactivos: true, porPagina: 10 })
              : await buscarProductos({ texto: nombre, priorizarNombreExacto: nombre, porPagina: 10 });

        if (resultado.total === 0) {
          return jsonResult({ encontrado: false, mensaje: "No se encontró ningún producto con ese criterio." });
        }
        if (resultado.total === 1) {
          return jsonResult({ encontrado: true, producto: resultado.productos[0] });
        }
        return jsonResult({
          encontrado: true,
          coincidencias: resultado.total,
          mensaje:
            resultado.total > resultado.productos.length
              ? `Hay ${resultado.total} coincidencias; se muestran las ${resultado.productos.length} más cercanas. Refiná el nombre o usá el código.`
              : `Hay ${resultado.total} coincidencias.`,
          productos: resultado.productos,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "buscar_productos",
    {
      title: "Buscar productos",
      description: `Lista productos filtrados por categoría u otros valores, siempre con precios y stock. Paginado.
Categorías disponibles (se pueden combinar, por id o por nombre parcial):
- linea: agrupación general, ej. BAZAR, JUGUETERIA, MARROQUINERIA, NAVIDAD, ACCESORIOS ESCOLARES.
- rubro: agrupación interna más fina, ej. CARTERAS, BIJOUTERIE, GORROS, BILLETERAS.
- rubroWeb: categoría de la tienda online, ej. CARTERA DE DAMA, MOCHILAS CON LICENCIA (incluye subcategorías al filtrar por id).
Por defecto solo trae productos activos y ordena por descripción.
${DESCRIPCION_PRODUCTO}`,
      inputSchema: {
        texto: z.string().optional().describe("Palabras que deben aparecer en la descripción"),
        idLinea: z.number().int().optional(),
        linea: z.string().optional().describe("Nombre (o parte) de la línea"),
        idRubro: z.number().int().optional(),
        rubro: z.string().optional().describe("Nombre (o parte) del rubro"),
        idRubroWeb: z.number().int().optional(),
        rubroWeb: z.string().optional().describe("Nombre (o parte) de la categoría web"),
        idProveedor: z.number().int().optional(),
        proveedor: z.string().optional().describe("Nombre (o parte) del proveedor"),
        soloConStock: z.boolean().optional().describe("Solo productos con stock mayor a 0"),
        idSucursal: z
          .number()
          .int()
          .optional()
          .describe("Sucursal para filtrar/ordenar por stock: 1 = Pasteur, 2 = Muñiz. Sin valor = stock total"),
        idListaPrecio: z
          .number()
          .int()
          .optional()
          .describe("Lista para filtrar/ordenar por precio: 1 = A (default), 2 = B, 3 = C"),
        precioMin: z.number().nonnegative().optional(),
        precioMax: z.number().nonnegative().optional(),
        incluirInactivos: z.boolean().optional().describe("Incluir productos inactivos o inhabilitados"),
        orden: z.enum(["descripcion", "precio", "stock", "codigo"]).optional(),
        descendente: z.boolean().optional(),
        pagina: z.number().int().positive().optional().describe("Default 1"),
        porPagina: z.number().int().min(1).max(100).optional().describe("Default 20, máximo 100"),
      },
    },
    async (args) => {
      try {
        return jsonResult(await buscarProductos(args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
