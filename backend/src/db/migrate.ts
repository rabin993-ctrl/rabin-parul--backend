import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations complete");
} finally {
  await pool.end();
}
