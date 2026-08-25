// Applies the SQL files in `drizzle/` to the local D1 database that
// `@cloudflare/vite-plugin` / Miniflare uses for `npm run dev`.
//
// `npm run dev` never runs migrations on its own: the local D1 binding
// starts out with no tables, so routes that touch it (e.g.
// `app/api/garage-save/route.ts`) fail with "no such table: garage_saves"
// until this has been run at least once.
//
// This shells out to `wrangler d1 execute --local`, the same D1 storage
// engine Miniflare/workerd use under the hood — writing to the underlying
// SQLite file directly (e.g. via node:sqlite) is not reliable, since a
// running dev server's D1 session does not reliably pick up out-of-band
// file changes.
//
// The database name/id/persist path below must stay in sync with the
// `d1_databases` binding declared in `vite.config.ts`.
//
// Usage: `npm run db:migrate:local` (stop `npm run dev` first if it's
// running, then start it again afterwards).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATABASE_NAME = "site-creator-d1";
const DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const PERSIST_TO = ".wrangler/state";
const migrationsDir = "drizzle";

const tempDir = mkdtempSync(join(tmpdir(), "d1-migrate-"));
const configPath = join(tempDir, "wrangler.jsonc");
writeFileSync(
  configPath,
  JSON.stringify(
    {
      name: "site-creator-d1-migrate-temp",
      compatibility_date: "2024-09-23",
      d1_databases: [
        {
          binding: "DB",
          database_name: DATABASE_NAME,
          database_id: DATABASE_ID,
        },
      ],
    },
    null,
    2,
  ),
);

try {
  const migrationFiles = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    console.log(`Applying ${file}...`);
    try {
      execFileSync(
        "npx",
        [
          "wrangler",
          "d1",
          "execute",
          DATABASE_NAME,
          "--local",
          `--config=${configPath}`,
          `--persist-to=${PERSIST_TO}`,
          `--file=${join(migrationsDir, file)}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      if (/already exists/i.test(output)) {
        console.log(`Skipped ${file} (already applied)`);
        continue;
      }
      process.stderr.write(output);
      throw error;
    }
  }
  console.log("Local D1 migrations applied.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
