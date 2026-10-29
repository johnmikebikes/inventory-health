// Builds prisma/postgres/schema.prisma from the SQLite dev schema, so there's one
// source of truth. Used by the Render build; local dev keeps SQLite.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("prisma/schema.prisma", "utf8");
const out = src
  .replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')
  .replace(/url\s*=\s*"file:dev\.sqlite"/, 'url      = env("DATABASE_URL")');
if (out === src || !out.includes('env("DATABASE_URL")')) {
  console.error("Could not convert prisma/schema.prisma to Postgres");
  process.exit(1);
}
mkdirSync("prisma/postgres", { recursive: true });
writeFileSync("prisma/postgres/schema.prisma", "// GENERATED from prisma/schema.prisma by scripts/make-postgres-schema.mjs. Don't edit.\n" + out);
console.log("Wrote prisma/postgres/schema.prisma");
