import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function defaultDataDir() {
  return fileURLToPath(new URL("./data", import.meta.url));
}

async function readTable({ dataDir, table }) {
  const p = path.join(dataDir, `${table}.json`);
  const raw = await fs.readFile(p, "utf8");
  const obj = JSON.parse(raw);
  if (!Array.isArray(obj)) throw new Error(`table ${table} must be a JSON array`);
  return obj;
}

function createTableProvider() {
  const dataDir = process.env.LS_TABLE_DATA_DIR || defaultDataDir();
  const allowTables = new Set(
    String(process.env.LS_TABLES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

  return {
    allowTables,
    async list(table) {
      if (!allowTables.has(table)) return null;
      return await readTable({ dataDir, table });
    },
    async getById(table, id) {
      if (!allowTables.has(table)) return null;
      const rows = await readTable({ dataDir, table });
      const want = String(id);
      const row = rows.find((r) => String(r?.id) === want);
      return row ?? null;
    }
  };
}

export { createTableProvider };

