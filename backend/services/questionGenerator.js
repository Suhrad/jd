/**
 * questionGenerator.js
 * Intelligent AI Question Architect & Copilot Engine.
 * Supports Groq (Meta Llama-3.3-70B), OpenRouter, OpenAI, or Smart Rule Fallback Engine.
 * Refines single categories, appends new cards, or re-architects entire scripts.
 */

const axios = require('axios');

const ALL_7_CATEGORIES = [
  'Career Trajectory & Switch Motivation',
  'Core Technical & System Architecture',
  'Company & Role Problem Statements',
  'Ownership, Leadership & Startup Mindset',
  'Product & Business Instincts',
  'Academics & Early Background',
  'Logistics & Hard Dealbreakers'
];

/**
 * Smart Dynamic Question Generator fallback that adapts questions based on Copilot instructions.
 */
function generateFallbackQuestions(jdText, companyName, jobTitle, techStack, copilotPrompt = '') {
  const comp   = companyName || 'Weekday';
  const role   = jobTitle || 'Software Engineer';
  const tech   = techStack || 'Software Engineering';
  const prompt = (copilotPrompt || '').toLowerCase().trim();

  const isHarder    = prompt.includes('hard') || prompt.includes('tough') || prompt.includes('deep') || prompt.includes('rigorous') || prompt.includes('advanced');
  const isEasier    = prompt.includes('easy') || prompt.includes('basic') || prompt.includes('junior') || prompt.includes('entry');
  const isSystemDes = prompt.includes('system') || prompt.includes('architecture') || prompt.includes('scale') || prompt.includes('database');
  const isStartup   = prompt.includes('startup') || prompt.includes('founder') || prompt.includes('ownership');

  // Pillar 1: Career Trajectory & Switch Motivation
  let q1 = `What is the main reason you are looking to make a career switch right now?`;
  if (isHarder) {
    q1 = `What specific technical or leadership ceiling at your current company is forcing you to look out right now?`;
  }

  // Pillar 2: Core Technical & System Architecture
  let q2 = `Could you walk me through 1 core production system you built using ${tech} and a major trade-off you faced?`;
  if (isHarder || isSystemDes) {
    q2 = `How did you handle database indexing, memory leaks, or concurrency bottlenecks when scaling ${tech} under peak load?`;
  } else if (isEasier) {
    q2 = `What are the core fundamentals and libraries you use daily in ${tech}?`;
  }

  // Pillar 3: Company & Role Problem Statements
  let q3 = `At ${comp}, we work on high-impact technology products. What attracts you most about working at ${comp}?`;
  if (isHarder) {
    q3 = `At ${comp}, we move extremely fast with a high technical bar. How do you ensure zero regression under tight sprint deadlines?`;
  }

  // Pillar 4: Ownership, Leadership & Startup Mindset
  let q4 = `Can you share a specific project where you took 100% end-to-end ownership with vague requirements?`;
  if (isHarder || isStartup) {
    q4 = `Describe a high-stakes scenario where a critical project was failing. What drastic decisions did you make to rescue it?`;
  }

  // Pillar 5: Product & Business Instincts
  const q5 = `How do you analyze user feedback or product metrics to decide what technical feature to build next?`;

  // Pillar 6: Academics & Early Background
  const q6 = `What was your core focus or most challenging project during your degree or early career?`;

  // Pillar 7: Logistics & Hard Dealbreakers
  const q7 = `Are you comfortable with our office location and work setup, and what is your current official notice period?`;

  return [
    { category: 'Career Trajectory & Switch Motivation',  enabled: true,  questions: [q1] },
    { category: 'Core Technical & System Architecture',   enabled: true,  questions: [q2] },
    { category: 'Company & Role Problem Statements',      enabled: true,  questions: [q3] },
    { category: 'Ownership, Leadership & Startup Mindset', enabled: true, questions: [q4] },
    { category: 'Product & Business Instincts',           enabled: true,  questions: [q5] },
    { category: 'Academics & Early Background',           enabled: prompt.includes('college') || prompt.includes('academic'), questions: [q6] },
    { category: 'Logistics & Hard Dealbreakers',          enabled: true,  questions: [q7] }
  ];
}

