import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.NODE_ENV === "test" ? 5 : 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
