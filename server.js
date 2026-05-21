const express = require('express');
const { randomUUID } = require('crypto');
const fs   = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

const STORE_FILE = path.join(__dirname, 'quizzes.json');
const TTL_MS  = 5 * 60 * 60 * 1000; // 5 hours
const API_KEY = process.env.API_KEY || 'dev-key-changeme';

// ── Storage ───────────────────────────────────────────────────────────────────
function loadStore() {
  try { if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
  catch (e) {}
  return {};
}
function saveStore(s) {
  try { fs.writeFileSync(STORE_FILE, JSON.stringify(s), 'utf8'); } catch(e) {}
}
function cleanup(s) {
  const now = Date.now(); let changed = false;
  for (const id in s) { if (now > s[id].expiresAt) { delete s[id]; changed = true; } }
  if (changed) saveStore(s);
  return s;
}
setInterval(() => cleanup(loadStore()), 30 * 60 * 1000);

// ── Middleware ────────────────────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  if (req.headers['x-api-key'] !== API_KEY)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.post('/create-quiz', requireApiKey, (req, res) => {
  const { title, question } = req.body;
  if (!title || !question) return res.status(400).json({ error: 'Missing fields' });
  let questions;
  try { questions = typeof question === 'string' ? JSON.parse(question) : question; }
  catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ error: 'Empty questions' });
  if (questions.length > 200) return res.status(400).json({ error: 'Max 200 questions' });

  const id = randomUUID();
  const store = cleanup(loadStore());
  store[id] = { title, questions, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS, sessionToken: null };
  saveStore(store);

  const host     = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  res.json({ link: protocol + '://' + host + '/quiz/' + id, id, expiresIn: '5 hours' });
});

app.get('/quiz/:id', (req, res) => {
  const store = cleanup(loadStore());
  const quiz  = store[req.params.id];
  if (!quiz) return res.status(404).send(expiredPage());

  const token = req.query.t;
  if (!quiz.sessionToken) {
    const tok = randomUUID();
    quiz.sessionToken = tok;
    saveStore(store);
    return res.redirect('/quiz/' + req.params.id + '?t=' + tok);
  }
  if (token !== quiz.sessionToken) return res.status(403).send(inUsePage());
  res.send(quizPage(req.params.id, quiz));
});

app.delete('/quiz/:id', (req, res) => {
  const store = loadStore();
  delete store[req.params.id];
  saveStore(store);
  res.json({ ok: true });
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Quiz App' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Quiz app running on port ' + PORT));

// ── Helper ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Static pages ──────────────────────────────────────────────────────────────
function expiredPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Expired</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&display=swap" rel="stylesheet">
  <style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0f1e;color:#f1f5f9;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}h1{font-size:2rem;color:#ef4444;margin-bottom:12px}p{color:#6b7280}</style>
  </head><body><div><h1>&#9203; Quiz Expired</h1><p>This quiz link has expired or has already been submitted.</p></div></body></html>`;
}

function inUsePage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>In Use</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&display=swap" rel="stylesheet">
  <style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0f1e;color:#f1f5f9;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}h1{font-size:2rem;color:#f59e0b;margin-bottom:12px}p{color:#6b7280}</style>
  </head><body><div><h1>&#128274; Quiz In Use</h1><p>This quiz link is already being used by someone else.</p></div></body></html>`;
}

