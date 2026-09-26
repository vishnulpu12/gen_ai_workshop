
const DEFAULT_API_KEY = 'AIzaSyCZID0qv6KUpmJCo-DmwalXJixc2NevnMc';

/* gemini-pro was retired (404). We try these in order and use the first
   one the key actually has access to. */
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro'
];

const REQUEST_TIMEOUT_MS = 60000;

const SYSTEM_PROMPT =
  'System Instructions: You are a highly professional, empathetic, and knowledgeable healthcare ' +
  'AI assistant. You are interacting with a patient named Sarah Jenkins (42yo). You provide helpful, ' +
  'clear, and medically sound information. Always include a disclaimer that you are an AI and not a ' +
  'doctor, and advise consulting a real physician for serious concerns. Keep your tone supportive, ' +
  'calm, and structured. Use short paragraphs and bullet points where helpful.';

const SYSTEM_ACK =
  'I understand. I am CareAssist AI, a healthcare assistant. I will maintain a supportive, calm, ' +
  'and structured tone, and I will always include medical disclaimers.';

const WELCOME_TEXT =
  "Hello Sarah. I'm your Care Assist AI. I have access to your recent labs and vitals. " +
  'How can I help you manage your health today?';

const RECENT_CHATS = [
  { title: 'Headache consultation', date: 'Today' },
  { title: 'Lab results review', date: 'Yesterday' },
  { title: 'Prescription refill: Atorvastatin', date: 'Oct 15' },
  { title: 'Annual physical follow-up', date: 'Oct 10' }
];

const SUGGESTED_PROMPTS = [
  'Summarize my recent Lipid Panel results.',
  'What are the side effects of Lisinopril?',
  'How can I improve my sleep hygiene?',
  'Dietary recommendations for pre-diabetes.'
];

/* ============================ State ============================ */
let messages = [];
let isLoading = false;

/* ============================ Elements ============================ */
const els = {
  sidebar: document.getElementById('sidebar'),
  overlay: document.getElementById('overlay'),
  openSidebar: document.getElementById('openSidebar'),
  closeSidebar: document.getElementById('closeSidebar'),
  newChat: document.getElementById('newChat'),
  apiKey: document.getElementById('apiKey'),
  messages: document.getElementById('messages'),
  messagesInner: document.getElementById('messagesInner'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  recentList: document.getElementById('recentList'),
  quickActions: document.getElementById('quickActions')
};

/* ============================ Helpers ============================ */
const nowTime = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* Inline markdown: **bold**, *italic*, `code` */
function inlineMd(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

/* Block markdown: headings, bullets, numbered lists, paragraphs */
function renderMarkdown(raw) {
  const lines = escapeHtml(raw == null ? '' : raw).split('\n');
  let html = '';
  let list = null;

  const closeList = () => {
    if (list) { html += '</' + list + '>'; list = null; }
  };

  for (const line of lines) {
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    const bullet  = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered= line.match(/^\s*(\d+)[.)]\s+(.*)$/);

    if (heading) {
      closeList();
      html += '<p class="md-h">' + inlineMd(heading[1]) + '</p>';
    } else if (bullet) {
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += '<li>' + inlineMd(bullet[1]) + '</li>';
    } else if (numbered) {
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += '<li>' + inlineMd(numbered[2]) + '</li>';
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html += '<p>' + inlineMd(line) + '</p>';
    }
  }
  closeList();
  return html;
}

/* Merge consecutive same-role turns (Gemini rejects duplicated roles) */
function appendTurn(arr, role, text) {
  const last = arr[arr.length - 1];
  if (last && last.role === role) {
    last.parts[0].text += '\n\n' + text;
  } else {
    arr.push({ role: role, parts: [{ text: text }] });
  }
  return arr;
}

const BOT_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 3v3M6 9h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"/>' +
  '<circle cx="9.5" cy="14" r="1"/><circle cx="14.5" cy="14" r="1"/><path d="M2 13v3M22 13v3"/></svg>';

/* ============================ Rendering ============================ */
function renderMessages() {
  let html = '<div class="date-chip">Today, ' + new Date().toLocaleDateString() + '</div>';

  for (const m of messages) {
    const isModel = m.role === 'model';
    const bubbleClass = isModel ? ('bubble' + (m.isError ? ' error' : '')) : 'bubble';
    const avatar = isModel
      ? '<div class="msg-avatar">' + BOT_SVG + '</div>'
      : '<div class="msg-avatar">SJ</div>';

    html +=
      '<div class="msg ' + (isModel ? 'model' : 'user') + '">' +
        avatar +
        '<div class="msg-col">' +
          '<div class="' + bubbleClass + '">' + renderMarkdown(m.text) + '</div>' +
          '<span class="time">' + m.timestamp + '</span>' +
        '</div>' +
      '</div>';
  }

  if (isLoading) {
    html +=
      '<div class="msg model">' +
        '<div class="msg-avatar">' + BOT_SVG + '</div>' +
        '<div class="msg-col"><div class="typing">' +
          '<span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
        '</div></div>' +
      '</div>';
  }

  els.messagesInner.innerHTML = html;
  requestAnimationFrame(() => {
    els.messages.scrollTop = els.messages.scrollHeight;
  });
}

function pushMessage(msg) {
  messages.push(msg);
  renderMessages();
}

function resetChat() {
  messages = [{
    id: 'welcome-1',
    role: 'model',
    text: WELCOME_TEXT,
    timestamp: nowTime()
  }];
  renderMessages();
}

function updateSendButton() {
  const ready = els.input.value.trim().length > 0 && !isLoading;
  els.send.classList.toggle('ready', ready);
}

/* ============================ API call ============================ */
async function callGemini(apiKey, payload, signal) {
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      model + ':generateContent?key=' + encodeURIComponent(apiKey);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: signal
    });

    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON body */ }

    if (res.ok) return data;

    const message = (data && data.error && data.error.message) ||
      ('Request failed with status ' + res.status);

    // Model unavailable for this API version → try the next one.
    if (res.status === 404 ||
        /not found|not supported|is not found for api version|does not support/i.test(message)) {
      lastError = new Error(message);
      continue;
    }
    throw new Error(message);
  }

  throw lastError || new Error('No supported Gemini model is available for this API key.');
}

