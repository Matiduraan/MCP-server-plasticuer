/**
 * Exploración de datos (solo lectura) para definir cómo calcular stock y precios.
 * Guarda los resultados en docs/exploracion.json.
 *
 * Uso: npx tsx scripts/explore-stock-precios.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { query, closePool } from "../src/db.js";

const SAMPLE_CTE = `
  WITH muestra AS (
    SELECT TOP 20 idArticulo
    FROM stocks
    WHERE fechaf >= DATEADD(day, -30, GETDATE())
    GROUP BY idArticulo
    ORDER BY COUNT(*) DESC
  )`;

const queries: Record<string, string> = {
  listas: `SELECT * FROM precios_listas ORDER BY idLista`,
  escalas: `SELECT * FROM precios_listas_escalas`,
  sucursales: `SELECT idSucursal, descripcion, habilitado, ingresoencajas FROM sucursales`,
  tipofac: `SELECT idTipofac, descripcion, descripcionamplia, TipoComprobante, signo FROM tipofac ORDER BY idTipofac`,
  lineas: `SELECT idLinea, descripcion FROM lineas ORDER BY idLinea`,
  unidades: `SELECT idUnidad, descripcion, descripcionamplia FROM unidades`,

  rubrosTop: `
    SELECT TOP 25 r.idRubro, r.descripcion, COUNT(*) AS articulos,
           SUM(CASE WHEN a.activo = 1 THEN 1 ELSE 0 END) AS activos
    FROM articulos a JOIN rubros r ON r.idRubro = a.idRubro
    GROUP BY r.idRubro, r.descripcion ORDER BY COUNT(*) DESC`,
  rubrosWebTop: `
    SELECT TOP 25 rw.idRubroWeb, rw.Descripcion, rw.activo, rw.publica, COUNT(*) AS articulos
    FROM articulos a JOIN RubrosWeb rw ON rw.idRubroWeb = a.idRubroWeb
    GROUP BY rw.idRubroWeb, rw.Descripcion, rw.activo, rw.publica ORDER BY COUNT(*) DESC`,
  rubrosWebVsArticulosWeb: `
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN a.idRubroWeb = aw.idRubroWeb THEN 1 ELSE 0 END) AS coinciden,
           SUM(CASE WHEN a.idRubroWeb IS NULL THEN 1 ELSE 0 END) AS articuloSinRubroWeb
    FROM articulosweb aw JOIN articulos a ON a.idArticulo = aw.idArticulo`,

  articulosStats: `
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN activo = 1 THEN 1 ELSE 0 END) AS activos,
           SUM(CASE WHEN inhabilitado = 1 THEN 1 ELSE 0 END) AS inhabilitados,
           SUM(CASE WHEN activo = 1 AND ISNULL(inhabilitado,0) = 0 THEN 1 ELSE 0 END) AS activosHabilitados,
           SUM(CASE WHEN catalogo = 1 THEN 1 ELSE 0 END) AS enCatalogo,
           SUM(CASE WHEN nopublicarenweb = 1 THEN 1 ELSE 0 END) AS noPublicarWeb,
           SUM(CASE WHEN facturable = 1 THEN 1 ELSE 0 END) AS facturables,
           SUM(CASE WHEN codigoorigen IS NOT NULL AND codigoorigen <> '' THEN 1 ELSE 0 END) AS conCodigoOrigen,
           COUNT(DISTINCT codigoorigen) AS codigoOrigenDistintos,
           SUM(CASE WHEN codbarras IS NOT NULL AND codbarras <> 0 THEN 1 ELSE 0 END) AS conCodBarras,
           SUM(CASE WHEN descripcionweb IS NOT NULL AND descripcionweb <> '' THEN 1 ELSE 0 END) AS conDescripcionWeb
    FROM articulos`,
  articulosMuestra: `
    SELECT TOP 15 idArticulo, descripcion, descripcionweb, codigoorigen, codbarras, activo, inhabilitado,
           catalogo, nopublicarenweb, idLinea, idRubro, idRubroWeb, idUnidad, contenido, packing, idTablaColor
    FROM articulos WHERE activo = 1 ORDER BY idArticulo DESC`,

  stocksLocalesStats: `
    SELECT idSucursal, COUNT(*) AS filas,
           SUM(CASE WHEN stock > 0 THEN 1 ELSE 0 END) AS conStockPositivo,
           SUM(CASE WHEN stock < 0 THEN 1 ELSE 0 END) AS conStockNegativo,
           MIN(stock) AS minimo, MAX(stock) AS maximo, SUM(CAST(stock AS bigint)) AS total
    FROM stocks_locales GROUP BY idSucursal`,

  stocksFormasUltimos3Meses: `
    SELECT s.forma, s.idTipofac, t.descripcion AS tipofac, t.signo, COUNT(*) AS movimientos,
           SUM(CASE WHEN s.cantd < 0 THEN 1 ELSE 0 END) AS negativos,
           SUM(CASE WHEN s.cantd > 0 THEN 1 ELSE 0 END) AS positivos
    FROM stocks s LEFT JOIN tipofac t ON t.idTipofac = s.idTipofac
    WHERE s.fechaf >= DATEADD(month, -3, GETDATE())
    GROUP BY s.forma, s.idTipofac, t.descripcion, t.signo
    ORDER BY COUNT(*) DESC`,
  stocksUltimosMovimientos: `
    SELECT TOP 30 s.*, t.descripcion AS tipofac, t.signo
    FROM stocks s LEFT JOIN tipofac t ON t.idTipofac = s.idTipofac
    ORDER BY s.idStocks DESC`,

  comparacionStock: `${SAMPLE_CTE}
    SELECT m.idArticulo, a.descripcion, su.idSucursal,
           sl.stock AS stocksLocales,
           (SELECT SUM(s.cantd) FROM stocks s
             WHERE s.idArticulo = m.idArticulo AND s.idSucursal = su.idSucursal) AS sumaMovimientos,
           (SELECT SUM(s.cantd * ISNULL(t.signo, 1)) FROM stocks s LEFT JOIN tipofac t ON t.idTipofac = s.idTipofac
             WHERE s.idArticulo = m.idArticulo AND s.idSucursal = su.idSucursal) AS sumaMovimientosConSigno
    FROM muestra m
    JOIN articulos a ON a.idArticulo = m.idArticulo
    CROSS JOIN sucursales su
    LEFT JOIN stocks_locales sl ON sl.idArticulo = m.idArticulo AND sl.idSucursal = su.idSucursal
    ORDER BY m.idArticulo, su.idSucursal`,
  comparacionStockTotales: `${SAMPLE_CTE}
    SELECT m.idArticulo,
           (SELECT SUM(stock) FROM stocks_locales sl WHERE sl.idArticulo = m.idArticulo) AS stocksLocales,
           (SELECT SUM(cantd) FROM stocks s WHERE s.idArticulo = m.idArticulo) AS sumaMovimientos,
           (SELECT SUM(stockactual) FROM articulos_embarques e WHERE e.idArticulo = m.idArticulo) AS embarquesStockActual,
           (SELECT MAX(stock) FROM articulosstockiniciales v WHERE v.idarticulo = m.idArticulo) AS vistaStockIniciales
    FROM muestra m ORDER BY m.idArticulo`,

  preciosPorLista: `
    SELECT p.idLista, l.descripcion, COUNT(*) AS articulos, MIN(p.precio) AS minimo, MAX(p.precio) AS maximo,
           MAX(p.fechahora) AS ultimaActualizacion
    FROM articulos_precios p JOIN precios_listas l ON l.idLista = p.idLista
    GROUP BY p.idLista, l.descripcion ORDER BY p.idLista`,
  preciosMuestra: `${SAMPLE_CTE}
    SELECT p.idArticulo, p.idLista, p.precio, p.fechahora
    FROM articulos_precios p JOIN muestra m ON m.idArticulo = p.idArticulo
    ORDER BY p.idArticulo, p.idLista`,
  vistaExportarMuestra: `${SAMPLE_CTE}
    SELECT v.idArticulo, v.descripcion, v.precio, v.despacho
    FROM vwExportarArticulos v JOIN muestra m ON m.idArticulo = v.idArticulo`,
  articulosSinPrecio: `
    SELECT COUNT(*) AS activosSinPrecio FROM articulos a
    WHERE a.activo = 1 AND NOT EXISTS (SELECT 1 FROM articulos_precios p WHERE p.idArticulo = a.idArticulo)`,
};

async function main() {
  const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  for (const [name, text] of Object.entries(queries)) {
    const start = Date.now();
    try {
      out[name] = await query(text);
      console.error(`  ✓ ${name} (${Date.now() - start} ms)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out[name] = { error: message };
      console.error(`  ⚠ ${name}: ${message}`);
    }
  }
  await mkdir("docs", { recursive: true });
  await writeFile("docs/exploracion.json", JSON.stringify(out, null, 2), "utf8");
  console.error("Generado docs/exploracion.json");
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
