const db = require('../db/database');
const fs = require('fs');
const path = require('path');

// Master raw seed dataset from user
const rawJobs = [
  {
    companyName: "Ema",
    role: "Chief Of Staff To CTO",
    jd: `Location
India - Bengaluru
Who are we?
Ema is building the next generation AI technology to empower every employee in the enterprise to be their most creative and productive. Our proprietary tech allows enterprises to delegate most repetitive tasks to Ema, the Universal AI employee. We are founded by ex-Google, Coinbase, Okta executives, and serial entrepreneurs. We’re well-funded by the top investors and angels in the world. Ema is based in Silicon Valley and Bangalore. This will be a hybrid role where we expect employees to work from office three days a week.
Role Overview
As Chief of Staff to the CTO at Ema, you will be responsible for execution support, cross-functional coordination, and strategic operations. You’ll act as the right-hand person to the CTO, ensuring the technology organization is operating efficiently and effectively. This role requires a structured, highly organized individual with a technical background, strong communication skills, and the ability to drive execution in a fast-moving startup environment. The ideal candidate is a problem solver who thrives in ambiguity, can juggle multiple priorities, and enjoys bringing order to chaos.
Requirements: 5+ years experience in tech industry (Engineering, Product, or Technical Program Management). Technical background in CS or Engineering.`
  },
  {
    companyName: "Ema",
    role: "Technical Account Manager",
    jd: `Technical Account Manager - Agentic AI Platform at Ema
Remote / Hybrid
About Ema: Ema is redefining how work gets done by building the next generation of agentic AI technology to empower every employee to be their most creative and productive.
Required Skills: 5+ years in a Technical Account Manager, Customer Success, or Solutions Architect role within Enterprise SaaS or AI platforms. Strong understanding of AI technologies, cloud services, and enterprise integrations.`
  },
  {
    companyName: "Ema",
    role: "Backend Engineer",
    jd: `Role: Backend Engineer | Location: Bangalore | Salary: Rs 35-50 lakhs per year | Experience: 4+ years
You will build scalable and reliable back-end systems using Go and Python, REST/GraphQL APIs, FastAPI, PostgreSQL, Redshift, Docker, Kubernetes, and cloud infrastructure.`
  },
  {
    companyName: "Ema",
    role: "Platform Engineer",
    jd: `Role: Platform Engineer | Location: Bangalore | Experience: 2-8 years
Assist in designing, implementing, and maintaining scalable microservices architectures using Docker and Kubernetes across GCP, Azure, and AWS using Golang and Python.`
  },
  {
    companyName: "Ema",
    role: "Infrastructure Team Leader",
    jd: `Role: Platform & Infrastructure Team Leader | Location: Bangalore | Experience: 10+ years
Lead the design and architecture of complex, scalable platforms, Python, Go, document knowledge management systems, AI pipelines, PostgreSQL, Elasticsearch, Docker, Kubernetes.`
  },
  {
    companyName: "Auquan",
    role: "Backend Engineer",
    jd: `Company: Auquan | Location: Bangalore (Hybrid) | Salary: Rs 50-100 lakhs | Experience: 3-8 years
Develop and optimize backend services and APIs in Python/Node.js/Java, SQL/NoSQL databases, microservices, and cloud platforms.`
  },
  {
    companyName: "CombineHealth",
    role: "ML Engineer",
    jd: `Company: CombineHealth | Location: Bangalore | Salary: Rs 25-50 lakhs | Experience: 2-5 years
Design and deploy multi-modal LLM-based agents, PyTorch/TensorFlow/JAX, OpenAI/Anthropic APIs, prompt engineering, RAG systems, LangChain/AutoGen/CrewAI.`
  },
  {
    companyName: "Ema",
    role: "Devops Engineer",
    jd: `Role: DevOps Engineer | Location: Bangalore | Salary: Rs 40-60 lakhs | Experience: 4-9 years
Design, deploy, manage cloud infrastructure (AWS/GCP/Azure), CI/CD pipelines (Jenkins, GitLab), containerization (Docker, Kubernetes), Terraform, Ansible, Prometheus, Grafana.`
  },
  {
    companyName: "Ema",
    role: "Sales Development Representative",
    jd: `Role: SDR | Location: Silicon Valley & Bangalore | Experience: 3+ years in SaaS/Tech sales
Lead generation, outbound outreach (LinkedIn, Email sequencing, cold calls), HubSpot, ICP qualification.`
  },
  {
    companyName: "Ema",
    role: "ML Engineer",
    jd: `Role: Machine Learning Engineer | Location: Bangalore | Degree: Master's or PhD preferred
Conceptualize, develop, deploy ML models for NLP, retrieval, ranking, reasoning, dialog, transformer-based models, PyTorch, TensorFlow, MLOps.`
  },
  {
    companyName: "Ema",
    role: "Platform Product Manager",
    jd: `Role: Platform PM | Location: Bangalore | Experience: 5+ years
Define vision and roadmap for core infrastructure, agentic and generative AI platform capabilities, backend systems at scale.`
  },
  {
    companyName: "StockGro",
    role: "Backend Engineer Lead",
    jd: `Company: StockGro | Location: Bangalore | Experience: 4+ years
Golang, PostgreSQL, MySQL, MongoDB, REST APIs, high-concurrency customer applications, Redis, RabbitMQ, Kafka, GCP, Kubernetes, Docker.`
  },
  {
    companyName: "Enterpret",
    role: "Senior Software Engineer",
    jd: `Company: Enterpret | Location: Remote/Bangalore | Experience: 3-7 years
Customer feedback platform for product companies (Notion, Cameo, Loom). High-scale backend systems, AI data ingestion, Python, React.`
  },
  {
    companyName: "StockGro",
    role: "Sr Product Manager",
    jd: `Company: StockGro | Location: Bangalore | Experience: 4+ years
Fintech platforms, trading, wealth management, agile/scrum, user-focused investment features.`
  },
  {
    companyName: "Ema",
    role: "Staff Software Engineer",
    jd: `Role: Staff Software Engineer | Location: Bangalore | Salary: Rs 60-90 lakhs | Experience: 7-10 years
Architect and build core Universal AI Teammate platform, technical leadership, Python, Java, Node.js, AI/ML production scaling, AWS/GCP/Azure.`
  },
  {
    companyName: "Clerky",
    role: "Senior Software Engineer",
    jd: `Company: Clerky | Location: Remote
Bootstrapped, profitable startup legal paperwork platform for DoorDash, Coinbase, Instacart. Core senior full-stack engineer, AI-native tools.`
  },
  {
    companyName: "Paribus AI",
    role: "Fullstack Engineer",
    jd: `Company: Paribus AI | Location: Bangalore (Hybrid) | Salary: Rs 20-40 lakhs
Legal tech AI automating medical record reviews, medical chronologies, fullstack JS/TS, Python, AI APIs.`
  },
  {
    companyName: "Ema",
    role: "Deployment Engineer",
    jd: `Role: Deployment Engineer | Location: Bangalore | Experience: 2+ years
Cloud infrastructure (GCP, Azure, AWS), Terraform, Ansible, CI/CD (GitLab, Jenkins), Prometheus, Grafana, Datadog.`
  },
  {
    companyName: "Ema",
    role: "AI Application Engineer",
    jd: `Role: AI Application Engineer | Location: Bangalore | Salary: Rs 20-30 lakhs | Experience: 2-4 years
GenAI challenges for Fortune 500 companies, customer requirements analysis, Python data transformation, REST APIs, enterprise SaaS.`
  },
  {
    companyName: "Ema",
    role: "Frontend Engineer",
    jd: `Role: Frontend Engineer | Location: Bangalore | Salary: Rs 35-50 lakhs | Experience: 4+ years
Agentic AI web experiences, React, Next.js, Vue, Angular, TypeScript, HTML/CSS, REST/gRPC API integration.`
  },
  {
    companyName: "MaxHome.AI",
    role: "Founding ML Engineer",
    jd: `Company: MaxHome.AI | Location: Bangalore (Hybrid)
0-to-1 building, shape engineering culture, ML pipelines, LLMs, FastAPI, prompt engineering, vector databases.`
  },
  {
    companyName: "Featurely",
    role: "Fullstack Engineer",
    jd: `Company: Featurely AI | Location: Remote/Bangalore
Human behavior simulation, AI research to production, fullstack React, Node.js, Python, scalable systems.`
  },
  {
    companyName: "Bynd AI",
    role: "Founding Fullstack Engineer",
    jd: `Company: Bynd AI | Location: Gurgaon (In-office) | Experience: 4+ years
AI financial intelligence platform, LLMs, RAG, React, TypeScript, Python, Azure/AWS, SQL/NoSQL.`
  },
  {
    companyName: "Sidecar",
    role: "Founding Engineer",
    jd: `Company: Sidecar | Location: Bangalore (In-office) | Experience: 2+ years
Automating freight forwarding logistics, browser-native AI agents, LLM memory/tool-use, voice AI, Python, Golang.`
  },
  {
    companyName: "Jabali",
    role: "Game Programmer",
    jd: "Company: Jabali | Location: Remote | Experience: 3-7 years. Godot, Unity, Unreal, server-side multiplayer, leaderboards, mobile performance."
  },
  {
    companyName: "100ms",
    role: "Platform Engineer",
    jd: "Company: 100ms | Location: Bangalore | Salary: up to 35L + ESOPs. GCP/GKE, GitOps (Argo CD), Terraform, Helm, WebRTC, low-latency media, LLM infra."
  },
  {
    companyName: "Dashverse",
    role: "Senior Product Engineer",
    jd: "Company: Dashverse | Location: Bangalore (Hybrid) | Experience: 6-10 years. Consumer mobile/web apps, Flutter, Dart, Kotlin, JS, Python, UPI payments, video feed."
  },
  {
    companyName: "Ablecredit",
    role: "AI Applications Systems Engineer",
    jd: "Company: AbleCredit | Location: Pune / Bangalore | Salary: INR 25L - 60L | Experience: 4-8 years. Agent orchestration, vLLM/TGI hosting, RAG, vector DBs, Python/Golang, FastAPI."
  },
  {
    companyName: "Prodigal",
    role: "Lead Machine Learning Engineer",
    jd: "Company: Prodigal | Location: Bangalore (In-office). Agentic bots for consumer finance, scalable classifiers, ML lifecycle, Python, AWS."
  },
  {
    companyName: "Morphic",
    role: "Staff Principal Backend Engineer",
    jd: "Company: Morphic | Location: Remote. AI-native visual storytelling, Python, Go, model serving, scalable studio APIs."
  },
  {
    companyName: "Scifin",
    role: "Technical Director Site Leader",
    jd: "Company: Scifin | Location: Bangalore. Lead Bangalore engineering hub, AI automation, enterprise intelligence."
  },
  {
    companyName: "Breakout",
    role: "Senior Frontend Engineer",
    jd: "Company: Breakout | Location: Remote | Experience: 4+ years. Sales AI, JS, HTML, CSS, React, Vue, Python integration, REST APIs."
  },
  {
    companyName: "Cartesia",
    role: "Forward Deployed Engineer",
    jd: "Company: Cartesia | Location: San Francisco / Bangalore | Experience: 4+ years. Real-time multimodal voice AI, AWS/GCP/Kubernetes, Python, C++."
  },
  {
    companyName: "Saaf Finance",
    role: "AI Engineer",
    jd: "Company: Saaf Finance | Location: Remote. Mortgage operations AI, structured financial data, Python, LLMs."
  },
  {
    companyName: "Fuze Finance",
    role: "Backend Engineer",
    jd: "Company: Fuze Finance | Location: Remote. Regulated crypto & digital asset infrastructure, Go, Python, microservices."
  },
  {
    companyName: "Trackk",
    role: "Senior Devops Engineer",
    jd: "Company: Trackk | Location: Mumbai (In-office). Next-gen GenZ trading platform, cloud architecture, CI/CD, high concurrency."
  },
  {
    companyName: "Cartesia",
    role: "Research Engineer",
    jd: "Company: Cartesia | Location: San Francisco / Bangalore. Multilingual speech datasets, generative models, PyTorch, evaluation metrics."
  },
  {
    companyName: "Pavo AI",
    role: "Research ML Engineer",
    jd: "Company: Pavo AI | Location: London / Bangalore | Experience: 5+ years. Long-horizon agent memory, search & retrieval, RL, PyTorch."
  },
  {
    companyName: "Pavo AI",
    role: "Founding Systems Engineer Infrastructure",
    jd: "Company: Pavo AI | Location: London / Remote | Experience: 8+ years. Core database engine, Kubernetes, container sandboxing (gVisor/Firecracker), Go/Python."
  },
  {
    companyName: "Tote.AI",
    role: "Product Manager",
    jd: "Company: Tote.AI | Location: Jaipur (In-office). AI-powered product workflows, 0-to-1 PM, user research."
  },
  {
    companyName: "Globeia",
    role: "Senior Fullstack Developer",
    jd: "Company: Globeia | Location: Gurugram | Salary: Rs 30-40L | Experience: 4+ years. Microservices, Node.js/Golang, AWS, Docker, Kubernetes, React/Next.js."
  },
  {
    companyName: "GoGuardian",
    role: "QA Lead",
    jd: "Company: GoGuardian | Location: Remote | Experience: 6+ years. Test automation frameworks, CI/CD, release quality gates."
  },
  {
    companyName: "Hyde",
    role: "AI Builder",
    jd: "Company: Hyde | Location: Mumbai. LLM orchestration, agentic systems, RAG, Python/TypeScript/Java/C++."
  },
  {
    companyName: "Clara AI",
    role: "Cofounderhead Of Productfounding Pm",
    jd: "Company: Clara AI | Location: Bangalore | Experience: 0-to-1 vertical AI SaaS, multi-agent systems."
  },
  {
    "companyName": "Meru Data",
    "role": "Net Developer",
    "jd": "Company: Meru Data | Location: Hyderabad | Experience: 3+ years. .NET Core, C#, ASP.NET Web API, Angular, TypeScript, SQL Server, Azure."
  },
  {
    "companyName": "Truva",
    "role": "Uiux Designer",
    "jd": "Company: Truva | Location: Bangalore. Real estate intelligence tool, Figma, mobile/web UX."
  },
  {
    "companyName": "Synqed",
    "role": "CTO",
    "jd": "Company: Synqed | Location: Bangalore | Experience: 8-15 years. Data + integrations, graph RAG, AI agent orchestration."
  },
  {
    "companyName": "OpenWrench",
    "role": "Machine Learning Engineer",
    "jd": "Company: OpenWrench | Location: Remote | Experience: 4-7 years. Operations ML, invoice intelligence, PyTorch/TensorFlow, SQL, AWS/GCP."
  },
  {
    "companyName": "Shortloop",
    "role": "Software Engineer Fullstack",
    "jd": "Company: Shortloop | Location: Remote | Experience: 0-3 years. Real-time AI phone agents, Python, Node.js, React, MongoDB, ClickHouse, Azure."
  },
  {
    "companyName": "Bridgetown Research",
    "role": "Senior Backend Engineer",
    "jd": "Company: Bridgetown Research | Location: Bangalore | Experience: 5-8+ years. Node.js, TypeScript, Python, AWS, PostgreSQL, DynamoDB, Elasticsearch, Terraform, Kubernetes."
  },
  {
    "companyName": "Figr",
    "role": "Lead AI Engineer",
    "jd": "Company: Figr | Location: Bangalore (HSR Layout) | Salary: Rs 35-65L + ESOPs | Experience: 4+ years. Product context engine, Figma AI ingestion, prompt optimization."
  },
  {
    "companyName": "Prodigal",
    "role": "Product Engineer",
    "jd": "Company: Prodigal | Location: Bangalore | Experience: 2+ years. Python, AWS, PostgreSQL, MongoDB, AI conversation insights."
  },
  {
    "companyName": "WithCoverage",
    "role": "Fullstack Engineer",
    "jd": "Company: WithCoverage | Location: Remote. Node.js, MongoDB, React/Next.js, Python, insurance risk platform."
  },
  {
    "companyName": "flagright (yc w22)",
    "role": "Senior Software Engineer",
    "jd": "Company: Flagright | Location: Remote | Experience: 6+ years. Anti-fraud & compliance primitives, Node.js, TypeScript, Go, Cassandra/DynamoDB, Kafka."
  },
  {
    "companyName": "Flexprice",
    "role": "Sde2Backend",
    "jd": "Company: Flexprice | Location: Gurgaon | Salary: Rs 20-35L | Experience: 3-5 years. Open-source pricing & billing, Golang, Postgres, Kafka."
  },
  {
    "companyName": "SuperKalam",
    "role": "Full Stack Engineer",
    "jd": "Company: SuperKalam | Location: Bangalore | Salary: Rs 25-40L. AI-native learning OS, fullstack JS/TS, Python, AI tutoring."
  },
  {
    "companyName": "Accel",
    "role": "Senior AI Engineer",
    "jd": "Company: Accel | Location: Bangalore. VC AI stack, discovering & evaluating top startups, Python, LLMs, data pipelines."
  },
  {
    "companyName": "Accel",
    "role": "SRE Devops Engineer",
    "jd": "Company: Accel | Location: Bangalore. SRE/DevOps, observability, application security, cloud infra across venture data pipelines."
  },
  {
    "companyName": "Pavo AI",
    "role": "Forward Deployed Scientist",
    "jd": "Company: Pavo AI | Location: London / Bangalore / SF | Experience: 4+ years. Applied ML, PyTorch, Spark, customer engagements, A/B testing."
  },
  {
    "companyName": "Deeptune",
    "role": "Member Of Technical Staff",
    "jd": "Company: Deeptune | Location: Remote. Simulation environment for AI agents, Python, Go, TypeScript."
  },
  {
    "companyName": "Fuze Finance",
    "role": "Internal Audit",
    "jd": "Company: Fuze Finance | Location: GCC / Remote | Experience: 3-7 years. VARA/CBUAE compliance, digital assets, AML/CFT, internal audit."
  },
  {
    "companyName": "Von",
    "role": "AI Engineer",
    "jd": "Company: Von (by Rattle) | Location: Bangalore / Remote | Experience: 5+ years. AI revenue intelligence, Salesforce/Gong signal processing, LLMs, RAG."
  },
  {
    "companyName": "Pinkypromise",
    "role": "Founding Backend Engineer",
    "jd": "Company: Pinky Promise | Location: Mumbai | Salary: Rs 30-40L. Women's healthcare AI clinic, backend APIs, microservices, cloud."
  },
  {
    "companyName": "Trupeer",
    "role": "Product Manager",
    "jd": "Company: Trupeer | Location: Bangalore. AI video content creation platform, 0-to-1 PM, product metrics."
  },
  {
    "companyName": "Firmable",
    "role": "Senior Data Engineer",
    "jd": "Company: Firmable | Location: Remote. AI-first Sales SaaS data pipelines, ETL, data warehousing."
  },
  {
    "companyName": "Cyware",
    "role": "Principal Engineer",
    "jd": "Company: Cyware | Location: Bangalore | Experience: 6-12 years. Cyber Fusion platform, Go, Python, PostgreSQL, Elastic, Neo4j, Kubernetes, LLMs."
  },
  {
    "companyName": "FoodStories",
    "role": "Director Of Engineering",
    "jd": "Company: FoodStories | Location: Bangalore / Gurgaon. Core engineering team lead, consumer apps, supply chain systems."
  },
  {
    "companyName": "Bolna (YC F25)",
    "role": "Machine Learning Engineer",
    "jd": "Company: Bolna AI | Location: Bangalore (Hybrid) | Salary: Up to 35L. Vernacular voice AI platform, model fine-tuning, token optimization."
  },
  {
    "companyName": "Vela",
    "role": "AI Operations Associate",
    "jd": "Company: Vela | Location: Remote India | Salary: 8-12 LPA. AI scheduling agent, executive communication, prompt review, quality assurance."
  },
  {
    "companyName": "SolarSquare",
    "role": "Director AI Platform Engineering",
    "jd": "Company: SolarSquare | Location: Gurgaon / Mumbai / Bangalore | Experience: 10+ years. Renewable energy AI platform, computer vision, forecasting."
  },
  {
    "companyName": "AI Fiesta",
    "role": "AI Engineer",
    "jd": "Company: AI Fiesta | Location: Remote. Unified AI workspace (ChatGPT, Claude, Gemini, Perplexity), RAG, Python, LangChain, Pinecone."
  },
  {
    "companyName": "Openobserve",
    "role": "Rust Backend Engineer",
    "jd": "Company: OpenObserve | Location: Remote. High-performance observability stack, Rust, log ingestion, S3 storage."
  },
  {
    "companyName": "Richpanel",
    "role": "Account Executive Outbound",
    "jd": "Company: Richpanel | Location: Bangalore | Salary: up to 60 LPA + uncapped commission. E-commerce support automation."
  },
  {
    "companyName": "Maxim",
    "role": "Member Of Technical Staff",
    "jd": "Company: Maxim AI | Location: Remote | Experience: 2-4 years. Bifrost open-source LLM gateway, Go, TypeScript, Next.js."
  },
  {
    "companyName": "businessonbot",
    "role": "Head Of Technology",
    "jd": "Company: BusinessOnBot | Location: Bangalore | Experience: 7-8 years. Omnichannel AI commerce stack, TypeScript, Node.js, Temporal.io, AWS."
  }
];

