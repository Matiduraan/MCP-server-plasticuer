import sql from "mssql";
import { loadSqlConfig } from "./config.js";

let poolPromise: Promise<sql.ConnectionPool> | null = null;

/** Pool compartido, creado al primer uso. Si la conexión falla, se reintenta en la próxima llamada. */
export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(loadSqlConfig());
    pool.on("error", (err) => {
      console.error("[db] error en el pool:", err);
    });
    poolPromise = pool.connect().catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

/** Parámetro con tipo explícito (por ejemplo VarChar, para no forzar conversiones sobre columnas varchar). */
export interface TypedParam {
  type: sql.ISqlTypeFactoryWithNoParams | sql.ISqlType;
  value: unknown;
}

export type Params = Record<string, unknown | TypedParam>;

function isTyped(value: unknown): value is TypedParam {
  return typeof value === "object" && value !== null && "type" in value && "value" in value;
}

function bind(request: sql.Request, params: Params) {
  for (const [name, value] of Object.entries(params)) {
    if (isTyped(value)) request.input(name, value.type, value.value);
    else request.input(name, value);
  }
}

/**
 * Ejecuta una consulta parametrizada. Los parámetros se referencian como @nombre en el SQL.
 * Nunca concatenar valores del usuario en el texto de la consulta.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: Params = {},
): Promise<T[]> {
  const pool = await getPool();
  const request = pool.request();
  bind(request, params);
  const result = await request.query<T>(text);
  return result.recordset ?? [];
}

/** Ejecuta un stored procedure con parámetros de entrada. */
export async function execProcedure<T = Record<string, unknown>>(
  name: string,
  params: Params = {},
): Promise<T[]> {
  const pool = await getPool();
  const request = pool.request();
  bind(request, params);
  const result = await request.execute<T>(name);
  return result.recordset ?? [];
}

export async function closePool(): Promise<void> {
  if (poolPromise) {
    const pool = await poolPromise.catch(() => null);
    poolPromise = null;
    await pool?.close();
  }
}

export { sql };
