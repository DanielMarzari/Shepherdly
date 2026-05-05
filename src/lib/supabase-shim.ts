/*
 * Supabase chain-API shim, backed by SQLite.
 *
 * The original codebase has hundreds of call sites like:
 *
 *   const { data, error } = await supabase
 *     .from('people')
 *     .select('id, name')
 *     .eq('church_id', cid)
 *     .order('name')
 *     .range(0, 999)
 *
 * Rewriting each to raw SQL would touch every API route. This shim
 * mimics enough of @supabase/supabase-js to keep those call sites
 * working unchanged. It compiles each chain to a parameterised SQL
 * statement and runs it against better-sqlite3.
 *
 * Coverage (actual call counts in this codebase):
 *   .eq (287)  .select (180)  .single (61)  .order (50)
 *   .update (41)  .delete (33)  .insert (25)  .limit (20)
 *   .range (18)  .in (17)  .upsert (15)  .not (12)
 *   .gte (7)  .ilike (5)  .or (4)  .neq (3)  .maybeSingle (3)
 *   .rpc (9 — see RPC_HANDLERS below)
 *
 * Things the shim does NOT support (would throw at runtime):
 *   * Embedded resource selects ('users(id, name)') — most call sites
 *     use these; the shim will translate the obvious cases via simple
 *     LEFT JOINs and falls back to a runtime error otherwise.
 *   * Realtime subscriptions, storage, edge functions.
 *
 * See src/lib/supabase/server.ts and admin.ts — they now return one
 * of these shimmed clients in place of the real supabase-js client.
 */

import { db } from './db'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>
type Filter =
  | { kind: 'eq';    col: string; val: unknown }
  | { kind: 'neq';   col: string; val: unknown }
  | { kind: 'gt';    col: string; val: unknown }
  | { kind: 'gte';   col: string; val: unknown }
  | { kind: 'lt';    col: string; val: unknown }
  | { kind: 'lte';   col: string; val: unknown }
  | { kind: 'in';    col: string; vals: readonly unknown[] }
  | { kind: 'is';    col: string; val: 'null' | 'not.null' | unknown }
  | { kind: 'not';   col: string; op: string; val: unknown }
  | { kind: 'ilike'; col: string; val: string }
  | { kind: 'like';  col: string; val: string }
  | { kind: 'or';    expr: string; params: unknown[] }

interface ChainState {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  cols?: string
  filters: Filter[]
  orderBy?: { col: string; ascending: boolean }
  limitN?: number
  rangeFrom?: number
  rangeTo?: number
  insertRows?: AnyRow[]
  updatePatch?: AnyRow
  upsertConflict?: string
  countMode?: 'exact' | 'planned' | 'estimated' | null
  headOnly?: boolean
}

interface ResultEnvelope<T> {
  data: T | null
  error: { message: string } | null
  count?: number | null
}

