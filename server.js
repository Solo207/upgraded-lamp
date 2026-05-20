// npm install cookie-parser  ← run this once if not already installed
const express = require('express');
const cookieParser = require('cookie-parser');
const { randomUUID: uuidv4 } = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const STORE_FILE = path.join(__dirname, 'quizzes.json');
const TTL_MS = 5 * 60 * 60 * 1000; // 5 hours

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (e) {}
  return {};
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store), 'utf8');
}

function cleanup(store) {
  const now = Date.now();
  let changed = false;
  for (const id in store) {
    if (now > store[id].expiresAt) { delete store[id]; changed = true; }
  }
  if (changed) saveStore(store);
  return store;
}

// POST /create-quiz
app.post('/create-quiz', (req, res) => {
  const { title, question } = req.body;
  if (!title || !question) return res.status(400).json({ error: 'Missing title or question fields' });

  let questions;
  try {
    questions = typeof question === 'string' ? JSON.parse(question) : question;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid questions JSON' });
  }

  const id = uuidv4();
  const store = cleanup(loadStore());
  store[id] = { title, questions, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS, claimed: false };
  saveStore(store);

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const link = `${protocol}://${host}/quiz/${id}`;

  res.json({ link, id, expiresIn: '5 hours' });
});

// DELETE /quiz/:id
app.delete('/quiz/:id', (req, res) => {
  const store = loadStore();
  delete store[req.params.id];
  saveStore(store);
  res.json({ ok: true });
});

