/**
 * database.js
 * Dual-engine database adapter.
 * Uses pg (PostgreSQL) when DATABASE_URL is configured (Production).
 * Falls back to sql.js (pure WebAssembly SQLite) locally (Development).
 */

const path      = require('path');
const fs        = require('fs');
const initSqlJs = require('sql.js');
const { Pool }  = require('pg');

const dataDir = path.join(__dirname, '../../data');
const dbPath  = path.join(dataDir, 'interviews.db');

let sqliteDb = null;
let pgPool = null;
let isPg = false;

function convertSqlForPg(sql) {
  let index = 1;
  let converted = sql.replace(/\?/g, () => `$${index++}`);
  // Replace SQLite specific functions/keywords
  converted = converted.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  converted = converted.replace(/datetime\("now"\)/gi, 'CURRENT_TIMESTAMP');
  return converted;
}

async function initDb() {
  if (isPg && pgPool) return pgPool;
  if (!isPg && sqliteDb) return sqliteDb;

  if (process.env.DATABASE_URL) {
    isPg = true;
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    // Create PG Schema
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id               SERIAL PRIMARY KEY,
        title            TEXT NOT NULL,
        company_name     TEXT DEFAULT 'Weekday',
        location         TEXT DEFAULT 'Hybrid / Onsite',
        max_notice_days  TEXT DEFAULT '30',
        tech_stack       TEXT DEFAULT '',
        target_cpa       TEXT DEFAULT '',
        tone             TEXT DEFAULT 'warm',
        duration_target  INTEGER DEFAULT 5,
        voice_id         TEXT DEFAULT 'shimmer',
        custom_questions TEXT DEFAULT '[]',
        jd_text          TEXT NOT NULL,
        requirements     TEXT DEFAULT '',
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS candidates (
        id                  SERIAL PRIMARY KEY,
        job_id              INTEGER,
        name                TEXT NOT NULL,
        call_id             TEXT,
        status              TEXT DEFAULT 'pending',
        duration_secs       INTEGER,
        transcript          TEXT,
        summary             TEXT,
        overall_score       INTEGER,
        technical_score     INTEGER,
        communication_score INTEGER,
        highlights          TEXT DEFAULT '[]',
        concerns            TEXT DEFAULT '[]',
        recommendation      TEXT,
        called_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at        TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );
    `);

    // Auto-migration for PostgreSQL (ADD COLUMN IF NOT EXISTS)
    const columnsToAdd = [
      { name: 'company_name',     def: "TEXT DEFAULT 'Weekday'" },
      { name: 'location',         def: "TEXT DEFAULT 'Hybrid / Onsite'" },
      { name: 'max_notice_days',  def: "TEXT DEFAULT '30'" },
      { name: 'tech_stack',       def: "TEXT DEFAULT ''" },
      { name: 'target_cpa',       def: "TEXT DEFAULT ''" },
      { name: 'tone',             def: "TEXT DEFAULT 'warm'" },
      { name: 'language_mode',    def: "TEXT DEFAULT 'en-IN'" },
      { name: 'duration_target',  def: "INTEGER DEFAULT 5" },
      { name: 'voice_id',          def: "TEXT DEFAULT 'shimmer'" },
      { name: 'custom_questions', def: "TEXT DEFAULT '[]'" }
    ];

    for (const col of columnsToAdd) {
      try {
        await pgPool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ${col.name} ${col.def}`);
      } catch (err) {
        console.warn(`[db pg auto-migration jobs] Alter table failed for column ${col.name}:`, err.message);
      }
    }

    const candidateColsToAdd = [
      { name: 'candidate_bio',    def: "TEXT DEFAULT ''" },
      { name: 'recording_url',    def: "TEXT DEFAULT ''" },
      { name: 'call_health',      def: "TEXT DEFAULT '{}'" },
      { name: 'incident_resolved', def: "INTEGER DEFAULT 0" },
      { name: 'talent_persona',   def: "TEXT DEFAULT '{}'" },
      { name: 'vague_answers',    def: "TEXT DEFAULT '[]'" }
    ];

    for (const col of candidateColsToAdd) {
      try {
        await pgPool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS ${col.name} ${col.def}`);
      } catch (err) {
        console.warn(`[db pg auto-migration candidates] Alter table failed for column ${col.name}:`, err.message);
      }
    }

    // Short call cleanup on PG
    try {
      await pgPool.query(`
        UPDATE candidates SET
          overall_score       = 0,
          technical_score     = 0,
          communication_score = 0,
          recommendation      = 'Call Dropped Early (Re-Screen)',
          summary             = 'Call dropped off early after 25-30 seconds before core screening questions could be conducted. Re-screening recommended.',
          concerns            = '["Call disconnected early (< 45 sec) before core technical & role questions could be asked"]'
        WHERE status = 'completed'
          AND (duration_secs < 45 OR length(COALESCE(transcript, '')) < 180)
      `);
    } catch (err) {
      console.warn('[db pg] Short call cleanup warning:', err.message);
    }

    console.log('✓ Connected to PostgreSQL Database (Production)');
    return pgPool;
  } else {
    isPg = false;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const SQL = await initSqlJs();

    if (fs.existsSync(dbPath)) {
      const buf = fs.readFileSync(dbPath);
      sqliteDb = new SQL.Database(buf);
    } else {
      sqliteDb = new SQL.Database();
    }

    // Create tables with expanded recruiter parameters
    sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        title            TEXT NOT NULL,
        company_name     TEXT DEFAULT 'Weekday',
        location         TEXT DEFAULT 'Hybrid / Onsite',
        max_notice_days  TEXT DEFAULT '30',
        tech_stack       TEXT DEFAULT '',
        target_cpa       TEXT DEFAULT '',
        tone             TEXT DEFAULT 'warm',
        duration_target  INTEGER DEFAULT 5,
        voice_id         TEXT DEFAULT 'shimmer',
        custom_questions TEXT DEFAULT '[]',
        jd_text          TEXT NOT NULL,
        requirements     TEXT DEFAULT '',
        created_at       TEXT DEFAULT (datetime('now')),
        updated_at       TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS candidates (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id              INTEGER,
        name                TEXT NOT NULL,
        call_id             TEXT,
        status              TEXT DEFAULT 'pending',
        duration_secs       INTEGER,
        transcript          TEXT,
        summary             TEXT,
        overall_score       INTEGER,
        technical_score     INTEGER,
        communication_score INTEGER,
        highlights          TEXT DEFAULT '[]',
        concerns            TEXT DEFAULT '[]',
        recommendation      TEXT,
        called_at           TEXT DEFAULT (datetime('now')),
        completed_at        TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );
    `);

    // Auto-migration loop: Ensure all columns exist in SQLite database
    const columnsToAdd = [
      { name: 'company_name',     def: "TEXT DEFAULT 'Weekday'" },
      { name: 'location',         def: "TEXT DEFAULT 'Hybrid / Onsite'" },
      { name: 'max_notice_days',  def: "TEXT DEFAULT '30'" },
      { name: 'tech_stack',       def: "TEXT DEFAULT ''" },
      { name: 'target_cpa',       def: "TEXT DEFAULT ''" },
      { name: 'tone',             def: "TEXT DEFAULT 'warm'" },
      { name: 'language_mode',    def: "TEXT DEFAULT 'en-IN'" },
      { name: 'duration_target',  def: "INTEGER DEFAULT 5" },
      { name: 'voice_id',          def: "TEXT DEFAULT 'shimmer'" },
      { name: 'custom_questions', def: "TEXT DEFAULT '[]'" }
    ];

    for (const col of columnsToAdd) {
      try {
        sqliteDb.run(`ALTER TABLE jobs ADD COLUMN ${col.name} ${col.def}`);
      } catch (_) {}
    }

    // Auto-migration for candidates table
    const candidateColsToAdd = [
      { name: 'candidate_bio',    def: "TEXT DEFAULT ''" },
      { name: 'recording_url',    def: "TEXT DEFAULT ''" },
      { name: 'call_health',      def: "TEXT DEFAULT '{}'" },
      { name: 'incident_resolved', def: "INTEGER DEFAULT 0" },
      { name: 'talent_persona',   def: "TEXT DEFAULT '{}'" },
      { name: 'vague_answers',    def: "TEXT DEFAULT '[]'" }
    ];
    for (const col of candidateColsToAdd) {
      try {
        sqliteDb.run(`ALTER TABLE candidates ADD COLUMN ${col.name} ${col.def}`);
      } catch (_) {}
    }

    // Auto-cleanup for SQLite
    try {
      sqliteDb.run(`
        UPDATE candidates SET
          overall_score       = 0,
          technical_score     = 0,
          communication_score = 0,
          recommendation      = 'Call Dropped Early (Re-Screen)',
          summary             = 'Call dropped off early after 25-30 seconds before core screening questions could be conducted. Re-screening recommended.',
          concerns            = '["Call disconnected early (< 45 sec) before core technical & role questions could be asked"]'
        WHERE status = 'completed'
          AND (duration_secs < 45 OR length(COALESCE(transcript, '')) < 180)
      `);
    } catch (err) {
      console.warn('[db] Short call cleanup warning:', err.message);
    }

    save();
    console.log('✓ Initialized SQLite Database (Local fallback)');
    return sqliteDb;
  }
}

function save() {
  if (isPg || !sqliteDb) return;
  const data = sqliteDb.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

async function run(sql, params = []) {
  if (isPg) {
    let pgSql = convertSqlForPg(sql);
    let isInsert = pgSql.trim().toUpperCase().startsWith('INSERT ');
    if (isInsert && !pgSql.toUpperCase().includes(' RETURNING ')) {
      pgSql += ' RETURNING id';
    }
    const res = await pgPool.query(pgSql, params);
    const lastInsertRowid = isInsert ? (res.rows[0]?.id || null) : null;
    return { lastInsertRowid, changes: res.rowCount };
  } else {
    sqliteDb.run(sql, params);
    const lastInsertRowid = sqliteDb.exec('SELECT last_insert_rowid() as id')[0]?.values[0]?.[0] ?? null;
    save();
    return { lastInsertRowid, changes: sqliteDb.getRowsModified() };
  }
}

async function all(sql, params = []) {
  if (isPg) {
    const pgSql = convertSqlForPg(sql);
    const res = await pgPool.query(pgSql, params);
    return res.rows;
  } else {
    const stmt = sqliteDb.prepare(sql);
    const rows = [];
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows.length ? rows[0] : null;
}

module.exports = { initDb, run, all, get, save };