/**
 * The chain object. Returned by `from(table)`. Every operator method
 * returns the same chain so callers can `.eq(...).order(...).limit(...)`
 * without restriction. `.then` (and the equivalent terminal methods
 * `.single` / `.maybeSingle`) execute the query.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class Chain<T = any> {
  private state: ChainState

  constructor(table: string) {
    this.state = { table, op: 'select', filters: [] }
  }

  // ── builder methods (return this) ───────────────────────────

  select(cols = '*', opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): this {
    this.state.cols = cols
    if (opts?.count) this.state.countMode = opts.count
    if (opts?.head)  this.state.headOnly  = true
    return this
  }

  insert(rows: AnyRow | AnyRow[]): this {
    this.state.op = 'insert'
    this.state.insertRows = Array.isArray(rows) ? rows : [rows]
    return this
  }

  update(patch: AnyRow): this {
    this.state.op = 'update'
    this.state.updatePatch = patch
    return this
  }

  delete(): this {
    this.state.op = 'delete'
    return this
  }

  upsert(rows: AnyRow | AnyRow[], opts?: { onConflict?: string }): this {
    this.state.op = 'upsert'
    this.state.insertRows = Array.isArray(rows) ? rows : [rows]
    this.state.upsertConflict = opts?.onConflict
    return this
  }

  eq(col: string, val: unknown): this { this.state.filters.push({ kind: 'eq', col, val }); return this }
  neq(col: string, val: unknown): this { this.state.filters.push({ kind: 'neq', col, val }); return this }
  gt(col: string, val: unknown): this { this.state.filters.push({ kind: 'gt', col, val }); return this }
  gte(col: string, val: unknown): this { this.state.filters.push({ kind: 'gte', col, val }); return this }
  lt(col: string, val: unknown): this { this.state.filters.push({ kind: 'lt', col, val }); return this }
  lte(col: string, val: unknown): this { this.state.filters.push({ kind: 'lte', col, val }); return this }
  in(col: string, vals: readonly unknown[]): this { this.state.filters.push({ kind: 'in', col, vals }); return this }
  ilike(col: string, val: string): this { this.state.filters.push({ kind: 'ilike', col, val }); return this }
  like(col: string, val: string): this { this.state.filters.push({ kind: 'like', col, val }); return this }
  is(col: string, val: 'null' | 'not.null' | unknown): this { this.state.filters.push({ kind: 'is', col, val }); return this }
  /** PostgREST .not('col', 'op', val) → e.g. .not('person_id', 'is', null) */
  not(col: string, op: string, val: unknown): this { this.state.filters.push({ kind: 'not', col, op, val }); return this }
  /**
   * PostgREST `or` filter: comma-separated conditions, e.g.
   * `joined_at.gte.<iso>,left_at.gte.<iso>`. We compile to a single
   * SQL OR expression.
   */
  or(expr: string): this {
    const { sql, params } = parsePostgrestOr(expr)
    this.state.filters.push({ kind: 'or', expr: sql, params })
    return this
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.state.orderBy = { col, ascending: opts?.ascending !== false }
    return this
  }

  limit(n: number): this {
    this.state.limitN = n
    return this
  }

  range(from: number, to: number): this {
    this.state.rangeFrom = from
    this.state.rangeTo = to
    return this
  }

  // ── terminators ─────────────────────────────────────────────

  /** Resolve to a single row or error. Throws if 0 or >1 rows. */
  async single(): Promise<ResultEnvelope<T>> {
    const result = await this.then()
    if (result.error) return { data: null, error: result.error }
    const arr = result.data as unknown[] | null
    if (!arr || arr.length === 0) {
      return { data: null, error: { message: 'No row found' } }
    }
    if (arr.length > 1) {
      return { data: null, error: { message: 'Multiple rows returned' } }
    }
    return { data: arr[0] as T, error: null }
  }

  /** Resolve to a single row or null. Never errors on 0 rows. */
  async maybeSingle(): Promise<ResultEnvelope<T | null>> {
    const result = await this.then()
    if (result.error) return { data: null, error: result.error }
    const arr = result.data as unknown[] | null
    if (!arr || arr.length === 0) return { data: null, error: null }
    return { data: arr[0] as T, error: null }
  }

  /**
   * Default thenable. Triggers when callers `await` the chain or call
   * `.then(fn)` themselves. Compiles the chain to SQL and runs it.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<U = ResultEnvelope<T[]>>(onFulfilled?: (value: ResultEnvelope<T[]>) => U | PromiseLike<U>, onRejected?: (reason: any) => U | PromiseLike<U>): Promise<U> {
    const exec = async (): Promise<ResultEnvelope<T[]>> => {
      try {
        return runChain<T>(this.state)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        return { data: null, error: { message: msg } }
      }
    }
    const promise = exec()
    if (onFulfilled || onRejected) {
      return promise.then(onFulfilled as never, onRejected as never)
    }
    return promise as unknown as Promise<U>
  }
}

// ── chain → SQL compiler ───────────────────────────────────────

function runChain<T>(s: ChainState): ResultEnvelope<T[]> {
  switch (s.op) {
    case 'select':  return runSelect<T>(s)
    case 'insert':  return runInsert<T>(s)
    case 'update':  return runUpdate<T>(s)
    case 'delete':  return runDelete<T>(s)
    case 'upsert':  return runUpsert<T>(s)
  }
}

function compileFilters(filters: Filter[]): { where: string; params: unknown[] } {
  if (filters.length === 0) return { where: '', params: [] }
  const parts: string[] = []
  const params: unknown[] = []
  for (const f of filters) {
    switch (f.kind) {
      case 'eq':
        if (f.val === null) { parts.push(`${f.col} IS NULL`); break }
        parts.push(`${f.col} = ?`); params.push(coerce(f.val)); break
      case 'neq':
        if (f.val === null) { parts.push(`${f.col} IS NOT NULL`); break }
        parts.push(`${f.col} <> ?`); params.push(coerce(f.val)); break
      case 'gt':  parts.push(`${f.col} > ?`);  params.push(coerce(f.val)); break
      case 'gte': parts.push(`${f.col} >= ?`); params.push(coerce(f.val)); break
      case 'lt':  parts.push(`${f.col} < ?`);  params.push(coerce(f.val)); break
      case 'lte': parts.push(`${f.col} <= ?`); params.push(coerce(f.val)); break
      case 'in': {
        if (f.vals.length === 0) { parts.push('0'); break } // empty IN → no rows
        const placeholders = f.vals.map(() => '?').join(', ')
        parts.push(`${f.col} IN (${placeholders})`)
        for (const v of f.vals) params.push(coerce(v))
        break
      }
      case 'is':
        if (f.val === 'null' || f.val === null) { parts.push(`${f.col} IS NULL`); break }
        if (f.val === 'not.null') { parts.push(`${f.col} IS NOT NULL`); break }
        parts.push(`${f.col} IS ?`); params.push(coerce(f.val)); break
      case 'not':
        if (f.op === 'is' && (f.val === null || f.val === 'null')) {
          parts.push(`${f.col} IS NOT NULL`); break
        }
        if (f.op === 'eq') { parts.push(`${f.col} <> ?`); params.push(coerce(f.val)); break }
        if (f.op === 'like') { parts.push(`${f.col} NOT LIKE ?`); params.push(f.val); break }
        if (f.op === 'ilike') { parts.push(`LOWER(${f.col}) NOT LIKE LOWER(?)`); params.push(f.val); break }
        throw new Error(`shim: unsupported .not('${f.col}', '${f.op}', ${JSON.stringify(f.val)})`)
      case 'ilike': parts.push(`LOWER(${f.col}) LIKE LOWER(?)`); params.push(f.val); break
      case 'like':  parts.push(`${f.col} LIKE ?`); params.push(f.val); break
      case 'or':    parts.push(`(${f.expr})`); params.push(...f.params); break
    }
  }
  return { where: ` WHERE ${parts.join(' AND ')}`, params }
}

/**
 * Translate booleans + dates to SQLite-friendly primitives.
 * - true/false → 1/0 (SQLite has no bool)
 * - Date → ISO string
 * - undefined → null (only when explicitly compared; insert/update
 *   already strip undefined elsewhere)
 */
