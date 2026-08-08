const db = require('../db/database');
const fs = require('fs');
const path = require('path');

const cleanFile = '/Users/suhrad/Downloads/Company_Roles_Final_Clean_JDs.json';

async function seedCleanFile() {
  if (!fs.existsSync(cleanFile)) {
    console.error('Clean JSON file not found at:', cleanFile);
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync(cleanFile, 'utf8'));
  console.log(`Loaded ${rawData.length} entries from Company_Roles_Final_Clean_JDs.json`);

  // Initialize Database
  await db.initDb();

  // 1. Wipe legacy data completely
  try {
    await db.run("DELETE FROM candidates");
    await db.run("DELETE FROM jobs");
    await db.run("DELETE FROM user_company_assignments");
    await db.run("DELETE FROM company_roles");
    await db.run("DELETE FROM companies");
    console.log("✓ Cleared all previous companies, roles, jobs, and candidates!");
  } catch (err) {
    console.warn("Table clear warning:", err.message);
  }

  const companyMap = new Map();

  for (const item of rawData) {
    const cName = (item.companyName || item.company || 'Weekday').trim();
    const rTitle = (item.role || item.roleTitle || 'Software Engineer').trim();
    const jdText = (item.jd || item.jobDescription || '').trim();

    // Extract location if present in JD
    let location = 'Bangalore / Hybrid';
    const locMatch = jdText.match(/Location[:\s]+([^\n]+)/i);
    if (locMatch) {
      location = locMatch[1].trim();
    }

    if (!companyMap.has(cName.toLowerCase())) {
      let comp = await db.get("SELECT id FROM companies WHERE LOWER(name) = LOWER(?)", [cName]);
      if (!comp) {
        await db.run(
          "INSERT INTO companies (name, elevator_pitch, hq_location) VALUES (?, ?, ?)",
          [cName, `${cName} Tech & Engineering`, location]
        );
        comp = await db.get("SELECT id FROM companies WHERE LOWER(name) = LOWER(?)", [cName]);
      }
      if (comp) companyMap.set(cName.toLowerCase(), comp.id);
    }

    const companyId = companyMap.get(cName.toLowerCase());

    // Insert company_roles entry
    const existingRole = await db.get(
      "SELECT id FROM company_roles WHERE company_id = ? AND LOWER(role_title) = LOWER(?)",
      [companyId, rTitle]
    );
    if (!existingRole) {
      await db.run("INSERT INTO company_roles (company_id, role_title) VALUES (?, ?)", [companyId, rTitle]);
    }

    // Insert job posting with full JD text
    const existingJob = await db.get(
      "SELECT id FROM jobs WHERE company_id = ? AND LOWER(title) = LOWER(?)",
      [companyId, rTitle]
    );

    if (!existingJob) {
      await db.run(
        `INSERT INTO jobs (company_id, created_by_user_id, title, company_name, location, jd_text, tone, custom_questions, requirements)
         VALUES (?, 1, ?, ?, ?, ?, 'warm', '[]', '[]')`,
        [companyId, rTitle, cName, location, jdText]
      );
    } else {
      await db.run(
        `UPDATE jobs SET jd_text = ? WHERE id = ?`,
        [jdText, existingJob.id]
      );
    }
  }

  const finalComps = await db.all("SELECT COUNT(*) as cnt FROM companies");
  const finalRoles = await db.all("SELECT COUNT(*) as cnt FROM company_roles");
  const finalJobs  = await db.all("SELECT COUNT(*) as cnt FROM jobs");

  console.log(`✓ Clean Seeding Complete from Company_Roles_Final_Clean_JDs.json!`);
  console.log(`  → Total Unique Companies: ${finalComps[0]?.cnt || 0}`);
  console.log(`  → Total Unique Roles:     ${finalRoles[0]?.cnt || 0}`);
  console.log(`  → Total Active Jobs/JDs:  ${finalJobs[0]?.cnt || 0}`);

  process.exit(0);
}

seedCleanFile().catch(err => {
  console.error("Clean file seeding failed:", err);
  process.exit(1);
});
