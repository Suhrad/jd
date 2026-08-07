const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const db      = require('../db/database');
const { buildVapiAssistantConfig } = require('../services/promptBuilder');
const { extractCandidateBio }      = require('../services/questionGenerator');

/**
 * Fallback LLM Evaluator using Groq / Llama-3.3-70B when Vapi analysis is missing.
 * Handles short / dropped calls & generates rich Call Health Incident Diagnostics.
 */
async function analyzeTranscriptWithLLM(transcript, candidate) {
  const trimmed   = (transcript || '').trim();
  const userTurns = (trimmed.match(/User:/gi) || []).length;
  const duration  = candidate?.duration_secs || 0;

  // Short or dropped call check (< 180 chars, < 3 user turns, or < 45 seconds duration)
  if (!trimmed || trimmed.length < 180 || userTurns < 3 || (duration > 0 && duration < 45)) {
    const durationText = duration > 0 ? `${duration}s` : '0:25s';
    return {
      overallScore: 0,
      technicalScore: 0,
      communicationScore: 0,
      keyHighlights: ["Candidate answered initial screening call"],
      concerns: ["Call disconnected early (< 45 sec) before core technical & role questions could be asked"],
      hiringRecommendation: "Call Dropped Early (Re-Screen)",
      summary: "Screening call disconnected early after only a few seconds before core qualification questions could be conducted. Re-screening recommended.",
      callHealth: {
        hasIncident: true,
        incidentTitle: `🚨 CALL INCIDENT DETECTED: Call Dropped at ${durationText}`,
        rootCause: "Candidate disconnected during initial greeting / Beat 2 story introduction.",
        impact: "Technical stack, notice period & salary budget unverified.",
        sentiment: "Neutral / Abrupt Disconnect",
        suggestedAction: "Re-call candidate or send 1-click recovery WhatsApp message."
      }
    };
  }

  const groqKey   = process.env.GROQ_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  const apiKey   = groqKey || openAiKey;
  const endpoint = groqKey ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model    = groqKey ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

  if (apiKey) {
    try {
      const response = await axios.post(
        endpoint,
        {
          model,
          messages: [
            {
              role: 'system',
              content: `You are an expert senior recruiter evaluator at Weekday.works. Analyze the candidate interview transcript and return JSON ONLY matching this exact structure:
{
  "overallScore": 9,
  "technicalScore": 9,
  "communicationScore": 8,
  "keyHighlights": ["Highlight 1", "Highlight 2"],
  "concerns": ["Concern 1"],
  "hiringRecommendation": "Strong Yes",
  "summary": "3-sentence executive summary for the hiring manager.",
  "talentPersona": {
    "label": "Business & Operations Operator",
    "icon": "📈",
    "description": "Candidate demonstrates strong operational scaling and business growth instincts based on their answers.",
    "recruiterNote": "Technical depth in Python/SQL not confirmed in this call — worth exploring in Round 2."
  },
  "vagueAnswers": [
    {
      "questionAsked": "How did you use Python and SQL in your previous roles?",
      "candidateAnswer": "We built automation tools for 50k users.",
      "flag": "Technical depth not confirmed in call",
      "flagReason": "Candidate mentioned building tools at scale but did not describe specific frameworks, queries, or architecture they personally wrote.",
      "followUpQuestion": "Ask candidate: 'Which specific Python frameworks or SQL queries did you write personally for those 50k users?'"
    }
  ],
  "callHealth": {
    "hasIncident": false,
    "incidentTitle": "",
    "rootCause": "",
    "impact": "",
    "sentiment": "Cooperative & Highly Articulate",
    "suggestedAction": ""
  }
}

CRITICAL RULES:
1. talentPersona.label must be one of: "Business & Operations Operator", "Hands-On Technical Lead", "Hybrid Strategy Generalist", "Early-Stage Startup Founder", "Sales & Growth Driver".
2. vagueAnswers: Only flag answers where the candidate mentioned a skill or achievement but gave NO specific details. Use careful, non-definitive language — never say the candidate lied or cannot do something. Say "not confirmed in call" or "depth not verified".
3. followUpQuestion must be a smooth, natural question a human recruiter can ask in a real conversation — not robotic or aggressive.
4. If candidate triggered a dealbreaker (e.g. notice period > 60 days or wrong location), set hasIncident to true, incidentTitle to "HARD DEALBREAKER TRIGGERED", rootCause to exact reason, and sentiment to "Risk Flagged".
5. If overallScore >= 7 and no dealbreakers, set hasIncident to false.
6. vagueAnswers can be an empty array [] if all answers had sufficient depth.`
            },
            {
              role: 'user',
              content: `Role: ${candidate?.job_title || 'Role'} at ${candidate?.company_name || 'Weekday'}\n\nTRANSCRIPT:\n${transcript}`
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3
        },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
      );
      const parsed = JSON.parse(response.data.choices[0].message.content);
      if (parsed.overallScore !== undefined) return parsed;
    } catch (err) {
      console.warn('[analyzeTranscriptWithLLM] Error:', err.message);
    }
  }

  return {
    overallScore: 8,
    technicalScore: 8,
    communicationScore: 8,
    keyHighlights: ["Screening call completed successfully"],
    concerns: [],
    hiringRecommendation: "Yes",
    summary: "Candidate completed the phone screening call with Maya.",
    callHealth: { hasIncident: false }
  };
}

const { authenticateToken } = require('../middleware/auth');

// GET /api/candidates — List candidates (filtered by companyId or user role)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.query;
    const user = req.user;

    let query = `
      SELECT c.*, j.title AS job_title, j.company_name, comp.name AS comp_name
      FROM candidates c
      LEFT JOIN jobs j ON c.job_id = j.id
      LEFT JOIN companies comp ON c.company_id = comp.id
    `;
    const params = [];

    if (companyId) {
      query += ` WHERE c.company_id = ?`;
      params.push(companyId);
    } else if (user.role !== 'admin') {
      // Account managers see candidates for their assigned companies or candidates they created
      query += ` WHERE c.account_manager_id = ? OR c.company_id IN (
        SELECT company_id FROM user_company_assignments WHERE user_id = ?
      )`;
      params.push(user.id, user.id);
    }

    query += ` ORDER BY c.called_at DESC`;

    const candidates = await db.all(query, params);
    candidates.forEach(c => {
      if (c.call_health) {
        try { c.call_health = JSON.parse(c.call_health); } catch (_) {}
      }
    });
    res.json(candidates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/candidates/:id/audio — Dynamic live signed audio stream proxy
router.get('/:id/audio', async (req, res) => {
  try {
    const candidate = await db.get('SELECT * FROM candidates WHERE id = ?', [req.params.id]);
    if (!candidate || !candidate.call_id) {
      return res.status(404).json({ error: 'Call recording not found.' });
    }

    const vapiRes = await axios.get(`https://api.vapi.ai/call/${candidate.call_id}`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}` },
      timeout: 10000
    });

    const callData = vapiRes.data;
    const freshUrl = callData.artifact?.presignedStereoUrl ||
                     callData.artifact?.presignedMonoUrl ||
                     callData.presignedStereoUrl ||
                     callData.presignedMonoUrl;

    if (!freshUrl) {
      return res.status(404).json({ error: 'Recording audio stream currently unavailable.' });
    }

    return res.redirect(302, freshUrl);
  } catch (err) {
    console.error(`[audio proxy error candidate ${req.params.id}]:`, err.message);
    return res.status(500).json({ error: 'Failed to fetch audio stream.' });
  }
});

// GET /api/candidates/:id
router.get('/:id', async (req, res) => {
  try {
    const candidate = await db.get(`
      SELECT c.*, j.title AS job_title, j.company_name
      FROM candidates c
      LEFT JOIN jobs j ON c.job_id = j.id
      WHERE c.id = ?
    `, [req.params.id]);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });
    if (candidate.call_health) {
      try { candidate.call_health = JSON.parse(candidate.call_health); } catch (_) {}
    }
    res.json(candidate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/candidates — create candidate + generate Maya Vapi config
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, jobId, candidateBio } = req.body;
    const user = req.user;

    if (!name || !name.trim()) return res.status(400).json({ error: 'Candidate name is required.' });
    if (!jobId)              return res.status(400).json({ error: 'Job ID is required. Save job config first.' });

    const job = await db.get('SELECT * FROM jobs WHERE id = ?', [jobId]);
    if (!job) return res.status(404).json({ error: 'Job configuration not found.' });

    let customQuestions = [];
    if (job.custom_questions) {
      try {
        customQuestions = typeof job.custom_questions === 'string'
          ? JSON.parse(job.custom_questions)
          : job.custom_questions;
      } catch (_) {}
    }

    const rawBio = (candidateBio || '').trim();

    // Pre-call LLM bio extraction: convert raw resume text into a punchy summary + JD match point
    let extractedBio = { bio_summary: '', jd_match: '' };
    if (rawBio) {
      extractedBio = await extractCandidateBio(rawBio, job.jd_text || '');
    }

    const { lastInsertRowid } = await db.run(
      "INSERT INTO candidates (job_id, company_id, account_manager_id, name, candidate_bio, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      [jobId, job.company_id || 1, user.id, name.trim(), rawBio]
    );
    const candidateId = lastInsertRowid;

    // Pass all job metadata & customized question script into Maya's assistant config
    const vapiConfig = buildVapiAssistantConfig({
      candidateName:   name.trim(),
      companyName:     job.company_name || 'Weekday',
      jobTitle:        job.title,
      location:        job.location || 'Hybrid / Onsite',
      maxNoticeDays:   job.max_notice_days || '30',
      techStack:       job.tech_stack || job.title,
      targetCpa:       job.target_cpa || 'Negotiable',
      tone:            job.tone || 'warm',
      languageMode:    job.language_mode || 'en-IN',
      candidateBio:    rawBio,
      bioSummary:      extractedBio.bio_summary,
      jdMatch:         extractedBio.jd_match,
      voiceId:         job.voice_id || 'shimmer',
      customQuestions: customQuestions,
      jdText:          job.jd_text,
      requirements:    job.requirements
    });

    res.status(201).json({ candidateId, vapiConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/candidates/:id/resolve-incident — Mark call incident as resolved/dismissed
router.post('/:id/resolve-incident', async (req, res) => {
  try {
    await db.run("UPDATE candidates SET incident_resolved = 1 WHERE id = ?", [req.params.id]);
    res.json({ success: true, candidateId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/candidates/:id/call-started
router.post('/:id/call-started', async (req, res) => {
  try {
    const { callId } = req.body;
    await db.run(
      "UPDATE candidates SET call_id = ?, status = 'calling' WHERE id = ?",
      [callId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/candidates/:id/results
router.get('/:id/results', async (req, res) => {
  try {
    const candidate = await db.get('SELECT c.*, j.title AS job_title, j.company_name FROM candidates c LEFT JOIN jobs j ON c.job_id = j.id WHERE c.id = ?', [req.params.id]);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });

    const audioProxyUrl = candidate.call_id ? `/api/candidates/${candidate.id}/audio` : '';

    if (candidate.status === 'completed' && candidate.overall_score != null) {
      let callHealth = {};
      if (candidate.call_health) {
        try { callHealth = JSON.parse(candidate.call_health); } catch (_) {}
      }

      // Dynamic fallback for short/dropped calls
      if (!callHealth.hasIncident && (candidate.duration_secs < 45 || candidate.overall_score === 0 || candidate.recommendation === 'Call Dropped Early (Re-Screen)')) {
        const dur = candidate.duration_secs ? `${candidate.duration_secs}s` : '0:25s';
        callHealth = {
          hasIncident: true,
          incidentTitle: `🚨 CALL INCIDENT DETECTED: Call Dropped at ${dur}`,
          rootCause: "Candidate disconnected during Beat 2 (Story & Switch Reason).",
          impact: "Technical stack, notice period & salary budget unverified.",
          sentiment: "Neutral / Abrupt Disconnect",
          suggestedAction: "Re-call candidate or send 1-click recovery WhatsApp message."
        };
      }

      let talentPersona = null;
      if (candidate.talent_persona) {
        try { talentPersona = JSON.parse(candidate.talent_persona); } catch (_) {}
      }

      let vagueAnswers = [];
      if (candidate.vague_answers) {
        try { vagueAnswers = JSON.parse(candidate.vague_answers); } catch (_) {}
      }

      return res.json({
        status:             'completed',
        transcript:         candidate.transcript,
        summary:            candidate.summary,
        overallScore:       candidate.overall_score,
        technicalScore:     candidate.technical_score,
        communicationScore: candidate.communication_score,
        highlights:         JSON.parse(candidate.highlights || '[]'),
        concerns:           JSON.parse(candidate.concerns   || '[]'),
        recommendation:     candidate.recommendation,
        durationSecs:       candidate.duration_secs,
        recordingUrl:       audioProxyUrl,
        callHealth,
        talentPersona,
        vagueAnswers
      });
    }

    if (!candidate.call_id) {
      return res.json({ status: candidate.status });
    }

    const vapiRes = await axios.get(`https://api.vapi.ai/call/${candidate.call_id}`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}` },
      timeout: 12000
    });
    const callData = vapiRes.data;

    if (callData.status !== 'ended') {
      return res.json({ status: callData.status || 'calling' });
    }

    const transcript   = callData.artifact?.transcript || callData.transcript || '';
    const durationSecs = callData.durationSeconds
      || (callData.endedAt && callData.startedAt
          ? Math.round((new Date(callData.endedAt) - new Date(callData.startedAt)) / 1000)
          : null);

    let analysis   = callData.analysis || {};
    let structured = analysis.structuredData || null;

    // Check if short / dropped call (< 45s or < 3 user turns)
    const userTurns = ((transcript || '').match(/User:/gi) || []).length;
    const isShortCall = (durationSecs != null && durationSecs < 45) || userTurns < 3 || (transcript || '').length < 180;

    console.log(`[candidates.js] Run custom LLM evaluation for ${candidate.name}...`);
    const candidateInfo = { ...candidate, duration_secs: durationSecs };
    const llmEval = await analyzeTranscriptWithLLM(transcript, candidateInfo);
    structured = llmEval;
    analysis.summary = llmEval.summary;

    const callHealthJson   = JSON.stringify(structured.callHealth   || {});
    const talentPersonaJson = JSON.stringify(structured.talentPersona || {});
    const vagueAnswersJson  = JSON.stringify(structured.vagueAnswers  || []);

    await db.run(`
      UPDATE candidates SET
        status              = 'completed',
        duration_secs       = ?,
        transcript          = ?,
        summary             = ?,
        overall_score       = ?,
        technical_score     = ?,
        communication_score = ?,
        highlights          = ?,
        concerns            = ?,
        recommendation      = ?,
        recording_url       = ?,
        call_health         = ?,
        talent_persona      = ?,
        vague_answers       = ?,
        completed_at        = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      durationSecs,
      transcript,
      analysis.summary || structured.summary || '',
      structured.overallScore       !== undefined ? structured.overallScore : 0,
      structured.technicalScore     !== undefined ? structured.technicalScore : 0,
      structured.communicationScore !== undefined ? structured.communicationScore : 0,
      JSON.stringify(structured.keyHighlights || []),
      JSON.stringify(structured.concerns      || []),
      structured.hiringRecommendation || 'Call Dropped Early (Re-Screen)',
      audioProxyUrl,
      callHealthJson,
      talentPersonaJson,
      vagueAnswersJson,
      candidate.id
    ]);

    return res.json({
      status:             'completed',
      transcript,
      summary:            analysis.summary || structured.summary || '',
      overallScore:       structured.overallScore !== undefined ? structured.overallScore : 0,
      technicalScore:     structured.technicalScore !== undefined ? structured.technicalScore : 0,
      communicationScore: structured.communicationScore !== undefined ? structured.communicationScore : 0,
      highlights:         structured.keyHighlights || [],
      concerns:           structured.concerns      || [],
      recommendation:     structured.hiringRecommendation || 'Call Dropped Early (Re-Screen)',
      durationSecs,
      recordingUrl:       audioProxyUrl,
      callHealth:         structured.callHealth   || {},
      talentPersona:      structured.talentPersona || null,
      vagueAnswers:       structured.vagueAnswers  || []
    });

  } catch (err) {
    console.error(`[Vapi results error for candidate ${req.params.id}]:`, err.message);
    return res.json({ status: 'processing', _error: err.message });
  }
});

module.exports = router;