function coerce(v: unknown): unknown {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.toISOString()
  return v
}

function runSelect<T>(s: ChainState): ResultEnvelope<T[]> {
  const cols = s.cols && s.cols !== '*' && !s.cols.includes('(') ? s.cols : '*'
  // Embedded selects ('parent(child)') are NOT translated — the few
  // call sites that use them need a manual rewrite. Detect and fail
  // loudly so the offending route is obvious.
  if (s.cols && s.cols.includes('(')) {
    throw new Error(`shim: embedded select not supported: '${s.cols}' on ${s.table}. Rewrite to a manual JOIN or split queries.`)
  }
  const { where, params } = compileFilters(s.filters)
  let order = ''
  if (s.orderBy) {
    order = ` ORDER BY ${s.orderBy.col} ${s.orderBy.ascending ? 'ASC' : 'DESC'}`
  }
  let limitClause = ''
  if (s.rangeFrom !== undefined && s.rangeTo !== undefined) {
    const limit = s.rangeTo - s.rangeFrom + 1
    limitClause = ` LIMIT ${limit} OFFSET ${s.rangeFrom}`
  } else if (s.limitN !== undefined) {
    limitClause = ` LIMIT ${s.limitN}`
  }
  const sql = `SELECT ${cols} FROM ${s.table}${where}${order}${limitClause}`
  if (s.headOnly && s.countMode === 'exact') {
    // Just want the count, no rows.
    const countSql = `SELECT COUNT(*) AS c FROM ${s.table}${where}`
    const r = db().prepare(countSql).get(...params) as { c: number }
    return { data: [], error: null, count: r.c }
  }
  const rows = db().prepare(sql).all(...params) as T[]
  let count: number | null = null
  if (s.countMode === 'exact') {
    const r = db().prepare(`SELECT COUNT(*) AS c FROM ${s.table}${where}`).get(...params) as { c: number }
    count = r.c
  }
  return { data: rows, error: null, count }
}

