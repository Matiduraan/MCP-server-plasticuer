import "dotenv/config";
import type { config as SqlConfig } from "mssql";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "si"].includes(value.toLowerCase());
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadSqlConfig(): SqlConfig {
  const instanceName = process.env.DB_INSTANCE || undefined;

  return {
    server: required("DB_SERVER"),
    // Con instancia con nombre, SQL Browser resuelve el puerto; si no, se usa DB_PORT.
    port: instanceName ? undefined : int("DB_PORT", 1433),
    database: required("DB_NAME"),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    connectionTimeout: int("DB_CONNECTION_TIMEOUT", 15000),
    requestTimeout: int("DB_REQUEST_TIMEOUT", 30000),
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    options: {
      encrypt: bool("DB_ENCRYPT", true),
      trustServerCertificate: bool("DB_TRUST_SERVER_CERTIFICATE", true),
      instanceName,
      enableArithAbort: true,
    },
  };
}
