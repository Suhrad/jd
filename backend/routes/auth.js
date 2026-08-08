const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { authenticateToken, requireAdmin, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    // 1. Find user by email
    const user = await db.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [cleanEmail]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 2. Verify password via bcrypt
    const isValid = await bcrypt.compare(cleanPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 3. Check active status
    if (user.is_active !== undefined && user.is_active !== null) {
      const act = String(user.is_active).toLowerCase();
      if (act === '0' || act === 'false') {
        return res.status(401).json({ error: 'Account is deactivated.' });
      }
    }

    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: payload
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/profile — Update current user's profile (name, email, password)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const userId = req.user.id;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    // Check email uniqueness if email is changing
    const existing = await db.get(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?',
      [cleanEmail, userId]
    );
    if (existing) {
      return res.status(400).json({ error: 'An account with this email address already exists.' });
    }

    if (password && password.trim().length > 0) {
      if (password.trim().length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
      }
      const hash = await bcrypt.hash(password.trim(), 10);
      await db.run(
        'UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?',
        [cleanName, cleanEmail, hash, userId]
      );
    } else {
      await db.run(
        'UPDATE users SET name = ?, email = ? WHERE id = ?',
        [cleanName, cleanEmail, userId]
      );
    }

    const updatedUser = await db.get(
      'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
      [userId]
    );

    const payload = {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    res.json({ user: payload, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.get('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.json({ user: req.user });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-admin  — forcibly resets admin@weekday.com to password 'admin' at runtime
// This bypasses seed logic and works for both PG (BOOLEAN) and SQLite (INTEGER) is_active columns
router.post('/reset-admin', async (req, res) => {
  try {
    const hash = await bcrypt.hash('admin', 10);
    const existing = await db.get("SELECT id FROM users WHERE LOWER(email) = 'admin@weekday.com'");
    if (existing) {
      // Use db.run which handles ? → $N conversion for PG automatically
      // For is_active, we avoid literals — pass as JS true (pg converts), which also works as 1 in SQLite
      await db.run(
        "UPDATE users SET name = 'Admin', password_hash = ?, is_active = 1, role = 'admin' WHERE LOWER(email) = 'admin@weekday.com'",
        [hash]
      );
    } else {
      await db.run(
        "INSERT INTO users (name, email, password_hash, role, is_active) VALUES ('Admin', 'admin@weekday.com', ?, 'admin', 1)",
        [hash]
      );
    }
    const user = await db.get("SELECT id, email, role, is_active FROM users WHERE LOWER(email) = 'admin@weekday.com'");
    const check = await bcrypt.compare('admin', hash);
    res.json({ success: true, user, passwordCheck: check });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