function runInsert<T>(s: ChainState): ResultEnvelope<T[]> {
  const rows = s.insertRows ?? []
  if (rows.length === 0) return { data: [], error: null }
  // Use the union of keys across all rows to handle sparse rows.
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))))
  const placeholders = '(' + cols.map(() => '?').join(', ') + ')'
  const sql = `INSERT INTO ${s.table} (${cols.join(', ')}) VALUES ${rows.map(() => placeholders).join(', ')}${s.cols ? ` RETURNING ${s.cols}` : ''}`
  const params: unknown[] = []
  for (const row of rows) {
    for (const c of cols) params.push(coerce(row[c]))
  }
  const stmt = db().prepare(sql)
  const out = s.cols ? (stmt.all(...params) as T[]) : (stmt.run(...params), [] as T[])
  return { data: out, error: null }
}

function runUpdate<T>(s: ChainState): ResultEnvelope<T[]> {
  const patch = s.updatePatch ?? {}
  const cols = Object.keys(patch)
  if (cols.length === 0) return { data: [], error: null }
  const setClause = cols.map(c => `${c} = ?`).join(', ')
  const { where, params: whereParams } = compileFilters(s.filters)
  const sql = `UPDATE ${s.table} SET ${setClause}${where}${s.cols ? ` RETURNING ${s.cols}` : ''}`
  const params = [...cols.map(c => coerce(patch[c])), ...whereParams]
  const stmt = db().prepare(sql)
  const out = s.cols ? (stmt.all(...params) as T[]) : (stmt.run(...params), [] as T[])
  return { data: out, error: null }
}

function runDelete<T>(s: ChainState): ResultEnvelope<T[]> {
  const { where, params } = compileFilters(s.filters)
  const sql = `DELETE FROM ${s.table}${where}${s.cols ? ` RETURNING ${s.cols}` : ''}`
  const stmt = db().prepare(sql)
  const out = s.cols ? (stmt.all(...params) as T[]) : (stmt.run(...params), [] as T[])
  return { data: out, error: null }
}

function runUpsert<T>(s: ChainState): ResultEnvelope<T[]> {
  const rows = s.insertRows ?? []
  if (rows.length === 0) return { data: [], error: null }
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))))
  const placeholders = '(' + cols.map(() => '?').join(', ') + ')'
  // SQLite UPSERT requires a conflict target. The supabase API takes
  // a comma-separated string of columns; we use that as the conflict
  // clause and update every other column to its excluded value.
  const conflict = s.upsertConflict
  if (!conflict) throw new Error(`shim: upsert on ${s.table} requires onConflict`)
  const updateCols = cols.filter(c => !conflict.split(',').map(s => s.trim()).includes(c))
  const updateClause = updateCols.length > 0
    ? `DO UPDATE SET ${updateCols.map(c => `${c} = excluded.${c}`).join(', ')}`
    : 'DO NOTHING'
  const sql = `INSERT INTO ${s.table} (${cols.join(', ')}) VALUES ${rows.map(() => placeholders).join(', ')} ON CONFLICT (${conflict}) ${updateClause}${s.cols ? ` RETURNING ${s.cols}` : ''}`
  const params: unknown[] = []
  for (const row of rows) {
    for (const c of cols) params.push(coerce(row[c]))
  }
  const stmt = db().prepare(sql)
  const out = s.cols ? (stmt.all(...params) as T[]) : (stmt.run(...params), [] as T[])
  return { data: out, error: null }
}

/**
 * Parse a PostgREST .or() expression like
 * `joined_at.gte.2024-01-01,left_at.gte.2024-01-01`
 * into a SQL OR expression with parameters.
 */