// ── Quiz Page ─────────────────────────────────────────────────────────────────
function quizPage(id, quiz) {
  const DATA = JSON.stringify({ id, title: quiz.title, questions: quiz.questions })
    .replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
  <title>${escapeHtml(quiz.title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#0a0f1e; --surface:#111827; --surface2:#1a2235; --border:#1f2d45;
      --accent:#4f83f5; --accent-d:#2563eb; --correct:#22c55e; --wrong:#ef4444;
      --bookmark:#f59e0b; --text:#f1f5f9; --text2:#94a3b8; --muted:#6b7280;
      --mono:'JetBrains Mono',monospace; --nav-h:68px;
    }
    html,body{height:100%;background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;overflow-x:hidden}
    body::before{content:'';position:fixed;inset:0;
      background-image:linear-gradient(rgba(79,131,245,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(79,131,245,.025) 1px,transparent 1px);
      background-size:32px 32px;pointer-events:none;z-index:0}

    /* Layout */
    .page{max-width:640px;margin:0 auto;padding:18px 14px calc(var(--nav-h) + 24px);position:relative;z-index:1}

    /* Header */
    .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:10px}
    .quiz-title{font-family:var(--mono);font-size:.68rem;color:var(--accent);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
    .header-right{display:flex;gap:7px;flex-shrink:0}
    .icon-btn{width:40px;height:40px;border-radius:10px;background:var(--surface);border:1px solid var(--border);color:var(--muted);font-size:.95rem;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;flex-shrink:0;-webkit-tap-highlight-color:transparent}
    .icon-btn:active{transform:scale(.93)}
    .icon-btn.active{border-color:var(--bookmark);color:var(--bookmark);background:rgba(245,158,11,.08)}
    .bm-count-btn{height:40px;padding:0 12px;border-radius:10px;background:var(--surface);border:1px solid var(--border);color:var(--muted);font-family:'DM Sans',sans-serif;font-size:.8rem;display:flex;align-items:center;gap:5px;cursor:pointer;transition:all .15s;white-space:nowrap;-webkit-tap-highlight-color:transparent}
    .bm-count-btn:active{transform:scale(.97)}

    /* Progress */
    .progress-wrap{margin-bottom:16px}
    .progress-bar{height:3px;background:var(--border);border-radius:2px;overflow:hidden}
    .progress-fill{height:100%;background:linear-gradient(90deg,var(--accent),#818cf8);border-radius:2px;transition:width .4s cubic-bezier(.4,0,.2,1)}

    /* Bookmark panel */
    .bm-panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:14px;display:none}
    .bm-panel.show{display:block;animation:fadeIn .2s ease}
    .bm-panel-hdr{padding:11px 15px;font-family:var(--mono);font-size:.65rem;color:var(--bookmark);letter-spacing:.1em;border-bottom:1px solid var(--border)}
    .bm-item{padding:12px 15px;font-size:.875rem;color:var(--text2);border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;display:flex;gap:10px;align-items:flex-start;-webkit-tap-highlight-color:transparent}
    .bm-item:last-child{border-bottom:none}
    .bm-item:active{background:var(--surface2)}
    .bm-q-num{font-family:var(--mono);font-size:.68rem;color:var(--accent);flex-shrink:0;margin-top:2px;font-weight:600}
    .bm-empty{padding:16px;text-align:center;color:var(--muted);font-size:.85rem}

    /* Question card */
    .question-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px 16px}
    .q-number{font-family:var(--mono);font-size:.65rem;color:var(--accent);letter-spacing:.1em;margin-bottom:10px;text-transform:uppercase}
    .q-text{font-size:.975rem;font-weight:500;line-height:1.65;color:var(--text);margin-bottom:18px}

    /* Options */
    .options{display:flex;flex-direction:column;gap:8px}
    .option{width:100%;text-align:left;background:var(--surface2);border:1.5px solid var(--border);border-radius:12px;padding:13px 13px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:border-color .15s,background .15s;color:var(--text);font-family:'DM Sans',sans-serif;font-size:.9rem;line-height:1.4;-webkit-tap-highlight-color:transparent}
    .option:active:not(.disabled){transform:scale(.99)}
    .option.hoverable:hover{border-color:var(--accent);background:rgba(79,131,245,.07)}
    .option.disabled{cursor:default;pointer-events:none}
    .option.correct{border-color:var(--correct)!important;background:rgba(34,197,94,.08)!important;color:var(--correct)!important}
    .option.wrong{border-color:var(--wrong)!important;background:rgba(239,68,68,.08)!important;color:var(--wrong)!important}
    .option.prev-sel{border-color:var(--accent);background:rgba(79,131,245,.07)}
    .opt-letter{font-family:var(--mono);font-size:.68rem;font-weight:600;min-width:28px;height:28px;border-radius:7px;background:var(--border);color:var(--muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
    .option.correct .opt-letter{background:var(--correct);color:#fff}
    .option.wrong   .opt-letter{background:var(--wrong);color:#fff}
    .option.prev-sel .opt-letter{background:var(--accent);color:#fff}

    /* Feedback */
    .feedback{margin-top:13px;padding:12px 14px;border-radius:10px;font-size:.865rem;line-height:1.6;display:none}
    .feedback.show{display:block;animation:fadeIn .2s ease}
    .feedback.correct-fb{background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.2);color:#86efac}
    .feedback.wrong-fb{background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);color:#fca5a5}

    /* Edit section */
    .edit-section{margin-top:11px;display:none}
    .edit-btn{background:none;border:1px solid var(--border);color:var(--text2);padding:9px 15px;border-radius:9px;font-family:'DM Sans',sans-serif;font-size:.82rem;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:6px;-webkit-tap-highlight-color:transparent}
    .edit-btn:active{transform:scale(.97)}

    /* Disagree */
    .disagree-wrap{margin-top:9px;display:none}
    .disagree-wrap.show{display:block;animation:fadeIn .25s ease}
    .disagree-btn{background:none;border:1px dashed var(--muted);color:var(--muted);padding:9px 15px;border-radius:9px;font-family:'DM Sans',sans-serif;font-size:.82rem;cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent}
    .disagree-btn:active{transform:scale(.97)}

    /* Correction panel */
    .correction-panel{margin-top:11px;display:none;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:14px}
    .correction-panel.show{display:block;animation:fadeIn .25s ease}
    .correction-panel>p{font-size:.8rem;color:var(--muted);margin-bottom:10px}
    .correction-options{display:flex;flex-direction:column;gap:7px;margin-bottom:11px}
    .correction-option{width:100%;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:10px 12px;display:flex;align-items:center;gap:8px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:.85rem;color:var(--text);transition:all .15s;-webkit-tap-highlight-color:transparent}
    .correction-option:active{transform:scale(.98)}
    .correction-option.selected{border-color:var(--bookmark);background:rgba(245,158,11,.08);color:var(--bookmark)}
    .co-letter{font-family:var(--mono);font-size:.68rem;font-weight:600;min-width:24px;height:24px;border-radius:6px;background:var(--border);color:var(--muted);display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .correction-option.selected .co-letter{background:var(--bookmark);color:#fff}
    textarea{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:9px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:.875rem;padding:11px 12px;resize:vertical;min-height:72px;outline:none;transition:border-color .15s}
    textarea:focus{border-color:var(--accent)}
    textarea::placeholder{color:var(--muted)}

    /* Bottom nav */
    .bottom-nav{position:fixed;bottom:0;left:0;right:0;height:var(--nav-h);background:rgba(10,15,30,.95);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--border);display:flex;align-items:center;padding:0 14px;gap:8px;z-index:100}
    .nav-btn{height:46px;border-radius:11px;border:none;font-family:'DM Sans',sans-serif;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent}
    .nav-btn:active{transform:scale(.96)!important}
    .nav-prev{background:var(--surface2);border:1px solid var(--border);color:var(--text2);flex:1}
    .nav-prev:disabled{opacity:.3;cursor:not-allowed}
    .nav-mid{background:var(--surface2);border:1px solid var(--border);color:var(--accent);font-family:var(--mono);font-size:.78rem;flex:1.1}
    .nav-next{background:linear-gradient(135deg,var(--accent),var(--accent-d));color:#fff;flex:1}
    .nav-submit{background:linear-gradient(135deg,var(--correct),#15803d);color:#fff;flex:1}

    /* Overlay */
    .overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;display:none}
    .overlay.show{display:block;animation:fadeIn .2s ease}

    /* Sheet (question menu) */
    .sheet{position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-top:1px solid var(--border);border-radius:20px 20px 0 0;z-index:201;max-height:68vh;display:none;flex-direction:column}
    .sheet.show{display:flex;animation:slideSheet .25s cubic-bezier(.4,0,.2,1)}
    @keyframes slideSheet{from{transform:translateY(100%)}to{transform:translateY(0)}}
    .sheet-hdr{padding:16px 16px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);flex-shrink:0}
    .sheet-hdr-title{font-weight:600;font-size:.95rem}
    .sheet-close{width:30px;height:30px;border-radius:8px;background:var(--surface2);border:1px solid var(--border);color:var(--muted);font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .sheet-body{overflow-y:auto;padding:14px 16px 28px;flex:1;-webkit-overflow-scrolling:touch}

    /* Legend */
    .qmenu-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:14px}
    .leg{display:flex;align-items:center;gap:5px;font-size:.73rem;color:var(--muted)}
    .leg::before{content:'';width:9px;height:9px;border-radius:3px;flex-shrink:0}
    .leg.grey::before{background:var(--border)}
    .leg.green::before{background:var(--correct)}
    .leg.red::before{background:var(--wrong)}
    .leg.amber::before{background:var(--bookmark)}

    /* Q grid */
    .qmenu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:7px}
    .qm-cell{position:relative;width:100%;aspect-ratio:1;border-radius:10px;background:var(--surface2);border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:.75rem;font-weight:600;color:var(--muted);cursor:pointer;transition:all .12s;-webkit-tap-highlight-color:transparent}
    .qm-cell:active{transform:scale(.92)}
    .qm-cell.qm-current{border-color:#fff;color:#fff}
    .qm-cell.qm-correct{background:rgba(34,197,94,.15);border-color:var(--correct);color:var(--correct)}
    .qm-cell.qm-wrong{background:rgba(239,68,68,.15);border-color:var(--wrong);color:var(--wrong)}
    .qm-bm-dot{position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:var(--bookmark)}

    /* Modal */
    .modal-wrap{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:300;padding:20px}
    .modal-wrap.show{display:flex}
    .modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.7);animation:fadeIn .2s ease}
    .modal-box{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px;max-width:340px;width:100%;position:relative;z-index:1;animation:fadeIn .2s ease}
    .modal-title{font-size:1rem;font-weight:600;margin-bottom:9px}
    .modal-msg{font-size:.875rem;color:var(--text2);line-height:1.55;margin-bottom:18px}
    .modal-btns{display:flex;gap:9px}
    .modal-btn{flex:1;padding:12px;border-radius:10px;border:none;font-family:'DM Sans',sans-serif;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent}
    .modal-cancel{background:var(--surface2);border:1px solid var(--border);color:var(--text2)}
    .modal-confirm{background:linear-gradient(135deg,var(--correct),#15803d);color:#fff}
    .modal-btn:active{transform:scale(.96)}

    /* Submitting */
    .submitting-wrap{position:fixed;inset:0;background:rgba(10,15,30,.92);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:400;gap:14px}
    .submitting-wrap.show{display:flex}
    .spinner{width:38px;height:38px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .submitting-wrap p{color:var(--text2);font-size:.9rem}

    /* Results */
    .results-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:30px 18px;text-align:center;animation:slideUp .4s cubic-bezier(.4,0,.2,1)}
    .score-big{font-family:var(--mono);font-size:3rem;font-weight:700;background:linear-gradient(135deg,var(--accent),var(--correct));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:4px}
    .score-label{color:var(--muted);font-size:.82rem;margin-bottom:22px}
    .stats-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-bottom:20px}
    .stat-box{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:14px 8px}
    .stat-val{font-family:var(--mono);font-size:1.5rem;font-weight:700}
    .stat-val.c{color:var(--correct)} .stat-val.w{color:var(--wrong)} .stat-val.b{color:var(--bookmark)} .stat-val.u{color:var(--muted)}
    .stat-label{font-size:.68rem;color:var(--muted);margin-top:3px;letter-spacing:.05em}
    .results-msg{font-size:.85rem;color:var(--text2);line-height:1.6;background:rgba(79,131,245,.06);border:1px solid rgba(79,131,245,.15);border-radius:10px;padding:12px 15px}

    /* Animations */
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes slideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}

    /* Desktop tweaks */
    @media(min-width:480px){
      .page{padding:22px 20px calc(var(--nav-h) + 32px)}
      .q-text{font-size:1.025rem}
      .option{font-size:.93rem}
      .stats-grid{grid-template-columns:repeat(4,1fr)}
    }
  </style>
</head>
<body>

<!-- Quiz main -->
<div class="page" id="quizMain">
  <div class="header">
    <div class="quiz-title" id="quizTitle"></div>
    <div class="header-right">
      <button class="icon-btn" id="bmIconBtn" title="Bookmark this question">&#128278;</button>
      <button class="bm-count-btn" id="bmListBtn">&#128203; <span id="bmCount">0</span></button>
    </div>
  </div>

  <div class="progress-wrap">
    <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
  </div>

  <div class="bm-panel" id="bmPanel">
    <div class="bm-panel-hdr">BOOKMARKED QUESTIONS</div>
    <div id="bmItems"><div class="bm-empty">No bookmarks yet</div></div>
  </div>

  <div class="question-card" id="questionCard">
    <div class="q-number" id="qNum"></div>
    <div class="q-text" id="qText"></div>
    <div class="options" id="options"></div>
    <div class="feedback" id="feedback"></div>
    <div class="edit-section" id="editSection">
      <button class="edit-btn" id="editBtn">&#9998; Edit Answer</button>
    </div>
    <div class="disagree-wrap" id="disagreeWrap">
      <button class="disagree-btn" id="disagreeBtn">&#9997;&#65039; Disagree? Correct it</button>
    </div>
    <div class="correction-panel" id="correctionPanel">
      <p>Tap the option you believe is correct:</p>
      <div class="correction-options" id="correctionOptions"></div>
      <textarea id="correctionText" placeholder="Explain your reasoning (optional)"></textarea>
    </div>
  </div>
</div>

<!-- Results page -->
<div class="page" id="resultsPage" style="display:none">
  <div class="results-card">
    <div class="score-big" id="scoreBig"></div>
    <div class="score-label">Final Score</div>
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-val c" id="rCorrect">0</div><div class="stat-label">CORRECT</div></div>
      <div class="stat-box"><div class="stat-val w" id="rWrong">0</div><div class="stat-label">WRONG</div></div>
      <div class="stat-box"><div class="stat-val b" id="rBookmarks">0</div><div class="stat-label">BOOKMARKED</div></div>
      <div class="stat-box"><div class="stat-val u" id="rSkipped">0</div><div class="stat-label">SKIPPED</div></div>
    </div>
    <div class="results-msg" id="resultsMsg"></div>
  </div>
</div>

<!-- Bottom nav -->
<div class="bottom-nav" id="bottomNav">
  <button class="nav-btn nav-prev" id="prevBtn">&#8592; Prev</button>
  <button class="nav-btn nav-mid"  id="qMenuBtn">1 / 1</button>
  <button class="nav-btn nav-next" id="nextBtn">Next &#8594;</button>
</div>

<!-- Q menu overlay + sheet -->
<div class="overlay" id="qMenuOverlay"></div>
<div class="sheet"   id="qMenuSheet">
  <div class="sheet-hdr">
    <span class="sheet-hdr-title">All Questions</span>
    <button class="sheet-close" id="qMenuClose">&#215;</button>
  </div>
  <div class="sheet-body">
    <div class="qmenu-legend">
      <span class="leg grey">Unanswered</span>
      <span class="leg green">Correct</span>
      <span class="leg red">Wrong</span>
      <span class="leg amber">Bookmarked</span>
    </div>
    <div class="qmenu-grid" id="qMenuGrid"></div>
  </div>
</div>

<!-- Modal -->
<div class="modal-wrap" id="modalWrap">
  <div class="modal-backdrop" id="modalBackdrop"></div>
  <div class="modal-box">
    <div class="modal-title" id="modalTitle"></div>
    <div class="modal-msg"   id="modalMsg"></div>
    <div class="modal-btns">
      <button class="modal-btn modal-cancel"  id="modalCancel">Cancel</button>
      <button class="modal-btn modal-confirm" id="modalConfirm">Confirm</button>
    </div>
  </div>
</div>

<!-- Submitting overlay -->
<div class="submitting-wrap" id="submittingWrap">
  <div class="spinner"></div>
  <p>Submitting your quiz...</p>
</div>

<script>
// ── Data ──────────────────────────────────────────────────────────────────────
const _D       = ${DATA};
const QUIZ_ID  = _D.id;
const TITLE    = _D.title;
const QUESTIONS = _D.questions;
const TOTAL    = QUESTIONS.length;
const LETTS    = ['a','b','c','d','e'];
const LS_KEY   = 'quiz_' + QUIZ_ID;

// Store session token
(function(){
  const t = new URLSearchParams(location.search).get('t');
  if (t) try { sessionStorage.setItem('qt_' + QUIZ_ID, t); } catch(e){}
})();

// ── State ─────────────────────────────────────────────────────────────────────
let S = { current: 0, results: {}, bookmarks: [], corrections: {} };
let editing = false;
let _modalCb = null;

// ── Persistence ───────────────────────────────────────────────────────────────
function saveS() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch(e){} }
function loadS() {
  try { const d = localStorage.getItem(LS_KEY); if (d) S = Object.assign(S, JSON.parse(d)); } catch(e){}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function curQ() { return QUESTIONS[S.current]; }
function getOpts(q) { return LETTS.map(l=>({letter:l.toUpperCase(),text:q['option_'+l]})).filter(o=>o.text&&o.text.trim()); }
function isBm(n) { return S.bookmarks.includes(n); }
function answeredCount() { return Object.keys(S.results).length; }

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  editing = false;
  const q      = curQ();
  const result = S.results[q.number];
  const ans    = !!result;
  const isLast = S.current === TOTAL - 1;

  document.getElementById('quizTitle').textContent = TITLE;
  document.getElementById('bmIconBtn').classList.toggle('active', isBm(q.number));
  document.getElementById('bmCount').textContent = S.bookmarks.length;
  document.getElementById('progressFill').style.width = ((S.current+1)/TOTAL*100)+'%';
  document.getElementById('qMenuBtn').textContent = (S.current+1)+' / '+TOTAL;
  document.getElementById('prevBtn').disabled = S.current === 0;

  const nb = document.getElementById('nextBtn');
  nb.textContent = isLast ? 'Submit \u2713' : 'Next \u2192';
  nb.className = 'nav-btn ' + (isLast ? 'nav-submit' : 'nav-next');

  document.getElementById('qNum').textContent = 'QUESTION '+(S.current+1)+' OF '+TOTAL;
  document.getElementById('qText').textContent = q.question;

  renderOpts(q, result, ans);
  renderFb(q, result, ans);

  document.getElementById('editSection').style.display   = (ans) ? 'block' : 'none';
  document.getElementById('disagreeWrap').className      = 'disagree-wrap' + (ans && result && !result.correct ? ' show' : '');
  document.getElementById('correctionPanel').className   = 'correction-panel';
  document.getElementById('correctionText').value        = '';

  renderQGrid();
}

function renderOpts(q, result, ans) {
  const c = document.getElementById('options');
  c.innerHTML = '';
  getOpts(q).forEach(o => {
    const btn = document.createElement('button');
    btn.className = 'option';
    if (ans && !editing) {
      btn.classList.add('disabled');
      if (o.letter === q.answer_letter) btn.classList.add('correct');
      else if (result && o.letter === result.letter && !result.correct) btn.classList.add('wrong');
    } else if (ans && editing) {
      if (result && o.letter === result.letter) btn.classList.add('prev-sel');
      else btn.classList.add('hoverable');
      btn.onclick = () => reAnswer(o.letter, btn);
    } else {
      btn.classList.add('hoverable');
      btn.onclick = () => pickOpt(o.letter, btn);
    }
    btn.innerHTML = '<span class="opt-letter">'+o.letter+'</span><span>'+o.text+'</span>';
    c.appendChild(btn);
  });
}

function renderFb(q, result, ans) {
  const fb = document.getElementById('feedback');
  if (!ans || editing) { fb.className = 'feedback'; fb.textContent = ''; return; }
  fb.className = 'feedback show ' + (result.correct ? 'correct-fb' : 'wrong-fb');
  fb.textContent = result.correct
    ? '\u2713 Correct!' + (q.explanation ? ' '+q.explanation : '')
    : '\u2717 Correct answer: '+q.answer_letter+' \u2014 '+q.answer_text+(q.explanation?' . '+q.explanation:'');
}

// ── Answer actions ────────────────────────────────────────────────────────────
function pickOpt(letter, btn) {
  const q = curQ();
  const correct = letter === q.answer_letter;
  lockOpts(q, letter, correct);
  S.results[q.number] = { letter, correct };
  saveS();
  renderFb(q, S.results[q.number], true);
  document.getElementById('editSection').style.display = 'block';
  document.getElementById('disagreeWrap').className = 'disagree-wrap' + (!correct ? ' show' : '');
  renderQGrid();
}

function lockOpts(q, sel, correct) {
  document.querySelectorAll('.option').forEach(b => {
    b.classList.remove('hoverable');
    b.classList.add('disabled');
    b.onclick = null;
    const l = b.querySelector('.opt-letter').textContent;
    if (l === q.answer_letter) b.classList.add('correct');
    else if (l === sel && !correct) b.classList.add('wrong');
  });
}

function startEdit() {
  editing = true;
  const q = curQ();
  renderOpts(q, S.results[q.number], true);
  document.getElementById('feedback').className = 'feedback';
  document.getElementById('editSection').style.display = 'none';
  document.getElementById('disagreeWrap').className = 'disagree-wrap';
  document.getElementById('correctionPanel').className = 'correction-panel';
}

function reAnswer(letter, btn) {
  editing = false;
  const q = curQ();
  const correct = letter === q.answer_letter;
  lockOpts(q, letter, correct);
  S.results[q.number] = { letter, correct };
  saveS();
  renderFb(q, S.results[q.number], true);
  document.getElementById('editSection').style.display = 'block';
  document.getElementById('disagreeWrap').className = 'disagree-wrap' + (!correct ? ' show' : '');
  document.getElementById('correctionPanel').className = 'correction-panel';
  renderQGrid();
}

function showDisagree() {
  const q = curQ();
  document.getElementById('correctionPanel').className = 'correction-panel show';
  document.getElementById('disagreeWrap').className = 'disagree-wrap';
  const c = document.getElementById('correctionOptions');
  c.innerHTML = '';
  getOpts(q).forEach(o => {
    const btn = document.createElement('button');
    btn.className = 'correction-option';
    btn.innerHTML = '<span class="co-letter">'+o.letter+'</span><span>'+o.text+'</span>';
    btn.onclick = () => {
      document.querySelectorAll('.correction-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    };
    c.appendChild(btn);
  });
}

function saveCorrection() {
  const sel = document.querySelector('.correction-option.selected');
  if (!sel) return;
  const q = curQ();
  const letter = sel.querySelector('.co-letter').textContent;
  S.corrections[q.number] = {
    question_number: q.number, question_text: q.question,
    original_answer_letter: q.answer_letter, original_answer_text: q.answer_text,
    user_correction_letter: letter,
    user_correction_text: getOpts(q).find(o=>o.letter===letter)?.text || '',
    explanation: document.getElementById('correctionText').value.trim()
  };
  saveS();
}

// ── Navigation ────────────────────────────────────────────────────────────────
function goNext() {
  if (S.current === TOTAL-1) { trySubmit(); return; }
  saveCorrection();
  S.current++;
  saveS();
  animCard(render);
}

function goPrev() {
  if (S.current === 0) return;
  saveCorrection();
  S.current--;
  saveS();
  animCard(render);
}

function jumpTo(idx) {
  saveCorrection();
  S.current = idx;
  saveS();
  closeQMenu();
  animCard(render);
}

function animCard(cb) {
  const card = document.getElementById('questionCard');
  card.style.transition = 'none';
  card.style.opacity = '0';
  card.style.transform = 'translateY(10px)';
  setTimeout(() => {
    cb();
    requestAnimationFrame(() => {
      card.style.transition = 'opacity .22s ease,transform .22s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });
  }, 110);
}

// ── Q Menu ────────────────────────────────────────────────────────────────────
function toggleQMenu() {
  document.getElementById('qMenuSheet').classList.contains('show') ? closeQMenu() : openQMenu();
}
function openQMenu() {
  renderQGrid();
  document.getElementById('qMenuOverlay').classList.add('show');
  document.getElementById('qMenuSheet').classList.add('show');
}
function closeQMenu() {
  document.getElementById('qMenuOverlay').classList.remove('show');
  document.getElementById('qMenuSheet').classList.remove('show');
}
function renderQGrid() {
  const grid = document.getElementById('qMenuGrid');
  if (!grid) return;
  grid.innerHTML = '';
  QUESTIONS.forEach((q, idx) => {
    const r    = S.results[q.number];
    const cell = document.createElement('button');
    cell.className = 'qm-cell';
    if (idx === S.current) cell.classList.add('qm-current');
    if (r) cell.classList.add(r.correct ? 'qm-correct' : 'qm-wrong');
    if (isBm(q.number)) { const dot = document.createElement('span'); dot.className='qm-bm-dot'; cell.appendChild(dot); }
    cell.appendChild(document.createTextNode(q.number));
    cell.onclick = () => jumpTo(idx);
    grid.appendChild(cell);
  });
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────
function toggleBm() {
  const n = curQ().number;
  const i = S.bookmarks.indexOf(n);
  i > -1 ? S.bookmarks.splice(i,1) : S.bookmarks.push(n);
  saveS();
  document.getElementById('bmIconBtn').classList.toggle('active', isBm(n));
  document.getElementById('bmCount').textContent = S.bookmarks.length;
  renderBmList();
  renderQGrid();
}

function toggleBmPanel() {
  document.getElementById('bmPanel').classList.toggle('show');
  renderBmList();
}

function renderBmList() {
  const c = document.getElementById('bmItems');
  if (!S.bookmarks.length) { c.innerHTML='<div class="bm-empty">No bookmarks yet</div>'; return; }
  c.innerHTML = '';
  [...S.bookmarks].sort((a,b)=>a-b).forEach(n => {
    const q   = QUESTIONS.find(x=>x.number===n);
    const idx = QUESTIONS.findIndex(x=>x.number===n);
    const el  = document.createElement('div');
    el.className = 'bm-item';
    el.innerHTML = '<span class="bm-q-num">Q'+n+'</span><span>'+(q?.question||'')+'</span>';
    el.onclick = () => { document.getElementById('bmPanel').classList.remove('show'); jumpTo(idx); };
    c.appendChild(el);
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function showModal(title, msg, confirmTxt, cancelTxt, cb) {
  document.getElementById('modalTitle').textContent   = title;
  document.getElementById('modalMsg').textContent     = msg;
  document.getElementById('modalConfirm').textContent = confirmTxt;
  document.getElementById('modalCancel').textContent  = cancelTxt;
  _modalCb = cb;
  document.getElementById('modalWrap').classList.add('show');
}
function closeModal() { document.getElementById('modalWrap').classList.remove('show'); _modalCb = null; }

// ── Submit ────────────────────────────────────────────────────────────────────
function trySubmit() {
  const unansw = TOTAL - answeredCount();
  if (unansw > 0) {
    showModal('Unanswered Questions',
      'You have '+unansw+' unanswered question'+(unansw>1?'s':'')+'. Submit anyway?',
      'Submit Anyway','Go Back', doSubmit);
  } else {
    showModal('Submit Quiz','Ready to submit? This will end your session.','Submit','Cancel', doSubmit);
  }
}

async function doSubmit() {
  closeModal();
  saveCorrection();
  document.getElementById('submittingWrap').classList.add('show');

  const correct = Object.values(S.results).filter(r=>r.correct).length;
  const wrong   = Object.values(S.results).filter(r=>!r.correct).length;
  const payload = {
    title: TITLE,
    score: correct+'/'+TOTAL,
    score_percent: Math.round(correct/TOTAL*100)+'%',
    correct_answers: correct, wrong_answers: wrong,
    total_questions: TOTAL, answered: answeredCount(), unanswered: TOTAL-answeredCount(),
    bookmarks: S.bookmarks.map(n => {
      const q = QUESTIONS.find(x=>x.number===n);
      return { number:n, question:q?.question, answer_letter:q?.answer_letter, answer_text:q?.answer_text };
    }),
    corrections: Object.values(S.corrections)
  };

  try {
    await fetch('https://smce-n8n.tx5mac.easypanel.host/webhook/bookmark',
      { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  } catch(e){}

  try { await fetch('/quiz/'+QUIZ_ID, { method:'DELETE' }); } catch(e){}
  try { localStorage.removeItem(LS_KEY); } catch(e){}

  document.getElementById('submittingWrap').classList.remove('show');
  document.getElementById('quizMain').style.display  = 'none';
  document.getElementById('bottomNav').style.display = 'none';
  document.getElementById('resultsPage').style.display = 'block';

  const pct = Math.round(correct/TOTAL*100);
  document.getElementById('scoreBig').textContent    = correct+'/'+TOTAL;
  document.getElementById('rCorrect').textContent    = correct;
  document.getElementById('rWrong').textContent      = wrong;
  document.getElementById('rBookmarks').textContent  = S.bookmarks.length;
  document.getElementById('rSkipped').textContent    = TOTAL - answeredCount();
  document.getElementById('resultsMsg').textContent  =
    pct>=70 ? '\uD83C\uDF89 Great job! You scored '+pct+'%.' :
    pct>=50 ? '\uD83D\uDCDA Good effort! You scored '+pct+'%. Keep studying!' :
              '\uD83D\uDCAA You scored '+pct+'%. Review the material and try again!';
}

// ── Wiring ────────────────────────────────────────────────────────────────────
document.getElementById('prevBtn').onclick       = goPrev;
document.getElementById('nextBtn').onclick       = goNext;
document.getElementById('qMenuBtn').onclick      = toggleQMenu;
document.getElementById('qMenuOverlay').onclick  = closeQMenu;
document.getElementById('qMenuClose').onclick    = closeQMenu;
document.getElementById('bmIconBtn').onclick     = toggleBm;
document.getElementById('bmListBtn').onclick     = toggleBmPanel;
document.getElementById('editBtn').onclick       = startEdit;
document.getElementById('disagreeBtn').onclick   = showDisagree;
document.getElementById('modalConfirm').onclick  = () => { if(_modalCb) _modalCb(); };
document.getElementById('modalCancel').onclick   = closeModal;
document.getElementById('modalBackdrop').onclick = closeModal;

// ── Init ──────────────────────────────────────────────────────────────────────
loadS();
render();
</script>
</body>
</html>`;
}