/**
 * Refines a SINGLE category question using LLM (Groq Llama-3.3-70B) based on targeted user instructions.
 */
async function refineSingleCategoryQuestion({ category, currentQuestion, jdText, companyName, jobTitle, techStack, prompt }) {
  const groqKey       = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openAiKey     = process.env.OPENAI_API_KEY;

  let endpoint = '';
  let apiKey   = '';
  let model    = '';

  if (groqKey) {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    apiKey   = groqKey;
    model    = 'llama-3.3-70b-versatile';
  } else if (openRouterKey) {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    apiKey   = openRouterKey;
    model    = 'meta-llama/llama-3.1-8b-instruct:free';
  } else if (openAiKey) {
    endpoint = 'https://api.openai.com/v1/chat/completions';
    apiKey   = openAiKey;
    model    = 'gpt-4o-mini';
  }

  if (apiKey && endpoint) {
    try {
      const response = await axios.post(
        endpoint,
        {
          model,
          messages: [
            {
              role: 'system',
              content: `You are an expert technical recruiter architect. Rewrite the single interview question for category "${category}" based on the recruiter's exact instructions.
Return a JSON object ONLY in this exact format:
{ "refinedQuestion": "Your new polished single interview question here." }`
            },
            {
              role: 'user',
              content: `Role: ${jobTitle || 'Role'} at ${companyName || 'Company'}
Tech Stack: ${techStack || 'Engineering'}
Current Question: "${currentQuestion || ''}"
RECRUITER INSTRUCTION: "${prompt}"

JOB DESCRIPTION CONTEXT:
${(jdText || '').slice(0, 500)}`
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4
        },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
      );

      const parsed = JSON.parse(response.data.choices[0].message.content);
      if (parsed.refinedQuestion) return parsed.refinedQuestion;
    } catch (err) {
      console.warn('[refineSingleCategoryQuestion] Error:', err.message);
    }
  }

  // Fallback string manipulation if API fails
  return `${currentQuestion || 'Tell me about your experience'} (Refined: ${prompt})`;
}

/**
 * Generates a BRAND-NEW custom category card from a user prompt instruction.
 */
async function generateNewCategoryCard({ prompt, companyName, jobTitle, techStack, jdText }) {
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
              content: `You are an expert technical recruiter. Generate a new custom interview category card based on the recruiter's prompt.
Return JSON ONLY:
{
  "category": "Short Category Name (e.g. Sales Resilience & Rejection)",
  "enabled": true,
  "questions": ["Specific punchy interview question based on prompt"]
}`
            },
            {
              role: 'user',
              content: `Role: ${jobTitle || 'Role'} at ${companyName || 'Company'}\nPROMPT: "${prompt}"`
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4
        },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
      );
      const parsed = JSON.parse(response.data.choices[0].message.content);
      if (parsed.category && parsed.questions) return parsed;
    } catch (err) {
      console.warn('[generateNewCategoryCard] Error:', err.message);
    }
  }

  return {
    category: 'Custom Topic: ' + prompt.slice(0, 30),
    enabled: true,
    questions: [`Could you share how you approach ${prompt}?`]
  };
}

/**
 * Analyzes JD text and generates dynamic custom questions using Groq (FREE), OpenRouter, OpenAI, or Fallback
 */
