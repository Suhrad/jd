const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const {
  generateInterviewQuestions,
  refineSingleCategoryQuestion,
  generateNewCategoryCard,
  parseJdToParameters
} = require('../services/questionGenerator');

// GET /api/jobs — list all jobs
router.get('/', async (req, res) => {
  try {
    const jobs = await db.all('SELECT * FROM jobs ORDER BY created_at DESC');
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/latest — get the most recent job config
router.get('/latest', async (req, res) => {
  try {
    const job = await db.get('SELECT * FROM jobs ORDER BY updated_at DESC LIMIT 1');
    if (job && job.custom_questions) {
      try { job.custom_questions = JSON.parse(job.custom_questions); } catch (_) {}
    }
    res.json(job || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/parse-jd — Extract parameters and recruiter persona details from JD
router.post('/parse-jd', async (req, res) => {
  try {
    const { jdText } = req.body;
    if (!jdText || !jdText.trim()) {
      return res.status(400).json({ error: 'Please provide a Job Description to parse.' });
    }
    const params = await parseJdToParameters(jdText.trim());
    res.json(params);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/generate-questions — AI Question Generator & Copilot
router.post('/generate-questions', async (req, res) => {
  try {
    const { jdText, companyName, jobTitle, techStack, copilotPrompt } = req.body;
    if (!jdText || !jdText.trim()) {
      return res.status(400).json({ error: 'Please provide a Job Description to generate questions.' });
    }

    const topics = await generateInterviewQuestions({
      jdText: jdText.trim(),
      companyName,
      jobTitle,
      techStack,
      copilotPrompt
    });

    res.json({ topics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/refine-question — Refine ONLY 1 targeted category card with AI
router.post('/refine-question', async (req, res) => {
  try {
    const { category, currentQuestion, jdText, companyName, jobTitle, techStack, prompt } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Please provide a prompt instruction for refining this question.' });
    }

    const refinedQuestion = await refineSingleCategoryQuestion({
      category,
      currentQuestion,
      jdText,
      companyName,
      jobTitle,
      techStack,
      prompt: prompt.trim()
    });

    res.json({ refinedQuestion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/add-ai-question — Append a new AI-generated category card
router.post('/add-ai-question', async (req, res) => {
  try {
    const { prompt, companyName, jobTitle, techStack, jdText } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Please enter what topic/question you want to test.' });
    }

    const newTopic = await generateNewCategoryCard({
      prompt: prompt.trim(),
      companyName,
      jobTitle,
      techStack,
      jdText
    });

    res.json({ newTopic });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs — save job configuration with all customized screening parameters
router.post('/', async (req, res) => {
  try {
    const {
      title,
      companyName,
      location,
      maxNoticeDays,
      techStack,
      targetCpa,
      tone,
      languageMode,
      durationTarget,
      voiceId,
      customQuestions,
      jdText,
      requirements
    } = req.body;

    if (!title || !title.trim())   return res.status(400).json({ error: 'Job title is required.' });
    if (!jdText || !jdText.trim()) return res.status(400).json({ error: 'Job description is required.' });

    const questionsJson = typeof customQuestions === 'string' 
      ? customQuestions 
      : JSON.stringify(customQuestions || []);

    const { lastInsertRowid } = await db.run(`
      INSERT INTO jobs (
        title, company_name, location, max_notice_days, tech_stack, target_cpa,
        tone, language_mode, duration_target, voice_id, custom_questions, jd_text, requirements
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      title.trim(),
      (companyName || 'Weekday').trim(),
      (location || 'Hybrid / Onsite').trim(),
      (maxNoticeDays || '30').trim(),
      (techStack || '').trim(),
      (targetCpa || '').trim(),
      (tone || 'warm').trim(),
      (languageMode || 'en-IN').trim(),
      parseInt(durationTarget) || 5,
      (voiceId || 'shimmer').trim(),
      questionsJson,
      jdText.trim(),
      (requirements || '').trim()
    ]);

    const savedJob = await db.get('SELECT * FROM jobs WHERE id = ?', [lastInsertRowid]);
    if (savedJob && savedJob.custom_questions) {
      try { savedJob.custom_questions = JSON.parse(savedJob.custom_questions); } catch (_) {}
    }
    res.status(201).json(savedJob);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
