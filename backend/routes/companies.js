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

    // Fetch all predefined company_roles for this company
    const roles = await db.all('SELECT * FROM company_roles WHERE company_id = ? ORDER BY role_title ASC', [companyId]);

    // Also fetch saved jobs configured by this specific AM for this company
    const savedJobs = await db.all(
      'SELECT id, title, updated_at FROM jobs WHERE company_id = ? AND created_by_user_id = ? ORDER BY updated_at DESC',
      [companyId, user.id]
    );

    res.json({
      company,
      roles: roles.map(r => ({
        id: r.id,
        title: r.role_title,
        hasSavedConfig: savedJobs.some(j => j.title.toLowerCase() === r.role_title.toLowerCase())
      })),
      savedJobs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/companies — Create a new company
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, elevatorPitch, hqLocation } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Company name is required.' });

    const existing = await db.get('SELECT * FROM companies WHERE LOWER(name) = LOWER(?)', [name.trim()]);
    if (existing) {
      return res.json({ company: existing });
    }

    const { lastInsertRowid } = await db.run(
      'INSERT INTO companies (name, elevator_pitch, hq_location) VALUES (?, ?, ?)',
      [name.trim(), elevatorPitch || '', hqLocation || 'Bangalore']
    );

    const newCompany = await db.get('SELECT * FROM companies WHERE id = ?', [lastInsertRowid]);
    res.status(201).json({ company: newCompany });
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
