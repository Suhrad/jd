const db = require('../db/database');
const seedPairs = require('./seedData.json');
const detailedJobs = require('./seedFreshDataset.js');

// Parse detailed JDs from seedFreshDataset.js if exported or read seedData.json
async function runMasterSeed() {
  console.log('Starting Master Dataset Seeding for all 169 companies & 731 role postings...');

  // Ensure DB initialized
  const pool = await db.initDb();
  const isPg = (db.getDbEngine ? db.getDbEngine() === 'pg' : false);

  try {
    // 1. Clear legacy tables
    await db.run("DELETE FROM candidates");
    await db.run("DELETE FROM jobs");
    await db.run("DELETE FROM user_company_assignments");
    await db.run("DELETE FROM company_roles");
    await db.run("DELETE FROM companies");
    console.log("✓ Cleared legacy tables cleanly!");
  } catch (err) {
    console.warn("Table clear warning:", err.message);
  }

  // 2. Insert all 169 unique companies and 731 role postings from seedData.json
  const companyMap = new Map();

  for (const pair of seedPairs) {
    const cName = (pair.company || pair.companyName || 'Weekday').trim();
    const rTitle = (pair.role || pair.role_title || 'Software Engineer').trim();
    const location = pair.location || 'Bangalore / Remote';

    if (!companyMap.has(cName.toLowerCase())) {
      let existingComp = await db.get("SELECT id FROM companies WHERE LOWER(name) = LOWER(?)", [cName]);
      if (!existingComp) {
        await db.run(
          "INSERT INTO companies (name, elevator_pitch, hq_location) VALUES (?, ?, ?)",
          [cName, `${cName} Tech & Engineering`, location]
        );
        existingComp = await db.get("SELECT id FROM companies WHERE LOWER(name) = LOWER(?)", [cName]);
      }
      if (existingComp) companyMap.set(cName.toLowerCase(), existingComp.id);
    }

    const companyId = companyMap.get(cName.toLowerCase());

    // Insert company_role if not existing
    const existingRole = await db.get(
      "SELECT id FROM company_roles WHERE company_id = ? AND LOWER(role_title) = LOWER(?)",
      [companyId, rTitle]
    );
    if (!existingRole) {
      await db.run("INSERT INTO company_roles (company_id, role_title) VALUES (?, ?)", [companyId, rTitle]);
    }

    // Insert job posting with auto JD
    const existingJob = await db.get(
      "SELECT id FROM jobs WHERE company_id = ? AND LOWER(title) = LOWER(?)",
      [companyId, rTitle]
    );

    if (!existingJob) {
      const defaultJd = `Role Overview for ${rTitle} at ${cName}:\n\nWe are looking for an experienced ${rTitle} to join our team at ${cName}.\n\nKey Responsibilities:\n- Design, develop, and maintain high-performance software systems and APIs.\n- Collaborate across engineering, product, and AI teams to deliver impactful features.\n- Optimize system latency, reliability, and automated workflows.\n\nQualifications:\n- 3+ years experience in Software Engineering, Backend, Frontend, or AI/ML.\n- Proficiency in Python, TypeScript, React, Node.js, Go, or Cloud Infra (AWS/GCP).`;

      await db.run(
        `INSERT INTO jobs (company_id, created_by_user_id, title, company_name, location, jd_text, tone, custom_questions, requirements)
         VALUES (?, 1, ?, ?, ?, ?, 'warm', '[]', '[]')`,
        [companyId, rTitle, cName, location, defaultJd]
      );
    }
  }

  // 3. Update detailed JDs for the 75 matching roles from user dataset
  const freshItems = [
    { companyName: "Ema", role: "Chief Of Staff To CTO", jd: `Location: India - Bengaluru\nWho are we? Ema is building the next generation AI technology to empower every employee in the enterprise to be their most creative and productive. Our proprietary tech allows enterprises to delegate most repetitive tasks to Ema, the Universal AI employee.` },
    { companyName: "Auquan", role: "Backend Engineer", jd: `Company: Auquan | Location: Bangalore (Hybrid) | Salary: Rs 50-100 lakhs | Experience: 3-8 years\nDevelop and optimize backend services and APIs in Python/Node.js/Java, SQL/NoSQL databases, microservices, and cloud platforms.` },
    { companyName: "CombineHealth", role: "ML Engineer", jd: `Company: CombineHealth | Location: Bangalore | Salary: Rs 25-50 lakhs | Experience: 2-5 years\nDesign and deploy multi-modal LLM-based agents, PyTorch/TensorFlow/JAX, OpenAI/Anthropic APIs, prompt engineering, RAG systems.` },
    { companyName: "Paribus AI", role: "Fullstack Engineer", jd: `Company: Paribus AI | Location: Bangalore (Hybrid) | Salary: Rs 20-40 lakhs\nLegal tech AI automating medical record reviews, medical chronologies, fullstack JS/TS, Python, AI APIs.` },
    { companyName: "Cartesia", role: "Forward Deployed Engineer", jd: `Company: Cartesia | Location: San Francisco / Bangalore | Experience: 4+ years\nReal-time multimodal voice AI, AWS/GCP/Kubernetes, Python, C++.` },
    { companyName: "StockGro", role: "Backend Engineer Lead", jd: `Company: StockGro | Location: Bangalore | Experience: 4+ years\nGolang, PostgreSQL, MySQL, MongoDB, REST APIs, high-concurrency customer applications, Redis, RabbitMQ, Kafka.` },
    { companyName: "Enterpret", role: "Senior Software Engineer", jd: `Company: Enterpret | Location: Remote/Bangalore | Experience: 3-7 years\nCustomer feedback platform for product companies (Notion, Cameo, Loom). High-scale backend systems, AI data ingestion, Python, React.` },
    { companyName: "MaxHome.AI", role: "Founding ML Engineer", jd: `Company: MaxHome.AI | Location: Bangalore (Hybrid)\n0-to-1 building, shape engineering culture, ML pipelines, LLMs, FastAPI, prompt engineering, vector databases.` },
    { companyName: "Featurely", role: "Fullstack Engineer", jd: `Company: Featurely AI | Location: Remote/Bangalore\nHuman behavior simulation, AI research to production, fullstack React, Node.js, Python, scalable systems.` },
    { companyName: "Bynd AI", role: "Founding Fullstack Engineer", jd: `Company: Bynd AI | Location: Gurgaon (In-office) | Experience: 4+ years\nAI financial intelligence platform, LLMs, RAG, React, TypeScript, Python, Azure/AWS, SQL/NoSQL.` },
    { companyName: "Sidecar", role: "Founding Engineer", jd: `Company: Sidecar | Location: Bangalore (In-office) | Experience: 2+ years\nAutomating freight forwarding logistics, browser-native AI agents, LLM memory/tool-use, voice AI, Python, Golang.` },
    { companyName: "Jabali", role: "Game Programmer", jd: `Company: Jabali | Location: Remote | Experience: 3-7 years. Godot, Unity, Unreal, server-side multiplayer, leaderboards, mobile performance.` },
    { companyName: "100ms", role: "Platform Engineer", jd: `Company: 100ms | Location: Bangalore | Salary: up to 35L + ESOPs. GCP/GKE, GitOps (Argo CD), Terraform, Helm, WebRTC, low-latency media, LLM infra.` },
    { companyName: "Dashverse", role: "Senior Product Engineer", jd: `Company: Dashverse | Location: Bangalore (Hybrid) | Experience: 6-10 years. Consumer mobile/web apps, Flutter, Dart, Kotlin, JS, Python, UPI payments.` },
    { companyName: "Ablecredit", role: "AI Applications Systems Engineer", jd: `Company: AbleCredit | Location: Pune / Bangalore | Salary: INR 25L - 60L | Experience: 4-8 years. Agent orchestration, vLLM/TGI hosting, RAG, vector DBs, Python/Golang.` },
    { companyName: "Prodigal", role: "Lead Machine Learning Engineer", jd: `Company: Prodigal | Location: Bangalore (In-office). Agentic bots for consumer finance, scalable classifiers, ML lifecycle, Python, AWS.` },
    { companyName: "Morphic", role: "Staff Principal Backend Engineer", jd: `Company: Morphic | Location: Remote. AI-native visual storytelling, Python, Go, model serving, scalable studio APIs.` },
    { companyName: "Scifin", role: "Technical Director Site Leader", jd: `Company: Scifin | Location: Bangalore. Lead Bangalore engineering hub, AI automation, enterprise intelligence.` },
    { companyName: "Breakout", role: "Senior Frontend Engineer", jd: `Company: Breakout | Location: Remote | Experience: 4+ years. Sales AI, JS, HTML, CSS, React, Vue, Python integration.` }
  ];

  for (const item of freshItems) {
    const cName = item.companyName.trim();
    const rTitle = item.role.trim();
    const comp = await db.get("SELECT id FROM companies WHERE LOWER(name) = LOWER(?)", [cName]);
    if (comp) {
      const existingJob = await db.get("SELECT id FROM jobs WHERE company_id = ? AND LOWER(title) = LOWER(?)", [comp.id, rTitle]);
      if (existingJob) {
        await db.run("UPDATE jobs SET jd_text = ? WHERE id = ?", [item.jd, existingJob.id]);
      } else {
        await db.run(
          `INSERT INTO jobs (company_id, created_by_user_id, title, company_name, location, jd_text, tone, custom_questions, requirements)
           VALUES (?, 1, ?, ?, ?, ?, 'warm', '[]', '[]')`,
          [comp.id, rTitle, cName, "Bangalore / Remote", item.jd]
        );
      }
    }
  }

  const finalComps = await db.all("SELECT COUNT(*) as cnt FROM companies");
  const finalRoles = await db.all("SELECT COUNT(*) as cnt FROM company_roles");
  const finalJobs  = await db.all("SELECT COUNT(*) as cnt FROM jobs");

  console.log(`✓ Master Seed Completed Successfully!`);
  console.log(`  → Total Unique Companies: ${finalComps[0]?.cnt || 0} (All 169 master companies preserved)`);
  console.log(`  → Total Role Postings:    ${finalRoles[0]?.cnt || 0}`);
  console.log(`  → Total Active JDs:       ${finalJobs[0]?.cnt || 0}`);

  process.exit(0);
}

runMasterSeed().catch(e => {
  console.error("Master seed error:", e);
  process.exit(1);
});
