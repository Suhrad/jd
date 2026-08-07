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

    let connStr = process.env.DATABASE_URL;

    // Supabase direct connections (db.*.supabase.co:5432) are IPv6-only.
    // Render does not support outbound IPv6, so we auto-redirect to the
    // Supabase connection pooler (aws-0-*.pooler.supabase.com:6543) which is IPv4.
    const directMatch = connStr.match(/db\.([\w]+)\.supabase\.co/);
    if (directMatch) {
      const projectRef = directMatch[1];
      // Extract user/password from the connection string
      const urlParsed = new URL(connStr);
      const password = urlParsed.password;
      const region = 'ap-south-1'; // Mumbai - your Supabase project region
      connStr = `postgresql://postgres.${projectRef}:${password}@aws-0-${region}.pooler.supabase.com:6543/postgres`;
      console.log('[DB] Auto-redirected to Supabase connection pooler (IPv4 compatible)');
    }

    pgPool = new Pool({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      family: 4
    });

    // Create PG Schema
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT DEFAULT 'account_manager',
        is_active     INTEGER DEFAULT 1,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS companies (
        id             SERIAL PRIMARY KEY,
        name           TEXT NOT NULL,
        elevator_pitch TEXT DEFAULT '',
        hq_location    TEXT DEFAULT 'Bangalore',
        logo_url       TEXT DEFAULT '',
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS company_roles (
        id         SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        role_title TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_company_assignments (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id               SERIAL PRIMARY KEY,
        company_id       INTEGER,
        created_by_user_id INTEGER,
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
        company_id          INTEGER,
        account_manager_id  INTEGER,
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
      { name: 'company_id',         def: "INTEGER DEFAULT 1" },
      { name: 'created_by_user_id', def: "INTEGER DEFAULT 1" },
      { name: 'company_name',       def: "TEXT DEFAULT 'Weekday'" },
      { name: 'location',           def: "TEXT DEFAULT 'Hybrid / Onsite'" },
      { name: 'max_notice_days',    def: "TEXT DEFAULT '30'" },
      { name: 'tech_stack',         def: "TEXT DEFAULT ''" },
      { name: 'target_cpa',         def: "TEXT DEFAULT ''" },
      { name: 'tone',               def: "TEXT DEFAULT 'warm'" },
      { name: 'language_mode',      def: "TEXT DEFAULT 'en-IN'" },
      { name: 'duration_target',    def: "INTEGER DEFAULT 5" },
      { name: 'voice_id',           def: "TEXT DEFAULT 'shimmer'" },
      { name: 'custom_questions',   def: "TEXT DEFAULT '[]'" }
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

    // Create tables with expanded recruiter parameters and RBAC
    sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT DEFAULT 'account_manager',
        is_active     INTEGER DEFAULT 1,
        created_at    TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS companies (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL,
        elevator_pitch TEXT DEFAULT '',
        hq_location    TEXT DEFAULT 'Bangalore',
        logo_url       TEXT DEFAULT '',
        created_at     TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS company_roles (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        role_title TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_company_assignments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id       INTEGER DEFAULT 1,
        created_by_user_id INTEGER DEFAULT 1,
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
        company_id          INTEGER,
        account_manager_id  INTEGER,
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

    await seedInitialDataSQLite();
    save();
    console.log('✓ Initialized SQLite Database (Local fallback)');
    return sqliteDb;
  }
}

async function seedInitialDataPG(pool) {
  try {
    const bcrypt = require('bcryptjs');
    const seedPairs = require('./seedData.json');

    // 1. Seed Admin user if users table is empty
    const userRes = await pool.query('SELECT COUNT(*) as cnt FROM users');
    if (parseInt(userRes.rows[0].cnt, 10) === 0) {
      const hash = await bcrypt.hash('weekday@123', 10);
      await pool.query(
        "INSERT INTO users (name, email, password_hash, role) VALUES ('Surad (Admin)', 'admin@weekday.cx', $1, 'admin')",
        [hash]
      );
      await pool.query(
        "INSERT INTO users (name, email, password_hash, role) VALUES ('Priya Sharma (AM)', 'priya@weekday.cx', $1, 'account_manager')",
        [hash]
      );
      await pool.query(
        "INSERT INTO users (name, email, password_hash, role) VALUES ('Rohan Mehta (AM)', 'rohan@weekday.cx', $1, 'account_manager')",
        [hash]
      );
    }

    // 2. Seed Companies & Roles from seedData.json if companies table is empty
    const compRes = await pool.query('SELECT COUNT(*) as cnt FROM companies');
    if (parseInt(compRes.rows[0].cnt, 10) === 0) {
      console.log(`[DB Seed] Seeding ${seedPairs.length} company-role pairs into PostgreSQL...`);
      const companyMap = new Map();

      for (const item of seedPairs) {
        const cName = item.companyName.trim();
        const rTitle = item.role.trim();

        let companyId = companyMap.get(cName);
        if (!companyId) {
          const insertComp = await pool.query(
            "INSERT INTO companies (name, elevator_pitch, hq_location) VALUES ($1, $2, 'Bangalore') RETURNING id",
            [cName, `${cName} tech team`]
          );
          companyId = insertComp.rows[0].id;
          companyMap.set(cName, companyId);
        }

        await pool.query(
          "INSERT INTO company_roles (company_id, role_title) VALUES ($1, $2)",
          [companyId, rTitle]
        );
      }
      console.log(`✓ Seeded ${companyMap.size} unique companies and ${seedPairs.length} roles.`);
    }
  } catch (err) {
    console.warn('[DB Seed PG] Warning:', err.message);
  }
}

async function seedInitialDataSQLite() {
  try {
    const bcrypt = require('bcryptjs');
    const seedPairs = require('./seedData.json');

    const userCount = sqliteDb.exec('SELECT COUNT(*) FROM users')[0]?.values[0]?.[0] || 0;
    if (userCount === 0) {
      const hash = bcrypt.hashSync('weekday@123', 10);
      sqliteDb.run("INSERT INTO users (name, email, password_hash, role) VALUES ('Surad (Admin)', 'admin@weekday.cx', ?, 'admin')", [hash]);
      sqliteDb.run("INSERT INTO users (name, email, password_hash, role) VALUES ('Priya Sharma (AM)', 'priya@weekday.cx', ?, 'account_manager')", [hash]);
      sqliteDb.run("INSERT INTO users (name, email, password_hash, role) VALUES ('Rohan Mehta (AM)', 'rohan@weekday.cx', ?, 'account_manager')", [hash]);
    }

    const compCount = sqliteDb.exec('SELECT COUNT(*) FROM companies')[0]?.values[0]?.[0] || 0;
    if (compCount === 0) {
      console.log(`[DB Seed] Seeding ${seedPairs.length} company-role pairs into SQLite...`);
      const companyMap = new Map();

      for (const item of seedPairs) {
        const cName = item.companyName.trim();
        const rTitle = item.role.trim();

        let companyId = companyMap.get(cName);
        if (!companyId) {
          sqliteDb.run("INSERT INTO companies (name, elevator_pitch, hq_location) VALUES (?, ?, 'Bangalore')", [cName, `${cName} tech team`]);
          companyId = sqliteDb.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
          companyMap.set(cName, companyId);
        }

        sqliteDb.run("INSERT INTO company_roles (company_id, role_title) VALUES (?, ?)", [companyId, rTitle]);
      }
      console.log(`✓ Seeded ${companyMap.size} unique companies and ${seedPairs.length} roles.`);
    }
  } catch (err) {
    console.warn('[DB Seed SQLite] Warning:', err.message);
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
