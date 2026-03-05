import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carga el .env desde la raíz del proyecto (un nivel arriba de /src)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Helper: ejecutar en transacción
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}