function extractReply(data) {
  const candidate = data && data.candidates && data.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  const text = parts.map(p => p && p.text).filter(Boolean).join('\n').trim();

  if (text) return text;

  const blockReason = data && data.promptFeedback && data.promptFeedback.blockReason;
  if (blockReason) throw new Error('Request blocked by safety filters (' + blockReason + ').');

  const finish = candidate && candidate.finishReason;
  if (finish === 'SAFETY')      throw new Error('The response was blocked by safety filters. Try rephrasing.');
  if (finish === 'MAX_TOKENS')  throw new Error('The response was cut off (token limit). Try a shorter question.');
  if (finish === 'RECITATION')  throw new Error('The response was blocked (recitation). Try rephrasing.');

  throw new Error('The model returned an empty response.');
}

/* ============================ Send flow ============================ */
async function handleSend(overrideText) {
  const text = (overrideText != null ? overrideText : els.input.value).trim();
  if (!text || isLoading) return;

  pushMessage({
    id: 'u-' + Date.now(),
    role: 'user',
    text: text,
    timestamp: nowTime()
  });

  els.input.value = '';
  els.input.style.height = '44px';
  updateSendButton();

  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    pushMessage({
      id: 'e-' + Date.now(),
      role: 'model',
      text: 'Please enter your Gemini API key in the bottom-left sidebar to activate the AI.',
      timestamp: nowTime(),
      isError: true
    });
    return;
  }

  /* Build history: skip the welcome bubble and any previous error bubbles */
  const history = [];
  messages
    .filter(m => m.id !== 'welcome-1' && !m.isError && m.text)
    .forEach(m => appendTurn(history, m.role === 'model' ? 'model' : 'user', m.text));

  /* History already contains the message we just pushed — remove the
     duplicate final user turn before appending it once at the end. */
  if (history.length && history[history.length - 1].role === 'user') {
    history.pop();
  }

  const contents = [];
  appendTurn(contents, 'user', SYSTEM_PROMPT);
  appendTurn(contents, 'model', SYSTEM_ACK);
  history.forEach(turn => appendTurn(contents, turn.role, turn.parts[0].text));
  appendTurn(contents, 'user', text);

  const payload = {
    contents: contents,
    generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 1024 },
    safetySettings: [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' }
    ]
  };

  isLoading = true;
  updateSendButton();
  renderMessages();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const data = await callGemini(apiKey, payload, controller.signal);
    const reply = extractReply(data);

    isLoading = false;
    pushMessage({
      id: 'm-' + Date.now(),
      role: 'model',
      text: reply,
      timestamp: nowTime()
    });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    const detail = aborted
      ? 'The request timed out. Check your connection and try again.'
      : (err && err.message) || 'Unknown error';

    console.error('Gemini request failed:', err);

    isLoading = false;
    pushMessage({
      id: 'e-' + Date.now(),
      role: 'model',
      text: "I couldn't reach the AI service. " + detail,
      timestamp: nowTime(),
      isError: true
    });
  } finally {
    clearTimeout(timer);
    isLoading = false;
    updateSendButton();
    renderMessages();
  }
}

/* ============================ Wire up ============================ */
// API key: restore from localStorage, fall back to the default test key
try {
  els.apiKey.value = localStorage.getItem('careassist_api_key') || DEFAULT_API_KEY;
} catch (e) {
  els.apiKey.value = DEFAULT_API_KEY;
}
els.apiKey.addEventListener('input', () => {
  try { localStorage.setItem('careassist_api_key', els.apiKey.value); } catch (e) {}
});

// Recent chats
els.recentList.innerHTML = RECENT_CHATS.map(c =>
  '<button class="nav-item">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
    '<span><span class="t">' + escapeHtml(c.title) + '</span><span class="d">' + escapeHtml(c.date) + '</span></span>' +
  '</button>'
).join('');

// Quick actions
els.quickActions.innerHTML = SUGGESTED_PROMPTS.map((p, i) =>
  '<button class="quick" data-prompt="' + escapeHtml(p) + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
    '<span>' + escapeHtml(p) + '</span>' +
  '</button>'
).join('');

els.quickActions.addEventListener('click', (e) => {
  const btn = e.target.closest('.quick');
  if (!btn) return;
  handleSend(btn.dataset.prompt);
});

// Composer
els.input.addEventListener('input', () => {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 128) + 'px';
  updateSendButton();
});

els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

els.send.addEventListener('click', () => handleSend());

// Sidebar (mobile)
els.openSidebar.addEventListener('click', () => {
  els.sidebar.classList.add('open');
  els.overlay.classList.add('show');
});
const closeSidebar = () => {
  els.sidebar.classList.remove('open');
  els.overlay.classList.remove('show');
};
els.closeSidebar.addEventListener('click', closeSidebar);
els.overlay.addEventListener('click', closeSidebar);

// New consultation
els.newChat.addEventListener('click', () => {
  resetChat();
  closeSidebar();
});

// Boot
resetChat();
updateSendButton();
