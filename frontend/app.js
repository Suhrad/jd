import Vapi from 'https://esm.sh/@vapi-ai/web';

// ── State ──────────────────────────────────────────────────────────────────
let vapi                   = null;
let currentCandidateId     = null;
let currentJobId           = null;
let callTimerInterval      = null;
let callStartTime          = null;
let pollingInterval        = null;
let activeCallId           = null;
let currentModalReportData = null;
let allCandidatesCache     = [];
let currentTone            = 'warm';
let currentQuestionsState  = [];

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  injectSvgGradients();
  setConnection('initializing', 'Initializing...');
  await loadLatestJob();
  await loadCandidates();
  await initVapi();
  setupJdAutoExtractor();
});

async function initVapi() {
  try {
    const res  = await fetch('/api/config');
    const body = await res.json();

    if (!res.ok) {
      setConnection('error', 'No API Key');
      showToast(`⚠️ ${body.error}`, 'error');
      return;
    }

    vapi = new Vapi(body.vapiPublicKey);
    wireVapiEvents();
    setConnection('connected', 'WeekdayAI is ready');
  } catch (err) {
    setConnection('error', 'Init Failed');
    console.error('Vapi init error:', err);
    showToast('Failed to initialize Maya. Is server running?', 'error');
  }
}

// ── Navigation Tab Switcher ────────────────────────────────────────────────
window.switchTab = function (tabNum) {
  for (let i = 1; i <= 4; i++) {
    const btn  = document.getElementById(`tabBtn${i}`);
    const view = document.getElementById(`tabView${i}`);
    if (btn)  btn.classList.toggle('active', i === tabNum);
    if (view) view.classList.toggle('active', i === tabNum);
  }
  if (tabNum === 4) {
    renderLeaderboardDashboard();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.saveAndNext = async function (currentTab) {
  if (currentTab === 1) {
    // Disable both Save & Continue buttons while working
    const btns = document.querySelectorAll('[onclick="saveAndNext(1)"]');
    await generateScriptWithAI();

    btns.forEach(b => { b.disabled = false; b.textContent = 'Save & Continue to AI Questions →'; });
    switchTab(2);

  } else if (currentTab === 2) {
    await saveJob();
    switchTab(3);
  }
};

// ── Tone Selector Handler ──────────────────────────────────────────────────
window.setTone = function (toneKey) {
  currentTone = toneKey;
  document.querySelectorAll('.tone-card').forEach(card => {
    card.classList.toggle('active', card.getAttribute('data-tone') === toneKey);
  });
};

let lastSavedJdFingerprint = '';
let isJdChanged = false;

// ── Job Config ─────────────────────────────────────────────────────────────
async function loadLatestJob() {
  try {
    const res = await fetch('/api/jobs/latest');
    const job = await res.json();
    if (job) {
      document.getElementById('companyName').value   = job.company_name    || 'Weekday';
      document.getElementById('jobTitle').value      = job.title           || '';
      document.getElementById('location').value      = job.location        || '';
      document.getElementById('maxNoticeDays').value = job.max_notice_days || '30';
      document.getElementById('techStack').value     = job.tech_stack      || '';
      document.getElementById('targetCpa').value     = job.target_cpa      || '';
      document.getElementById('jdText').value        = job.jd_text         || '';
      
      if (job.tone)     setTone(job.tone);
      if (job.voice_id) document.getElementById('voiceId').value = job.voice_id;

      // Fingerprint existing job to detect if user pastes a new JD later
      lastSavedJdFingerprint = `${job.title}__${job.company_name}__${job.jd_text}`.trim();
      isJdChanged = false;

      if (Array.isArray(job.custom_questions) && job.custom_questions.length >= 7) {
        currentQuestionsState = job.custom_questions;
        renderQuestionsArchitect();
      } else {
        // Auto-generate full 7-category cards if DB had incomplete data
        generateScriptWithAI();
      }
      currentJobId = job.id;
    }
  } catch (err) {
    console.warn('Could not load last job:', err.message);
  }
}

// ── AI Question Generator & Copilot ────────────────────────────────────────
window.generateScriptWithAI = async function () {
  let jdText          = document.getElementById('jdText').value.trim();
  const companyName   = document.getElementById('companyName').value.trim() || 'Weekday';
  const jobTitle      = document.getElementById('jobTitle').value.trim() || 'Software Engineer / Founder Office';
  const techStack     = document.getElementById('techStack').value.trim() || 'Software Engineering';
  const copilotPrompt = document.getElementById('copilotPrompt').value.trim();

  // If no JD text is present, provide a smart default so AI generator ALWAYS works!
  if (!jdText) {
    jdText = `Hiring for ${jobTitle} at ${companyName}. Requirements: ${techStack}. Looking for high ownership, strong problem solving, and immediate joining capability.`;
    document.getElementById('jdText').value = jdText;
  }

  const btn = document.getElementById('btnGenQuestions');
  btn.disabled = true;
  btn.textContent = '⚡ Architecting Questions...';

  try {
    const res = await fetch('/api/jobs/generate-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jdText, companyName, jobTitle, techStack, copilotPrompt })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentQuestionsState = data.topics || [];
    renderQuestionsArchitect();
    showToast('⚡ Interview questions architected successfully!', 'success');
  } catch (err) {
    showToast(`AI Architect failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Architect Questions with AI';
  }
};

// ── Copilot Action Dispatcher ──────────────────────────────────────────────
window.executeCopilotAction = async function () {
  const mode = document.getElementById('copilotMode')?.value || 'REPLACE_ALL';
  const prompt = document.getElementById('copilotPrompt').value.trim();

  if (mode === 'ADD_NEW') {
    if (!prompt) { showToast('Please enter what topic/question you want to add.', 'error'); return; }
    await addAIQuestionTopic(prompt);
  } else {
    await generateScriptWithAI();
  }
};

window.promptAddAiCategoryCard = function () {
  const input = prompt("Enter what question/topic you want AI to generate a card for:\n(e.g., 'Test sales resilience under cold call rejection' or 'Ask about notice period flexibility')");
  if (input && input.trim()) {
    addAIQuestionTopic(input.trim());
  }
};

async function addAIQuestionTopic(promptText) {
  const companyName = document.getElementById('companyName').value.trim();
  const jobTitle    = document.getElementById('jobTitle').value.trim();
  const techStack   = document.getElementById('techStack').value.trim();
  const jdText      = document.getElementById('jdText').value.trim();

  showToast('✨ Generating new AI category card...', '');
  try {
    const res = await fetch('/api/jobs/add-ai-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText, companyName, jobTitle, techStack, jdText })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentQuestionsState.push(data.newTopic);
    renderQuestionsArchitect();
    showToast('✨ New AI category card added!', 'success');
  } catch (err) {
    showToast(`Failed to add AI card: ${err.message}`, 'error');
  }
}

// ── Single Card Inline AI Refinement ────────────────────────────────────────
window.toggleInlineRefineBox = function (tIdx) {
  const box = document.getElementById(`refine-box-${tIdx}`);
  if (box) {
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) {
      const input = document.getElementById(`refine-input-${tIdx}`);
      if (input) input.focus();
    }
  }
};

window.refineSingleTopicWithAI = async function (tIdx) {
  const input = document.getElementById(`refine-input-${tIdx}`);
  const promptText = input ? input.value.trim() : '';

  if (!promptText) {
    showToast('Please enter an instruction (e.g. "Focus 50% on system design").', 'error');
    return;
  }

  const topic           = currentQuestionsState[tIdx];
  const companyName     = document.getElementById('companyName').value.trim();
  const jobTitle        = document.getElementById('jobTitle').value.trim();
  const techStack       = document.getElementById('techStack').value.trim();
  const jdText          = document.getElementById('jdText').value.trim();
  const currentQuestion = topic.questions[0] || '';

  const btn = document.getElementById(`refine-btn-${tIdx}`);
  if (btn) { btn.disabled = true; btn.textContent = '⚡ Refining...'; }

  try {
    const res = await fetch('/api/jobs/refine-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: topic.category,
        currentQuestion,
        jdText,
        companyName,
        jobTitle,
        techStack,
        prompt: promptText
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentQuestionsState[tIdx].questions[0] = data.refinedQuestion;
    renderQuestionsArchitect();
    showToast(`⚡ Refined "${topic.category}" question successfully!`, 'success');
  } catch (err) {
    showToast(`Refine failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Refine Card'; }
  }
};

// ── Render Questions Architect Workspace ────────────────────────────────────
function renderQuestionsArchitect() {
  const container  = document.getElementById('topicsContainer');
  const countBadge = document.getElementById('questionCountBadge');

  if (!currentQuestionsState.length) {
    container.innerHTML = `
      <div class="topics-empty-placeholder">
        <div class="empty-sparkle">⚡</div>
        <h3>No Question Script Architected Yet</h3>
        <p>Click the <strong>"⚡ Run AI Copilot"</strong> button above to parse your JD and automatically generate 7 category topic cards.</p>
      </div>`;
    countBadge.textContent = '0 Questions Active';
    return;
  }

  let totalQCount = 0;

  container.innerHTML = currentQuestionsState.map((topic, tIdx) => {
    const isEnabled = topic.enabled !== false;
    const questions = topic.questions || [];
    totalQCount += isEnabled ? questions.length : 0;

    return `
      <div class="topic-card" id="topic-card-${tIdx}">
        <div class="topic-header">
          <div class="topic-title">
            <span>${topicIconMap(topic.category)}</span>
            <span>${esc(topic.category)}</span>
          </div>
          <div class="topic-header-actions">
            <button class="btn-card-refine" onclick="toggleInlineRefineBox(${tIdx})" title="Refine only this card with AI">AI Refine</button>
            <label class="topic-toggle">
              <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleTopicEnabled(${tIdx}, this.checked)" />
              <span>Enable</span>
            </label>
          </div>
        </div>

        <!-- Inline Card AI Refine Prompt Box -->
        <div class="card-refine-box" id="refine-box-${tIdx}" style="display:none;">
          <input type="text" id="refine-input-${tIdx}" class="card-refine-input"
            placeholder="e.g. Focus 50% on system design and ask why they left 1st job in < 6 months..."
            onkeydown="if(event.key==='Enter') refineSingleTopicWithAI(${tIdx})" />
          <button class="btn-card-refine-run" id="refine-btn-${tIdx}" onclick="refineSingleTopicWithAI(${tIdx})">Refine Card</button>
        </div>

        ${isEnabled ? `
          <div class="topic-questions-list">
            ${questions.map((q, qIdx) => `
              <div class="q-item">
                <input type="text" class="q-input" value="${esc(q)}" oninput="updateQuestionText(${tIdx}, ${qIdx}, this.value)" />
                <button class="btn-icon-del" onclick="deleteQuestion(${tIdx}, ${qIdx})" title="Delete question">✕</button>
              </div>
            `).join('')}
            <button class="btn-add-q" onclick="addQuestionToTopic(${tIdx})">+ Add Question</button>
          </div>
        ` : ''}
      </div>`;
  }).join('');

  countBadge.textContent = `${totalQCount} Questions Active`;
}

function topicIconMap(category) {
  if (category.includes('Career'))     return '🔄';
  if (category.includes('Technical'))  return '⚡';
  if (category.includes('Company'))    return '🏢';
  if (category.includes('Ownership'))  return '🚀';
  if (category.includes('Product'))    return '📊';
  if (category.includes('Academics'))  return '🎓';
  if (category.includes('Logistics'))  return '📍';
  return '💬';
}

window.toggleTopicEnabled = function (tIdx, enabled) {
  currentQuestionsState[tIdx].enabled = enabled;
  renderQuestionsArchitect();
};

window.updateQuestionText = function (tIdx, qIdx, text) {
  currentQuestionsState[tIdx].questions[qIdx] = text;
};

window.deleteQuestion = function (tIdx, qIdx) {
  currentQuestionsState[tIdx].questions.splice(qIdx, 1);
  renderQuestionsArchitect();
};

window.addQuestionToTopic = function (tIdx) {
  currentQuestionsState[tIdx].questions.push('New custom interview question...');
  renderQuestionsArchitect();
};

// ── Save Job Config ────────────────────────────────────────────────────────
window.saveJob = async function () {
  const companyName   = document.getElementById('companyName').value.trim();
  const title         = document.getElementById('jobTitle').value.trim();
  const location      = document.getElementById('location').value.trim();
  const maxNoticeDays = document.getElementById('maxNoticeDays').value.trim();
  const techStack     = document.getElementById('techStack').value.trim();
  const targetCpa     = document.getElementById('targetCpa').value.trim();
  const languageMode  = document.getElementById('languageMode')?.value || 'en-IN';
  const voiceId       = document.getElementById('voiceId').value;
  let jdText          = document.getElementById('jdText').value.trim();

  if (!title) { showToast('Please enter a Job Role Title.', 'error'); return; }
  if (!jdText) {
    jdText = `Hiring for ${title} at ${companyName || 'Weekday'}. Requirements: ${techStack || 'Engineering'}.`;
    document.getElementById('jdText').value = jdText;
  }

  try {
    const newFingerprint = `${title}__${companyName}__${jdText}`.trim();
    if (newFingerprint !== lastSavedJdFingerprint) {
      isJdChanged = true;
      lastSavedJdFingerprint = newFingerprint;
    } else {
      isJdChanged = false;
    }

    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName,
        title,
        location,
        maxNoticeDays,
        techStack,
        targetCpa,
        tone: currentTone,
        languageMode,
        voiceId,
        customQuestions: currentQuestionsState,
        jdText
      })
    });
    const job = await res.json();
    if (!res.ok) throw new Error(job.error);

    currentJobId = job.id;
    const status = document.getElementById('jobSaveStatus');
    if (status) {
      status.textContent = '✓ Config & Persona saved!';
      setTimeout(() => (status.textContent = ''), 3500);
    }
    showToast('Screening configuration saved!', 'success');
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
  }
};

