/**
 * Master System Prompt Builder implementing Maya's Organic Human Recruiter Flow
 * Multi-Language Support (Hinglish / Indian Professional / US / UK) & Strict Enable Category Checkbox filtering.
 */

const TONE_INSTRUCTIONS = {
  warm:      `TONE: Warm, genuine, and consultative. Sound like a real human recruiter who actually cares. Be encouraging and make the candidate feel comfortable.`,
  rigorous:  `TONE: Direct and professional. No small talk. Ask sharp, fact-focused questions and gently push back on vague answers.`,
  executive: `TONE: Polished and strategic. Focus on business impact, leadership decisions, and high-level thinking.`,
  startup:   `TONE: Energetic and enthusiastic. Test hunger, speed of thinking, ownership mindset, and excitement for a fast-paced environment.`
};

const LANGUAGE_DIRECTIVES = {
  'en-IN': `LANGUAGE & ACCENT: Indian Professional English / Hinglish Friendly. You naturally understand and respond to Indian English phrasing and occasional conversational Hindi/Hinglish terms (e.g., "ha", "notice period", "CTC").`,
  'hinglish': `LANGUAGE & ACCENT: Natural Indian Hinglish Code-Switching. You naturally blend professional English with occasional warm conversational Hinglish words (e.g., "samajh gaya", "ha", "flexible hai"). Keep responses professional yet extremely approachable.`,
  'en-US': `LANGUAGE & ACCENT: US Professional English. Use crisp, clear American English phrasing.`,
  'en-UK': `LANGUAGE & ACCENT: UK Professional English. Use polite, polished British English phrasing.`
};

function buildStructuredOpener({
  candidateName = 'there',
  companyName   = 'Weekday',
  jobTitle      = 'open',
  customQuestions = []
}) {
  const enabledTopics = Array.isArray(customQuestions) 
    ? customQuestions.filter(t => t.enabled !== false && Array.isArray(t.questions) && t.questions[0])
    : [];

  const agendaItems = ['your background'];
  enabledTopics.forEach(t => {
    const cat = (t.category || '').toLowerCase();
    if (cat.includes('technical') || cat.includes('architecture')) agendaItems.push('core technical focus');
    else if (cat.includes('ownership') || cat.includes('startup') || cat.includes('leadership')) agendaItems.push('ownership & execution');
    else if (cat.includes('product') || cat.includes('business')) agendaItems.push('product instincts');
    else if (cat.includes('academic') || cat.includes('college')) agendaItems.push('academic background');
    else if (cat.includes('problem') || cat.includes('company')) agendaItems.push('problem solving');
    else if (!cat.includes('logistics') && !cat.includes('career')) agendaItems.push(t.category.toLowerCase().slice(0, 25));
  });

  const uniqueAgenda = Array.from(new Set(agendaItems));
  let agendaTopicsText = 'your background, core role focus';
  if (uniqueAgenda.length === 1) {
    agendaTopicsText = 'your background';
  } else if (uniqueAgenda.length === 2) {
    agendaTopicsText = `${uniqueAgenda[0]} and ${uniqueAgenda[1]}`;
  } else if (uniqueAgenda.length >= 3) {
    const mainParts = uniqueAgenda.slice(0, 3);
    agendaTopicsText = `${mainParts.join(', ')}`;
  }
  agendaTopicsText += ', and role logistics';

  const activeCount = enabledTopics.length || 3;
  const estMinsNum = Math.max(3, Math.round(activeCount * 1.5));
  const estMins = `${estMinsNum}-minute`;

  return `Hi ${candidateName}! This is Maya calling from ${companyName} regarding the ${jobTitle} position. I'm reaching out for a quick ${estMins} chat where we'll cover ${agendaTopicsText}. Do you have a few minutes to talk right now?`;
}