async function runSeed() {
  console.log(`Starting clean seed for ${rawJobs.length} real company-role JDs...`);

  // Clear existing database tables completely for clean slate
  try {
    await db.run("DELETE FROM candidates");
    await db.run("DELETE FROM jobs");
    await db.run("DELETE FROM user_company_assignments");
    await db.run("DELETE FROM company_roles");
    await db.run("DELETE FROM companies");
    console.log("✓ Cleared legacy companies, roles, jobs, candidates!");
  } catch (err) {
    console.warn("Table clear warning:", err.message);
  }

  // Insert Companies & Roles into Supabase PostgreSQL / SQLite
  const companyMap = new Map();

  for (const item of rawJobs) {
    const cName = item.companyName.trim();
    if (!companyMap.has(cName)) {
      const { lastInsertRowid } = await db.run(
        "INSERT INTO companies (name, elevator_pitch, hq_location) VALUES (?, ?, ?)",
        [cName, `${cName} Tech & Engineering`, "Bangalore / Remote"]
      );

      // Fetch created company record
      let comp = await db.get("SELECT id, name FROM companies WHERE LOWER(name) = LOWER(?)", [cName]);
      companyMap.set(cName, comp.id);
    }

    const companyId = companyMap.get(cName);
    const roleTitle = item.role.trim();

    // Check if role exists
    let existingRole = await db.get(
      "SELECT id FROM company_roles WHERE company_id = ? AND LOWER(role_title) = LOWER(?)",
      [companyId, roleTitle]
    );

    if (!existingRole) {
      await db.run("INSERT INTO company_roles (company_id, role_title) VALUES (?, ?)", [companyId, roleTitle]);
    }

    // Insert or update Job with exact JD text
    let existingJob = await db.get(
      "SELECT id FROM jobs WHERE company_id = ? AND LOWER(title) = LOWER(?)",
      [companyId, roleTitle]
    );

    if (!existingJob) {
      await db.run(
        `INSERT INTO jobs (company_id, created_by_user_id, title, company_name, location, jd_text, tone, custom_questions, requirements)
         VALUES (?, 1, ?, ?, ?, ?, 'warm', '[]', '[]')`,
        [companyId, roleTitle, cName, "Hybrid / Onsite", item.jd]
      );
    } else {
      await db.run(
        `UPDATE jobs SET jd_text = ? WHERE id = ?`,
        [item.jd, existingJob.id]
      );
    }
  }

  const allComps = await db.all("SELECT COUNT(*) as cnt FROM companies");
  const allRoles = await db.all("SELECT COUNT(*) as cnt FROM company_roles");
  const allJobs  = await db.all("SELECT COUNT(*) as cnt FROM jobs");

  console.log(`✓ Clean seed completed successfully!`);
  console.log(`  → Total Companies: ${allComps[0]?.cnt || 0}`);
  console.log(`  → Total Roles:     ${allRoles[0]?.cnt || 0}`);
  console.log(`  → Total JDs:       ${allJobs[0]?.cnt || 0}`);
  process.exit(0);
}

db.initDb().then(runSeed).catch(e => {
  console.error("Seed failed:", e);
  process.exit(1);
});