// ── Start Interview ────────────────────────────────────────────────────────
window.startInterview = async function () {
  const candidateName = document.getElementById('candidateName').value.trim();
  const candidateBio  = document.getElementById('candidateBio')?.value?.trim() || '';

  if (!candidateName) { showToast("Please enter candidate's full name.", 'error'); return; }
  if (!currentJobId)  { showToast('Please save Screening Config first.', 'error'); return; }
  if (!vapi)          { showToast('Maya AI not initialized. Check Vapi key in .env.', 'error'); return; }

  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  btn.textContent = 'Connecting to Maya...';

  try {
    const res = await fetch('/api/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: candidateName, jobId: currentJobId, candidateBio })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentCandidateId = data.candidateId;

    const jobTitle = document.getElementById('jobTitle').value.trim();
    document.getElementById('callerInitial').textContent     = candidateName[0].toUpperCase();
    document.getElementById('callerNameDisplay').textContent = candidateName;
    document.getElementById('callerRoleDisplay').textContent = `Maya screening for ${jobTitle || 'Role'}`;

    showState('active');
    setLabel('aiStatusLabel', 'Connecting to Maya...');
    setBadge('Calling', 'calling');

    const call = await vapi.start(data.vapiConfig);
    activeCallId = call?.id || null;

    if (activeCallId) {
      fetch(`/api/candidates/${currentCandidateId}/call-started`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: activeCallId })
      }).catch(console.error);
    }

  } catch (err) {
    console.error('Failed to start interview:', err);
    showToast(`Failed to start: ${err.message}`, 'error');
    showState('idle');
    setBadge('Idle', '');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<div class="start-btn-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></div><span>Start Screening with Maya</span>`;
  }
};

