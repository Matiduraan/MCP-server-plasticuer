/**
 * Consulta de productos (tabla articulos) con precios y stock.
 *
 * Criterios relevados de la base (ver docs/schema.md):
 * - Solo productos activos: articulos.activo = 1 y no inhabilitado.
 * - Stock: stocks_locales (idArticulo, idSucursal, stock); coincide con la suma de movimientos
 *   de la tabla stocks. Puede ser negativo.
 * - Precios: articulos_precios de las listas de venta (precios_listas.puedefacturar = 1: A, B, C).
 *   La lista COSTO no se expone. Precio 0 = sin precio cargado (null).
 * - SQL compatible con SQL Server 2008: paginación con ROW_NUMBER, sin OFFSET/FETCH.
 */
import { query, sql, type Params } from "./db.js";
import type { ListProducts, Product, ProductsPage } from "./api.js";

const MAX_WORDS = 8;

/** Escapa los comodines de LIKE de SQL Server. */
function escapeLike(value: string): string {
  return value.replace(/[[\]%_]/g, (c) => `[${c}]`);
}

const varchar = (value: string) => ({ type: sql.VarChar(8000), value });

interface PriceList {
  idLista: number;
  name: string;
}

let priceListsCache: { at: number; lists: PriceList[] } | null = null;

async function getPriceLists(): Promise<PriceList[]> {
  if (priceListsCache && Date.now() - priceListsCache.at < 10 * 60 * 1000) return priceListsCache.lists;
  const lists = await query<PriceList>(
    `SELECT idLista, RTRIM(descripcion) AS name
     FROM precios_listas WHERE puedefacturar = 1 ORDER BY orden, idLista`,
  );
  priceListsCache = { at: Date.now(), lists };
  return lists;
}

export const listProducts: ListProducts = async ({ offset, limit, query: search, include }) => {
  const params: Params = { desde: offset + 1, hasta: offset + limit };
  const where = ["a.activo = 1", "ISNULL(a.inhabilitado, 0) = 0"];
  const order: string[] = [];

  if (search) {
    // Cada palabra tiene que aparecer en el nombre o en la descripción web.
    const words = search.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
    words.forEach((word, i) => {
      params[`w${i}`] = varchar(`%${escapeLike(word)}%`);
      where.push(`(a.descripcion LIKE @w${i} OR a.descripcionweb LIKE @w${i})`);
    });
    // Primero la coincidencia exacta del nombre, después los que empiezan con el texto.
    params.exact = varchar(search);
    params.prefix = varchar(`${escapeLike(search)}%`);
    order.push("CASE WHEN a.descripcion = @exact THEN 0 WHEN a.descripcion LIKE @prefix THEN 1 ELSE 2 END");
  }
  order.push("a.descripcion", "a.idArticulo");

  const cte = `
    WITH base AS (
      SELECT a.idArticulo, a.descripcion, a.descripcionweb, a.codbarras, a.codbarras2, a.codbarras3,
             ROW_NUMBER() OVER (ORDER BY ${order.join(", ")}) AS rn,
             COUNT(*) OVER () AS total
      FROM articulos a
      WHERE ${where.join("\n        AND ")}
    )`;

  const rows = await query<Record<string, any>>(
    `${cte} SELECT * FROM base WHERE rn BETWEEN @desde AND @hasta ORDER BY rn`,
    params,
  );

  let total = rows.length ? Number(rows[0].total) : 0;
  if (!rows.length && offset > 0) {
    // Offset más allá del final: se informa el total real igual.
    const [row] = await query<{ total: number | null }>(`${cte} SELECT MAX(total) AS total FROM base`, params);
    total = Number(row?.total ?? 0);
  }

  const ids = rows.map((r) => Number(r.idArticulo));
  const [prices, stock] = await Promise.all([
    include.price ? getPrices(ids) : Promise.resolve(null),
    include.stock ? getStock(ids) : Promise.resolve(null),
  ]);

  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  const data: Product[] = rows.map((r) => {
    const id = Number(r.idArticulo);
    const product: Product = {
      id,
      name: String(r.descripcion ?? "").trim(),
      description: text(r.descripcionweb),
      barcodes: [r.codbarras, r.codbarras2, r.codbarras3]
        .filter((c) => c !== null && c !== undefined && Number(c) !== 0)
        .map((c) => BigInt(Math.round(Number(c))).toString()),
    };
    if (prices) product.price = prices.get(id) ?? prices.empty();
    if (stock) product.stock = stock.get(id) ?? { total: 0, branches: [] };
    return product;
  });

  return { data, pagination: { offset, limit, total } } satisfies ProductsPage;
};

function inList(ids: number[], params: Params): string {
  return ids
    .map((id, i) => {
      params[`id${i}`] = id;
      return `@id${i}`;
    })
    .join(", ");
}

async function getPrices(ids: number[]) {
  const lists = await getPriceLists();
  const empty = () => Object.fromEntries(lists.map((l) => [l.name, null])) as Record<string, number | null>;
  const byId = new Map<number, Record<string, number | null>>();
  const result = { get: (id: number) => byId.get(id), empty };
  if (!ids.length || !lists.length) return result;

  const params: Params = {};
  const idList = inList(ids, params);
  const listIds = lists
    .map((l, i) => {
      params[`lista${i}`] = l.idLista;
      return `@lista${i}`;
    })
    .join(", ");
  const rows = await query<{ idArticulo: number; idLista: number; precio: number | null }>(
    `SELECT idArticulo, idLista, precio FROM articulos_precios
     WHERE idArticulo IN (${idList}) AND idLista IN (${listIds})`,
    params,
  );

  const listName = new Map(lists.map((l) => [l.idLista, l.name]));
  for (const r of rows) {
    const prices = byId.get(r.idArticulo) ?? empty();
    prices[listName.get(r.idLista) ?? String(r.idLista)] =
      r.precio === null || r.precio <= 0 ? null : Math.round(r.precio * 100) / 100;
    byId.set(r.idArticulo, prices);
  }
  return result;
}

async function getStock(ids: number[]) {
  const byId = new Map<number, NonNullable<Product["stock"]>>();
  if (!ids.length) return byId;

  const params: Params = {};
  const rows = await query<{ idArticulo: number; idSucursal: number; sucursal: string; stock: number }>(
    `SELECT sl.idArticulo, sl.idSucursal, RTRIM(s.descripcion) AS sucursal, sl.stock
     FROM stocks_locales sl JOIN sucursales s ON s.idSucursal = sl.idSucursal
     WHERE sl.idArticulo IN (${inList(ids, params)})
     ORDER BY sl.idArticulo, sl.idSucursal`,
    params,
  );
  for (const r of rows) {
    const entry = byId.get(r.idArticulo) ?? { total: 0, branches: [] };
    entry.branches.push({ id: r.idSucursal, name: r.sucursal, stock: r.stock });
    entry.total += r.stock;
    byId.set(r.idArticulo, entry);
  }
  return byId;
}