// GET /quiz/:id — single-viewer claim + cookie guard
app.get('/quiz/:id', (req, res) => {
  const store = cleanup(loadStore());
  const quiz = store[req.params.id];
  if (!quiz) return res.status(404).send(expiredPage());

  const cookieName = 'qsess_' + req.params.id;
  const sessionCookie = req.cookies?.[cookieName];

  if (!quiz.claimed) {
    const token = uuidv4();
    store[req.params.id].claimed = true;
    store[req.params.id].sessionToken = token;
    saveStore(store);
    res.cookie(cookieName, token, { maxAge: TTL_MS, httpOnly: true, sameSite: 'lax' });
    return res.send(quizPage(req.params.id, store[req.params.id]));
  }

  if (sessionCookie && sessionCookie === quiz.sessionToken) {
    return res.send(quizPage(req.params.id, quiz));
  }

  return res.status(403).send(claimedPage());
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Quiz App' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Quiz app running on port ${PORT}`));

// ── Expired Page ──────────────────────────────────────────────────────────────
function expiredPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quiz Expired</title>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600&display=swap" rel="stylesheet"/>
  <style>
    body{background:#080c14;color:#fff;font-family:'Sora',sans-serif;
    display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
    .box{text-align:center;}
    h1{font-size:2.5rem;color:#ef4444;margin-bottom:12px;}
    p{color:#64748b;}
  </style></head><body>
  <div class="box"><h1>⏳ Quiz Expired</h1><p>This quiz link has expired or has already been submitted.</p></div>
  </body></html>`;
}

// ── Claimed Page ──────────────────────────────────────────────────────────────
function claimedPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quiz Unavailable</title>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600&display=swap" rel="stylesheet"/>
  <style>
    body{background:#080c14;color:#fff;font-family:'Sora',sans-serif;
    display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px;}
    .box{text-align:center;max-width:380px;}
    h1{font-size:2.2rem;color:#f59e0b;margin-bottom:12px;}
    p{color:#64748b;line-height:1.6;}
  </style></head><body>
  <div class="box"><h1>🔒 Quiz In Use</h1>
  <p>This quiz link is already open in another session. Each link can only be used by one person at a time.</p></div>
  </body></html>`;
}

// ── Quiz Page ─────────────────────────────────────────────────────────────────
function quizPage(id, quiz) {
  const questionsJson = JSON.stringify(quiz.questions);
  const titleJson = JSON.stringify(quiz.title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${quiz.title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    :root{
      --bg:#080c14;--surface:#0f1520;--surface2:#151d2e;--border:#1e2d45;
      --accent:#3b82f6;--accent2:#60a5fa;--correct:#22c55e;--wrong:#ef4444;
      --bookmark:#f59e0b;--text:#e2e8f0;--muted:#64748b;
      --mono:'JetBrains Mono',monospace;
    }
    body{background:var(--bg);color:var(--text);font-family:'Sora',sans-serif;min-height:100vh;overflow-x:hidden;}
    body::before{content:'';position:fixed;inset:0;
      background-image:linear-gradient(rgba(59,130,246,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(59,130,246,.03) 1px,transparent 1px);
      background-size:40px 40px;pointer-events:none;z-index:0;}

    .container{max-width:680px;margin:0 auto;padding:24px 16px 180px;position:relative;z-index:1;}

    /* ── Header ── */
    .header{display:flex;align-items:center;justify-content:space-between;
      margin-bottom:28px;padding-bottom:16px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:10px;}
    .title{font-family:var(--mono);font-size:.75rem;color:var(--accent);letter-spacing:.12em;text-transform:uppercase;}
    .header-right{display:flex;gap:8px;align-items:center;}
    .bm-icon-btn{background:none;border:1px solid var(--border);color:var(--muted);width:38px;height:38px;
      border-radius:10px;font-size:1rem;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;}
    .bm-icon-btn:hover{border-color:var(--bookmark);color:var(--bookmark);}
    .bm-icon-btn.active{border-color:var(--bookmark);color:var(--bookmark);background:rgba(245,158,11,.08);}
    .bm-list-btn{background:none;border:1px solid var(--border);color:var(--muted);padding:6px 14px;
      border-radius:20px;font-family:'Sora',sans-serif;font-size:.78rem;cursor:pointer;transition:all .2s;
      display:flex;align-items:center;gap:6px;}
    .bm-list-btn:hover{border-color:var(--bookmark);color:var(--bookmark);}

    /* ── Progress ── */
    .progress-wrap{margin-bottom:28px;}
    .progress-label{display:flex;justify-content:space-between;font-size:.75rem;color:var(--muted);
      font-family:var(--mono);margin-bottom:8px;}
    .progress-bar{height:3px;background:var(--border);border-radius:2px;overflow:hidden;}
    .progress-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));
      border-radius:2px;transition:width .5s cubic-bezier(.4,0,.2,1);}

    /* ── Bookmark list ── */
    .bookmark-list{display:none;margin-bottom:20px;background:var(--surface);
      border:1px solid var(--border);border-radius:12px;overflow:hidden;}
    .bookmark-list.show{display:block;animation:fadeIn .3s ease;}
    .bookmark-list-header{padding:12px 16px;font-family:var(--mono);font-size:.72rem;
      color:var(--bookmark);border-bottom:1px solid var(--border);letter-spacing:.1em;}
    .bookmark-item{padding:12px 16px;font-size:.82rem;color:var(--muted);
      border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;}
    .bookmark-item:last-child{border-bottom:none;}
    .bookmark-item:hover{background:var(--surface2);}
    .bookmark-item span{color:var(--text);}
    .no-bookmarks{padding:16px;color:var(--muted);font-size:.85rem;text-align:center;}

    /* ── Question card ── */
    .question-card{background:var(--surface);border:1px solid var(--border);
      border-radius:16px;padding:28px;margin-bottom:16px;animation:slideIn .35s cubic-bezier(.4,0,.2,1);}
    @keyframes slideIn{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
    @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
    .q-number{font-family:var(--mono);font-size:.7rem;color:var(--accent);letter-spacing:.1em;margin-bottom:12px;}
    .q-text{font-size:1.05rem;font-weight:400;line-height:1.65;color:var(--text);}

    /* ── Options ── */
    .options{display:flex;flex-direction:column;gap:10px;margin-top:24px;}
    .option{background:var(--surface2);border:1px solid var(--border);border-radius:12px;
      padding:14px 18px;cursor:pointer;display:flex;align-items:center;gap:12px;
      transition:all .18s;font-size:.92rem;color:var(--text);text-align:left;width:100%;}
    .option:hover:not(.disabled){border-color:var(--accent);background:rgba(59,130,246,.06);}
    .option.disabled{cursor:default;pointer-events:none;}
    .option.correct{border-color:var(--correct);background:rgba(34,197,94,.08);color:var(--correct);}
    .option.wrong{border-color:var(--wrong);background:rgba(239,68,68,.08);color:var(--wrong);}
    .opt-letter{font-family:var(--mono);font-size:.72rem;font-weight:600;width:26px;height:26px;
      border-radius:6px;background:var(--border);color:var(--muted);display:flex;align-items:center;
      justify-content:center;flex-shrink:0;transition:all .18s;}
    .option.correct .opt-letter{background:var(--correct);color:#fff;}
    .option.wrong .opt-letter{background:var(--wrong);color:#fff;}

    /* ── Feedback ── */
    .feedback{margin-top:16px;padding:14px 18px;border-radius:10px;font-size:.88rem;line-height:1.6;display:none;}
    .feedback.show{display:block;animation:fadeIn .25s ease;}
    .feedback.correct-fb{background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.2);color:#86efac;}
    .feedback.wrong-fb{background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);color:#fca5a5;}

    /* ── Change answer ── */
    .change-answer-wrap{display:none;margin-top:10px;}
    .change-answer-wrap.show{display:block;animation:fadeIn .25s ease;}
    .change-answer-btn{background:none;border:1px dashed var(--accent);color:var(--accent2);
      padding:8px 16px;border-radius:8px;font-family:'Sora',sans-serif;font-size:.8rem;cursor:pointer;transition:all .2s;}
    .change-answer-btn:hover{background:rgba(59,130,246,.07);}

    /* ── Disagree / Correction ── */
    .disagree-wrap{margin-top:14px;display:none;}
    .disagree-wrap.show{display:block;animation:fadeIn .3s ease;}
    .disagree-btn{background:none;border:1px dashed var(--muted);color:var(--muted);padding:8px 16px;
      border-radius:8px;font-family:'Sora',sans-serif;font-size:.8rem;cursor:pointer;transition:all .2s;}
    .disagree-btn:hover{border-color:var(--bookmark);color:var(--bookmark);}
    .correction-panel{margin-top:14px;display:none;background:var(--surface2);
      border:1px solid var(--border);border-radius:12px;padding:16px;}
    .correction-panel.show{display:block;animation:fadeIn .3s ease;}
    .correction-panel > p{font-size:.8rem;color:var(--muted);margin-bottom:12px;}
    .correction-options{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;}
    .correction-option{background:var(--surface);border:1px solid var(--border);border-radius:8px;
      padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:.85rem;
      color:var(--text);transition:all .18s;text-align:left;width:100%;}
    .correction-option:hover{border-color:var(--accent);background:rgba(59,130,246,.05);}
    .correction-option.selected{border-color:var(--bookmark);background:rgba(245,158,11,.08);color:var(--bookmark);}
    .co-letter{font-family:var(--mono);font-size:.7rem;font-weight:600;width:24px;height:24px;
      border-radius:5px;background:var(--border);color:var(--muted);display:flex;align-items:center;
      justify-content:center;flex-shrink:0;}
    .correction-option.selected .co-letter{background:var(--bookmark);color:#fff;}
    textarea{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;
      color:var(--text);font-family:'Sora',sans-serif;font-size:.85rem;padding:12px;resize:vertical;
      min-height:80px;outline:none;transition:border-color .2s;}
    textarea:focus{border-color:var(--accent);}
    textarea::placeholder{color:var(--muted);}

    /* ── Nav: Prev / Next ── */
    .nav{display:flex;gap:10px;margin-top:20px;}
    .btn{padding:14px;border-radius:12px;border:none;font-family:'Sora',sans-serif;
      font-size:.9rem;font-weight:600;cursor:pointer;transition:all .2s;}
    .btn-prev{background:var(--surface2);border:1px solid var(--border);color:var(--muted);flex:0 0 auto;min-width:100px;}
    .btn-prev:hover:not(:disabled){border-color:var(--accent);color:var(--text);}
    .btn-prev:disabled{opacity:.3;cursor:not-allowed;}
    .btn-next{background:linear-gradient(135deg,var(--accent),#1d4ed8);color:#fff;flex:1;}
    .btn-next:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 20px rgba(59,130,246,.3);}
    .btn-next:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none;}

    /* ── Question Nav (toggle below prev/next) ── */
    .qnav-wrap{margin-top:10px;}
    .qnav-toggle-btn{background:var(--surface);border:1px solid var(--border);color:var(--muted);
      padding:10px 18px;border-radius:10px;font-family:'Sora',sans-serif;font-size:.82rem;cursor:pointer;
      transition:all .2s;display:flex;align-items:center;gap:8px;width:100%;justify-content:center;}
    .qnav-toggle-btn:hover{border-color:var(--accent);color:var(--text);}
    .qnav-toggle-btn.active{border-color:var(--accent);color:var(--accent2);background:rgba(59,130,246,.05);}
    .qnav-panel{display:none;margin-top:10px;background:var(--surface);
      border:1px solid var(--border);border-radius:12px;padding:16px;}
    .qnav-panel.show{display:block;animation:fadeIn .25s ease;}
    .qnav-label{font-family:var(--mono);font-size:.7rem;color:var(--muted);letter-spacing:.1em;margin-bottom:12px;}
    .qnav-legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;}
    .qnav-legend-item{display:flex;align-items:center;gap:5px;font-size:.72rem;color:var(--muted);}
    .qnav-dot{width:10px;height:10px;border-radius:3px;}
    .qnav-dot.d-unanswered{background:var(--border);}
    .qnav-dot.d-correct{background:rgba(34,197,94,.4);}
    .qnav-dot.d-wrong{background:rgba(239,68,68,.4);}
    .qnav-dot.d-current{background:rgba(59,130,246,.4);}
    .qnav-grid{display:flex;flex-wrap:wrap;gap:8px;}
    .qnav-chip{width:40px;height:40px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);
      color:var(--muted);font-family:var(--mono);font-size:.8rem;font-weight:600;cursor:pointer;
      display:flex;align-items:center;justify-content:center;transition:all .15s;position:relative;}
    .qnav-chip:hover{border-color:var(--accent);color:var(--text);}
    .qnav-chip.qn-current{border-color:var(--accent);color:var(--accent);background:rgba(59,130,246,.12);}
    .qnav-chip.qn-correct{border-color:var(--correct);background:rgba(34,197,94,.1);color:var(--correct);}
    .qnav-chip.qn-wrong{border-color:var(--wrong);background:rgba(239,68,68,.1);color:var(--wrong);}
    .qnav-chip.qn-bookmarked::after{content:'•';position:absolute;top:2px;right:4px;
      color:var(--bookmark);font-size:.65rem;line-height:1;}

    /* ── Results ── */
    .results-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;
      padding:36px 28px;text-align:center;display:none;animation:slideIn .4s cubic-bezier(.4,0,.2,1);}
    .results-card.show{display:block;}
    .score-big{font-family:var(--mono);font-size:3.5rem;font-weight:600;
      background:linear-gradient(135deg,var(--accent),var(--correct));
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px;}
    .score-label{color:var(--muted);font-size:.9rem;margin-bottom:28px;}
    .stats{display:flex;gap:16px;justify-content:center;margin-bottom:24px;flex-wrap:wrap;}
    .stat{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 20px;text-align:center;min-width:80px;}
    .stat-val{font-family:var(--mono);font-size:1.4rem;font-weight:600;}
    .stat-val.c{color:var(--correct);}
    .stat-val.w{color:var(--wrong);}
    .stat-val.b{color:var(--bookmark);}
    .stat-label{font-size:.72rem;color:var(--muted);margin-top:2px;}
    .submit-status{font-size:.87rem;color:var(--muted);padding:12px 16px;
      background:var(--surface2);border:1px solid var(--border);border-radius:10px;}

    /* ── Mobile ── */
    @media(max-width:520px){
      .container{padding:16px 12px 180px;}
      .q-text{font-size:.95rem;}
      .question-card{padding:20px 16px;}
      .option{font-size:.86rem;padding:12px 14px;}
      .score-big{font-size:2.5rem;}
      .stat{padding:10px 12px;min-width:70px;}
      .stat-val{font-size:1.2rem;}
      .qnav-chip{width:36px;height:36px;font-size:.75rem;}
      .btn{font-size:.85rem;padding:13px;}
      .btn-prev{min-width:80px;}
    }
    @media(max-width:360px){
      .header-right .bm-list-btn span:not(#bmCount){display:none;}
      .qnav-chip{width:32px;height:32px;font-size:.7rem;}
    }
  </style>
</head>
<body>
<div class="container">

  <div class="header">
    <div class="title" id="quizTitle"></div>
    <div class="header-right">
      <button class="bm-icon-btn" id="bmIconBtn" title="Bookmark this question">🔖</button>
      <button class="bm-list-btn" onclick="toggleBookmarkList()">
        📋 <span id="bmCount">0</span> saved
      </button>
    </div>
  </div>

  <div class="progress-wrap">
    <div class="progress-label">
      <span id="qProgress">Question 1</span>
      <span id="qFraction">1 / 0</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
  </div>

  <div class="bookmark-list" id="bookmarkList">
    <div class="bookmark-list-header">🔖 BOOKMARKED QUESTIONS</div>
    <div id="bookmarkItems"><div class="no-bookmarks">No bookmarks yet</div></div>
  </div>

  <div class="question-card" id="questionCard">
    <div class="q-number" id="qNum"></div>
    <div class="q-text" id="qText"></div>
    <div class="options" id="options"></div>
    <div class="feedback" id="feedback"></div>
    <div class="change-answer-wrap" id="changeAnswerWrap">
      <button class="change-answer-btn" onclick="changeAnswer()">↩ Change Answer</button>
    </div>
    <div class="disagree-wrap" id="disagreeWrap">
      <button class="disagree-btn" onclick="showCorrectionPanel()">✏️ Disagree with answer? Correct it</button>
    </div>
    <div class="correction-panel" id="correctionPanel">
      <p>Tap the option you believe is correct, then explain your reasoning:</p>
      <div class="correction-options" id="correctionOptions"></div>
      <textarea id="correctionText" placeholder="Why do you think this is the correct answer? (optional)"></textarea>
    </div>
  </div>

  <!-- Prev / Next -->
  <div class="nav">
    <button class="btn btn-prev" id="prevBtn" onclick="prevQuestion()" disabled>← Prev</button>
    <button class="btn btn-next" id="nextBtn" onclick="nextQuestion()" disabled>Next →</button>
  </div>

  <!-- Question number grid (toggled, below nav) -->
  <div class="qnav-wrap">
    <button class="qnav-toggle-btn" id="qnavToggleBtn" onclick="toggleQNav()">⊞ &nbsp;All Questions</button>
    <div class="qnav-panel" id="qnavPanel">
      <div class="qnav-label">TAP A NUMBER TO JUMP</div>
      <div class="qnav-legend">
        <div class="qnav-legend-item"><div class="qnav-dot d-current"></div>Current</div>
        <div class="qnav-legend-item"><div class="qnav-dot d-correct"></div>Correct</div>
        <div class="qnav-legend-item"><div class="qnav-dot d-wrong"></div>Wrong</div>
        <div class="qnav-legend-item"><div class="qnav-dot d-unanswered"></div>Unanswered</div>
        <div class="qnav-legend-item" style="color:var(--bookmark)">• Bookmarked</div>
      </div>
      <div class="qnav-grid" id="qnavGrid"></div>
    </div>
  </div>

  <!-- Results (shown after submit) -->
  <div class="results-card" id="resultsCard">
    <div class="score-big" id="scoreBig"></div>
    <div class="score-label">Final Score</div>
    <div class="stats">
      <div class="stat"><div class="stat-val c" id="statCorrect">0</div><div class="stat-label">CORRECT</div></div>
      <div class="stat"><div class="stat-val w" id="statWrong">0</div><div class="stat-label">WRONG</div></div>
      <div class="stat"><div class="stat-val b" id="statBookmarks">0</div><div class="stat-label">BOOKMARKED</div></div>
    </div>
    <div class="submit-status" id="submitStatus">Submitting…</div>
  </div>

</div>
<script>
const QUIZ_ID   = ${JSON.stringify(id)};
const TITLE     = ${titleJson};
const QUESTIONS = ${questionsJson};

// ── State ──────────────────────────────────────────────────────────────────────
let current          = 0;
let answered         = false;
let bookmarks        = new Set();
let corrections      = {};
let results          = [];   // { number, correct, selectedLetter }
let selectedCorrection = null;
const LETTERS = ['a','b','c','d','e'];

// ── localStorage persistence ───────────────────────────────────────────────────
const STATE_KEY = 'quiz_state_' + QUIZ_ID;

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      current, results, bookmarks: [...bookmarks], corrections
    }));
  } catch(e) {}
}

function loadState() {
  try {
    const saved = localStorage.getItem(STATE_KEY);
    if (!saved) return;
    const s = JSON.parse(saved);
    current     = typeof s.current === 'number' ? s.current : 0;
    results     = Array.isArray(s.results) ? s.results : [];
    bookmarks   = new Set(Array.isArray(s.bookmarks) ? s.bookmarks : []);
    corrections = s.corrections && typeof s.corrections === 'object' ? s.corrections : {};
  } catch(e) {}
}

function clearState() {
  try { localStorage.removeItem(STATE_KEY); } catch(e) {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getOptions(q) {
  return LETTERS
    .map(l => ({ letter: l.toUpperCase(), text: q['option_' + l] }))
    .filter(o => o.text && o.text.trim());
}

// ── Render current question ───────────────────────────────────────────────────
function render() {
  const q          = QUESTIONS[current];
  const total      = QUESTIONS.length;
  const isLast     = current === total - 1;
  const prevResult = results.find(r => r.number === q.number);

  // Header / progress
  document.getElementById('quizTitle').textContent   = TITLE;
  document.getElementById('qNum').textContent        = 'QUESTION ' + q.number;
  document.getElementById('qText').textContent       = q.question;
  document.getElementById('qProgress').textContent  = 'Question ' + (current + 1);
  document.getElementById('qFraction').textContent  = (current + 1) + ' / ' + total;
  document.getElementById('progressFill').style.width = ((current + 1) / total * 100) + '%';
  document.getElementById('bmIconBtn').classList.toggle('active', bookmarks.has(q.number));
  document.getElementById('bmCount').textContent = bookmarks.size;

  // Reset panels
  document.getElementById('feedback').className           = 'feedback';
  document.getElementById('feedback').textContent         = '';
  document.getElementById('changeAnswerWrap').className   = 'change-answer-wrap';
  document.getElementById('disagreeWrap').className       = 'disagree-wrap';
  document.getElementById('correctionPanel').className    = 'correction-panel';
  document.getElementById('correctionText').value         = '';
  selectedCorrection = null;

  // Prev / Next buttons
  document.getElementById('prevBtn').disabled = current === 0;
  const nextBtn = document.getElementById('nextBtn');
  nextBtn.textContent = isLast ? 'Submit & Finish 🎯' : 'Next →';

  // Options
  const opts      = getOptions(q);
  const container = document.getElementById('options');
  container.innerHTML = '';
  opts.forEach(o => {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.innerHTML = '<span class="opt-letter">' + o.letter + '</span><span>' + o.text + '</span>';
    if (prevResult) {
      btn.classList.add('disabled');
      if (o.letter === q.answer_letter) btn.classList.add('correct');
      else if (o.letter === prevResult.selectedLetter && !prevResult.correct) btn.classList.add('wrong');
    } else {
      btn.onclick = () => selectOption(o.letter, btn);
    }
    container.appendChild(btn);
  });

  // Restore answered state if question was previously answered
  if (prevResult) {
    answered = true;
    nextBtn.disabled = false;
    const fb = document.getElementById('feedback');
    fb.className = 'feedback show ' + (prevResult.correct ? 'correct-fb' : 'wrong-fb');
    fb.textContent = prevResult.correct
      ? '✓ Correct!' + (q.explanation ? ' ' + q.explanation : '')
      : '✗ The correct answer is ' + q.answer_letter + ': ' + q.answer_text + (q.explanation ? ' — ' + q.explanation : '');
    document.getElementById('changeAnswerWrap').className = 'change-answer-wrap show';
    if (!prevResult.correct) document.getElementById('disagreeWrap').className = 'disagree-wrap show';
  } else {
    answered = false;
    nextBtn.disabled = true;
  }

  renderQNav();
  renderBookmarkList();
}

// ── Select answer ─────────────────────────────────────────────────────────────
function selectOption(letter, btn) {
  if (answered) return;
  answered = true;
  const q      = QUESTIONS[current];
  const isLast = current === QUESTIONS.length - 1;
  const correct = letter === q.answer_letter;

  document.querySelectorAll('.option').forEach(b => {
    b.classList.add('disabled');
    if (b.querySelector('.opt-letter').textContent === q.answer_letter) b.classList.add('correct');
  });
  if (!correct) btn.classList.add('wrong');

  const fb = document.getElementById('feedback');
  fb.className = 'feedback show ' + (correct ? 'correct-fb' : 'wrong-fb');
  fb.textContent = correct
    ? '✓ Correct!' + (q.explanation ? ' ' + q.explanation : '')
    : '✗ The correct answer is ' + q.answer_letter + ': ' + q.answer_text + (q.explanation ? ' — ' + q.explanation : '');

  // Upsert result
  results = results.filter(r => r.number !== q.number);
  results.push({ number: q.number, correct, selectedLetter: letter });

  document.getElementById('changeAnswerWrap').className = 'change-answer-wrap show';
  if (!correct) document.getElementById('disagreeWrap').className = 'disagree-wrap show';

  const nextBtn = document.getElementById('nextBtn');
  nextBtn.disabled = false;
  nextBtn.textContent = isLast ? 'Submit & Finish 🎯' : 'Next →';

  saveState();
  renderQNav();
}

// ── Change answer ─────────────────────────────────────────────────────────────
function changeAnswer() {
  const q = QUESTIONS[current];
  results = results.filter(r => r.number !== q.number);
  answered = false;
  saveState();
  render();
}

// ── Correction panel ──────────────────────────────────────────────────────────
function showCorrectionPanel() {
  const q = QUESTIONS[current];
  document.getElementById('correctionPanel').className = 'correction-panel show';
  document.getElementById('disagreeWrap').className    = 'disagree-wrap';
  const opts      = getOptions(q);
  const container = document.getElementById('correctionOptions');
  container.innerHTML = '';
  opts.forEach(o => {
    const btn = document.createElement('button');
    btn.className = 'correction-option';
    btn.innerHTML = '<span class="co-letter">' + o.letter + '</span><span>' + o.text + '</span>';
    btn.onclick = () => {
      document.querySelectorAll('.correction-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedCorrection = o.letter;
    };
    container.appendChild(btn);
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────
function animateToQuestion() {
  const card = document.getElementById('questionCard');
  card.style.transition = '';
  card.style.opacity    = '0';
  card.style.transform  = 'translateY(12px)';
  setTimeout(() => {
    render();
    card.style.transition = 'opacity .3s, transform .3s';
    card.style.opacity    = '1';
    card.style.transform  = 'translateY(0)';
  }, 150);
}

async function nextQuestion() {
  const q = QUESTIONS[current];

  // Persist correction if one was selected
  if (selectedCorrection) {
    corrections[q.number] = {
      question_number:        q.number,
      question_text:          q.question,
      original_answer_letter: q.answer_letter,
      original_answer_text:   q.answer_text,
      user_correction_letter: selectedCorrection,
      user_correction_text:   getOptions(q).find(o => o.letter === selectedCorrection)?.text || '',
      explanation:            document.getElementById('correctionText').value.trim()
    };
    saveState();
  }

  if (current === QUESTIONS.length - 1) {
    await submitAndFinish();
    return;
  }

  current++;
  saveState();
  animateToQuestion();
}

function prevQuestion() {
  if (current === 0) return;
  current--;
  saveState();
  animateToQuestion();
}

function goToQuestion(index) {
  current = index;
  saveState();
  document.getElementById('bookmarkList').classList.remove('show');
  document.getElementById('qnavPanel').classList.remove('show');
  document.getElementById('qnavToggleBtn').classList.remove('active');
  animateToQuestion();
}

// ── Submit & Finish ───────────────────────────────────────────────────────────
async function submitAndFinish() {
  const nextBtn = document.getElementById('nextBtn');
  nextBtn.disabled    = true;
  nextBtn.textContent = 'Submitting…';

  const correct = results.filter(r => r.correct).length;
  const payload = {
    title:             TITLE,
    score:             correct + '/' + QUESTIONS.length,
    score_percent:     Math.round(correct / QUESTIONS.length * 100) + '%',
    correct_answers:   correct,
    wrong_answers:     results.filter(r => !r.correct).length,
    answered_questions: results.length,
    total_questions:   QUESTIONS.length,
    bookmarks: [...bookmarks].map(n => {
      const q = QUESTIONS.find(x => x.number === n);
      return { number: n, question: q?.question, answer_letter: q?.answer_letter, answer_text: q?.answer_text };
    }),
    corrections: Object.values(corrections)
  };

  let webhookOk = false;
  try {
    const res = await fetch('https://smce-n8n.tx5mac.easypanel.host/webhook/bookmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    webhookOk = res.ok;
  } catch(e) { webhookOk = false; }

  clearState();
  await fetch('/quiz/' + QUIZ_ID, { method: 'DELETE' }).catch(() => {});
  showResults(correct, webhookOk);
}

// ── Results screen ────────────────────────────────────────────────────────────
function showResults(correct, webhookOk) {
  document.getElementById('questionCard').style.display = 'none';
  document.querySelector('.nav').style.display          = 'none';
  document.querySelector('.qnav-wrap').style.display    = 'none';
  document.getElementById('resultsCard').className      = 'results-card show';
  document.getElementById('scoreBig').textContent       = correct + '/' + QUESTIONS.length;
  document.getElementById('statCorrect').textContent    = correct;
  document.getElementById('statWrong').textContent      = results.filter(r => !r.correct).length;
  document.getElementById('statBookmarks').textContent  = bookmarks.size;
  document.getElementById('submitStatus').textContent   = webhookOk
    ? '✓ Results submitted successfully!'
    : '⚠ Could not reach server — your results were saved locally.';
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────
function toggleBookmark() {
  const q = QUESTIONS[current];
  bookmarks.has(q.number) ? bookmarks.delete(q.number) : bookmarks.add(q.number);
  document.getElementById('bmCount').textContent = bookmarks.size;
  document.getElementById('bmIconBtn').classList.toggle('active', bookmarks.has(q.number));
  renderBookmarkList();
  renderQNav();
  saveState();
}

function toggleBookmarkList() {
  document.getElementById('bookmarkList').classList.toggle('show');
}

function renderBookmarkList() {
  const c = document.getElementById('bookmarkItems');
  if (!bookmarks.size) { c.innerHTML = '<div class="no-bookmarks">No bookmarks yet</div>'; return; }
  c.innerHTML = [...bookmarks].sort((a,b) => a-b).map(n => {
    const q   = QUESTIONS.find(x => x.number === n);
    const idx = QUESTIONS.findIndex(x => x.number === n);
    return '<div class="bookmark-item" onclick="goToQuestion(' + idx + ')">Q' + n + '. <span>' + (q?.question || '') + '</span></div>';
  }).join('');
}

// ── Question nav grid ─────────────────────────────────────────────────────────
function toggleQNav() {
  const panel = document.getElementById('qnavPanel');
  const btn   = document.getElementById('qnavToggleBtn');
  panel.classList.toggle('show');
  btn.classList.toggle('active', panel.classList.contains('show'));
}

function renderQNav() {
  const grid = document.getElementById('qnavGrid');
  if (!grid) return;
  grid.innerHTML = QUESTIONS.map((q, i) => {
    const r   = results.find(r => r.number === q.number);
    let cls   = 'qnav-chip';
    if (i === current)          cls += ' qn-current';
    else if (r && r.correct)    cls += ' qn-correct';
    else if (r && !r.correct)   cls += ' qn-wrong';
    if (bookmarks.has(q.number)) cls += ' qn-bookmarked';
    return '<button class="' + cls + '" onclick="goToQuestion(' + i + ')" title="Question ' + q.number + '">' + q.number + '</button>';
  }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.getElementById('bmIconBtn').onclick = toggleBookmark;
loadState();
render();
</script>
</body>
</html>`;
}