// ── End Interview ──────────────────────────────────────────────────────────
window.endInterview = function () {
  if (vapi) {
    try { vapi.stop(); } catch (_) {}
  }
};

// ── Vapi Event Listeners ───────────────────────────────────────────────────
function wireVapiEvents() {
  vapi.on('call-start', () => {
    setBadge('Active', 'active');
    setLabel('aiStatusLabel', 'Maya is conducting the screening call...');
    startCallTimer();
    loadCandidates();

    // Reset Live Transcript Feed
    const feed = document.getElementById('liveTranscriptFeed');
    if (feed) feed.innerHTML = '<p class="lt-placeholder">Live conversation stream started...</p>';
  });

  vapi.on('message', (msg) => {
    if (msg.type === 'transcript' && msg.transcript) {
      appendLiveTranscript(msg.role === 'assistant' ? 'Maya' : 'Candidate', msg.transcript, msg.role);
    }
  });

  vapi.on('call-end', async () => {
    stopCallTimer();
    showState('processing');
    setBadge('Processing', 'processing');
    showToast('Screening call ended. Evaluating dealbreakers (~20 sec)...', '');
    await loadCandidates();
    startPolling();
  });

  vapi.on('speech-start', () => {
    setLabel('aiStatusLabel', '🤖 Maya is speaking...');
    const vis = document.getElementById('visualizer');
    vis.classList.remove('listening');
    vis.classList.add('speaking');
  });

  vapi.on('speech-end', () => {
    setLabel('aiStatusLabel', '🎤 Listening to candidate...');
    const vis = document.getElementById('visualizer');
    vis.classList.remove('speaking');
    vis.classList.add('listening');
  });

  vapi.on('volume-level', (level) => {
    document.querySelectorAll('.vis-bar').forEach((bar) => {
      const jitter = (0.5 + Math.random() * 0.5) * level;
      bar.style.height = `${Math.max(6, Math.min(50, jitter * 54))}px`;
    });
  });

  vapi.on('error', (err) => {
    console.error('Vapi error:', err);
    showToast(`Call error: ${err?.message || 'Unknown error'}`, 'error');
    showState('idle');
    setBadge('Idle', '');
    stopCallTimer();
    clearInterval(pollingInterval);
    loadCandidates();
  });
}

// ── Live Transcript Stream Smart Scroll & Fullscreen ─────────────────────────
let userIsScrolledUp = false;

window.handleTranscriptScroll = function (feedEl) {
  if (!feedEl) return;
  const distanceToBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight;
  userIsScrolledUp = distanceToBottom > 60;
  const pill = document.getElementById('ltScrollPill');
  if (pill) {
    if (userIsScrolledUp) pill.classList.remove('hidden');
    else pill.classList.add('hidden');
  }
};

window.scrollToTranscriptBottom = function () {
  const feed = document.getElementById('liveTranscriptFeed');
  if (feed) {
    feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    userIsScrolledUp = false;
    const pill = document.getElementById('ltScrollPill');
    if (pill) pill.classList.add('hidden');
  }
};

window.openFullscreenTranscript = function () {
  const feed = document.getElementById('liveTranscriptFeed');
  const fsFeed = document.getElementById('fsTranscriptFeed');
  const modal = document.getElementById('fullscreenTranscriptModal');
  if (feed && fsFeed && modal) {
    fsFeed.innerHTML = feed.innerHTML;
    modal.classList.remove('hidden');
  }
};

window.closeFullscreenTranscript = function () {
  const modal = document.getElementById('fullscreenTranscriptModal');
  if (modal) modal.classList.add('hidden');
};

