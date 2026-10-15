/**
 * Prueba los métodos de productos contra la base real (solo lectura).
 * Guarda los resultados en docs/prueba-productos.json.
 *
 * Uso: npm run probar
 */
import { mkdir, writeFile } from "node:fs/promises";
import { closePool } from "../src/db.js";
import { buscarProductos, type FiltrosProductos } from "../src/productos.js";

const casos: Record<string, FiltrosProductos> = {
  porCodigo: { codigos: [304483], incluirInactivos: true, porPagina: 1 },
  porCodigoBarras: { codigoBarras: "6948013100062", incluirInactivos: true, porPagina: 10 },
  porNombre: { texto: "taza ceramica", priorizarNombreExacto: "taza ceramica", porPagina: 10 },
  porNombreConComodin: { texto: "100%", porPagina: 3 },
  lineaJugueteriaConStock: { linea: "jugueteria", soloConStock: true, orden: "stock", descendente: true, porPagina: 5 },
  rubroWebPorId: { idRubroWeb: 17000007, porPagina: 5 },
  rubroWebPorNombre: { rubroWeb: "mochilas", porPagina: 5 },
  rangoPrecioListaB: { idListaPrecio: 2, precioMin: 5000, precioMax: 10000, orden: "precio", porPagina: 5 },
  stockMuniz: { idSucursal: 2, soloConStock: true, orden: "stock", descendente: true, porPagina: 5 },
  paginaFueraDeRango: { linea: "navidad", pagina: 9999, porPagina: 50 },
  sinResultados: { texto: "zzzz-no-existe-zzzz" },
};

async function main() {
  const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  for (const [nombre, filtros] of Object.entries(casos)) {
    const start = Date.now();
    try {
      const r = await buscarProductos(filtros);
      out[nombre] = { ms: Date.now() - start, ...r };
      console.error(`  ✓ ${nombre}: ${r.total} resultados (${Date.now() - start} ms)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out[nombre] = { error: message };
      console.error(`  ⚠ ${nombre}: ${message}`);
    }
  }
  await mkdir("docs", { recursive: true });
  await writeFile("docs/prueba-productos.json", JSON.stringify(out, null, 2), "utf8");
  console.error("Generado docs/prueba-productos.json");
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
