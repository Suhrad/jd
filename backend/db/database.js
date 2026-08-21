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
  // Convert integer boolean literals for BOOLEAN columns in PostgreSQL
  // is_active is stored as BOOLEAN in PG but INTEGER in SQLite
  // Handle SET clause: is_active = 1 → is_active = TRUE
  converted = converted.replace(/\bis_active\s*=\s*1\b/gi, 'is_active = TRUE');
  converted = converted.replace(/\bis_active\s*=\s*0\b/gi, 'is_active = FALSE');
  // Handle INSERT VALUES tail: (..., 'admin', 1) → (..., 'admin', TRUE)
  // when the column list of the same INSERT contains is_active
  if (/\bis_active\b/.test(converted)) {
    // Match literal integer 1 or 0 at the very end of a VALUES(...) clause
    converted = converted.replace(/,\s*1(\s*\))/g, ', TRUE$1');
    converted = converted.replace(/,\s*0(\s*\))/g, ', FALSE$1');
  }
  return converted;
}

async function initDb() {
  if (isPg && pgPool) return pgPool;
  if (!isPg && sqliteDb) return sqliteDb;

  if (process.env.DATABASE_URL) {
    let connStr = process.env.DATABASE_URL;
    const directMatch = connStr.match(/db\.(\w+)\.supabase\.co/);
    if (directMatch) {
      const projectRef = directMatch[1];
      const urlParsed = new URL(connStr);
      const password = urlParsed.password;
      connStr = 'postgresql://postgres.' + projectRef + ':' + password + '@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
    }

    try {
      const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false }, family: 4, connectionTimeoutMillis: 5000 });
      await pool.query('SELECT 1'); // verify connection alive
      pgPool = pool;
      isPg = true;

      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL, role TEXT DEFAULT 'account_manager',
          is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS companies (
          id SERIAL PRIMARY KEY, name TEXT NOT NULL, elevator_pitch TEXT DEFAULT '',
          hq_location TEXT DEFAULT 'Bangalore', logo_url TEXT DEFAULT '',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS company_roles (
          id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
          role_title TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS user_company_assignments (
          id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS jobs (
          id SERIAL PRIMARY KEY, company_id INTEGER, created_by_user_id INTEGER,
          title TEXT NOT NULL, company_name TEXT DEFAULT 'Weekday',
          location TEXT DEFAULT 'Hybrid / Onsite', tonality TEXT DEFAULT 'warm',
          jd_text TEXT, questions_json TEXT, dealbreakers_json TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS candidates (
          id SERIAL PRIMARY KEY, job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
          created_by_user_id INTEGER, name TEXT NOT NULL, email TEXT, phone TEXT,
          status TEXT DEFAULT 'pending', recommendation TEXT,
          overall_score INTEGER, technical_score INTEGER, communication_score INTEGER, culture_score INTEGER,
          transcript_json TEXT, recording_url TEXT, call_health_json TEXT,
          duration_secs INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const pgJobCols = [
        ['company_id','INTEGER DEFAULT 1'],['created_by_user_id','INTEGER DEFAULT 1'],
        ['company_name',"TEXT DEFAULT 'Weekday'"],['location',"TEXT DEFAULT 'Hybrid / Onsite'"],
        ['max_notice_days',"TEXT DEFAULT '30'"],['tech_stack',"TEXT DEFAULT ''"],
        ['target_cpa',"TEXT DEFAULT ''"],['tone',"TEXT DEFAULT 'warm'"],
        ['language_mode',"TEXT DEFAULT 'en-IN'"],['duration_target','INTEGER DEFAULT 5'],
        ['voice_id',"TEXT DEFAULT 'shimmer'"],['recruiter_name',"TEXT DEFAULT 'Maya'"],
        ['custom_questions',"TEXT DEFAULT '[]'"],['requirements',"TEXT DEFAULT ''"]
      ];
      for (const [col, def] of pgJobCols) {
        try { await pgPool.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ' + col + ' ' + def); } catch (_) {}
      }

      const pgCandCols = [
        ['candidate_bio',"TEXT DEFAULT ''"],['recording_url',"TEXT DEFAULT ''"],
        ['call_health',"TEXT DEFAULT '{}'"],['incident_resolved','INTEGER DEFAULT 0'],
        ['talent_persona',"TEXT DEFAULT '{}'"],['vague_answers',"TEXT DEFAULT '[]'"],
        ['transcript','TEXT'],['summary','TEXT'],['highlights',"TEXT DEFAULT '[]'"],
        ['concerns',"TEXT DEFAULT '[]'"],['called_at','TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
        ['completed_at','TIMESTAMP'],['call_id','TEXT'],
        ['technical_score','INTEGER'],['communication_score','INTEGER'],['overall_score','INTEGER']
      ];
      for (const [col, def] of pgCandCols) {
        try { await pgPool.query('ALTER TABLE candidates ADD COLUMN IF NOT EXISTS ' + col + ' ' + def); } catch (_) {}
      }

      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS admin_notifications (
          id SERIAL PRIMARY KEY,
          am_user_id INTEGER,
          am_name TEXT,
          company_id INTEGER,
          company_name TEXT,
          role_title TEXT,
          review_status TEXT DEFAULT 'unreviewed',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS recruiter_personas (
          id SERIAL PRIMARY KEY,
          created_by_user_id INTEGER REFERENCES users(id),
          persona_name TEXT NOT NULL,
          recruiter_name TEXT NOT NULL,
          voice_id TEXT DEFAULT 'rachel',
          sample_transcripts_count INTEGER DEFAULT 1,
          style_dna JSONB NOT NULL,
          system_instructions TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      try { await pgPool.query("ALTER TABLE user_company_assignments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'"); } catch (_) {}
      try { await pgPool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_by_am_id INTEGER"); } catch (_) {}

      await seedInitialDataPG(pgPool);
      console.log('[DB] Connected to PostgreSQL (Production / Supabase)');
      return pgPool;
    } catch (pgErr) {
      console.warn('[DB] PostgreSQL unreachable, falling back to SQLite:', pgErr.message);
      isPg = false;
      pgPool = null;
      // FALL THROUGH to SQLite below
    }
  }

  // SQLite fallback
  isPg = false;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    sqliteDb = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    sqliteDb = new SQL.Database();
  }

  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT DEFAULT 'account_manager',
      is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, elevator_pitch TEXT DEFAULT '',
      hq_location TEXT DEFAULT 'Bangalore', logo_url TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS company_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      role_title TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_company_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER DEFAULT 1,
      created_by_user_id INTEGER DEFAULT 1, title TEXT NOT NULL,
      company_name TEXT DEFAULT 'Weekday', location TEXT DEFAULT 'Hybrid / Onsite',
      max_notice_days TEXT DEFAULT '30', tech_stack TEXT DEFAULT '', target_cpa TEXT DEFAULT '',
      tone TEXT DEFAULT 'warm', duration_target INTEGER DEFAULT 5, voice_id TEXT DEFAULT 'shimmer',
      custom_questions TEXT DEFAULT '[]', jd_text TEXT NOT NULL,
      requirements TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, company_id INTEGER,
      account_manager_id INTEGER, name TEXT NOT NULL, call_id TEXT,
      status TEXT DEFAULT 'pending', duration_secs INTEGER, transcript TEXT, summary TEXT,
      overall_score INTEGER, technical_score INTEGER, communication_score INTEGER,
      highlights TEXT DEFAULT '[]', concerns TEXT DEFAULT '[]', recommendation TEXT,
      called_at TEXT DEFAULT (datetime('now')), completed_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      am_user_id INTEGER, am_name TEXT, company_id INTEGER, company_name TEXT, role_title TEXT,
      review_status TEXT DEFAULT 'unreviewed', created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS recruiter_personas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_by_user_id INTEGER,
      persona_name TEXT NOT NULL,
      recruiter_name TEXT NOT NULL,
      voice_id TEXT DEFAULT 'rachel',
      sample_transcripts_count INTEGER DEFAULT 1,
      style_dna TEXT NOT NULL,
      system_instructions TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  try { sqliteDb.run("ALTER TABLE user_company_assignments ADD COLUMN status TEXT DEFAULT 'active'"); } catch (_) {}
  try { sqliteDb.run("ALTER TABLE companies ADD COLUMN created_by_am_id INTEGER"); } catch (_) {}

  const sqliteJobCols = [
    ['company_name',"TEXT DEFAULT 'Weekday'"],['location',"TEXT DEFAULT 'Hybrid / Onsite'"],
    ['max_notice_days',"TEXT DEFAULT '30'"],['tech_stack',"TEXT DEFAULT ''"],
    ['target_cpa',"TEXT DEFAULT ''"],['tone',"TEXT DEFAULT 'warm'"],
    ['language_mode',"TEXT DEFAULT 'en-IN'"],['duration_target','INTEGER DEFAULT 5'],
    ['voice_id',"TEXT DEFAULT 'shimmer'"],['custom_questions',"TEXT DEFAULT '[]'"]
  ];
  for (const [col, def] of sqliteJobCols) {
    try { sqliteDb.run('ALTER TABLE jobs ADD COLUMN ' + col + ' ' + def); } catch (_) {}
  }

  const sqliteCandCols = [
    ['candidate_bio',"TEXT DEFAULT ''"],['recording_url',"TEXT DEFAULT ''"],
    ['call_health',"TEXT DEFAULT '{}'"],['incident_resolved','INTEGER DEFAULT 0'],
    ['talent_persona',"TEXT DEFAULT '{}'"],['vague_answers',"TEXT DEFAULT '[]'"]
  ];
  for (const [col, def] of sqliteCandCols) {
    try { sqliteDb.run('ALTER TABLE candidates ADD COLUMN ' + col + ' ' + def); } catch (_) {}
  }

  await seedInitialDataSQLite();
  save();
  console.log('[DB] Initialized SQLite (Local / Offline fallback)');
  return sqliteDb;
}

async function seedInitialDataPG(pool) {
  try {
    const bcrypt = require('bcryptjs');
    const seedPairs = require('./seedData.json');

    // 1. Guarantee admin@weekday.com exists with password 'admin'
    const adminHash = await bcrypt.hash('admin', 10);
    const adminUser = await pool.query("SELECT id FROM users WHERE LOWER(email) = 'admin@weekday.com'");
    if (adminUser.rows.length > 0) {
      await pool.query("UPDATE users SET password_hash = $1, is_active = TRUE, role = 'admin' WHERE id = $2", [adminHash, adminUser.rows[0].id]);
      console.log('[DB Seed PG] ✓ Admin password synced for admin@weekday.com');
    } else {
      const legacyAdmin = await pool.query("SELECT id FROM users WHERE LOWER(email) = 'admin@weekday.cx'");
      if (legacyAdmin.rows.length > 0) {
        await pool.query("UPDATE users SET email = 'admin@weekday.com', password_hash = $1, is_active = TRUE, role = 'admin' WHERE id = $2", [adminHash, legacyAdmin.rows[0].id]);
        console.log('[DB Seed PG] ✓ Admin migrated from admin@weekday.cx to admin@weekday.com');
      } else {
        await pool.query("INSERT INTO users (name, email, password_hash, role, is_active) VALUES ('Admin', 'admin@weekday.com', $1, 'admin', TRUE)", [adminHash]);
        console.log('[DB Seed PG] ✓ Admin user created: admin@weekday.com');
      }
    }

    // 2. Seed Companies & Roles from seedData.json if companies count < 10
    const compRes = await pool.query('SELECT COUNT(*) as cnt FROM companies');
    const compCount = parseInt(compRes.rows[0].cnt, 10);
    if (compCount < 10) {
      console.log(`[DB Seed PG] Fast Batch Seeding ${seedPairs.length} company-role pairs into PostgreSQL (Supabase)...`);

      // Clear legacy data safely
      await pool.query('DELETE FROM user_company_assignments');
      await pool.query('DELETE FROM company_roles');
      await pool.query('DELETE FROM companies');

      // Extract unique company names safely
      const rawCompNames = seedPairs.map(p => (p.companyName || p.company || 'Weekday').trim());
      const companyNames = Array.from(new Set(rawCompNames));

      // Bulk Insert Companies via UNNEST
      const compInsertRes = await pool.query(`
        INSERT INTO companies (name, elevator_pitch, hq_location)
        SELECT name, name || ' tech team', 'Bangalore'
        FROM UNNEST($1::text[]) AS name
        RETURNING id, name
      `, [companyNames]);

      const companyIdMap = new Map();
      for (const row of compInsertRes.rows) {
        companyIdMap.set(row.name, row.id);
      }

      // Prepare Bulk Roles Insert
      const roleCompanyIds = [];
      const roleTitles = [];

      for (const item of seedPairs) {
        const cName = (item.companyName || item.company || 'Weekday').trim();
        const rTitle = (item.role || item.roleTitle || 'Software Engineer').trim();
        const cid = companyIdMap.get(cName);
        if (cid) {
          roleCompanyIds.push(cid);
          roleTitles.push(rTitle);
        }
      }

      // Bulk Insert Roles via UNNEST
      await pool.query(`
        INSERT INTO company_roles (company_id, role_title)
        SELECT cid, title
        FROM UNNEST($1::int[], $2::text[]) AS t(cid, title)
      `, [roleCompanyIds, roleTitles]);

      console.log(`✓ [DB Seed PG] Successfully batch-seeded ${companyIdMap.size} unique companies and ${roleCompanyIds.length} roles into PostgreSQL (Supabase).`);
    }

    const notifRes = await pool.query('SELECT COUNT(*) as cnt FROM admin_notifications');
    if (parseInt(notifRes.rows[0]?.cnt || 0) === 0) {
      await pool.query(`
        INSERT INTO admin_notifications (am_user_id, am_name, company_id, company_name, role_title, review_status)
        VALUES
          (2, 'Priya Sharma', 1, 'Weekday', 'Founding Chief of Staff / Product Ops', 'unreviewed'),
          (3, 'Rohan Mehta', 2, '100ms', 'AI Engineer & WebRTC Systems', 'unreviewed'),
          (2, 'Priya Sharma', 3, 'AtoB', 'Senior Fullstack Engineer', 'reviewed')
      `);
    }

    const personaRes = await pool.query('SELECT COUNT(*) as cnt FROM recruiter_personas');
    if (parseInt(personaRes.rows[0]?.cnt || 0) === 0) {
      const suhradDna = JSON.stringify({
        personaName: 'Suhrad (Founder & Tech Lead Style)',
        executiveSummary: 'High-agency, casual yet razor-sharp interviewer who evaluates real production depth and founder mentality.',
        rapportStyle: 'Immediate casual rapport, skips corporate fluff, focuses on what the candidate actually built.',
        signaturePhrases: [
          'Love that momentum.',
          'Help me understand the architectural trade-offs you made there...',
          'What broke in production when you scaled that, and how did you fix it?',
          'Fair enough, let\'s peel back that layer.',
          'If the founders gave you full ownership tomorrow, how would you approach this?'
        ],
        probingTechnique: 'Asks candidates about the hardest edge cases and trade-offs rather than textbook definitions.',
        pacingAndFlow: 'Punchy 1-2 sentence questions with natural back-and-forth flow.',
        pitchingCharisma: 'Pitches high-velocity growth, zero bureaucracy, and massive product ownership.',
        sampleGreeting: 'Hey! Suhrad here from the team. Super excited to chat with you today about what you\'ve been building and how you might shape this role.'
      });

      const priyaDna = JSON.stringify({
        personaName: 'Priya (Consultative Talent Partner)',
        executiveSummary: 'Warm, empathetic, highly structured talent leader who makes candidates feel deeply valued while systematically assessing culture fit and problem-solving.',
        rapportStyle: 'Warm and welcoming greeting, sets a collaborative and supportive atmosphere.',
        signaturePhrases: [
          'That makes total sense, thank you for sharing that context.',
          'Let\'s double-click on how you collaborated with your team on this...',
          'What was the biggest learning you took away from that experience?',
          'I really appreciate that transparency.'
        ],
        probingTechnique: 'Empathetic curiosity; gently explores team dynamics, conflict resolution, and core technical contributions.',
        pacingAndFlow: 'Smooth, steady, and conversational with thoughtful listening pauses.',
        pitchingCharisma: 'Pitches culture, mentorship, career trajectory, and healthy work-life integration.',
        sampleGreeting: 'Hi there! I\'m Priya. It\'s an absolute pleasure to connect with you today. We\'ll explore your background and answer any questions you have about the team.'
      });

      const neerjaDna = JSON.stringify({
        personaName: 'Neerja (Fast-Track Tech Recruiter)',
        executiveSummary: 'Crisp, articulate Bangalore tech corporate recruiter with authentic Indian cadence and rapid assessment.',
        rapportStyle: 'Polished Indian corporate English greeting, setting expectations clearly.',
        signaturePhrases: [
          'Great to connect with you today.',
          'Could you walk me through your hands-on contribution on that project?',
          'Understood, let us move to the next technical pillar.',
          'What is your current notice period and joining flexibility?'
        ],
        probingTechnique: 'Systematic verification of core tech stack, CTC expectations, and notice period constraints.',
        pacingAndFlow: 'Crisp, structured, and goal-oriented.',
        pitchingCharisma: 'Pitches top-tier compensation, scale, and tier-1 startup visibility.',
        sampleGreeting: 'Hello! I am Neerja. I will be guiding your initial technical screening today. Let us get started whenever you are ready.'
      });

      await pool.query(`
        INSERT INTO recruiter_personas (created_by_user_id, persona_name, recruiter_name, voice_id, style_dna, system_instructions)
        VALUES
          (1, 'Suhrad (Founder & Tech Lead Style)', 'Suhrad', 'adam', $1, 'YOU ARE ROLEPLAYING AS SUHRAD. You are high-energy, consultative, and sharp. Use signature phrases like \"Love that momentum\" and \"Help me understand the trade-offs\". When answers are vague, probe specifically for production edge cases without sounding aggressive.'),
          (1, 'Priya (Consultative Talent Partner)', 'Priya', 'rachel', $2, 'YOU ARE ROLEPLAYING AS PRIYA. You are warm, empathetic, and consultative. Use signature phrases like \"That makes total sense\" and \"Let\'s double-click on that\". Create a psychologically safe space for the candidate while evaluating their rigor.'),
          (1, 'Neerja (Fast-Track Tech Recruiter)', 'Neerja', 'neerja', $3, 'YOU ARE ROLEPLAYING AS NEERJA. You are crisp, professional, and structured. Maintain clear Indian English corporate cadence. Verify hands-on depth, notice period, and compensation alignment efficiently.')
      `, [suhradDna, priyaDna, neerjaDna]);
    }
  } catch (err) {
    console.warn('[DB Seed PG] Warning:', err.message);
  }
}

async function seedInitialDataSQLite() {
  try {
    const bcrypt = require('bcryptjs');
    const seedPairs = require('./seedData.json');

    const adminHash = bcrypt.hashSync('admin', 10);
    const adminUser = sqliteDb.exec("SELECT id FROM users WHERE LOWER(email) = 'admin@weekday.com'")[0]?.values?.[0]?.[0];
    if (adminUser) {
      sqliteDb.run("UPDATE users SET password_hash = ?, is_active = 1, role = 'admin' WHERE id = ?", [adminHash, adminUser]);
    } else {
      const legacyAdmin = sqliteDb.exec("SELECT id FROM users WHERE LOWER(email) = 'admin@weekday.cx'")[0]?.values?.[0]?.[0];
      if (legacyAdmin) {
        sqliteDb.run("UPDATE users SET email = 'admin@weekday.com', password_hash = ?, is_active = 1, role = 'admin' WHERE id = ?", [adminHash, legacyAdmin]);
      } else {
        sqliteDb.run("INSERT INTO users (name, email, password_hash, role, is_active) VALUES ('Admin', 'admin@weekday.com', ?, 'admin', 1)", [adminHash]);
      }
    }

    const compCount = sqliteDb.exec('SELECT COUNT(*) FROM companies')[0]?.values[0]?.[0] || 0;
    if (compCount < 100) {
      console.log(`[DB Seed SQLite] Seeding ${seedPairs.length} company-role pairs into SQLite...`);
      sqliteDb.run('DELETE FROM user_company_assignments');
      sqliteDb.run('DELETE FROM company_roles');
      sqliteDb.run('DELETE FROM companies');

      sqliteDb.run('BEGIN TRANSACTION');
      const companyMap = new Map();

      for (const item of seedPairs) {
        const cName = (item.companyName || item.company || 'Weekday').trim();
        const rTitle = (item.role || item.roleTitle || 'Software Engineer').trim();

        let companyId = companyMap.get(cName);
        if (!companyId) {
          sqliteDb.run("INSERT INTO companies (name, elevator_pitch, hq_location) VALUES (?, ?, 'Bangalore')", [cName, `${cName} tech team`]);
          companyId = sqliteDb.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
          companyMap.set(cName, companyId);
        }

        sqliteDb.run("INSERT INTO company_roles (company_id, role_title) VALUES (?, ?)", [companyId, rTitle]);
      }
      sqliteDb.run('COMMIT');
      console.log(`✓ Seeded ${companyMap.size} unique companies and ${seedPairs.length} roles into SQLite.`);
    }

    // Seed initial admin_notifications if empty so AM Additions activity table has initial records
    const notifCount = sqliteDb.exec('SELECT COUNT(*) FROM admin_notifications')[0]?.values[0]?.[0] || 0;
    if (parseInt(notifCount) === 0) {
      sqliteDb.run(
        "INSERT INTO admin_notifications (am_user_id, am_name, company_id, company_name, role_title, review_status) VALUES (?, ?, ?, ?, ?, 'unreviewed')",
        [2, 'Priya Sharma', 1, 'Weekday', 'Founding Chief of Staff / Product Ops']
      );
      sqliteDb.run(
        "INSERT INTO admin_notifications (am_user_id, am_name, company_id, company_name, role_title, review_status) VALUES (?, ?, ?, ?, ?, 'unreviewed')",
        [3, 'Rohan Mehta', 2, '100ms', 'AI Engineer & WebRTC Systems']
      );
      sqliteDb.run(
        "INSERT INTO admin_notifications (am_user_id, am_name, company_id, company_name, role_title, review_status) VALUES (?, ?, ?, ?, ?, 'reviewed')",
        [2, 'Priya Sharma', 3, 'AtoB', 'Senior Fullstack Engineer']
      );
    }

    const personaCount = sqliteDb.exec('SELECT COUNT(*) FROM recruiter_personas')[0]?.values[0]?.[0] || 0;
    if (parseInt(personaCount) === 0) {
      const suhradDna = JSON.stringify({
        personaName: 'Suhrad (Founder & Tech Lead Style)',
        executiveSummary: 'High-agency, casual yet razor-sharp interviewer who evaluates real production depth and founder mentality.',
        rapportStyle: 'Immediate casual rapport, skips corporate fluff, focuses on what the candidate actually built.',
        signaturePhrases: [
          'Love that momentum.',
          'Help me understand the architectural trade-offs you made there...',
          'What broke in production when you scaled that, and how did you fix it?',
          'Fair enough, let\'s peel back that layer.',
          'If the founders gave you full ownership tomorrow, how would you approach this?'
        ],
        probingTechnique: 'Asks candidates about the hardest edge cases and trade-offs rather than textbook definitions.',
        pacingAndFlow: 'Punchy 1-2 sentence questions with natural back-and-forth flow.',
        pitchingCharisma: 'Pitches high-velocity growth, zero bureaucracy, and massive product ownership.',
        sampleGreeting: 'Hey! Suhrad here from the team. Super excited to chat with you today about what you\'ve been building and how you might shape this role.'
      });

      const priyaDna = JSON.stringify({
        personaName: 'Priya (Consultative Talent Partner)',
        executiveSummary: 'Warm, empathetic, highly structured talent leader who makes candidates feel deeply valued while systematically assessing culture fit and problem-solving.',
        rapportStyle: 'Warm and welcoming greeting, sets a collaborative and supportive atmosphere.',
        signaturePhrases: [
          'That makes total sense, thank you for sharing that context.',
          'Let\'s double-click on how you collaborated with your team on this...',
          'What was the biggest learning you took away from that experience?',
          'I really appreciate that transparency.'
        ],
        probingTechnique: 'Empathetic curiosity; gently explores team dynamics, conflict resolution, and core technical contributions.',
        pacingAndFlow: 'Smooth, steady, and conversational with thoughtful listening pauses.',
        pitchingCharisma: 'Pitches culture, mentorship, career trajectory, and healthy work-life integration.',
        sampleGreeting: 'Hi there! I\'m Priya. It\'s an absolute pleasure to connect with you today. We\'ll explore your background and answer any questions you have about the team.'
      });

      const neerjaDna = JSON.stringify({
        personaName: 'Neerja (Fast-Track Tech Recruiter)',
        executiveSummary: 'Crisp, articulate Bangalore tech corporate recruiter with authentic Indian cadence and rapid assessment.',
        rapportStyle: 'Polished Indian corporate English greeting, setting expectations clearly.',
        signaturePhrases: [
          'Great to connect with you today.',
          'Could you walk me through your hands-on contribution on that project?',
          'Understood, let us move to the next technical pillar.',
          'What is your current notice period and joining flexibility?'
        ],
        probingTechnique: 'Systematic verification of core tech stack, CTC expectations, and notice period constraints.',
        pacingAndFlow: 'Crisp, structured, and goal-oriented.',
        pitchingCharisma: 'Pitches top-tier compensation, scale, and tier-1 startup visibility.',
        sampleGreeting: 'Hello! I am Neerja. I will be guiding your initial technical screening today. Let us get started whenever you are ready.'
      });

      sqliteDb.run(
        "INSERT INTO recruiter_personas (created_by_user_id, persona_name, recruiter_name, voice_id, style_dna, system_instructions) VALUES (?, ?, ?, ?, ?, ?)",
        [1, 'Suhrad (Founder & Tech Lead Style)', 'Suhrad', 'adam', suhradDna, 'YOU ARE ROLEPLAYING AS SUHRAD. You are high-energy, consultative, and sharp. Use signature phrases like "Love that momentum" and "Help me understand the trade-offs". When answers are vague, probe specifically for production edge cases without sounding aggressive.']
      );
      sqliteDb.run(
        "INSERT INTO recruiter_personas (created_by_user_id, persona_name, recruiter_name, voice_id, style_dna, system_instructions) VALUES (?, ?, ?, ?, ?, ?)",
        [1, 'Priya (Consultative Talent Partner)', 'Priya', 'rachel', priyaDna, 'YOU ARE ROLEPLAYING AS PRIYA. You are warm, empathetic, and consultative. Use signature phrases like "That makes total sense" and "Let\'s double-click on that". Create a psychologically safe space for the candidate while evaluating their rigor.']
      );
      sqliteDb.run(
        "INSERT INTO recruiter_personas (created_by_user_id, persona_name, recruiter_name, voice_id, style_dna, system_instructions) VALUES (?, ?, ?, ?, ?, ?)",
        [1, 'Neerja (Fast-Track Tech Recruiter)', 'Neerja', 'neerja', neerjaDna, 'YOU ARE ROLEPLAYING AS NEERJA. You are crisp, professional, and structured. Maintain clear Indian English corporate cadence. Verify hands-on depth, notice period, and compensation alignment efficiently.']
      );
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
  if (!sqliteDb && !pgPool) {
    await initDb();
  }
  if (isPg && pgPool) {
    const isInsert = /^\s*INSERT/i.test(sql);
    let pgSql = convertSqlForPg(sql);
    if (isInsert && !/RETURNING/i.test(pgSql)) {
      pgSql += ' RETURNING id';
    }
    const res = await pgPool.query(pgSql, params);
    const lastInsertRowid = isInsert ? (res.rows[0]?.id || null) : null;
    return { lastInsertRowid, changes: res.rowCount };
  } else if (sqliteDb) {
    sqliteDb.run(sql, params);
    const lastInsertRowid = sqliteDb.exec('SELECT last_insert_rowid() as id')[0]?.values[0]?.[0] ?? null;
    save();
    return { lastInsertRowid, changes: sqliteDb.getRowsModified() };
  }
  return { lastInsertRowid: null, changes: 0 };
}

async function all(sql, params = []) {
  if (!sqliteDb && !pgPool) {
    await initDb();
  }
  if (isPg && pgPool) {
    const pgSql = convertSqlForPg(sql);
    const res = await pgPool.query(pgSql, params);
    return res.rows;
  } else if (sqliteDb) {
    const stmt = sqliteDb.prepare(sql);
    const rows = [];
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
  return [];
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows.length ? rows[0] : null;
}

module.exports = { initDb, run, all, get, save, getIsPg: () => isPg };
