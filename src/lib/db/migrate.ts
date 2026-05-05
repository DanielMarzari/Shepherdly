/*
 * Migration runner.
 *
 * Applies SQL files from db/migrations/ in lexical order. Tracks
 * applied migrations in a `_migrations` table so re-runs are idempotent.
 *
 * Called from a CLI entry (scripts/migrate.ts) and from
 * src/instrumentation.ts so the schema is always present at boot.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { db } from './index'

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')

function ensureMigrationsTable(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `)
}

function appliedFilenames(): Set<string> {
  const rows = db().prepare('SELECT filename FROM _migrations').all() as { filename: string }[]
  return new Set(rows.map(r => r.filename))
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
}

export function migrate(): { applied: string[]; skipped: string[] } {
  ensureMigrationsTable()
  const already = appliedFilenames()
  const files = listMigrationFiles()
  const applied: string[] = []
  const skipped: string[] = []

  for (const filename of files) {
    if (already.has(filename)) {
      skipped.push(filename)
      continue
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
    // The migration file owns its own transaction (BEGIN/COMMIT).
    // We just exec it and record completion in our own statement.
    db().exec(sql)
    db()
      .prepare('INSERT INTO _migrations (filename) VALUES (?)')
      .run(filename)
    applied.push(filename)
  }
  return { applied, skipped }
}

// Convenience for `tsx scripts/migrate.ts`.
if (require.main === module) {
  const result = migrate()
  if (result.applied.length === 0) {
    console.log('No new migrations.')
  } else {
    console.log(`Applied ${result.applied.length} migration(s):`)
    for (const f of result.applied) console.log(`  + ${f}`)
  }
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} already-applied.`)
  }
}
