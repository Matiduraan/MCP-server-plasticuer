/**
 * Releva el schema de la base y lo guarda en:
 *   docs/schema.json  (completo, para procesar)
 *   docs/schema.md    (legible)
 *
 * Uso: npm run introspect
 */
import { mkdir, writeFile } from "node:fs/promises";
import { query, closePool } from "../src/db.js";

type Row = Record<string, any>;

async function main() {
  console.error("Conectando y relevando schema...");

  const [info] = await query(
    `SELECT @@SERVERNAME AS server, DB_NAME() AS [database],
            SERVERPROPERTY('ProductVersion') AS productVersion,
            SERVERPROPERTY('Edition') AS edition,
            DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS collation`,
  );

  const tables = await query(`
    SELECT s.name AS [schema], t.name AS [table],
           SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END) AS [rows],
           CAST(ep.value AS nvarchar(4000)) AS description
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    LEFT JOIN sys.partitions p ON p.object_id = t.object_id
    LEFT JOIN sys.extended_properties ep
      ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
    WHERE t.is_ms_shipped = 0
    GROUP BY s.name, t.name, CAST(ep.value AS nvarchar(4000))
    ORDER BY s.name, t.name`);

  const columns = await query(`
    SELECT s.name AS [schema], o.name AS [table], c.column_id AS position, c.name AS [column],
           ty.name AS type, c.max_length AS maxLength, c.precision, c.scale,
           c.is_nullable AS nullable, c.is_identity AS isIdentity, c.is_computed AS isComputed,
           dc.definition AS [default],
           CAST(ep.value AS nvarchar(4000)) AS description
    FROM sys.columns c
    JOIN sys.objects o ON o.object_id = c.object_id AND o.type IN ('U','V')
    JOIN sys.schemas s ON s.schema_id = o.schema_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
    LEFT JOIN sys.extended_properties ep
      ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
    WHERE o.is_ms_shipped = 0
    ORDER BY s.name, o.name, c.column_id`);

  const primaryKeys = await query(`
    SELECT s.name AS [schema], t.name AS [table], kc.name AS constraintName,
           c.name AS [column], ic.key_ordinal AS ordinal
    FROM sys.key_constraints kc
    JOIN sys.tables t ON t.object_id = kc.parent_object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE kc.type = 'PK'
    ORDER BY s.name, t.name, ic.key_ordinal`);

  const foreignKeys = await query(`
    SELECT fk.name AS constraintName,
           ps.name AS [schema], pt.name AS [table], pc.name AS [column],
           rs.name AS refSchema, rt.name AS refTable, rc.name AS refColumn,
           fk.delete_referential_action_desc AS onDelete,
           fk.update_referential_action_desc AS onUpdate
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id
    JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
    JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
    JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
    JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
    JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
    ORDER BY ps.name, pt.name, fk.name, fkc.constraint_column_id`);

  const indexes = await query(`
    SELECT s.name AS [schema], t.name AS [table], i.name AS indexName, i.type_desc AS type,
           i.is_unique AS isUnique, i.is_primary_key AS isPrimaryKey,
           STRING_AGG(CASE WHEN ic.is_included_column = 0 THEN c.name END, ', ')
             WITHIN GROUP (ORDER BY ic.key_ordinal) AS keyColumns,
           STRING_AGG(CASE WHEN ic.is_included_column = 1 THEN c.name END, ', ') AS includedColumns
    FROM sys.indexes i
    JOIN sys.tables t ON t.object_id = i.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.type > 0 AND t.is_ms_shipped = 0
    GROUP BY s.name, t.name, i.name, i.type_desc, i.is_unique, i.is_primary_key
    ORDER BY s.name, t.name, i.name`);

  const views = await query(`
    SELECT s.name AS [schema], v.name AS [view], m.definition
    FROM sys.views v
    JOIN sys.schemas s ON s.schema_id = v.schema_id
    LEFT JOIN sys.sql_modules m ON m.object_id = v.object_id
    WHERE v.is_ms_shipped = 0
    ORDER BY s.name, v.name`);

  const routines = await query(`
    SELECT s.name AS [schema], o.name AS name, o.type_desc AS type, o.modify_date AS modified,
           m.definition
    FROM sys.objects o
    JOIN sys.schemas s ON s.schema_id = o.schema_id
    LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
    WHERE o.type IN ('P','FN','IF','TF') AND o.is_ms_shipped = 0
    ORDER BY o.type_desc, s.name, o.name`);

  const routineParams = await query(`
    SELECT s.name AS [schema], o.name AS routine, p.parameter_id AS position, p.name AS param,
           ty.name AS type, p.max_length AS maxLength, p.is_output AS isOutput
    FROM sys.parameters p
    JOIN sys.objects o ON o.object_id = p.object_id AND o.type IN ('P','FN','IF','TF')
    JOIN sys.schemas s ON s.schema_id = o.schema_id
    JOIN sys.types ty ON ty.user_type_id = p.user_type_id
    WHERE o.is_ms_shipped = 0 AND p.parameter_id > 0
    ORDER BY s.name, o.name, p.parameter_id`);

  const triggers = await query(`
    SELECT s.name AS [schema], t.name AS [table], tr.name AS [trigger],
           tr.is_disabled AS isDisabled, tr.is_instead_of_trigger AS isInsteadOf
    FROM sys.triggers tr
    JOIN sys.tables t ON t.object_id = tr.parent_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    ORDER BY s.name, t.name, tr.name`);

  const permissions = await query(`
    SELECT ISNULL(OBJECT_SCHEMA_NAME(major_id) + '.' + OBJECT_NAME(major_id), class_desc) AS securable,
           permission_name AS permission, state_desc AS state
    FROM sys.database_permissions
    WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID()
    UNION ALL
    SELECT 'ROLE', r.name, 'MEMBER'
    FROM sys.database_role_members rm
    JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
    WHERE rm.member_principal_id = DATABASE_PRINCIPAL_ID()`);

  const schema = {
    generatedAt: new Date().toISOString(),
    info,
    tables,
    columns,
    primaryKeys,
    foreignKeys,
    indexes,
    views,
    routines,
    routineParams,
    triggers,
    permissions,
  };

  await mkdir("docs", { recursive: true });
  await writeFile("docs/schema.json", JSON.stringify(schema, null, 2), "utf8");
  await writeFile("docs/schema.md", toMarkdown(schema), "utf8");

  console.error(
    `Listo: ${tables.length} tablas, ${views.length} vistas, ${routines.length} procedimientos/funciones.`,
  );
  console.error("Generado docs/schema.json y docs/schema.md");
}

