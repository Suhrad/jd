/**
 * personaCloner.js
 * Analyzes real recruiter screening transcripts and extracts a high-fidelity
 * Recruiter Style DNA profile for injection into the Vapi voice screening engine.
 */

const https = require('https');

function callGroqChat(messages, temperature = 0.4) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GROQ_API_KEY || '';
    const model = 'openai/gpt-oss-120b';

    if (!apiKey) {
      return reject(new Error('GROQ_API_KEY is not configured in environment.'));
    }

    const payload = JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: 1800,
      response_format: { type: 'json_object' }
    });

    const options = {
      hostname: 'api.groq.com',
      port: 443,
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 25000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body);
            const content = parsed.choices?.[0]?.message?.content || '{}';
            resolve(JSON.parse(content));
          } catch (e) {
            reject(new Error(`Failed to parse Groq response JSON: ${e.message}`));
          }
        } else {
          reject(new Error(`Groq API returned HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Groq API request timed out after 25s'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Extract Recruiter Style DNA from either:
 * 1) Plain English style instructions / bullet points (inputType: 'description')
 * 2) 1-3 raw transcript texts / dialogue (inputType: 'transcript')
 */
async function extractPersonaDNA(recruiterName, rawInputText, sampleRole = 'Software Engineer', inputType = 'description') {
  const cleanName = (recruiterName || 'Top Recruiter').trim();
  const cleanInput = (rawInputText || '').trim();

  const minChars = inputType === 'description' ? 20 : 50;
  if (!cleanInput || cleanInput.length < minChars) {
    throw new Error(`Please provide at least ${minChars} characters describing the recruiter style or interview transcript.`);
  }

  const isPlainDescription = inputType === 'description';

  const systemPrompt = `You are an elite Conversation Analysis and Recruiter Personality Profiling AI.
Your mission is to ${isPlainDescription ? 'take plain English style instructions / persona guidelines for a recruiter' : 'analyze real interview transcripts of a top-performing recruiter'} named "${cleanName}" and architect their signature Recruiter Style DNA.

You must return a valid JSON object matching this exact schema:
{
  "personaName": "${cleanName} (Cloned Recruiter Style)",
  "executiveSummary": "1-2 concise sentences describing what makes this recruiter unique and effective.",
  "rapportStyle": "How they greet, break the ice, and establish effortless trust in the first 30 seconds.",
  "signaturePhrases": [
    "4 to 6 authentic catchphrases or transition lines extracted or derived directly from their style"
  ],
  "probingTechnique": "Their specific strategy for drilling down when candidate answers are vague or memorized.",
  "pacingAndFlow": "Description of their question brevity, cadence, and back-and-forth rhythm.",
  "pitchingCharisma": "How they talk about the company, excitement, and selling the role to top talent.",
  "sampleGreeting": "An authentic 2-sentence opening greeting that ${cleanName} would say on a voice screening call.",
  "systemInstructions": "A detailed, imperative prompt block instructing an AI voice bot on how to roleplay as ${cleanName}. Must instruct the voice bot to use the signature phrases, maintain the exact conversational rhythm, and probe naturally without sounding robotic."
}

Analyze deeply:
- Generate punchy, charismatic, human signature phrases tailored to this recruiter's persona.
- Avoid generic robot filler; make the instructions feel bespoke, memorable, and ready for high-converting voice screening calls.`;

  const userPrompt = `Recruiter Name: ${cleanName}
Target Screening Domain: ${sampleRole}
Input Mode: ${isPlainDescription ? 'Plain English Style Description & Guidelines' : 'Raw Interview Transcripts / Dialogue'}

Recruiter Style Input:
---
${cleanInput.slice(0, 15000)}
---

Generate the complete Recruiter Style DNA JSON now.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const result = await callGroqChat(messages, 0.35);
  return result;
}

module.exports = {
  extractPersonaDNA
};
