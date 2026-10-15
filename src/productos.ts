/**
 * Consultas de productos (tabla articulos) con precios y stock.
 *
 * Criterios relevados de la base (ver docs/schema.md y docs/exploracion.json):
 * - Stock: stocks_locales (idArticulo, idSucursal, stock) coincide con la suma de movimientos de
 *   la tabla stocks, así que se usa directamente. Puede ser negativo.
 * - Precios: articulos_precios por lista (precios_listas). Se exponen solo las listas de venta
 *   (puedefacturar = 1: A, B, C); la lista COSTO queda excluida. Precio 0 = sin precio (null).
 * - "Activo" = articulos.activo = 1 y no inhabilitado.
 * - SQL compatible con SQL Server 2008 (paginación con ROW_NUMBER, sin OFFSET/FETCH).
 */
import { query, sql, type Params } from "./db.js";

export type Orden = "descripcion" | "precio" | "stock" | "codigo";

export interface FiltrosProductos {
  /** Código interno exacto (idArticulo). */
  codigos?: number[];
  /** Código de barras exacto (cualquiera de los 3 campos) o código de origen. */
  codigoBarras?: string;
  /** Texto a buscar en la descripción: deben aparecer todas las palabras. */
  texto?: string;
  idLinea?: number;
  linea?: string;
  idRubro?: number;
  rubro?: string;
  /** Incluye las subcategorías directas (RubrosWebHijos). */
  idRubroWeb?: number;
  rubroWeb?: string;
  idProveedor?: number;
  proveedor?: string;
  /** Sucursal para el filtro y el orden por stock. Sin valor = stock total. */
  idSucursal?: number;
  soloConStock?: boolean;
  /** Lista usada para filtrar y ordenar por precio (default: la primera lista de venta, A). */
  idListaPrecio?: number;
  precioMin?: number;
  precioMax?: number;
  incluirInactivos?: boolean;
  orden?: Orden;
  descendente?: boolean;
  /** Prioriza coincidencias exactas de descripción (búsqueda por nombre). */
  priorizarNombreExacto?: string;
  pagina?: number;
  porPagina?: number;
}

export interface Producto {
  codigo: number;
  descripcion: string;
  descripcionWeb: string | null;
  codigosBarras: string[];
  codigoOrigen: string | null;
  activo: boolean;
  publicadoWeb: boolean;
  linea: { id: number; nombre: string } | null;
  rubro: { id: number; nombre: string } | null;
  rubroWeb: { id: number; nombre: string } | null;
  proveedor: { id: number; nombre: string } | null;
  unidad: string | null;
  contenido: number | null;
  packing: string | null;
  precios: Record<string, number | null>;
  stock: {
    total: number;
    porSucursal: { idSucursal: number; sucursal: string; stock: number }[];
  };
}

export interface PaginaProductos {
  total: number;
  pagina: number;
  porPagina: number;
  totalPaginas: number;
  productos: Producto[];
}

const ORDEN_SQL: Record<Orden, string> = {
  descripcion: "a.descripcion",
  precio: "pr.precio",
  stock: "ISNULL(st.stock, 0)",
  codigo: "a.idArticulo",
};

/** Escapa comodines de LIKE en SQL Server. */
function likeContains(value: string): string {
  return `%${value.replace(/[[\]%_]/g, (c) => `[${c}]`)}%`;
}

const varchar = (value: string) => ({ type: sql.VarChar(8000), value });

interface Listas {
  ventas: { idLista: number; descripcion: string }[];
}

let listasCache: { at: number; data: Listas } | null = null;

async function getListas(): Promise<Listas> {
  if (listasCache && Date.now() - listasCache.at < 10 * 60 * 1000) return listasCache.data;
  const ventas = await query<{ idLista: number; descripcion: string }>(
    `SELECT idLista, RTRIM(descripcion) AS descripcion
     FROM precios_listas WHERE puedefacturar = 1 ORDER BY orden, idLista`,
  );
  listasCache = { at: Date.now(), data: { ventas } };
  return listasCache.data;
}

