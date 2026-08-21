const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// All routes require Admin access
router.use(authenticateToken);
router.use(requireAdmin);

// GET /api/admin/users — List all Account Managers (excluding Admins) with productivity metrics
router.get('/users', async (req, res) => {
  try {
    const users = await db.all("SELECT id, name, email, role, is_active, created_at FROM users WHERE role != 'admin' ORDER BY id ASC");

    const allAssignments = await db.all(
      `SELECT uca.user_id, c.id, c.name FROM user_company_assignments uca
       JOIN companies c ON c.id = uca.company_id`
    );

    const assignMap = new Map();
    for (const a of allAssignments) {
      if (!assignMap.has(a.user_id)) assignMap.set(a.user_id, []);
      assignMap.get(a.user_id).push({ id: a.id, name: a.name });
    }

    // Compute productivity metrics per AM
    const jobCounts = await db.all('SELECT created_by_user_id, COUNT(id) as cnt FROM jobs GROUP BY created_by_user_id');
    const jobMap = new Map(jobCounts.map(j => [j.created_by_user_id, j.cnt]));

    const candStats = await db.all(
      `SELECT j.created_by_user_id,
              COUNT(c.id) as total_calls,
              SUM(CASE WHEN c.recommendation LIKE 'Yes%' OR c.recommendation LIKE 'Conditional%' THEN 1 ELSE 0 END) as passes
       FROM candidates c
       JOIN jobs j ON c.job_id = j.id
       GROUP BY j.created_by_user_id`
    );
    const candMap = new Map(candStats.map(cs => [
      cs.created_by_user_id,
      { totalCalls: cs.total_calls || 0, passes: cs.passes || 0 }
    ]));

    for (const u of users) {
      u.assignedCompanies = assignMap.get(u.id) || [];
      const jCnt = jobMap.get(u.id) || 0;
      const cStat = candMap.get(u.id) || { totalCalls: 0, passes: 0 };
      const passRate = cStat.totalCalls > 0 ? Math.round((cStat.passes / cStat.totalCalls) * 100) : 0;

      u.metrics = {
        totalJdsConfigured: jCnt,
        totalScreeningCalls: cStat.totalCalls,
        candidatePassRate: passRate,
        assignedCompaniesCount: u.assignedCompanies.length
      };
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

// GET /api/admin/notifications — List unreviewed/all AM company additions
router.get('/notifications', async (req, res) => {
  try {
    const notifications = await db.all(
      `SELECT n.*, c.elevator_pitch, c.hq_location
       FROM admin_notifications n
       LEFT JOIN companies c ON c.id = n.company_id
       ORDER BY n.created_at DESC`
    );
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/notifications/:id/action — Perform Admin governance action
router.post('/notifications/:id/action', async (req, res) => {
  try {
    const notificationId = req.params.id;
    const { action, elevatorPitch, hqLocation } = req.body;

    const notif = await db.get('SELECT * FROM admin_notifications WHERE id = ?', [notificationId]);
    if (!notif) return res.status(404).json({ error: 'Notification record not found.' });

    if (action === 'mark_reviewed') {
      await db.run("UPDATE admin_notifications SET review_status = 'reviewed' WHERE id = ?", [notificationId]);
    } else if (action === 'revoke_am') {
      // Set status = 'archived' for that specific AM assignment
      await db.run(
        "UPDATE user_company_assignments SET status = 'archived' WHERE user_id = ? AND company_id = ?",
        [notif.am_user_id, notif.company_id]
      );
      await db.run("UPDATE admin_notifications SET review_status = 'revoked' WHERE id = ?", [notificationId]);
    } else if (action === 'edit_profile') {
      await db.run(
        'UPDATE companies SET elevator_pitch = ?, hq_location = ? WHERE id = ?',
        [elevatorPitch || '', hqLocation || 'Bangalore', notif.company_id]
      );
      await db.run("UPDATE admin_notifications SET review_status = 'reviewed' WHERE id = ?", [notificationId]);
    } else if (action === 'delete_global') {
      await db.run('DELETE FROM companies WHERE id = ?', [notif.company_id]);
      await db.run("UPDATE admin_notifications SET review_status = 'revoked' WHERE id = ?", [notificationId]);
    }

    const updated = await db.get('SELECT * FROM admin_notifications WHERE id = ?', [notificationId]);
    res.json({ success: true, notification: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
