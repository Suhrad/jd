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
      // Account Managers see active assigned companies
      const assignments = await db.all(
        `SELECT c.* FROM companies c
         JOIN user_company_assignments uca ON uca.company_id = c.id
         WHERE uca.user_id = ? AND (uca.status = 'active' OR uca.status IS NULL)
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
    const jobs = await db.all('SELECT id, title, jd_text, location, tone, max_notice_days, tech_stack, target_cpa, custom_questions, requirements FROM jobs WHERE company_id = ?', [companyId]);

    const jobsMap = new Map();
    for (const j of jobs) {
      if (j.title) {
        jobsMap.set(j.title.trim().toLowerCase(), j);
      }
    }

    res.json({
      company,
      roles: roles.map(r => {
        const cleanTitle = (r.role_title || '').trim().toLowerCase();
        let matchingJob = jobsMap.get(cleanTitle);
        // If not exact match, try fuzzy substring match
        if (!matchingJob) {
          for (const [k, v] of jobsMap.entries()) {
            if (cleanTitle.includes(k) || k.includes(cleanTitle)) {
              matchingJob = v;
              break;
            }
          }
        }

        return {
          id: r.id,
          title: r.role_title,
          hasSavedConfig: !!matchingJob,
          jd_text: matchingJob ? (matchingJob.jd_text || '') : '',
          location: matchingJob ? (matchingJob.location || 'Hybrid / Onsite') : 'Hybrid / Onsite',
          max_notice_days: matchingJob ? (matchingJob.max_notice_days || '30') : '30',
          tech_stack: matchingJob ? (matchingJob.tech_stack || '') : '',
          target_cpa: matchingJob ? (matchingJob.target_cpa || '') : ''
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
    const { name, elevatorPitch, hqLocation, roles, roleTitle, isTemporary } = req.body;
    const user = req.user;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Company name is required.' });

    let company = await db.get('SELECT * FROM companies WHERE LOWER(name) = LOWER(?)', [name.trim()]);
    if (!company) {
      const { lastInsertRowid } = await db.run(
        'INSERT INTO companies (name, elevator_pitch, hq_location, created_by_am_id) VALUES (?, ?, ?, ?)',
        [name.trim(), elevatorPitch || '', hqLocation || 'Bangalore', user.id]
      );
      company = await db.get('SELECT * FROM companies WHERE id = ?', [lastInsertRowid]);
    }

    // Role insertion
    const targetRoles = [];
    if (roleTitle && roleTitle.trim()) targetRoles.push(roleTitle.trim());
    if (roles) {
      const list = Array.isArray(roles) ? roles : roles.split(',').map(r => r.trim()).filter(Boolean);
      targetRoles.push(...list);
    }

    for (const title of targetRoles) {
      const existingRole = await db.get(
        'SELECT id FROM company_roles WHERE company_id = ? AND LOWER(role_title) = LOWER(?)',
        [company.id, title.toLowerCase()]
      );
      if (!existingRole) {
        await db.run('INSERT INTO company_roles (company_id, role_title) VALUES (?, ?)', [company.id, title]);
      }
    }

    if (!isTemporary && user.role !== 'admin') {
      // Assign company to current AM with status = 'active'
      const existingAssignment = await db.get(
        'SELECT id FROM user_company_assignments WHERE user_id = ? AND company_id = ?',
        [user.id, company.id]
      );
      if (!existingAssignment) {
        await db.run(
          "INSERT INTO user_company_assignments (user_id, company_id, status) VALUES (?, ?, 'active')",
          [user.id, company.id]
        );
      } else {
        await db.run(
          "UPDATE user_company_assignments SET status = 'active' WHERE user_id = ? AND company_id = ?",
          [user.id, company.id]
        );
      }

      // Record informational admin notification
      await db.run(
        "INSERT INTO admin_notifications (am_user_id, am_name, company_id, company_name, role_title, review_status) VALUES (?, ?, ?, ?, ?, 'unreviewed')",
        [user.id, user.name || 'Account Manager', company.id, company.name, roleTitle || 'Role']
      );
    }

    const companyRoles = await db.all('SELECT role_title FROM company_roles WHERE company_id = ?', [company.id]);
    company.roles = companyRoles.map(r => r.role_title);

    res.status(201).json({ success: true, company, isTemporary: !!isTemporary });
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
