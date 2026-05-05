/*
 * SQLite client.
 *
 * One process-wide singleton. better-sqlite3 is synchronous and fast
 * enough that wrapping in a connection pool is unnecessary; the WAL
 * mode set in 0001_init.sql is what gives us concurrent readers.
 *
 * The DB path comes from DATABASE_PATH (set in PM2's ecosystem
 * config). In dev / tests it falls back to <repo>/db/shepherdly.db.
 */

import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

let _db: Database.Database | null = null

function resolveDatabasePath(): string {
  const env = process.env.DATABASE_PATH
  if (env) return env
  // Default for dev: repo-local.
  return join(process.cwd(), 'db', 'shepherdly.db')
}

export function db(): Database.Database {
  if (_db) return _db
  const path = resolveDatabasePath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  _db = new Database(path)
  // Recommended pragmas for a long-running web app:
  _db.pragma('journal_mode = WAL')          // concurrent readers + one writer
  _db.pragma('synchronous = NORMAL')        // WAL-safe; faster than FULL
  _db.pragma('foreign_keys = ON')           // enforce FKs (off by default!)
  _db.pragma('busy_timeout = 5000')         // wait up to 5s on contention
  return _db
}

// Convenience wrappers — most call sites use db().prepare(...) directly,
// but these are handy for one-off ad-hoc queries.
export function exec(sql: string): void {
  db().exec(sql)
}

// Utility for INSERT ... RETURNING-equivalent. SQLite supports RETURNING
// natively since 3.35; better-sqlite3 ships with a recent enough binary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function one<T = any>(sql: string, params: unknown[] = []): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function all<T = any>(sql: string, params: unknown[] = []): T[] {
  return db().prepare(sql).all(...params) as T[]
}

export function run(sql: string, params: unknown[] = []): Database.RunResult {
  return db().prepare(sql).run(...params)
}
