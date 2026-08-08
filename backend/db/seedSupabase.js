const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { Client } = require('pg');

// 1. Load DATABASE_URL from /Users/suhrad/Downloads/JD/.env using dotenv
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const jsonPath = '/Users/suhrad/Downloads/Company_Roles_Final_Clean_JDs.json';

async function seedSupabase() {
  console.log('[SeedSupabase] Starting Supabase PostgreSQL seeding process...');

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not defined in .env file');
    process.exit(1);
  }

  let connStr = process.env.DATABASE_URL;
  const directMatch = connStr.match(/db\.(\w+)\.supabase\.co/);
  if (directMatch) {
    const projectRef = directMatch[1];
    const urlParsed = new URL(connStr);
    const password = urlParsed.password;
    connStr = 'postgresql://postgres.' + projectRef + ':' + password + '@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
  }

  // 2. Connect directly to Supabase PostgreSQL with ssl: { rejectUnauthorized: false }
  const client = new Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('[SeedSupabase] Connected directly to Supabase PostgreSQL.');

    // 3. Delete ALL rows from: user_company_assignments, company_roles, companies, jobs (in that order to respect foreign keys)
    console.log('[SeedSupabase] Deleting rows from candidates (dependent on jobs)...');
    await client.query('DELETE FROM candidates');

    console.log('[SeedSupabase] Deleting rows from user_company_assignments...');
    await client.query('DELETE FROM user_company_assignments');

    console.log('[SeedSupabase] Deleting rows from company_roles...');
    await client.query('DELETE FROM company_roles');

    console.log('[SeedSupabase] Deleting rows from companies...');
    await client.query('DELETE FROM companies');

    console.log('[SeedSupabase] Deleting rows from jobs...');
    await client.query('DELETE FROM jobs');

    console.log('[SeedSupabase] All target tables cleared successfully.');

    // 4. Read /Users/suhrad/Downloads/Company_Roles_Final_Clean_JDs.json
    if (!fs.existsSync(jsonPath)) {
      console.error(`ERROR: JSON file not found at ${jsonPath}`);
      process.exit(1);
    }

    const rawData = fs.readFileSync(jsonPath, 'utf8');
    const entries = JSON.parse(rawData);
    console.log(`[SeedSupabase] Loaded ${entries.length} entries from ${jsonPath}`);

    // Map to keep track of inserted company names -> company_id
    const companyMap = new Map();

    for (const item of entries) {
      const cName = (item.companyName || item.company || 'Weekday').trim();
      const rTitle = (item.role || item.roleTitle || 'Software Engineer').trim();
      const jdText = (item.jd || item.jobDescription || '').trim();

      // Extract location if present in JD
      let location = 'Bangalore / Hybrid';
      const locMatch = jdText.match(/Location[:\s]+([^\n]+)/i);
      if (locMatch) {
        location = locMatch[1].trim();
      }

      // 5. Insert unique companies from the JSON (88 unique companies)
      if (!companyMap.has(cName)) {
        const insertCompRes = await client.query(
          `INSERT INTO companies (name, elevator_pitch, hq_location)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [cName, `${cName} Tech & Engineering`, location]
        );
        const compId = insertCompRes.rows[0].id;
        companyMap.set(cName, compId);
      }

      const companyId = companyMap.get(cName);

      // 6. Insert company_roles for each entry
      await client.query(
        `INSERT INTO company_roles (company_id, role_title)
         VALUES ($1, $2)
         ON CONFLICT (company_id, role_title) DO NOTHING`,
        [companyId, rTitle]
      );

      // 7. Insert into jobs table with jd_text from the JSON for each entry
      await client.query(
        `INSERT INTO jobs (company_id, created_by_user_id, title, company_name, location, jd_text)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [companyId, 1, rTitle, cName, location, jdText]
      );
    }

    // 8. Print final counts: companies, roles, jobs
    const compCountRes = await client.query('SELECT COUNT(*)::int as count FROM companies');
    const rolesCountRes = await client.query('SELECT COUNT(*)::int as count FROM company_roles');
    const jobsCountRes = await client.query('SELECT COUNT(*)::int as count FROM jobs');

    const companyCount = compCountRes.rows[0].count;
    const roleCount = rolesCountRes.rows[0].count;
    const jobCount = jobsCountRes.rows[0].count;

    console.log('\n================ FINAL SEED COUNTS ================');
    console.log(`Companies count: ${companyCount}`);
    console.log(`Roles count:     ${roleCount}`);
    console.log(`Jobs count:      ${jobCount}`);
    console.log('===================================================\n');

    await client.end();
    console.log('[SeedSupabase] Seeding completed successfully!');
  } catch (err) {
    console.error('[SeedSupabase] Error during execution:', err);
    await client.end().catch(() => {});
    process.exit(1);
  }
}

seedSupabase();