async function generateInterviewQuestions({ jdText, companyName, jobTitle, techStack, copilotPrompt }) {
  const groqKey       = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openAiKey     = process.env.OPENAI_API_KEY;

  let endpoint = '';
  let apiKey   = '';
  let model    = '';

  if (groqKey) {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    apiKey   = groqKey;
    model    = 'llama-3.3-70b-versatile';
  } else if (openRouterKey) {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    apiKey   = openRouterKey;
    model    = 'meta-llama/llama-3.1-8b-instruct:free';
  } else if (openAiKey) {
    endpoint = 'https://api.openai.com/v1/chat/completions';
    apiKey   = openAiKey;
    model    = 'gpt-4o-mini';
  }

  const fallback = generateFallbackQuestions(jdText, companyName, jobTitle, techStack, copilotPrompt);

  if (apiKey && endpoint) {
    try {
      const response = await axios.post(
        endpoint,
        {
          model,
          messages: [
            {
              role: 'system',
              content: `You are an expert technical recruiter architect. Analyze the Job Description and Recruiter Copilot Instructions, then generate a JSON object containing ALL 7 screening categories:
1. Career Trajectory & Switch Motivation
2. Core Technical & System Architecture
3. Company & Role Problem Statements
4. Ownership, Leadership & Startup Mindset
5. Product & Business Instincts
6. Academics & Early Background
7. Logistics & Hard Dealbreakers

RULES FOR QUESTION PHRASING:
- Every question MUST be concise, punchy, and conversational.
- Cap each question at MAX 2 aspects (NEVER stack multiple sub-questions like "why, how, when, and what" together).
- For Logistics & Hard Dealbreakers, phrase notice period and compensation questions politely and consultatively for candidates.

Return JSON ONLY matching this exact structure:
{
  "topics": [
    { "category": "Category Name", "enabled": true, "questions": ["Conversational Question 1"] }
  ]
}`
            },
            {
              role: 'user',
              content: `Hiring Company: ${companyName || 'Weekday'}
Job Title: ${jobTitle || 'Role'}
Tech Stack: ${techStack || 'Engineering'}
RECRUITER COPILOT INSTRUCTIONS: ${copilotPrompt || 'Generate standard concise questions.'}

JOB DESCRIPTION:
${jdText || 'Standard engineering screening'}`
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.5
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000
        }
      );

      const parsed = JSON.parse(response.data.choices[0].message.content);
      let topics = parsed.topics || parsed.categories || parsed;
      if (Array.isArray(topics) && topics.length) {
        ALL_7_CATEGORIES.forEach(cat => {
          const exists = topics.some(t => t.category.toLowerCase().includes(cat.toLowerCase().slice(0, 10)));
          if (!exists) {
            const fbTopic = fallback.find(f => f.category === cat);
            if (fbTopic) topics.push(fbTopic);
          }
        });
        return topics;
      }
    } catch (err) {
      console.warn(`[questionGenerator] API Provider (${model}) call returned warning, using dynamic Copilot engine:`, err.message);
    }
  }

  return fallback;
}

/**
 * Parses JD text and extracts role parameters and recruiter persona details using LLM.
 */
async function parseJdToParameters(jdText) {
  const groqKey       = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openAiKey     = process.env.OPENAI_API_KEY;

  let endpoint = '';
  let apiKey   = '';
  let model    = '';

  if (groqKey) {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    apiKey   = groqKey;
    model    = 'llama-3.3-70b-versatile';
  } else if (openRouterKey) {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    apiKey   = openRouterKey;
    model    = 'meta-llama/llama-3.1-8b-instruct:free';
  } else if (openAiKey) {
    endpoint = 'https://api.openai.com/v1/chat/completions';
    apiKey   = openAiKey;
    model    = 'gpt-4o-mini';
  }

  const fallback = {
    companyName: 'Weekday',
    title: '',
    location: 'Hybrid / Onsite',
    maxNoticeDays: '30',
    techStack: '',
    targetCpa: 'Negotiable',
    tone: 'warm',
    voiceId: 'shimmer'
  };

  if (apiKey && endpoint) {
    try {
      const response = await axios.post(
        endpoint,
        {
          model,
          messages: [
            {
              role: 'system',
              content: `You are an expert recruitment coordinator. Parse the provided Job Description (JD) and extract the following parameters as JSON.
If a parameter is not mentioned, use the specified fallback/default value.

Expected JSON output format:
{
  "companyName": "extracted company name, default to 'Weekday' if not found",
  "title": "extracted job title, default to '' if not found",
  "location": "extracted location, e.g. 'Indiranagar, Bangalore (5 Days WFO)' or 'Remote'. default to 'Hybrid / Onsite' if not found",
  "maxNoticeDays": "extracted max notice period in days as string, e.g. '30', '60', '90' or 'Negotiable'. default to '30' if not found",
  "techStack": "extracted core technologies as comma-separated list, e.g. 'React, Node.js, Python'. default to '' if not found",
  "targetCpa": "extracted target salary budget or fixed CTC, e.g. 'INR 12L - 15L Fixed' or 'Negotiable'. default to 'Negotiable' if not found",
  "tone": "must be one of: 'warm', 'rigorous', 'executive', 'startup'. default to 'warm' if not found",
  "voiceId": "must be one of: 'shimmer', 'alloy', 'fable', 'onyx'. Choose based on the target role/company: 'shimmer' for warm/collaborative, 'alloy' for general/engineering, 'fable' for customer-facing/expressive, 'onyx' for mature/deep voice. default to 'shimmer' if not found"
}

Return JSON ONLY.`
            },
            {
              role: 'user',
              content: `JOB DESCRIPTION:\n${jdText}`
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2
        },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
      );

      const parsed = JSON.parse(response.data.choices[0].message.content);
      return {
        companyName: parsed.companyName || fallback.companyName,
        title: parsed.title || fallback.title,
        location: parsed.location || fallback.location,
        maxNoticeDays: parsed.maxNoticeDays || fallback.maxNoticeDays,
        techStack: parsed.techStack || fallback.techStack,
        targetCpa: parsed.targetCpa || fallback.targetCpa,
        tone: ['warm', 'rigorous', 'executive', 'startup'].includes(parsed.tone) ? parsed.tone : fallback.tone,
        voiceId: ['shimmer', 'alloy', 'fable', 'onyx'].includes(parsed.voiceId) ? parsed.voiceId : fallback.voiceId
      };
    } catch (err) {
      console.warn('[parseJdToParameters] Error:', err.message);
    }
  }

  // Fallback heuristic regex parsing if API fails
  try {
    const lines = jdText.split('\n');
    let title = '';
    let companyName = 'Weekday';

    for (const line of lines.slice(0, 10)) {
      if (line.toLowerCase().includes('title') || line.toLowerCase().includes('position')) {
        title = line.replace(/title|position|:|#/gi, '').trim();
      }
      if (line.toLowerCase().includes('company') || line.toLowerCase().includes('about us')) {
        companyName = line.replace(/company|about us|:|#/gi, '').trim();
      }
    }
    return { ...fallback, title, companyName };
  } catch (_) {
    return fallback;
  }
}

/**
 * Pre-call LLM Bio Extractor.
 * Given raw resume text + JD, returns a punchy 1-line bio summary and 1 specific JD match point.
 * Used to build a natural, informed opener for Maya instead of slicing raw resume text.
 */
async function extractCandidateBio(resumeText, jdText) {
  const fallback = { bio_summary: '', jd_match: '' };

  if (!resumeText || !resumeText.trim()) return fallback;

  const groqKey   = process.env.GROQ_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  const apiKey    = groqKey || openAiKey;
  const endpoint  = groqKey ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model     = groqKey ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

  if (!apiKey) return fallback;

  try {
    const response = await axios.post(
      endpoint,
      {
        model,
        messages: [
          {
            role: 'system',
            content: `You are a recruiter's assistant. Given a raw resume and a job description, extract exactly two things and return them as JSON:
1. "bio_summary": A single punchy recruiter-style sentence summarising the candidate's background. Max 18 words. Factual, no adjectives or hype. Example: "Founding COO at Weekday, ex-Titan Capital analyst, CS and ML background."
2. "jd_match": One specific thing from the resume that directly maps to the JD. Max 12 words. Example: "operational scaling and 0-to-1 product experience". If no clear match, return empty string "".

Return JSON only: { "bio_summary": "...", "jd_match": "..." }`
          },
          {
            role: 'user',
            content: `RESUME:\n${resumeText.slice(0, 2000)}\n\nJOB DESCRIPTION:\n${(jdText || '').slice(0, 800)}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2
      },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 8000 }
    );

    const parsed = JSON.parse(response.data.choices[0].message.content);
    return {
      bio_summary: (parsed.bio_summary || '').trim().slice(0, 120),
      jd_match:    (parsed.jd_match    || '').trim().slice(0, 80)
    };
  } catch (err) {
    console.warn('[extractCandidateBio] LLM extraction failed, using fallback:', err.message);
    return fallback;
  }
}

module.exports = {
  generateInterviewQuestions,
  generateFallbackQuestions,
  refineSingleCategoryQuestion,
  generateNewCategoryCard,
  parseJdToParameters,
  extractCandidateBio
};
