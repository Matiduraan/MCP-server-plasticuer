/**
 * Tests del manejo HTTP y la validación de parámetros, sin base de datos.
 * Uso: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApiHandler, type ProductsQuery } from "../src/api.ts";

let lastQuery: ProductsQuery | null = null;

async function start(opts: { authToken?: string; fail?: boolean } = {}): Promise<{ server: Server; base: string }> {
  const handler = createApiHandler({
    authToken: opts.authToken,
    log: () => undefined,
    listProducts: async (q) => {
      lastQuery = q;
      if (opts.fail) throw new Error("db caída");
      return {
        data: [
          {
            id: 1,
            name: "TAZA CERAMICA",
            description: null,
            barcodes: ["779000000001"],
            ...(q.include.price ? { price: { A: 100, B: 120, C: null } } : {}),
            ...(q.include.stock ? { stock: { total: 3, branches: [{ id: 1, name: "Pasteur", stock: 3 }] } } : {}),
          },
        ],
        pagination: { offset: q.offset, limit: q.limit, total: 1 },
      };
    },
  });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function get(base: string, path: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: (await res.json()) as any };
}

test("defaults: offset 0, limit 20, sin query, incluye stock y price", async () => {
  const { server, base } = await start();
  const { status, body } = await get(base, "/products");
  assert.equal(status, 200);
  assert.deepEqual(lastQuery, { offset: 0, limit: 20, query: null, include: { stock: true, price: true } });
  assert.ok(body.data[0].price && body.data[0].stock);
  assert.deepEqual(body.pagination, { offset: 0, limit: 20, total: 1 });
  server.close();
});

test("offset, limit y query se parsean", async () => {
  const { server, base } = await start();
  const { status } = await get(base, "/products?offset=40&limit=50&query=%20taza%20%20ceramica%20");
  assert.equal(status, 200);
  assert.equal(lastQuery?.offset, 40);
  assert.equal(lastQuery?.limit, 50);
  assert.equal(lastQuery?.query, "taza ceramica");
  server.close();
});

test("include: solo stock, solo price, lista con coma y parámetro repetido", async () => {
  const { server, base } = await start();
  let r = await get(base, "/products?include=stock");
  assert.deepEqual(lastQuery?.include, { stock: true, price: false });
  assert.equal(r.body.data[0].price, undefined);
  assert.ok(r.body.data[0].stock);

  r = await get(base, "/products?include=PRICE");
  assert.deepEqual(lastQuery?.include, { stock: false, price: true });
  assert.equal(r.body.data[0].stock, undefined);

  await get(base, "/products?include=stock,price");
  assert.deepEqual(lastQuery?.include, { stock: true, price: true });
  await get(base, "/products?include=stock&include=price");
  assert.deepEqual(lastQuery?.include, { stock: true, price: true });
  await get(base, "/products?include=");
  assert.deepEqual(lastQuery?.include, { stock: true, price: true });
  server.close();
});

test("validaciones devuelven 400", async () => {
  const { server, base } = await start();
  for (const qs of [
    "limit=51",
    "limit=0",
    "limit=abc",
    "offset=-1",
    "offset=1.5",
    "include=precio",
    "query=a&query=b",
    `query=${"x".repeat(101)}`,
  ]) {
    const { status, body } = await get(base, `/products?${qs}`);
    assert.equal(status, 400, qs);
    assert.equal(body.error.code, "bad_request", qs);
  }
  server.close();
});

test("auth Bearer cuando hay token", async () => {
  const { server, base } = await start({ authToken: "secreto" });
  assert.equal((await get(base, "/products")).status, 401);
  assert.equal((await get(base, "/products", { Authorization: "Bearer otro" })).status, 401);
  assert.equal((await get(base, "/products", { Authorization: "Bearer secreto" })).status, 200);
  assert.equal((await get(base, "/health")).status, 200, "health no exige token");
  server.close();
});

test("rutas y métodos", async () => {
  const { server, base } = await start();
  assert.equal((await get(base, "/products/")).status, 200);
  assert.equal((await get(base, "/otra")).status, 404);
  const res = await fetch(base + "/products", { method: "POST" });
  assert.equal(res.status, 405);
  server.close();
});

test("error de base devuelve 500 sin detalles internos", async () => {
  const { server, base } = await start({ fail: true });
  const origError = console.error;
  console.error = () => undefined;
  const { status, body } = await get(base, "/products");
  console.error = origError;
  assert.equal(status, 500);
  assert.equal(body.error.code, "internal_error");
  assert.ok(!JSON.stringify(body).includes("db caída"));
  server.close();
});
