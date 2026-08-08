const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

// GET /api/companies — List companies available to the current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    let companies = [];

    if (user.role === 'admin') {
      // Admins see all 200+ companies
      companies = await db.all('SELECT * FROM companies ORDER BY name ASC');
    } else {
      // Account Managers see assigned companies or all if assigned "Select All"
      const assignments = await db.all(
        `SELECT c.* FROM companies c
         JOIN user_company_assignments uca ON uca.company_id = c.id
         WHERE uca.user_id = ?
         ORDER BY c.name ASC`,
        [user.id]
      );

      if (assignments.length > 0) {
        companies = assignments;
      } else {
        // Fallback: If no explicit assignment, default to all companies so AM can start immediately
        companies = await db.all('SELECT * FROM companies ORDER BY name ASC');
      }
    }

    // Fast 1-query in-memory roles join (0.05s response time instead of 8.5s)
    const allRoles = await db.all('SELECT company_id, role_title FROM company_roles ORDER BY role_title ASC');
    const rolesMap = new Map();
    for (const r of allRoles) {
      if (!rolesMap.has(r.company_id)) rolesMap.set(r.company_id, []);
      rolesMap.get(r.company_id).push(r.role_title);
    }

    for (const c of companies) {
      c.roles = rolesMap.get(c.id) || [];
    }

    res.json({ companies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/companies/:id/roles — List open roles under a specific company
router.get('/:id/roles', authenticateToken, async (req, res) => {
  try {
    const companyId = req.params.id;
    const user = req.user;

    const company = await db.get('SELECT * FROM companies WHERE id = ?', [companyId]);
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    // Fetch all predefined company_roles for this company along with matching job JDs
    const roles = await db.all('SELECT * FROM company_roles WHERE company_id = ? ORDER BY role_title ASC', [companyId]);
    const jobs = await db.all('SELECT id, title, jd_text, location, tone, max_notice_days, tech_stack, target_cpa FROM jobs WHERE company_id = ?', [companyId]);

    const jobsMap = new Map();
    for (const j of jobs) {
      jobsMap.set(j.title.toLowerCase(), j);
    }

    res.json({
      company,
      roles: roles.map(r => {
        const matchingJob = jobsMap.get(r.role_title.toLowerCase());
        return {
          id: r.id,
          title: r.role_title,
          hasSavedConfig: !!matchingJob,
          jd_text: matchingJob ? matchingJob.jd_text : '',
          location: matchingJob ? matchingJob.location : 'Hybrid / Onsite',
          max_notice_days: matchingJob ? matchingJob.max_notice_days : '30',
          tech_stack: matchingJob ? matchingJob.tech_stack : '',
          target_cpa: matchingJob ? matchingJob.target_cpa : ''
        };
      }),
      savedJobs: jobs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/companies — Create a new company & roles
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, elevatorPitch, hqLocation, roles } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Company name is required.' });

    let company = await db.get('SELECT * FROM companies WHERE LOWER(name) = LOWER(?)', [name.trim()]);
    if (!company) {
      const { lastInsertRowid } = await db.run(
        'INSERT INTO companies (name, elevator_pitch, hq_location) VALUES (?, ?, ?)',
        [name.trim(), elevatorPitch || '', hqLocation || 'Bangalore']
      );
      company = await db.get('SELECT * FROM companies WHERE id = ?', [lastInsertRowid]);
    }

    if (roles) {
      const roleList = Array.isArray(roles) ? roles : roles.split(',').map(r => r.trim()).filter(Boolean);
      for (const title of roleList) {
        const existingRole = await db.get(
          'SELECT id FROM company_roles WHERE company_id = ? AND LOWER(role_title) = LOWER(?)',
          [company.id, title]
        );
        if (!existingRole) {
          await db.run('INSERT INTO company_roles (company_id, role_title) VALUES (?, ?)', [company.id, title]);
        }
      }
    }

    const companyRoles = await db.all('SELECT role_title FROM company_roles WHERE company_id = ?', [company.id]);
    company.roles = companyRoles.map(r => r.role_title);

    res.status(201).json({ success: true, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/companies/:id/roles — Add a new role under a company
router.post('/:id/roles', authenticateToken, async (req, res) => {
  try {
    const companyId = req.params.id;
    const { roleTitle } = req.body;
    if (!roleTitle || !roleTitle.trim()) return res.status(400).json({ error: 'Role title is required.' });

    const existing = await db.get(
      'SELECT * FROM company_roles WHERE company_id = ? AND LOWER(role_title) = LOWER(?)',
      [companyId, roleTitle.trim()]
    );
    if (existing) {
      return res.json({ role: existing });
    }

    const { lastInsertRowid } = await db.run(
      'INSERT INTO company_roles (company_id, role_title) VALUES (?, ?)',
      [companyId, roleTitle.trim()]
    );

    const newRole = await db.get('SELECT * FROM company_roles WHERE id = ?', [lastInsertRowid]);
    res.status(201).json({ role: newRole });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