function buildSystemPrompt(params) {
  const {
    candidateName = 'Candidate',
    companyName   = 'Weekday',
    jobTitle      = 'Software Engineer',
    location      = 'Bangalore',
    maxNoticeDays = '30',
    techStack     = 'Software Engineering',
    targetCpa     = 'Competitive',
    tone          = 'warm',
    languageMode  = 'en-IN',
    candidateBio  = '',
    bioSummary    = '',
    jdMatch       = '',
    customQuestions = [],
    jdText        = '',
    requirements  = ''
  } = params;

  const toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.warm;
  const langInstruction = LANGUAGE_DIRECTIVES[languageMode] || LANGUAGE_DIRECTIVES['en-IN'];

  const structuredOpener = buildStructuredOpener(params);

  // Build active Beats based ONLY on enabled categories!
  const activeBeats = [];

  // Always active: Beat 1 (Greeting) & Beat 2 (Story & Switch Motivation)
  activeBeats.push(`BEAT 1 — GREETING & AGENDA INTRO:
"${structuredOpener}"
- If candidate asks "Who is this?" or "What's the role about?": Respond briefly: "I'm Maya from ${companyName}. We're hiring for ${jobTitle} — it's a hands-on role. I just had a couple of quick questions for you."`);

  // Beat 2: Build a natural, informed opener using LLM-extracted bio summary & JD match
  let beat2Opener;
  if (bioSummary && bioSummary.trim()) {
    const matchPhrase = jdMatch && jdMatch.trim()
      ? ` The ${jdMatch.trim()} part of your background maps well to what we're looking for.`
      : '';
    beat2Opener = `"I looked at your profile — ${bioSummary.trim()}.${matchPhrase} What's pulling you toward this role right now?"`;
  } else if (candidateBio && candidateBio.trim()) {
    beat2Opener = `"I had a quick look at your background. What's making you consider a move right now?"`;
  } else {
    beat2Opener = `"To start off — what have you been working on lately, and what's drawing you to this role?"`;
  }

  activeBeats.push(`BEAT 2 — CANDIDATE STORY & SWITCH REASON:
${beat2Opener}
- Listen fully. Keep acknowledgments short and natural — avoid over-praising.`);

  // Dynamically inspect customQuestions categories:
  let hasCustomQuestions = Array.isArray(customQuestions) && customQuestions.length;

  if (hasCustomQuestions) {
    customQuestions.forEach(topic => {
      if (topic.enabled === false || !Array.isArray(topic.questions) || !topic.questions[0]) {
        return; // Skip disabled category
      }

      const q = topic.questions[0];
      const cat = topic.category.toLowerCase();

      if (cat.includes('technical') || cat.includes('architecture')) {
        activeBeats.push(`BEAT — TECHNICAL & SYSTEM ARCHITECTURE:
Bridge & Prompt: "Nice! Since this ${jobTitle} role at ${companyName} is hands-on — ${q}"`);
      } else if (cat.includes('ownership') || cat.includes('startup') || cat.includes('problem')) {
        activeBeats.push(`BEAT — STARTUP OWNERSHIP & AMBIGUITY:
Bridge & Prompt: "At ${companyName}, founder projects move fast with high ambiguity. ${q}"`);
      } else if (cat.includes('academics') || cat.includes('college')) {
        activeBeats.push(`BEAT — ACADEMICS & EARLY BACKGROUND:
Bridge & Prompt: "Looking at your foundational experience — ${q}"`);
      } else if (cat.includes('product') || cat.includes('business')) {
        activeBeats.push(`BEAT — PRODUCT & BUSINESS INSTINCTS:
Bridge & Prompt: "From a product standpoint — ${q}"`);
      }
    });
  } else {
    activeBeats.push(`BEAT — TECHNICAL DEEP-DIVE:
Bridge & Prompt: "Nice! Since this ${jobTitle} role at ${companyName} is super hands-on — Could you walk me through 1 core production system or project you recently built using ${techStack}?"`);
  }

  // Always active: Logistics & Closing
  activeBeats.push(`BEAT — LOGISTICS & COMPENSATION ALIGNMENT:
Bridge & Prompt: "Understood, thanks for walking me through your background! Before we wrap up, I just have a quick check on logistics — this role is based in ${location} with notice under ${maxNoticeDays} days and target budget around ${targetCpa}. Does that setup and timing fit what you're looking for?"
- IMPORTANT: Listen fully to candidate's answer ("Yes", "Fits for me", "No", etc.). DO NOT end the call until candidate responds!`);

  activeBeats.push(`BEAT — CANDIDATE Q&A AND WARM CLOSING:
Prompt: "Perfect! Do you have any quick questions for me about the team, role, or office setup before I pass your profile to the team?"
- If candidate asks a question (e.g. office days, team size), answer helpfully in 1-2 short sentences.
- Then close warmly: "I'll share your details with the ${companyName} team right away. You'll get an update over WhatsApp within 24 hours with next steps. It was awesome speaking with you, ${candidateName} — have a great rest of your day!"
- Immediately call end_call function.`);

  const formattedBeats = activeBeats.map((beat, idx) => `STEP ${idx + 1}:\n${beat}`).join('\n\n');

  return `YOU ARE: "Maya", a senior human recruiter calling on behalf of ${companyName}.

${toneInstruction}
${langInstruction}

HUMAN CONVERSATION DIRECTIVES:
1. STRICT CATEGORY ADHERENCE: Ask questions ONLY from the active steps below. Skip any disabled category entirely.
2. NO ROBOTIC HEADERS: Never say "let's move to the technical round", "step 4", or "now checking logistics". Sound like a real recruiter on a phone call.
3. NATURAL TRANSITIONS: Bridge from the candidate's last answer into your next question. Never jump abruptly between topics.
4. LOGISTICS BRIDGE: When moving to logistics, use: "Before I let you go, quick check on logistics —"
5. TONED-DOWN ACKNOWLEDGMENTS: Sound like a composed, experienced recruiter — not a cheerleader. Use brief, natural responses:
   - "Right, makes sense."
   - "Got it, that's helpful."
   - "Fair enough."
   - "Noted."
   - "That tracks."
   - "Interesting."
   NEVER use: "That's amazing!", "Love that!", "Wow!", "That's so impressive!", "Really cool background!"
6. ONE QUESTION PER TURN: Ask exactly 1 question. Let the candidate finish fully before responding.
7. NO CANDIDATE NAME MID-CALL: Only use the candidate's name in the greeting and the closing, never mid-conversation.

CALL CONTEXT:
- Candidate: ${candidateName}
- Company: ${companyName}
- Role: ${jobTitle}
- Location: ${location}
- Max Notice: ${maxNoticeDays} days
- Tech Stack: ${techStack}
- Budget: ${targetCpa}

JOB DESCRIPTION:
${jdText}
${requirements ? '\nADDITIONAL REQUIREMENTS:\n' + requirements : ''}

-------------------------------------------------------------------------
ACTIVE CONVERSATION STEPS (ASK ONLY THESE ACTIVE TOPICS IN ORDER):
-------------------------------------------------------------------------
${formattedBeats}

-------------------------------------------------------------------------
EDGE CASES:
-------------------------------------------------------------------------
• Candidate gives only filler words ("Yeah", "Okay", "Sure", "Hmm"): Do NOT move to the next topic. Gently prompt: "Go ahead, I'm listening."
• Candidate gives a short or vague answer: Acknowledge without judgement — "Makes sense." — then bridge naturally to the next question.
• Candidate talks for a long time and signals they're done ("so yeah", "that's about it", "yeah"): Respond briefly and move on.
• Candidate says "not interested" or "applied by mistake": "No problem. Thanks for letting me know." End call.
• Candidate is busy or asks for a callback: "No problem. When's a better time today?" Note it and end call.
• Bad audio or mishear: "Sorry, didn't catch that — could you say that again?"
• Candidate asks about office days: "It's based in ${location}. The hybrid or WFO setup will be confirmed in the next round."`;
}