export async function buscarProductos(f: FiltrosProductos): Promise<PaginaProductos> {
  const listas = await getListas();
  const listaRef = f.idListaPrecio ?? listas.ventas[0]?.idLista ?? 1;
  if (!listas.ventas.some((l) => l.idLista === listaRef)) {
    throw new Error(
      `Lista de precios inválida: ${listaRef}. Disponibles: ${listas.ventas
        .map((l) => `${l.idLista} (${l.descripcion})`)
        .join(", ")}`,
    );
  }

  const porPagina = Math.min(Math.max(f.porPagina ?? 20, 1), 100);
  const pagina = Math.max(f.pagina ?? 1, 1);
  const params: Params = {
    listaRef,
    desde: (pagina - 1) * porPagina + 1,
    hasta: pagina * porPagina,
  };
  const where: string[] = [];

  if (!f.incluirInactivos) where.push("a.activo = 1 AND ISNULL(a.inhabilitado, 0) = 0");

  if (f.codigos?.length) {
    const names = f.codigos.slice(0, 200).map((c, i) => {
      params[`cod${i}`] = c;
      return `@cod${i}`;
    });
    where.push(`a.idArticulo IN (${names.join(", ")})`);
  }

  if (f.codigoBarras) {
    const limpio = f.codigoBarras.trim();
    const conds = ["a.codigoorigen = @codOrigen"];
    params.codOrigen = varchar(limpio);
    if (/^\d{1,18}$/.test(limpio)) {
      params.codBarras = { type: sql.Float, value: Number(limpio) };
      conds.push("a.codbarras = @codBarras", "a.codbarras2 = @codBarras", "a.codbarras3 = @codBarras");
    }
    where.push(`(${conds.join(" OR ")})`);
  }

  if (f.texto) {
    const palabras = f.texto.trim().split(/\s+/).filter(Boolean).slice(0, 8);
    palabras.forEach((p, i) => {
      params[`txt${i}`] = varchar(likeContains(p));
      where.push(`(a.descripcion LIKE @txt${i} OR a.descripcionweb LIKE @txt${i})`);
    });
  }

  if (f.idLinea !== undefined) {
    params.idLinea = f.idLinea;
    where.push("a.idLinea = @idLinea");
  }
  if (f.linea) {
    params.linea = varchar(likeContains(f.linea.trim()));
    where.push("l.descripcion LIKE @linea");
  }
  if (f.idRubro !== undefined) {
    params.idRubro = f.idRubro;
    where.push("a.idRubro = @idRubro");
  }
  if (f.rubro) {
    params.rubro = varchar(likeContains(f.rubro.trim()));
    where.push("r.descripcion LIKE @rubro");
  }
  if (f.idRubroWeb !== undefined) {
    params.idRubroWeb = f.idRubroWeb;
    where.push(`(a.idRubroWeb = @idRubroWeb OR a.idRubroWeb IN
      (SELECT idRubroWebHijo FROM RubrosWebHijos WHERE idRubroWebPadre = @idRubroWeb))`);
  }
  if (f.rubroWeb) {
    params.rubroWeb = varchar(likeContains(f.rubroWeb.trim()));
    where.push("rw.Descripcion LIKE @rubroWeb");
  }
  if (f.idProveedor !== undefined) {
    params.idProveedor = f.idProveedor;
    where.push("a.idProveedor = @idProveedor");
  }
  if (f.proveedor) {
    params.proveedor = varchar(likeContains(f.proveedor.trim()));
    where.push("p.nombre LIKE @proveedor");
  }

  let stockFiltroSucursal = "";
  if (f.idSucursal !== undefined) {
    params.idSucursal = f.idSucursal;
    stockFiltroSucursal = "WHERE idSucursal = @idSucursal";
  }
  if (f.soloConStock) where.push("ISNULL(st.stock, 0) > 0");

  if (f.precioMin !== undefined || f.precioMax !== undefined) where.push("pr.precio > 0");
  if (f.precioMin !== undefined) {
    params.precioMin = { type: sql.Float, value: f.precioMin };
    where.push("pr.precio >= @precioMin");
  }
  if (f.precioMax !== undefined) {
    params.precioMax = { type: sql.Float, value: f.precioMax };
    where.push("pr.precio <= @precioMax");
  }

  const dir = f.descendente ? "DESC" : "ASC";
  const ordenes: string[] = [];
  if (f.priorizarNombreExacto) {
    params.nombreExacto = varchar(f.priorizarNombreExacto.trim());
    ordenes.push("CASE WHEN a.descripcion = @nombreExacto THEN 0 ELSE 1 END", "LEN(a.descripcion)");
  }
  ordenes.push(`${ORDEN_SQL[f.orden ?? "descripcion"]} ${dir}`, "a.idArticulo");

  const cte = `
    WITH base AS (
      SELECT a.idArticulo, a.descripcion, a.descripcionweb, a.codbarras, a.codbarras2, a.codbarras3,
             a.codigoorigen, a.activo, a.inhabilitado, a.nopublicarenweb, a.contenido, a.packing,
             a.idLinea, l.descripcion AS linea, a.idRubro, r.descripcion AS rubro,
             a.idRubroWeb, rw.Descripcion AS rubroWeb, a.idProveedor, p.nombre AS proveedor,
             u.descripcionamplia AS unidad,
             ROW_NUMBER() OVER (ORDER BY ${ordenes.join(", ")}) AS rn,
             COUNT(*) OVER () AS total
      FROM articulos a
      LEFT JOIN lineas l ON l.idLinea = a.idLinea
      LEFT JOIN rubros r ON r.idRubro = a.idRubro
      LEFT JOIN RubrosWeb rw ON rw.idRubroWeb = a.idRubroWeb
      LEFT JOIN provedor p ON p.idProveedor = a.idProveedor
      LEFT JOIN unidades u ON u.idUnidad = a.idUnidad
      LEFT JOIN (
        SELECT idArticulo, SUM(stock) AS stock FROM stocks_locales ${stockFiltroSucursal} GROUP BY idArticulo
      ) st ON st.idArticulo = a.idArticulo
      LEFT JOIN articulos_precios pr ON pr.idArticulo = a.idArticulo AND pr.idLista = @listaRef
      ${where.length ? `WHERE ${where.join("\n        AND ")}` : ""}
    )`;

  const rows = await query<Record<string, any>>(
    `${cte} SELECT * FROM base WHERE rn BETWEEN @desde AND @hasta ORDER BY rn`,
    params,
  );
  let total = rows.length ? Number(rows[0].total) : 0;
  if (!rows.length && pagina > 1) {
    // Página fuera de rango: se informa el total real igual.
    const [row] = await query<{ total: number | null }>(`${cte} SELECT MAX(total) AS total FROM base`, params);
    total = Number(row?.total ?? 0);
  }

  const productos = await enriquecer(rows, listas);
  return {
    total,
    pagina,
    porPagina,
    totalPaginas: Math.ceil(total / porPagina),
    productos,
  };
}