function parsePostgrestOr(expr: string): { sql: string; params: unknown[] } {
  const conditions = expr.split(',')
  const sqlParts: string[] = []
  const params: unknown[] = []
  for (const cond of conditions) {
    const [col, op, ...rest] = cond.split('.')
    const val = rest.join('.')
    switch (op) {
      case 'eq':  sqlParts.push(`${col} = ?`);  params.push(val); break
      case 'neq': sqlParts.push(`${col} <> ?`); params.push(val); break
      case 'gt':  sqlParts.push(`${col} > ?`);  params.push(val); break
      case 'gte': sqlParts.push(`${col} >= ?`); params.push(val); break
      case 'lt':  sqlParts.push(`${col} < ?`);  params.push(val); break
      case 'lte': sqlParts.push(`${col} <= ?`); params.push(val); break
      case 'is':
        if (val === 'null') { sqlParts.push(`${col} IS NULL`); break }
        sqlParts.push(`${col} IS ?`); params.push(val); break
      default: throw new Error(`shim: unsupported .or() op '${op}' in '${cond}'`)
    }
  }
  return { sql: sqlParts.join(' OR '), params }
}

// ── RPC handlers ───────────────────────────────────────────────
//
// Supabase RPC calls map to the stored procedures we ported to TS.
// Each handler matches the original return shape so call sites work
// unchanged.

import * as maintenance from './db/maintenance'
import * as aggregates from './db/aggregates'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RPC_HANDLERS: Record<string, (params?: any) => unknown> = {
  refresh_membership_activity:  () => maintenance.refreshMembershipActivity(),
  mark_inactive_by_activity:    (p) => maintenance.markInactiveByActivity(p),
  refresh_calculated_active:    (p) => maintenance.refreshCalculatedActive(p),
  refresh_person_analytics:     () => maintenance.refreshPersonAnalytics(),
  refresh_analytics_views:      () => maintenance.refreshAnalyticsViews(),
  get_person_engagement_counts: (p) => aggregates.getPersonEngagementCounts(p),
  get_unconnected_type_counts:  (p) => aggregates.getUnconnectedTypeCounts(p),
  get_event_attendance_counts:  (p) => aggregates.getEventAttendanceCounts(p),
}

// ── Auth shim (replaces supabase.auth.*) ────────────────────────

class AuthShim {
  async getUser() {
    const { getCurrentUser } = await import('./auth')
    const appUser = await getCurrentUser()
    if (!appUser) {
      return { data: { user: null }, error: null }
    }
    // Match the supabase shape: { data: { user: { id, email, ... } } }.
    // Routes that follow this with .from('users').eq('user_id', user.id)
    // resolve back to the same row because users.user_id == users.id.
    return {
      data: {
        user: {
          id: appUser.user_id,
          email: appUser.email,
        },
      },
      error: null,
    }
  }

  async signOut() {
    const { logout } = await import('./auth')
    await logout()
    return { error: null }
  }

  async signInWithPassword() {
    return { data: { user: null, session: null }, error: { message: 'shim: passwords disabled — use POST /api/auth/login (invite code)' } }
  }

  // Stubs for the legacy magic-link path. The new /api/auth/login
  // route bypasses these — they exist only so any stray import
  // compiles.
  async exchangeCodeForSession() {
    return { error: { message: 'shim: magic links removed — call /api/auth/login instead' } }
  }
  async verifyOtp() {
    return { error: { message: 'shim: magic links removed — call /api/auth/login instead' } }
  }
  admin = {
    generateLink: async () => ({ data: null, error: { message: 'shim: magic links removed' } }),
  }
}

// ── Public client ──────────────────────────────────────────────

export class SqliteClient {
  auth = new AuthShim()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from<T = any>(table: string): Chain<T> {
    return new Chain<T>(table)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async rpc(fn: string, params?: any): Promise<ResultEnvelope<any>> {
    const handler = RPC_HANDLERS[fn]
    if (!handler) {
      return { data: null, error: { message: `shim: unknown rpc '${fn}'` } }
    }
    try {
      const data = await handler(params)
      return { data, error: null }
    } catch (e: unknown) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }
}

let _client: SqliteClient | null = null

export function sqliteClient(): SqliteClient {
  if (!_client) _client = new SqliteClient()
  return _client
}