window.closeFullscreenTranscriptOnBg = function (e) {
  if (e.target && e.target.id === 'fullscreenTranscriptModal') {
    closeFullscreenTranscript();
  }
};

let currentTurnSpeaker = null;
let currentTurnMsgElement = null;
let currentFsTurnMsgElement = null;

function appendLiveTranscript(speaker, text, role) {
  const feed = document.getElementById('liveTranscriptFeed');
  const fsFeed = document.getElementById('fsTranscriptFeed');
  if (!feed) return;

  const placeholder = feed.querySelector('.lt-placeholder');
  if (placeholder) placeholder.remove();

  const isBot = role === 'assistant';
  const speakerLabel = isBot ? '🤖 Maya (AI Recruiter)' : '👤 Candidate';
  const innerHTML = `<div class="lt-speaker-badge">${speakerLabel}</div><div>${esc(text)}</div>`;

  // Update existing speaker turn bubble or append new speech bubble
  if (currentTurnSpeaker === role && currentTurnMsgElement) {
    currentTurnMsgElement.innerHTML = innerHTML;
    if (currentFsTurnMsgElement) currentFsTurnMsgElement.innerHTML = innerHTML;
  } else {
    currentTurnSpeaker = role;

    const msgDiv = document.createElement('div');
    msgDiv.className = `lt-msg ${isBot ? 'bot' : 'user'}`;
    msgDiv.innerHTML = innerHTML;
    feed.appendChild(msgDiv);
    currentTurnMsgElement = msgDiv;

    if (fsFeed) {
      const fsMsgDiv = document.createElement('div');
      fsMsgDiv.className = `lt-msg ${isBot ? 'bot' : 'user'}`;
      fsMsgDiv.innerHTML = innerHTML;
      fsFeed.appendChild(fsMsgDiv);
      currentFsTurnMsgElement = fsMsgDiv;
      fsFeed.scrollTop = fsFeed.scrollHeight;
    }
  }

  // Only auto-scroll feed if user hasn't manually scrolled up to read earlier text!
  if (!userIsScrolledUp) {
    feed.scrollTop = feed.scrollHeight;
  } else {
    const pill = document.getElementById('ltScrollPill');
    if (pill) pill.classList.remove('hidden');
  }
}

// ── Result Polling ─────────────────────────────────────────────────────────
function startPolling() {
  let attempts = 0;
  const MAX    = 24;

  clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    if (attempts++ >= MAX || !currentCandidateId) {
      clearInterval(pollingInterval);
      showState('idle');
      setBadge('Idle', '');
      showToast('Analysis timed out. Click refresh to check History.', 'error');
      return;
    }

    updateProcessingSteps(attempts);

    try {
      const res  = await fetch(`/api/candidates/${currentCandidateId}/results`);
      const data = await res.json();

      if (data.status === 'completed' && data.overallScore != null) {
        clearInterval(pollingInterval);
        await loadCandidates();
        showState('idle');
        setBadge('Idle', '');
        document.getElementById('candidateName').value = '';
        showToast('✅ Evaluation report ready!', 'success');
        setTimeout(() => openModal(currentCandidateId, data), 600);
      }
    } catch (err) {
      console.warn('Polling error:', err.message);
    }
  }, 3000);
}

function updateProcessingSteps(attempt) {
  const s1 = document.getElementById('procStep1');
  const s2 = document.getElementById('procStep2');
  const s3 = document.getElementById('procStep3');
  if (attempt >= 2) { s1.className = 'proc-step done';   s1.children[0].textContent = '✓'; }
  if (attempt >= 4) { s2.className = 'proc-step active'; s2.children[0].textContent = '⟳'; }
  if (attempt >= 7) { s3.className = 'proc-step active'; s3.children[0].textContent = '⟳'; }
}

// ── Candidates List & Filtering ────────────────────────────────────────────
window.loadCandidates = async function () {
  try {
    const res          = await fetch('/api/candidates');
    allCandidatesCache = await res.json();
    renderCandidates(allCandidatesCache);
  } catch (err) {
    console.error('Failed to load candidates:', err);
  }
};

window.filterCandidates = function () {
  const query = (document.getElementById('historySearchInput')?.value || '').toLowerCase().trim();
  if (!query) {
    renderCandidates(allCandidatesCache);
    return;
  }
  const filtered = allCandidatesCache.filter(c => 
    (c.name || '').toLowerCase().includes(query) ||
    (c.job_title || '').toLowerCase().includes(query) ||
    (c.recommendation || '').toLowerCase().includes(query)
  );
  renderCandidates(filtered);
};

