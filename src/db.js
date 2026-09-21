import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carga el .env desde la raíz del proyecto (un nivel arriba de /src).
// override: true — ver la nota en server.js: sin esto, pm2 puede mantener
// process.env cacheado de un arranque anterior y las ediciones a .env no
// surten efecto.
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

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