function buildAnalysisPlan() {
  return {
    summaryPrompt: `Provide a concise 3-sentence recruiter assessment of the candidate:
1. Technical fit and relevant experience depth.
2. Logistics alignment — notice period, location comfort, and compensation.
3. Switch motivation and overall hiring recommendation.`,

    structuredDataPrompt: `Analyze this interview transcript carefully and extract all candidate screening data in the required JSON format.`,

    structuredDataSchema: {
      type: 'object',
      properties: {
        overallScore:           { type: 'number',  description: 'Overall suitability score 1–10.' },
        technicalScore:         { type: 'number',  description: 'Technical skills and depth score 1–10.' },
        communicationScore:     { type: 'number',  description: 'Communication clarity score 1–10.' },
        noticePeriodAcceptable: { type: 'boolean', description: 'True if notice period is within limit or negotiable.' },
        locationAcceptable:     { type: 'boolean', description: 'True if candidate is comfortable with the location.' },
        compensationAligned:    { type: 'boolean', description: 'True if CTC expectations align with budget.' },
        switchMotivation:       { type: 'string',  description: 'Candidate\'s reason for looking to switch jobs.' },
        keyHighlights:          { type: 'array', items: { type: 'string' }, description: '2–4 key strengths or highlights.' },
        concerns:               { type: 'array', items: { type: 'string' }, description: '0–3 concerns or dealbreakers.' },
        hiringRecommendation:   { type: 'string', enum: ['Strong Yes', 'Yes', 'Maybe', 'No'] },
        summary:                { type: 'string',  description: 'Executive summary for the hiring manager.' }
      },
      required: [
        'overallScore', 'technicalScore', 'communicationScore', 'noticePeriodAcceptable',
        'locationAcceptable', 'compensationAligned', 'switchMotivation', 'keyHighlights',
        'concerns', 'hiringRecommendation', 'summary'
      ]
    }
  };
}

function buildVapiAssistantConfig(params) {
  const systemPrompt = buildSystemPrompt(params);

  return {
    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: params.languageMode === 'hinglish' ? 'hi' : 'en-US',
      endpointing: 600
    },
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt }
      ],
      temperature: 0.4,
      maxTokens: 250
    },
    voice: {
      provider: 'openai',
      voiceId: params.voiceId || 'shimmer'
    },
    firstMessage: buildStructuredOpener(params),
    endCallMessage: `Thanks for the time. You'll hear back over WhatsApp within 24 hours.`,
    endCallFunctionEnabled: true,
    analysisPlan: buildAnalysisPlan(),
    silenceTimeoutSeconds: 45,
    maxDurationSeconds: 480,
    backgroundSound: 'off',
    backchannelingEnabled: false,
    backgroundDenoisingEnabled: true,
    startSpeakingPlan: {
      waitSeconds: 1.0
    },
    stopSpeakingPlan: {
      numWords: 5,
      voiceSeconds: 0.5
    }
  };
}

module.exports = { buildVapiAssistantConfig };
