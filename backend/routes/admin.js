const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// All routes require Admin access
router.use(authenticateToken);
router.use(requireAdmin);

// GET /api/admin/users — List all users (Account Managers & Admins)
router.get('/users', async (req, res) => {
  try {
    const users = await db.all('SELECT id, name, email, role, is_active, created_at FROM users ORDER BY id ASC');

    const allAssignments = await db.all(
      `SELECT uca.user_id, c.id, c.name FROM user_company_assignments uca
       JOIN companies c ON c.id = uca.company_id`
    );

    const assignMap = new Map();
    for (const a of allAssignments) {
      if (!assignMap.has(a.user_id)) assignMap.set(a.user_id, []);
      assignMap.get(a.user_id).push({ id: a.id, name: a.name });
    }

    for (const u of users) {
      u.assignedCompanies = assignMap.get(u.id) || [];
    }

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users — Create new Account Manager
router.post('/users', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const existing = await db.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (existing) {
      return res.status(400).json({ error: 'A user with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userRole = role === 'admin' ? 'admin' : 'account_manager';

    const { lastInsertRowid } = await db.run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name.trim(), email.trim(), passwordHash, userRole]
    );

    const newUser = await db.get('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [lastInsertRowid]);
    res.status(201).json({ user: newUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id/assignments — Assign companies to an Account Manager (supports "Select All")
router.post('/users/:id/assignments', async (req, res) => {
  try {
    const userId = req.params.id;
    const { companyIds, selectAll } = req.body;

    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Clear existing assignments
    await db.run('DELETE FROM user_company_assignments WHERE user_id = ?', [userId]);

    if (selectAll) {
      // Assign ALL companies to this AM
      const allCompanies = await db.all('SELECT id FROM companies');
      for (const c of allCompanies) {
        await db.run('INSERT INTO user_company_assignments (user_id, company_id) VALUES (?, ?)', [userId, c.id]);
      }
    } else if (Array.isArray(companyIds) && companyIds.length > 0) {
      for (const cid of companyIds) {
        await db.run('INSERT INTO user_company_assignments (user_id, company_id) VALUES (?, ?)', [userId, cid]);
      }
    }

    const updatedAssignments = await db.all(
      `SELECT c.id, c.name FROM companies c
       JOIN user_company_assignments uca ON uca.company_id = c.id
       WHERE uca.user_id = ?`,
      [userId]
    );

    res.json({ success: true, userId, assignedCompanies: updatedAssignments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id — Edit AM Credentials & Password
router.put('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, password, is_active } = req.body;

    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const newName  = (name || user.name).trim();
    const newEmail = (email || user.email).trim().toLowerCase();
    const activeVal = is_active !== undefined ? (is_active ? 1 : 0) : user.is_active;

    if (password && password.trim().length > 0) {
      const hash = await bcrypt.hash(password.trim(), 10);
      await db.run(
        'UPDATE users SET name = ?, email = ?, password_hash = ?, is_active = ? WHERE id = ?',
        [newName, newEmail, hash, activeVal, userId]
      );
    } else {
      await db.run(
        'UPDATE users SET name = ?, email = ?, is_active = ? WHERE id = ?',
        [newName, newEmail, activeVal, userId]
      );
    }

    const updatedUser = await db.get('SELECT id, name, email, role, is_active FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id — Remove Account Manager
router.delete('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);

    if (req.user.id === userId) {
      return res.status(400).json({ error: 'Super Admin cannot delete their own active account.' });
    }

    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Clear assignments & delete user
    await db.run('DELETE FROM user_company_assignments WHERE user_id = ?', [userId]);
    await db.run('DELETE FROM users WHERE id = ?', [userId]);

    res.json({ success: true, message: `Account Manager ${user.name} removed.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