function key(r: Row, objField = "table") {
  return `${r.schema}.${r[objField]}`;
}

function groupBy(rows: Row[], fn: (r: Row) => string) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = fn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return map;
}

function typeLabel(c: Row): string {
  const t = String(c.type);
  if (["varchar", "char", "varbinary", "binary"].includes(t)) {
    return `${t}(${c.maxLength === -1 ? "max" : c.maxLength})`;
  }
  if (["nvarchar", "nchar"].includes(t)) {
    return `${t}(${c.maxLength === -1 ? "max" : c.maxLength / 2})`;
  }
  if (["decimal", "numeric"].includes(t)) return `${t}(${c.precision},${c.scale})`;
  return t;
}

function esc(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function toMarkdown(s: any): string {
  const out: string[] = [];
  const cols = groupBy(s.columns, (r) => key(r));
  const pks = groupBy(s.primaryKeys, (r) => key(r));
  const fks = groupBy(s.foreignKeys, (r) => key(r));
  const idx = groupBy(s.indexes, (r) => key(r));
  const trg = groupBy(s.triggers, (r) => key(r));
  const params = groupBy(s.routineParams, (r) => key(r, "routine"));

  out.push(`# Schema de ${s.info.database}`, "");
  out.push(
    `Servidor: ${s.info.server} · SQL Server ${s.info.productVersion} (${s.info.edition}) · Collation ${s.info.collation}`,
    `Generado: ${s.generatedAt}`,
    "",
  );

  out.push("## Resumen de tablas", "", "| Tabla | Filas | Descripción |", "|---|---:|---|");
  for (const t of s.tables) out.push(`| ${key(t)} | ${t.rows} | ${esc(t.description)} |`);
  out.push("");

  out.push("## Relaciones (FK)", "", "| Desde | Hacia | Constraint |", "|---|---|---|");
  for (const f of s.foreignKeys) {
    out.push(`| ${key(f)}.${f.column} | ${f.refSchema}.${f.refTable}.${f.refColumn} | ${f.constraintName} |`);
  }
  out.push("");

  out.push("## Tablas", "");
  for (const t of s.tables) {
    const k = key(t);
    const pkCols = new Set((pks.get(k) ?? []).map((p) => p.column));
    const fkByCol = new Map((fks.get(k) ?? []).map((f) => [f.column, `${f.refTable}.${f.refColumn}`]));
    out.push(`### ${k}`, "");
    if (t.description) out.push(String(t.description), "");
    out.push(`Filas: ${t.rows}`, "");
    out.push("| # | Columna | Tipo | Null | Clave | Default | Descripción |", "|---:|---|---|---|---|---|---|");
    for (const c of cols.get(k) ?? []) {
      const flags = [
        pkCols.has(c.column) ? "PK" : "",
        fkByCol.has(c.column) ? `FK→${fkByCol.get(c.column)}` : "",
        c.isIdentity ? "identity" : "",
        c.isComputed ? "computed" : "",
      ]
        .filter(Boolean)
        .join(" ");
      out.push(
        `| ${c.position} | ${c.column} | ${typeLabel(c)} | ${c.nullable ? "sí" : "no"} | ${flags} | ${esc(c.default)} | ${esc(c.description)} |`,
      );
    }
    const tIdx = (idx.get(k) ?? []).filter((i) => !i.isPrimaryKey);
    if (tIdx.length) {
      out.push("", "Índices:");
      for (const i of tIdx) {
        out.push(
          `- ${i.indexName} (${i.type}${i.isUnique ? ", único" : ""}): ${i.keyColumns}${i.includedColumns ? ` INCLUDE (${i.includedColumns})` : ""}`,
        );
      }
    }
    const tTrg = trg.get(k) ?? [];
    if (tTrg.length) {
      out.push("", "Triggers: " + tTrg.map((x) => `${x.trigger}${x.isDisabled ? " (deshabilitado)" : ""}`).join(", "));
    }
    out.push("");
  }

  if (s.views.length) {
    out.push("## Vistas", "");
    for (const v of s.views) {
      const k = key(v, "view");
      out.push(`### ${k}`, "");
      const vc = cols.get(k) ?? [];
      if (vc.length) out.push("Columnas: " + vc.map((c) => `${c.column} ${typeLabel(c)}`).join(", "), "");
      if (v.definition) out.push("```sql", String(v.definition).trim(), "```", "");
    }
  }

  if (s.routines.length) {
    out.push("## Procedimientos y funciones", "");
    for (const r of s.routines) {
      const k = key(r, "name");
      const ps = params.get(k) ?? [];
      const sig = ps.map((p) => `${p.param} ${p.type}${p.isOutput ? " OUTPUT" : ""}`).join(", ");
      out.push(`### ${k} (${r.type})`, "", `Parámetros: ${sig || "ninguno"}`, "");
      if (r.definition) out.push("```sql", String(r.definition).trim(), "```", "");
    }
  }

  out.push("## Permisos del usuario de conexión", "", "| Objeto | Permiso | Estado |", "|---|---|---|");
  for (const p of s.permissions) out.push(`| ${esc(p.securable)} | ${esc(p.permission)} | ${esc(p.state)} |`);
  out.push("");

  return out.join("\n");
}

main()
  .catch((err) => {
    console.error("Error relevando schema:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