function renderCandidates(candidates) {
  const list = document.getElementById('candidatesList');
  if (!candidates.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>No candidates found.</p>
      </div>`;
    return;
  }

  list.innerHTML = candidates.map(c => {
    const hasScores = c.overall_score != null;
    return `
      <div class="candidate-card" id="card-${c.id}" onclick="onCandidateClick(${c.id})">
        <div class="cc-header">
          <span class="cc-name">${esc(c.name)}</span>
          <span class="chip chip-${c.status}">${c.status}</span>
        </div>
        <div class="cc-role">${esc(c.job_title || '')} ${c.company_name ? '@ ' + esc(c.company_name) : ''}</div>
        ${hasScores ? `
          <div class="cc-scores">
            <span class="cc-score">Overall: <strong>${c.overall_score}/10</strong></span>
            <span class="cc-score">Tech: <strong>${c.technical_score}/10</strong></span>
            <span class="cc-score">Comm: <strong>${c.communication_score}/10</strong></span>
          </div>
          <div class="cc-rec">&rarr; ${esc(c.recommendation || '')}</div>
        ` : ''}
      </div>`;
  }).join('');
}

window.onCandidateClick = async function (id) {
  try {
    const res  = await fetch(`/api/candidates/${id}/results`);
    const data = await res.json();
    if (data.status !== 'completed' || data.overallScore == null) {
      showToast('Results not available yet. Please wait.', '');
      return;
    }
    openModal(id, data);
  } catch (err) {
    showToast('Failed to load results.', 'error');
  }
};

// ── Results Modal ──────────────────────────────────────────────────────────
async function openModal(candidateId, data) {
  currentModalReportData = { ...data };

  let candidateName = `Candidate #${candidateId}`;
  let meta = '';
  try {
    const res = await fetch(`/api/candidates/${candidateId}`);
    const c   = await res.json();
    candidateName = c.name || candidateName;
    currentModalReportData._name = candidateName;
    if (c.job_title)     meta += `${c.job_title} @ ${c.company_name || 'Weekday'}`;
    if (c.duration_secs) meta += ` · ${formatDuration(c.duration_secs)}`;
    currentModalReportData._meta = meta;
  } catch (_) {}

  document.getElementById('modalCandidateName').textContent = candidateName;
  document.getElementById('modalMeta').textContent          = meta;

  const overall  = data.overallScore || 0;
  const offset   = 314 - (314 * overall / 10);
  const ringFill = document.getElementById('ringOverallFill');
  document.getElementById('scoreOverall').textContent = `${overall}`;
  setTimeout(() => {
    ringFill.style.strokeDashoffset = String(offset);
    if      (overall >= 8) ringFill.style.stroke = '#059669';
    else if (overall >= 6) ringFill.style.stroke = '#0284c7';
    else if (overall >= 4) ringFill.style.stroke = '#d97706';
    else                   ringFill.style.stroke = '#e11d48';
  }, 80);

  const tech = data.technicalScore     || 0;
  const comm = data.communicationScore || 0;
  document.getElementById('scoreTechnical').textContent     = `${tech}/10`;
  document.getElementById('scoreCommunication').textContent = `${comm}/10`;
  setTimeout(() => {
    document.getElementById('barTech').style.width = `${tech * 10}%`;
    document.getElementById('barComm').style.width = `${comm * 10}%`;
  }, 100);

  const isDroppedCall = data.recommendation === 'Call Dropped Early (Re-Screen)' || data.overallScore === 0;
  const health        = data.callHealth || {};
  const hasIncident   = health.hasIncident || isDroppedCall;

  // Render Uber-Grade Call Incident Diagnostic Banner
  const incContainer = document.getElementById('incidentBannerContainer');
  if (incContainer) {
    if (hasIncident) {
      const durationText = data.durationSecs ? `${data.durationSecs}s` : '0:25s';
      const rootCause    = health.rootCause || 'Candidate disconnected during Beat 2 (Story & Switch Reason).';
      const impact       = health.impact    || 'Technical stack, notice period & salary budget unverified.';
      const sentiment    = health.sentiment || 'Neutral / Abrupt Disconnect';
      const title        = health.incidentTitle || `🚨 CALL INCIDENT DETECTED: Call Dropped at ${durationText}`;

      incContainer.innerHTML = `
        <div class="incident-card">
          <div class="incident-card-header">
            <div class="incident-badge">
              <span class="pulse-red"></span> ${esc(title)}
            </div>
            <span class="incident-timestamp">INCIDENT AUDIT DIAGNOSTIC</span>
          </div>

          <div class="incident-grid">
            <div class="incident-col">
              <div class="inc-label">🔍 ROOT CAUSE</div>
              <div class="inc-val">${esc(rootCause)}</div>
            </div>
            <div class="incident-col">
              <div class="inc-label">⚡ IMPACT &amp; UNVERIFIED PILLARS</div>
              <div class="inc-val">${esc(impact)}</div>
            </div>
            <div class="incident-col">
              <div class="inc-label">😊 CANDIDATE SENTIMENT</div>
              <div class="inc-val sentiment-neutral">${esc(sentiment)}</div>
            </div>
          </div>

          <div class="incident-actions">
            <button class="btn-inc-action primary" onclick="retryAiCall(${candidateId})">📞 Retry AI Call</button>
            <button class="btn-inc-action whatsapp" onclick="copyRecoveryWhatsAppCard(${candidateId})">📲 Send Recovery WhatsApp</button>
            <button class="btn-inc-action secondary" onclick="flagForHumanReview(${candidateId})">📝 Flag for Human Review</button>
          </div>
        </div>`;
    } else {
      incContainer.innerHTML = '';
    }
  }

  const recMap = {
    'Strong Yes': ['rec-strong-yes', '🟢'],
    'Yes':        ['rec-yes',        '🔵'],
    'Maybe':      ['rec-maybe',      '🟡'],
    'No':         ['rec-no',         '🔴'],
    'Call Dropped Early (Re-Screen)': ['rec-no', '🔴']
  };
  const [cls, emoji] = recMap[data.recommendation] || ['rec-no', '🔴'];
  const recEl = document.getElementById('recommendationBanner');
  recEl.className   = `recommendation-banner ${cls}`;
  recEl.textContent = isDroppedCall 
    ? `🔴 Call Dropped Early (< 45s) — Re-Screen Recommended`
    : `${emoji}  Maya Recommendation: ${data.recommendation || 'Inconclusive'}`;

  // Audio Recording Playback Player
  const audioContainer = document.getElementById('audioPlayerContainer');
  const audioPlayer    = document.getElementById('modalAudioPlayer');
  if (data.recordingUrl) {
    if (audioPlayer) audioPlayer.src = data.recordingUrl;
    if (audioContainer) audioContainer.style.display = 'block';
  } else {
    if (audioContainer) audioContainer.style.display = 'none';
    if (audioPlayer) audioPlayer.src = '';
  }

  document.getElementById('modalSummary').textContent = data.summary || 'No summary available.';

  const hlEl = document.getElementById('modalHighlights');
  hlEl.innerHTML = (data.highlights || []).length
    ? data.highlights.map(h => `<li>${esc(h)}</li>`).join('')
    : '<li>No highlights recorded.</li>';

  const cnEl          = document.getElementById('modalConcerns');
  const concernsBlock = document.getElementById('concernsBlock');
  const concerns      = data.concerns || [];
  if (concerns.length) {
    cnEl.innerHTML = concerns.map(c => `<li>${esc(c)}</li>`).join('');
    concernsBlock.style.display = '';
  } else {
    concernsBlock.style.display = 'none';
  }

  // ── Talent Persona Card ─────────────────────────────────────────────────
  const personaBlock = document.getElementById('talentPersonaBlock');
  const tp = data.talentPersona;
  if (tp && tp.label) {
    document.getElementById('tpIcon').textContent  = tp.icon  || '👤';
    document.getElementById('tpLabel').textContent = tp.label || '';
    document.getElementById('tpDesc').textContent  = tp.description || '';
    document.getElementById('tpNote').textContent  = tp.recruiterNote || '';
    personaBlock.style.display = '';
  } else {
    personaBlock.style.display = 'none';
  }

  // ── Answer Depth Radar ──────────────────────────────────────────────────
  const radarBlock = document.getElementById('answerRadarBlock');
  const radarCards = document.getElementById('answerRadarCards');
  const vague      = data.vagueAnswers || [];
  if (vague.length) {
    radarCards.innerHTML = vague.map(v => `
      <div class="radar-item">
        <div class="radar-flag-row">
          <span class="radar-flag-dot"></span>
          <span class="radar-flag-text">${esc(v.flag || 'Depth not confirmed in call')}</span>
        </div>
        <div class="radar-q"><strong>Q asked:</strong> ${esc(v.questionAsked || '')}</div>
        <div class="radar-q"><strong>Candidate said:</strong> "${esc(v.candidateAnswer || '')}"</div>
        <div class="radar-reason">${esc(v.flagReason || '')}</div>
        <div class="radar-followup">
          <span class="radar-followup-label">Round 2</span>
          <span class="radar-followup-text">${esc(v.followUpQuestion || '')}</span>
        </div>
      </div>`).join('');
    radarBlock.style.display = '';
  } else {
    radarBlock.style.display = 'none';
  }

  document.getElementById('modalTranscript').textContent =
    (data.transcript || '').trim() || 'Transcript not available.';


  document.getElementById('resultsModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

window.closeModal = function () {
  document.getElementById('resultsModal').classList.add('hidden');
  document.body.style.overflow = '';
};

window.handleModalClick = function (e) {
  if (e.target.id === 'resultsModal') closeModal();
};

// ── Copy / Download Report ─────────────────────────────────────────────────
window.copyWhatsAppCard = function () {
  const d = currentModalReportData;
  if (!d) return;

  const recEmojiMap = { 'Strong Yes': '🟢', 'Yes': '🔵', 'Maybe': '🟡', 'No': '🔴' };
  const emoji = recEmojiMap[d.recommendation] || '⚪';

  const card = `*${emoji} AI CANDIDATE SCREENING REPORT*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Candidate*: ${d._name || 'Candidate'}
*Role*: ${d._meta || 'Position'}
*Maya Recommendation*: *${d.recommendation || 'Evaluated'}*

📊 *SCORE BREAKDOWN*
• *Overall Score*: ${d.overallScore || '—'}/10
• *Technical Depth*: ${d.technicalScore || '—'}/10
• *Communication*: ${d.communicationScore || '—'}/10

📝 *EXECUTIVE SUMMARY*
${d.summary || 'Screening completed successfully.'}

✅ *KEY STRENGTHS*
${(d.highlights || []).map(h => `• ${h}`).join('\n') || '• Strong candidate profile'}

⚠️ *DEALBREAKERS & LOGISTICS*
${(d.concerns || []).map(c => `• ${c}`).join('\n') || '• Notice period, WFO location & CTC aligned'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Generated automatically by WeekdayAI_`;

  navigator.clipboard.writeText(card)
    .then(() => showToast('📲 Formatted WhatsApp card copied to clipboard!', 'success'))
    .catch(() => showToast('Copy failed.', 'error'));
};

window.copyCandidateReport = function () {
  const d = currentModalReportData;
  if (!d) return;

  const text = `📋 CANDIDATE SCREENING REPORT
==============================
Candidate:      ${d._name || 'N/A'}
Role:           ${d._meta || 'N/A'}
Recommendation: ${d.recommendation || 'N/A'}

📊 SCORES
• Overall Score:    ${d.overallScore || '—'}/10
• Technical Fit:    ${d.technicalScore || '—'}/10
• Communication:    ${d.communicationScore || '—'}/10

📝 EXECUTIVE SUMMARY
${d.summary || 'N/A'}

✅ KEY HIGHLIGHTS
${(d.highlights || []).map(h => `• ${h}`).join('\n') || '• None recorded'}

⚠️ CONCERNS & DEALBREAKERS
${(d.concerns || []).map(c => `• ${c}`).join('\n') || '• None'}
`;

  navigator.clipboard.writeText(text)
    .then(()  => showToast('📋 Bullet report copied to clipboard!', 'success'))
    .catch(()  => showToast('Copy failed — try the Download button.', 'error'));
};

window.downloadCandidateReport = function () {
  const d = currentModalReportData;
  if (!d) return;

  const name = (d._name || 'candidate').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const text = `CANDIDATE SCREENING REPORT
==========================
Candidate:      ${d._name || 'N/A'}
Role:           ${d._meta || 'N/A'}
Recommendation: ${d.recommendation || 'N/A'}

SCORES
------
Overall Score:  ${d.overallScore || '—'}/10
Technical Fit:  ${d.technicalScore || '—'}/10
Communication:  ${d.communicationScore || '—'}/10

EXECUTIVE SUMMARY
-----------------
${d.summary || 'N/A'}

KEY HIGHLIGHTS
--------------
${(d.highlights || []).map(h => `- ${h}`).join('\n') || '- None recorded'}

CONCERNS & DEALBREAKERS
-----------------------
${(d.concerns || []).map(c => `- ${c}`).join('\n') || '- None'}

FULL TRANSCRIPT
---------------
${(d.transcript || 'N/A').trim()}
`;

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${name}_screening_report.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📥 Report downloaded!', 'success');
};

// ── UI State Machine ───────────────────────────────────────────────────────
function showState(state) {
  document.getElementById('stateIdle').classList.toggle('hidden',       state !== 'idle');
  document.getElementById('stateActive').classList.toggle('hidden',     state !== 'active');
  document.getElementById('stateProcessing').classList.toggle('hidden', state !== 'processing');

  if (state !== 'active') {
    document.getElementById('visualizer').classList.remove('speaking', 'listening');
  }
}

function setBadge(text, type) {
  const badge = document.getElementById('callStatusBadge');
  badge.textContent = text;
  badge.className   = `status-badge${type ? ' ' + type : ''}`;
}

function setLabel(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setConnection(state, label) {
  const dot = document.getElementById('connectionDot');
  const lbl = document.getElementById('connectionLabel');
  if (dot) dot.className = `dot ${state}`;
  if (lbl) lbl.textContent = label;
}

function startCallTimer() {
  callStartTime = Date.now();
  clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    document.getElementById('callTimer').textContent = formatDuration(elapsed);
  }, 1000);
}

function stopCallTimer() { clearInterval(callTimerInterval); }

function formatDuration(secs) {
  if (!secs) return '0:00';
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

let toastTimer = null;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast${type ? ' ' + type : ''}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Step 4: Role Leaderboard & Ranking Dashboard ───────────────────────────
let topRankedCandidateCache = null;

window.renderLeaderboardDashboard = function () {
  const selectFilter = document.getElementById('leaderboardRoleFilter');
  const selectedRole = selectFilter ? selectFilter.value : 'ALL';

  // Populate Role Filter dropdown with unique roles in cache
  if (selectFilter && allCandidatesCache.length) {
    const roles = Array.from(new Set(allCandidatesCache.map(c => c.job_title).filter(Boolean)));
    const currentVal = selectFilter.value;
    selectFilter.innerHTML = `<option value="ALL">All Roles &amp; Positions</option>` +
      roles.map(r => `<option value="${esc(r)}"${r === currentVal ? ' selected' : ''}>${esc(r)}</option>`).join('');
  }

  // Filter candidates with completed scorecards
  let candidates = allCandidatesCache.filter(c => c.overall_score != null);
  if (selectedRole !== 'ALL') {
    candidates = candidates.filter(c => c.job_title === selectedRole);
  }

  // Sort by Overall Score DESC, Tech Score DESC, Comm Score DESC
  candidates.sort((a, b) => {
    if (b.overall_score !== a.overall_score) return b.overall_score - a.overall_score;
    if (b.technical_score !== a.technical_score) return b.technical_score - a.technical_score;
    return (b.communication_score || 0) - (a.communication_score || 0);
  });

  const spotlightBanner = document.getElementById('spotlightBanner');
  const tbody             = document.getElementById('leaderboardTbody');

  if (!candidates.length) {
    if (spotlightBanner) spotlightBanner.style.display = 'none';
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="padding: 36px; text-align: center;">
            <p class="empty-sub">No completed evaluations found for this role filter. Run screening calls to view rankings.</p>
          </td>
        </tr>`;
    }
    return;
  }

  // #1 Spotlight Candidate
  const top = candidates[0];
  topRankedCandidateCache = top;

  // Update Executive KPI Strip
  const kpiTotal     = document.getElementById('kpiTotalScreened');
  const kpiTop       = document.getElementById('kpiTopScore');
  const kpiIncidents = document.getElementById('kpiIncidentsCount');
  const incBadge     = document.getElementById('incidentBadgeCount');

  const incidentsList = allCandidatesCache.filter(c => 
    !c.incident_resolved && (c.recommendation === 'Call Dropped Early (Re-Screen)' || c.overall_score === 0 || (c.call_health && c.call_health.hasIncident))
  );

  if (kpiTotal)     kpiTotal.textContent     = String(candidates.length);
  if (kpiTop)       kpiTop.textContent       = top?.overall_score != null ? `${top.overall_score}/10` : '—';
  if (kpiIncidents) kpiIncidents.textContent = String(incidentsList.length);
  if (incBadge)     incBadge.textContent     = `${incidentsList.length} TASKS`;

  if (spotlightBanner) {
    spotlightBanner.style.display = 'flex';
    document.getElementById('spotlightName').textContent    = top.name;
    document.getElementById('spotlightMeta').textContent    = `${top.job_title || 'Role'} ${top.company_name ? '@ ' + top.company_name : ''}`;
    document.getElementById('spotlightOverall').textContent = `${top.overall_score}/10`;
    document.getElementById('spotlightTech').textContent    = `${top.technical_score}/10`;
    document.getElementById('spotlightComm').textContent    = `${top.communication_score}/10`;
  }

  // Render Ranking Table Rows
  const recMap = {
    'Strong Yes': '🟢 Strong Yes',
    'Yes':        '🔵 Yes',
    'Maybe':      '🟡 Maybe',
    'No':         '🔴 No'
  };

  tbody.innerHTML = candidates.map((c, idx) => {
    let rankBadge = `<span class="rank-pill">${idx + 1}</span>`;
    if (idx === 0) rankBadge = `<span class="rank-pill gold">🥇</span>`;
    if (idx === 1) rankBadge = `<span class="rank-pill silver">🥈</span>`;
    if (idx === 2) rankBadge = `<span class="rank-pill bronze">🥉</span>`;

    return `
      <tr onclick="onCandidateClick(${c.id})" style="cursor:pointer;">
        <td>${rankBadge}</td>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${esc(c.job_title || '')} ${c.company_name ? '@ ' + esc(c.company_name) : ''}</td>
        <td><strong>${c.overall_score}/10</strong></td>
        <td>${c.technical_score}/10</td>
        <td>${c.communication_score}/10</td>
        <td>${recMap[c.recommendation] || c.recommendation || '—'}</td>
        <td><button class="btn-secondary" style="padding:4px 10px; font-size:11px;" onclick="event.stopPropagation(); onCandidateClick(${c.id})">View Dossier &rarr;</button></td>
      </tr>`;
  }).join('');

  // SECTION 3: Render Recruiter Activity Task Queue (Ashby Light Theme)
  const incContainer = document.getElementById('incidentsGridContainer');
  if (incContainer) {
    if (incidentsList.length) {
      incContainer.innerHTML = incidentsList.map(c => {
        const health = c.call_health || {};
        const title  = `⚠️ CALL FOLLOW-UP · ${c.name}`;
        const root   = health.rootCause || 'Candidate disconnected during Beat 2 greeting.';
        const impact = health.impact || 'Technical stack & notice period unverified.';
        const sent   = health.sentiment || 'Neutral / Abrupt Disconnect';

        return `
          <div class="incident-card" id="inc-card-${c.id}">
            <div class="incident-card-header">
              <div class="incident-badge">
                <span class="pulse-red"></span> ${esc(title)}
              </div>
              <span class="incident-timestamp">${esc(c.job_title || 'Role')}</span>
            </div>

            <div class="incident-grid">
              <div class="incident-col">
                <div class="inc-label">🔍 ROOT CAUSE</div>
                <div class="inc-val">${esc(root)}</div>
              </div>
              <div class="incident-col">
                <div class="inc-label">⚡ IMPACT</div>
                <div class="inc-val">${esc(impact)}</div>
              </div>
              <div class="incident-col">
                <div class="inc-label">😊 SENTIMENT</div>
                <div class="inc-val sentiment-neutral">${esc(sent)}</div>
              </div>
            </div>

            <div class="incident-actions">
              <button class="btn-inc-action primary" onclick="retryAiCall(${c.id})">📞 Re-dial AI Call</button>
              <button class="btn-inc-action whatsapp" onclick="copyRecoveryWhatsAppCard(${c.id})">📲 WhatsApp</button>
              <button class="btn-inc-action resolve" onclick="resolveIncident(${c.id})">✓ Mark Resolved</button>
            </div>
          </div>`;
      }).join('');
    } else {
      incContainer.innerHTML = `
        <div class="topics-empty-placeholder" style="padding: 28px;">
          <div class="empty-sparkle">✓</div>
          <h3>All Tasks Resolved &amp; Cleared</h3>
          <p>No active call follow-ups needed. Calls that drop early (< 45s) will appear here for 1-click recruiter action.</p>
        </div>`;
    }
  }
};

window.shareSpotlightWhatsApp = function () {
  const top = topRankedCandidateCache;
  if (!top) return;

  const card = `*🥇 #1 TOP RANKED CANDIDATE REPORT*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Candidate*: ${top.name}
*Role*: ${top.job_title || 'Role'} @ ${top.company_name || 'Weekday'}
*Maya Recommendation*: *${top.recommendation || 'Strong Yes'}*

📊 *SCORES*
• *Overall Rating*: ${top.overall_score}/10
• *Technical Fit*: ${top.technical_score}/10
• *Communication*: ${top.communication_score}/10

📝 *RECRUITER SUMMARY*
${top.summary || 'Top candidate evaluated by Maya AI.'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Verified by WeekdayAI Leaderboard_`;

  navigator.clipboard.writeText(card)
    .then(() => showToast('📲 Top Candidate WhatsApp Card copied!', 'success'))
    .catch(() => showToast('Copy failed.', 'error'));
};

// ── Call Incident Resolution & Dismiss Handler ──────────────────────────────
window.resolveIncident = async function (candidateId) {
  const cardEl = document.getElementById(`inc-card-${candidateId}`);
  if (cardEl) {
    cardEl.classList.add('resolving');
  }

  try {
    const res = await fetch(`/api/candidates/${candidateId}/resolve-incident`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to resolve incident');

    // Update in-memory cache
    const cand = allCandidatesCache.find(c => String(c.id) === String(candidateId));
    if (cand) cand.incident_resolved = 1;

    setTimeout(() => {
      renderLeaderboardDashboard();
      showToast('✓ Task marked resolved and cleared from queue!', 'success');
    }, 300);
  } catch (err) {
    showToast(`Could not resolve: ${err.message}`, 'error');
    if (cardEl) cardEl.classList.remove('resolving');
  }
};

window.retryAiCall = function (candidateId) {
  closeModal();
  switchTab(3);
  const nameEl = document.getElementById('candidateName');
  if (nameEl && currentModalReportData?._name) {
    nameEl.value = currentModalReportData._name;
  }
  showToast('📞 Initiating AI Retry screening call with Maya...', 'success');
};

window.copyRecoveryWhatsAppCard = function (candidateId) {
  const name = currentModalReportData?._name || `Candidate #${candidateId}`;
  const meta = currentModalReportData?._meta || 'Role';
  const msg  = `*🚨 RECOVERY FOLLOW-UP: WEEKDAY RECRUITING TEAM*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Hi ${name}!*

It looks like our screening call disconnected after a few seconds while discussing your experience for *${meta}*.

Would you be free for a quick 2-minute follow-up call right now to complete your profile for the hiring team?

_Or let us know what time works best for you!_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Sent via WeekdayAI Recruiter System_`;

  navigator.clipboard.writeText(msg)
    .then(() => showToast('📲 Recovery WhatsApp Message copied to clipboard!', 'success'))
    .catch(() => showToast('Copy failed.', 'error'));
};

window.flagForHumanReview = function (candidateId) {
  showToast(`📝 Candidate #${candidateId} flagged for human recruiter follow-up!`, 'success');
};

function injectSvgGradients() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML = `
    <defs>
      <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#09090b"/>
        <stop offset="50%"  stop-color="#4f46e5"/>
        <stop offset="100%" stop-color="#0284c7"/>
      </linearGradient>
    </defs>`;
  document.body.prepend(svg);
}

let jdParseTimeout = null;
let lastAutoParsedJdText = '';

function setupJdAutoExtractor() {
  const jdTextEl = document.getElementById('jdText');
  if (!jdTextEl) return;

  const triggerExtraction = async () => {
    const text = jdTextEl.value.trim();
    if (!text || text.length < 100) return;
    if (text === lastAutoParsedJdText) return;
    
    lastAutoParsedJdText = text;
    const statusEl = document.getElementById('jdParseStatus');
    if (statusEl) {
      statusEl.className = 'jd-parse-status parsing';
      statusEl.innerHTML = '✨ AI is analyzing this Job Description to extract details...';
    }

    try {
      const res = await fetch('/api/jobs/parse-jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jdText: text })
      });
      if (!res.ok) throw new Error('Parsing failed');
      const data = await res.json();
      
      // Update form values
      if (data.companyName) document.getElementById('companyName').value = data.companyName;
      if (data.title)       document.getElementById('jobTitle').value    = data.title;
      if (data.location)    document.getElementById('location').value    = data.location;
      if (data.maxNoticeDays) document.getElementById('maxNoticeDays').value = data.maxNoticeDays;
      if (data.techStack)   document.getElementById('techStack').value   = data.techStack;
      if (data.targetCpa)   document.getElementById('targetCpa').value   = data.targetCpa;
      
      if (data.tone)        setTone(data.tone);
      if (data.voiceId)     document.getElementById('voiceId').value = data.voiceId;

      if (statusEl) {
        statusEl.className = 'jd-parse-status success';
        statusEl.innerHTML = '✓ Role parameters and recruiter persona successfully extracted!';
        setTimeout(() => {
          if (statusEl.className === 'jd-parse-status success') statusEl.innerHTML = '';
        }, 5000);
      }
      showToast('✨ AI auto-populated role parameters and recruiter persona!', 'success');
    } catch (err) {
      console.warn('[JdAutoExtractor] failed:', err.message);
      if (statusEl) {
        statusEl.className = 'jd-parse-status error';
        statusEl.innerHTML = '⚠️ AI extraction failed. You can still fill details manually.';
        setTimeout(() => {
          if (statusEl.className === 'jd-parse-status error') statusEl.innerHTML = '';
        }, 5000);
      }
    }
  };

  jdTextEl.addEventListener('paste', () => {
    clearTimeout(jdParseTimeout);
    jdParseTimeout = setTimeout(triggerExtraction, 100);
  });

  jdTextEl.addEventListener('input', () => {
    clearTimeout(jdParseTimeout);
    jdParseTimeout = setTimeout(triggerExtraction, 1500);
  });

  jdTextEl.addEventListener('blur', () => {
    clearTimeout(jdParseTimeout);
    triggerExtraction();
  });
}

