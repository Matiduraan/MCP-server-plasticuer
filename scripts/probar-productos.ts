/**
 * Prueba la consulta de productos contra la base real (solo lectura).
 * Guarda los resultados en docs/prueba-productos.json.
 *
 * Uso: npm run probar
 */
import { mkdir, writeFile } from "node:fs/promises";
import type { ProductsQuery } from "../src/api.js";
import { closePool } from "../src/db.js";
import { listProducts } from "../src/productos.js";

const both = { stock: true, price: true };

const casos: Record<string, ProductsQuery> = {
  sinQuery: { offset: 0, limit: 5, query: null, include: both },
  porNombre: { offset: 0, limit: 10, query: "taza ceramica", include: both },
  segundaPagina: { offset: 10, limit: 10, query: "taza ceramica", include: both },
  soloStock: { offset: 0, limit: 5, query: "mochila", include: { stock: true, price: false } },
  soloPrecio: { offset: 0, limit: 5, query: "mochila", include: { stock: false, price: true } },
  conComodin: { offset: 0, limit: 5, query: "100%", include: both },
  limiteMaximo: { offset: 0, limit: 50, query: "cartera", include: both },
  offsetFueraDeRango: { offset: 100000, limit: 20, query: "navidad", include: both },
  sinResultados: { offset: 0, limit: 20, query: "zzzz-no-existe-zzzz", include: both },
};

async function main() {
  const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  for (const [nombre, q] of Object.entries(casos)) {
    const start = Date.now();
    try {
      const r = await listProducts(q);
      out[nombre] = { ms: Date.now() - start, ...r };
      console.error(`  ✓ ${nombre}: ${r.data.length} de ${r.pagination.total} (${Date.now() - start} ms)`);
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
