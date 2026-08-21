/**
 * personas.js
 * API routes for Cloning Recruiter Styles and Managing the Recruiter Persona Library.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { extractPersonaDNA } = require('../services/personaCloner');

// POST /api/personas/clone — Extract Style DNA from plain English or transcript
router.post('/clone', authenticateToken, async (req, res) => {
  try {
    const { recruiterName, transcriptsText, styleInput, roleTitle, inputType } = req.body;
    const rawText = styleInput || transcriptsText || '';
    const mode = inputType || 'description';

    const minChars = mode === 'description' ? 20 : 50;
    if (!rawText || rawText.trim().length < minChars) {
      return res.status(400).json({ error: `Please provide at least ${minChars} characters describing the recruiter style or interview dialogue.` });
    }

    const personaDNA = await extractPersonaDNA(recruiterName, rawText, roleTitle, mode);
    res.json({ success: true, personaDNA });
  } catch (err) {
    console.error('Error cloning recruiter persona:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/personas — List all saved recruiter personas
router.get('/', authenticateToken, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM recruiter_personas ORDER BY id ASC');
    const personas = rows.map(r => {
      let styleDna = {};
      try {
        styleDna = typeof r.style_dna === 'string' ? JSON.parse(r.style_dna) : r.style_dna;
      } catch (_) {}
      return {
        ...r,
        style_dna: styleDna
      };
    });
    res.json({ personas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personas — Save a cloned recruiter persona
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { personaName, recruiterName, voiceId, styleDna, systemInstructions } = req.body;
    const userId = req.user.id;

    if (!personaName || !recruiterName) {
      return res.status(400).json({ error: 'Persona name and Recruiter name are required.' });
    }

    const dnaString = typeof styleDna === 'object' ? JSON.stringify(styleDna) : (styleDna || '{}');

    const result = await db.run(
      `INSERT INTO recruiter_personas 
        (created_by_user_id, persona_name, recruiter_name, voice_id, style_dna, system_instructions)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, personaName.trim(), recruiterName.trim(), voiceId || 'rachel', dnaString, systemInstructions || '']
    );

    const newId = result.lastInsertRowid;
    const created = await db.get('SELECT * FROM recruiter_personas WHERE id = ?', [newId]);
    if (created && typeof created.style_dna === 'string') {
      try { created.style_dna = JSON.parse(created.style_dna); } catch (_) {}
    }

    res.status(201).json({ success: true, persona: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/personas/:id — Delete a cloned recruiter persona
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    // Don't delete system default personas (id <= 3)
    if (parseInt(id) <= 3) {
      return res.status(403).json({ error: 'System baseline personas cannot be deleted.' });
    }

    await db.run('DELETE FROM recruiter_personas WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