async function enriquecer(rows: Record<string, any>[], listas: Listas): Promise<Producto[]> {
  if (!rows.length) return [];

  const params: Params = {};
  const ids = rows.map((r, i) => {
    params[`id${i}`] = r.idArticulo;
    return `@id${i}`;
  });
  const listaIds = listas.ventas.map((l, i) => {
    params[`lista${i}`] = l.idLista;
    return `@lista${i}`;
  });

  const [precios, stocks] = await Promise.all([
    query<{ idArticulo: number; idLista: number; precio: number | null }>(
      `SELECT idArticulo, idLista, precio FROM articulos_precios
       WHERE idArticulo IN (${ids.join(", ")}) AND idLista IN (${listaIds.join(", ")})`,
      params,
    ),
    query<{ idArticulo: number; idSucursal: number; sucursal: string; stock: number }>(
      `SELECT sl.idArticulo, sl.idSucursal, RTRIM(s.descripcion) AS sucursal, sl.stock
       FROM stocks_locales sl JOIN sucursales s ON s.idSucursal = sl.idSucursal
       WHERE sl.idArticulo IN (${ids.join(", ")})
       ORDER BY sl.idArticulo, sl.idSucursal`,
      params,
    ),
  ]);

  const nombreLista = new Map(listas.ventas.map((l) => [l.idLista, l.descripcion]));
  const preciosPorArt = new Map<number, Record<string, number | null>>();
  for (const p of precios) {
    const m = preciosPorArt.get(p.idArticulo) ?? {};
    // Precio 0 = sin precio cargado en esa lista: se informa como null para no cotizar $0.
    m[nombreLista.get(p.idLista) ?? String(p.idLista)] =
      p.precio === null || p.precio <= 0 ? null : Math.round(p.precio * 100) / 100;
    preciosPorArt.set(p.idArticulo, m);
  }
  const stockPorArt = new Map<number, Producto["stock"]["porSucursal"]>();
  for (const s of stocks) {
    const list = stockPorArt.get(s.idArticulo) ?? [];
    list.push({ idSucursal: s.idSucursal, sucursal: s.sucursal, stock: s.stock });
    stockPorArt.set(s.idArticulo, list);
  }

  const ref = (id: unknown, nombre: unknown) =>
    id !== null && id !== undefined && Number(id) !== 0 && nombre
      ? { id: Number(id), nombre: String(nombre).trim() }
      : null;
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  return rows.map((r) => {
    const porSucursal = stockPorArt.get(r.idArticulo) ?? [];
    const precios: Record<string, number | null> = {};
    for (const l of listas.ventas) precios[l.descripcion] = preciosPorArt.get(r.idArticulo)?.[l.descripcion] ?? null;
    return {
      codigo: r.idArticulo,
      descripcion: String(r.descripcion ?? "").trim(),
      descripcionWeb: texto(r.descripcionweb),
      codigosBarras: [r.codbarras, r.codbarras2, r.codbarras3]
        .filter((c) => c !== null && c !== undefined && Number(c) !== 0)
        .map((c) => BigInt(Math.round(Number(c))).toString()),
      codigoOrigen: texto(r.codigoorigen),
      activo: Boolean(r.activo) && !r.inhabilitado,
      publicadoWeb: !r.nopublicarenweb,
      linea: ref(r.idLinea, r.linea),
      rubro: ref(r.idRubro, r.rubro),
      rubroWeb: ref(r.idRubroWeb, r.rubroWeb),
      proveedor: ref(r.idProveedor, r.proveedor),
      unidad: texto(r.unidad),
      contenido: r.contenido ? Number(r.contenido) : null,
      packing: texto(r.packing),
      precios,
      stock: {
        total: porSucursal.reduce((acc, s) => acc + s.stock, 0),
        porSucursal,
      },
    };
  });
}
