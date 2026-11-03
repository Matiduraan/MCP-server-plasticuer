/**
 * API REST de Plasticuer.
 *
 *   GET /products?offset=0&limit=20&query=taza&include=stock,price
 *   GET /health
 *
 * Este módulo no importa nada de la base: recibe la función de datos por parámetro, así el
 * manejo HTTP se puede probar sin conexión.
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface Include {
  stock: boolean;
  price: boolean;
}

export interface ProductsQuery {
  offset: number;
  limit: number;
  query: string | null;
  include: Include;
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  barcodes: string[];
  /** Precio por lista de venta (A, B, C). null = sin precio cargado en esa lista. */
  price?: Record<string, number | null>;
  /** Stock total y por sucursal. Puede ser negativo. */
  stock?: {
    total: number;
    branches: { id: number; name: string; stock: number }[];
  };
}

export interface ProductsPage {
  data: Product[];
  pagination: { offset: number; limit: number; total: number };
}

export type ListProducts = (q: ProductsQuery) => Promise<ProductsPage>;

// ---------------------------------------------------------------------------
// Validación de query params
// ---------------------------------------------------------------------------

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_QUERY_LENGTH = 100;
const INCLUDE_VALUES = ["stock", "price"] as const;

export class BadRequest extends Error {}

function parseInteger(params: URLSearchParams, name: string, fallback: number, min: number, max?: number): number {
  const values = params.getAll(name);
  if (values.length > 1) throw new BadRequest(`'${name}' se indica una sola vez`);
  const raw = values[0]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new BadRequest(`'${name}' debe ser un número entero`);
  const value = Number(raw);
  if (value < min || (max !== undefined && value > max) || !Number.isSafeInteger(value)) {
    throw new BadRequest(max !== undefined ? `'${name}' debe estar entre ${min} y ${max}` : `'${name}' debe ser mayor o igual a ${min}`);
  }
  return value;
}

/** include=stock | include=price | include=stock,price | include=stock&include=price. Sin valor = ambos. */
function parseInclude(params: URLSearchParams): Include {
  const values = params
    .getAll("include")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!values.length) return { stock: true, price: true };

  const invalid = values.filter((v) => !(INCLUDE_VALUES as readonly string[]).includes(v));
  if (invalid.length) {
    throw new BadRequest(`'include' acepta ${INCLUDE_VALUES.join(", ")} (separados por coma); valor inválido: ${invalid.join(", ")}`);
  }
  return { stock: values.includes("stock"), price: values.includes("price") };
}

export function parseProductsQuery(params: URLSearchParams): ProductsQuery {
  const queries = params.getAll("query");
  if (queries.length > 1) throw new BadRequest("'query' se indica una sola vez");
  const search = (queries[0] ?? "").replace(/\s+/g, " ").trim();
  if (search.length > MAX_QUERY_LENGTH) throw new BadRequest(`'query' admite hasta ${MAX_QUERY_LENGTH} caracteres`);

  return {
    offset: parseInteger(params, "offset", 0, 0),
    limit: parseInteger(params, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT),
    query: search || null,
    include: parseInclude(params),
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface ApiOptions {
  listProducts: ListProducts;
  /** Token Bearer exigido en /products. Sin token no se exige autenticación. */
  authToken?: string;
  /** Valor de Access-Control-Allow-Origin (opcional). */
  corsOrigin?: string;
  log?: (line: string) => void;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}) {
  send(res, status, { error: { code, message } }, headers);
}

function isAuthorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(req.headers.authorization ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createApiHandler(options: ApiOptions) {
  const log = options.log ?? ((line: string) => console.log(line));
  const cors: Record<string, string> = options.corsOrigin
    ? {
        "Access-Control-Allow-Origin": options.corsOrigin,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        Vary: "Origin",
      }
    : {};

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    res.on("finish", () => log(`${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`));

    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);

    if (path === "/health") {
      return send(res, 200, { ok: true });
    }
    if (path !== "/products") {
      return sendError(res, 404, "not_found", "Recurso inexistente. Usar GET /products");
    }
    if (req.method === "OPTIONS" && options.corsOrigin) {
      res.writeHead(204);
      return void res.end();
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendError(res, 405, "method_not_allowed", "Solo se admite GET", { Allow: "GET" });
    }
    if (!isAuthorized(req, options.authToken)) {
      return sendError(res, 401, "unauthorized", "Falta el token o es inválido (Authorization: Bearer <token>)", {
        "WWW-Authenticate": "Bearer",
      });
    }

    let params: ProductsQuery;
    try {
      params = parseProductsQuery(url.searchParams);
    } catch (err) {
      if (err instanceof BadRequest) return sendError(res, 400, "bad_request", err.message);
      throw err;
    }

    try {
      const page = await options.listProducts(params);
      return send(res, 200, page);
    } catch (err) {
      console.error("[plasticuer-api] error consultando productos:", err);
      if (!res.headersSent) sendError(res, 500, "internal_error", "Error interno consultando la base");
    }
  };
}
