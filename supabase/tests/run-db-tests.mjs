// Runs every migration on an in-memory Postgres (PGlite) with Supabase stand-ins,
// then the end-to-end scenario test as real signed-in users under RLS.
//   npm run test:db
import { PGlite } from "@electric-sql/pglite";

import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new PGlite();
await db.exec(fs.readFileSync(path.join(dir, "tests/stubs.sql"), "utf8"));
for (const f of fs.readdirSync(path.join(dir, "migrations")).sort()) {
  try { await db.exec(fs.readFileSync(path.join(dir, "migrations", f), "utf8")); console.log("OK  ", f); }
  catch (e) { console.log("FAIL", f, e.message); process.exit(1); }
}
const scenario = await import(path.join(dir, "tests/scenario.mjs"));
await scenario.default(db);
