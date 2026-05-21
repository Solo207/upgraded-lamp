// npm install cookie-parser  ← run once if not already installed
const express      = require('express');
const cookieParser = require('cookie-parser');
const { randomUUID: uuidv4 } = require('crypto');
const fs   = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const STORE_FILE = path.join(__dirname, 'quizzes.json');
const TTL_MS     = 5 * 60 * 60 * 1000; // 5 hours

function loadStore() {
  try { if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
  catch (e) {}
  return {};
}
function saveStore(store) { fs.writeFileSync(STORE_FILE, JSON.stringify(store), 'utf8'); }
function cleanup(store) {
  const now = Date.now(); let changed = false;
  for (const id in store) { if (now > store[id].expiresAt) { delete store[id]; changed = true; } }
  if (changed) saveStore(store);
  return store;
}

app.post('/create-quiz', (req, res) => {
  const { title, question } = req.body;
  if (!title || !question) return res.status(400).json({ error: 'Missing title or question fields' });
  let questions;
  try { questions = typeof question === 'string' ? JSON.parse(question) : question; }
  catch (e) { return res.status(400).json({ error: 'Invalid questions JSON' }); }
  const id    = uuidv4();
  const store = cleanup(loadStore());
  store[id]   = { title, questions, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS, claimed: false };
  saveStore(store);
  const host     = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  res.json({ link: `${protocol}://${host}/quiz/${id}`, id, expiresIn: '5 hours' });
});

app.delete('/quiz/:id', (req, res) => {
  const store = loadStore();
  delete store[req.params.id];
  saveStore(store);
  res.json({ ok: true });
});

app.get('/quiz/:id', (req, res) => {
  const store = cleanup(loadStore());
  const quiz  = store[req.params.id];
  if (!quiz) return res.status(404).send(expiredPage());
  const cookieName    = 'qsess_' + req.params.id;
  const sessionCookie = req.cookies?.[cookieName];
  if (!quiz.claimed) {
    const token = uuidv4();
    store[req.params.id].claimed      = true;
    store[req.params.id].sessionToken = token;
    saveStore(store);
    res.cookie(cookieName, token, { maxAge: TTL_MS, httpOnly: true, sameSite: 'lax' });
    return res.send(quizPage(req.params.id, store[req.params.id]));
  }
  if (sessionCookie && sessionCookie === quiz.sessionToken) return res.send(quizPage(req.params.id, quiz));
  return res.status(403).send(claimedPage());
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Quiz App' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Quiz app running on port ${PORT}`));

// ── Static pages ──────────────────────────────────────────────────────────────
function expiredPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quiz Expired</title>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600&display=swap" rel="stylesheet"/>
  <style>body{background:#080c14;color:#fff;font-family:'Sora',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.box{text-align:center;}h1{font-size:2.5rem;color:#ef4444;margin-bottom:12px;}p{color:#64748b;}</style>
  </head><body><div class="box"><h1>⏳ Quiz Expired</h1><p>This quiz link has expired or has already been submitted.</p></div></body></html>`;
}
function claimedPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quiz Unavailable</title>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600&display=swap" rel="stylesheet"/>
  <style>body{background:#080c14;color:#fff;font-family:'Sora',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px;}.box{text-align:center;max-width:380px;}h1{font-size:2.2rem;color:#f59e0b;margin-bottom:12px;}p{color:#64748b;line-height:1.6;}</style>
  </head><body><div class="box"><h1>🔒 Quiz In Use</h1><p>This quiz link is already open in another session. Each link can only be used by one person at a time.</p></div></body></html>`;
}

// ── Main quiz page ────────────────────────────────────────────────────────────
function quizPage(id, quiz) {
  const questionsJson = JSON.stringify(quiz.questions);
  const titleJson     = JSON.stringify(quiz.title);
  const FAVICON = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230f1520'/><circle cx='16' cy='16' r='10' fill='none' stroke='%233b82f6' stroke-width='2'/><polyline points='11,16 14.5,20 21,12' fill='none' stroke='%2322c55e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/></svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${quiz.title}</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON}"/>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    :root{
      --bg:#080c14;--surface:#0d1626;--surface2:#121d30;--border:#1e2d45;
      --accent:#3b82f6;--accent2:#60a5fa;--correct:#22c55e;--wrong:#ef4444;
      --bookmark:#f59e0b;--text:#e2e8f0;--muted:#64748b;
      --mono:'JetBrains Mono',monospace;
    }
    html{scroll-behavior:smooth;}
    body{background:var(--bg);color:var(--text);font-family:'Sora',sans-serif;min-height:100vh;overflow-x:hidden;}

    /* ── Animated background layers ── */
    #bgCanvas{position:fixed;inset:0;z-index:0;pointer-events:none;}
    .bg-grid{position:fixed;inset:0;z-index:0;pointer-events:none;
      background-image:linear-gradient(rgba(59,130,246,.055) 1px,transparent 1px),
        linear-gradient(90deg,rgba(59,130,246,.055) 1px,transparent 1px);
      background-size:44px 44px;
      animation:gridPulse 5s ease-in-out infinite;}
    @keyframes gridPulse{0%,100%{opacity:.5;}50%{opacity:1;}}
    .bg-orb{position:fixed;border-radius:50%;pointer-events:none;z-index:0;filter:blur(90px);}
    .bg-orb-1{width:520px;height:520px;top:-160px;right:-120px;
      background:radial-gradient(circle,rgba(59,130,246,.13) 0%,transparent 70%);
      animation:orbFloat 9s ease-in-out infinite;}
    .bg-orb-2{width:420px;height:420px;bottom:10%;left:-120px;
      background:radial-gradient(circle,rgba(34,197,94,.08) 0%,transparent 70%);
      animation:orbFloat 12s ease-in-out infinite reverse;}
    .bg-orb-3{width:300px;height:300px;bottom:-80px;right:10%;
      background:radial-gradient(circle,rgba(245,158,11,.06) 0%,transparent 70%);
      animation:orbFloat 15s ease-in-out infinite 3s;}
    @keyframes orbFloat{0%,100%{transform:translateY(0) scale(1);}50%{transform:translateY(-28px) scale(1.04);}}

    .container{max-width:680px;margin:0 auto;padding:24px 16px 200px;position:relative;z-index:1;}

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
      border-radius:16px;padding:28px;margin-bottom:16px;}
    .q-number{font-family:var(--mono);font-size:.7rem;color:var(--accent);letter-spacing:.1em;margin-bottom:12px;}
    .q-text{font-size:1.05rem;font-weight:400;line-height:1.65;color:var(--text);}
    @keyframes slideIn{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
    @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}

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
      min-height:80px;outline:none;transition:border-color .2s;margin-bottom:12px;}
    textarea:focus{border-color:var(--accent);}
    textarea::placeholder{color:var(--muted);}
    .btn-send-correction{background:linear-gradient(135deg,var(--bookmark),#d97706);color:#fff;border:none;
      padding:10px 22px;border-radius:10px;font-family:'Sora',sans-serif;font-size:.85rem;font-weight:600;
      cursor:pointer;transition:all .2s;}
    .btn-send-correction:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(245,158,11,.3);}

    /* ── Correction bar (persistent after send) ── */
    .correction-bar{display:none;margin-top:14px;padding:14px 16px;
      background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.25);border-radius:12px;}
    .correction-bar.show{display:block;animation:fadeIn .3s ease;}
    .correction-bar-label{font-family:var(--mono);font-size:.68rem;color:var(--bookmark);
      letter-spacing:.1em;margin-bottom:8px;}
    .correction-bar-answer{font-size:.88rem;color:var(--text);font-weight:600;margin-bottom:4px;}
    .correction-bar-expl{font-size:.82rem;color:var(--muted);line-height:1.5;margin-bottom:8px;}
    .correction-bar-note{font-size:.78rem;color:var(--bookmark);opacity:.8;}

    /* ── Nav buttons ── */
    .nav{display:flex;gap:10px;margin-top:20px;}
    .btn{padding:14px;border-radius:12px;border:none;font-family:'Sora',sans-serif;
      font-size:.9rem;font-weight:600;cursor:pointer;transition:all .2s;}
    .btn-prev{background:var(--surface2);border:1px solid var(--border);color:var(--muted);flex:0 0 auto;min-width:96px;}
    .btn-prev:hover:not(:disabled){border-color:var(--accent);color:var(--text);}
    .btn-prev:disabled{opacity:.3;cursor:not-allowed;}
    .btn-next{background:linear-gradient(135deg,var(--accent),#1d4ed8);color:#fff;flex:1;}
    .btn-next:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(59,130,246,.3);}
    .btn-next.skip-mode{background:var(--surface2);border:1px solid var(--border);color:var(--muted);}
    .btn-next.skip-mode:hover{border-color:var(--accent);color:var(--text);transform:none;box-shadow:none;}

    /* ── Question nav grid ── */
    .qnav-wrap{margin-top:10px;}
    .qnav-toggle-btn{background:var(--surface);border:1px solid var(--border);color:var(--muted);
      padding:10px 18px;border-radius:10px;font-family:'Sora',sans-serif;font-size:.82rem;cursor:pointer;
      transition:all .2s;display:flex;align-items:center;gap:8px;width:100%;justify-content:center;}
    .qnav-toggle-btn:hover{border-color:var(--accent);color:var(--text);}
    .qnav-toggle-btn.active{border-color:var(--accent);color:var(--accent2);background:rgba(59,130,246,.05);}
    .qnav-panel{display:none;margin-top:10px;background:var(--surface);
      border:1px solid var(--border);border-radius:12px;padding:16px;}
    .qnav-panel.show{display:block;animation:fadeIn .25s ease;}
    .qnav-label{font-family:var(--mono);font-size:.7rem;color:var(--muted);letter-spacing:.1em;margin-bottom:10px;}
    .qnav-legend{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;}
    .qnav-legend-item{display:flex;align-items:center;gap:5px;font-size:.7rem;color:var(--muted);}
    .qnav-dot{width:10px;height:10px;border-radius:3px;}
    .qnav-dot.d-current{background:rgba(59,130,246,.5);}
    .qnav-dot.d-correct{background:rgba(34,197,94,.5);}
    .qnav-dot.d-wrong{background:rgba(239,68,68,.5);}
    .qnav-dot.d-unanswered{background:var(--border);}
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

    /* ── Submit confirmation modal ── */
    .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;
      display:none;align-items:center;justify-content:center;padding:20px;}
    .modal-overlay.show{display:flex;animation:fadeIn .2s ease;}
    .modal-box{background:var(--surface);border:1px solid var(--border);border-radius:18px;
      padding:32px 28px;max-width:400px;width:100%;text-align:center;
      animation:slideIn .3s cubic-bezier(.4,0,.2,1);}
    .modal-icon{font-size:2.5rem;margin-bottom:14px;}
    .modal-title{font-size:1.2rem;font-weight:600;color:var(--text);margin-bottom:10px;}
    .modal-msg{font-size:.9rem;color:var(--muted);line-height:1.6;margin-bottom:24px;}
    .modal-btns{display:flex;gap:12px;}
    .modal-btn-cancel{flex:1;padding:13px;border-radius:11px;background:var(--surface2);
      border:1px solid var(--border);color:var(--muted);font-family:'Sora',sans-serif;
      font-size:.9rem;font-weight:600;cursor:pointer;transition:all .2s;}
    .modal-btn-cancel:hover{border-color:var(--accent);color:var(--text);}
    .modal-btn-confirm{flex:1;padding:13px;border-radius:11px;
      background:linear-gradient(135deg,var(--accent),#1d4ed8);color:#fff;border:none;
      font-family:'Sora',sans-serif;font-size:.9rem;font-weight:600;cursor:pointer;transition:all .2s;}
    .modal-btn-confirm:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(59,130,246,.3);}

    /* ── Results ── */
    .results-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;
      padding:36px 28px;text-align:center;display:none;}
    .results-card.show{display:block;animation:slideIn .4s cubic-bezier(.4,0,.2,1);}
    .score-big{font-family:var(--mono);font-size:3.5rem;font-weight:600;
      background:linear-gradient(135deg,var(--accent),var(--correct));
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px;}
    .score-percent{font-family:var(--mono);font-size:1.6rem;font-weight:600;
      color:var(--accent2);margin-bottom:4px;}
    .score-label{color:var(--muted);font-size:.88rem;margin-bottom:28px;}
    .stats{display:flex;gap:12px;justify-content:center;margin-bottom:24px;flex-wrap:wrap;}
    .stat{background:var(--surface2);border:1px solid var(--border);border-radius:10px;
      padding:14px 18px;text-align:center;min-width:80px;}
    .stat-val{font-family:var(--mono);font-size:1.4rem;font-weight:600;}
    .stat-val.c{color:var(--correct);}
    .stat-val.w{color:var(--wrong);}
    .stat-val.b{color:var(--bookmark);}
    .stat-val.s{color:var(--muted);}
    .stat-label{font-size:.7rem;color:var(--muted);margin-top:2px;letter-spacing:.05em;}
    .submit-status{font-size:.87rem;color:var(--muted);padding:12px 16px;
      background:var(--surface2);border:1px solid var(--border);border-radius:10px;}

    /* ── Mobile ── */
    @media(max-width:520px){
      .container{padding:16px 12px 200px;}
      .q-text{font-size:.95rem;}
      .question-card{padding:20px 16px;}
      .option{font-size:.86rem;padding:12px 14px;}
      .score-big{font-size:2.5rem;}
      .score-percent{font-size:1.3rem;}
      .stat{padding:10px 12px;min-width:70px;}
      .stat-val{font-size:1.15rem;}
      .qnav-chip{width:36px;height:36px;font-size:.75rem;}
      .btn{font-size:.85rem;padding:13px;}
      .btn-prev{min-width:80px;}
      .modal-box{padding:24px 18px;}
    }
    @media(max-width:360px){
      .qnav-chip{width:32px;height:32px;font-size:.7rem;}
    }
  </style>
</head>
<body>
<canvas id="bgCanvas"></canvas>
<div class="bg-grid"></div>
<div class="bg-orb bg-orb-1"></div>
<div class="bg-orb bg-orb-2"></div>
<div class="bg-orb bg-orb-3"></div>

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
      <p>Select the option you believe is correct, then explain why:</p>
      <div class="correction-options" id="correctionOptions"></div>
      <textarea id="correctionText" placeholder="Why do you think this is the correct answer? (optional)"></textarea>
      <button class="btn-send-correction" onclick="sendCorrection()">📤 Send Correction</button>
    </div>
    <div class="correction-bar" id="correctionBar">
      <div class="correction-bar-label">✏️ YOUR CORRECTION</div>
      <div class="correction-bar-answer" id="correctionBarAnswer"></div>
      <div class="correction-bar-expl" id="correctionBarExpl"></div>
      <div class="correction-bar-note">📬 Submit the quiz for this correction to take effect.</div>
    </div>
  </div>

  <div class="nav">
    <button class="btn btn-prev" id="prevBtn" onclick="prevQuestion()" disabled>← Prev</button>
    <button class="btn btn-next" id="nextBtn" onclick="nextQuestion()">Next →</button>
  </div>

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

  <div class="results-card" id="resultsCard">
    <div class="score-big" id="scoreBig"></div>
    <div class="score-percent" id="scorePercent"></div>
    <div class="score-label">Final Score</div>
    <div class="stats">
      <div class="stat"><div class="stat-val c" id="statCorrect">0</div><div class="stat-label">CORRECT</div></div>
      <div class="stat"><div class="stat-val w" id="statWrong">0</div><div class="stat-label">WRONG</div></div>
      <div class="stat"><div class="stat-val s" id="statSkipped">0</div><div class="stat-label">SKIPPED</div></div>
      <div class="stat"><div class="stat-val b" id="statBookmarks">0</div><div class="stat-label">BOOKMARKED</div></div>
    </div>
    <div class="submit-status" id="submitStatus">Submitting…</div>
  </div>

</div>

<!-- Submit confirmation modal -->
<div class="modal-overlay" id="submitModal">
  <div class="modal-box">
    <div class="modal-icon">🎯</div>
    <div class="modal-title">Submit Quiz?</div>
    <p class="modal-msg" id="modalMsg"></p>
    <div class="modal-btns">
      <button class="modal-btn-cancel" onclick="closeModal()">Go Back</button>
      <button class="modal-btn-confirm" onclick="confirmSubmit()">Submit Anyway</button>
    </div>
  </div>
</div>

<script>
const QUIZ_ID   = ${JSON.stringify(id)};
const TITLE     = ${titleJson};
const QUESTIONS = ${questionsJson};

// ── State ──────────────────────────────────────────────────────────────────────
let current           = 0;
let answered          = false;
let bookmarks         = new Set();
let corrections       = {};   // { [qNum]: { ...data, sent: bool } }
let results           = [];   // { number, correct, selectedLetter, skipped? }
let selectedCorrection = null;
const LETTERS = ['a','b','c','d','e'];

// ── Persistence ───────────────────────────────────────────────────────────────
const STATE_KEY = 'quiz_state_' + QUIZ_ID;
function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify({ current, results, bookmarks: [...bookmarks], corrections })); } catch(e) {}
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    if (!s) return;
    current     = typeof s.current === 'number' ? s.current : 0;
    results     = Array.isArray(s.results)   ? s.results   : [];
    bookmarks   = new Set(Array.isArray(s.bookmarks) ? s.bookmarks : []);
    corrections = s.corrections && typeof s.corrections === 'object' ? s.corrections : {};
  } catch(e) {}
}
function clearState() { try { localStorage.removeItem(STATE_KEY); } catch(e) {} }

// ── Helpers ───────────────────────────────────────────────────────────────────
function getOptions(q) {
  return LETTERS.map(l => ({ letter: l.toUpperCase(), text: q['option_' + l] })).filter(o => o.text?.trim());
}
function unansweredCount() {
  return QUESTIONS.filter(q => !results.find(r => r.number === q.number)).length;
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  const q          = QUESTIONS[current];
  const total      = QUESTIONS.length;
  const isLast     = current === total - 1;
  const prevResult = results.find(r => r.number === q.number);
  const sentCorr   = corrections[q.number]?.sent ? corrections[q.number] : null;

  // Header / progress
  document.getElementById('quizTitle').textContent  = TITLE;
  document.getElementById('qNum').textContent       = 'QUESTION ' + q.number;
  document.getElementById('qText').textContent      = q.question;
  document.getElementById('qProgress').textContent  = 'Question ' + (current + 1);
  document.getElementById('qFraction').textContent  = (current + 1) + ' / ' + total;
  document.getElementById('progressFill').style.width = ((current + 1) / total * 100) + '%';
  document.getElementById('bmIconBtn').classList.toggle('active', bookmarks.has(q.number));
  document.getElementById('bmCount').textContent = bookmarks.size;

  // Reset panels
  ['feedback','changeAnswerWrap','disagreeWrap','correctionPanel','correctionBar']
    .forEach(id => { const el = document.getElementById(id); el.className = el.className.split(' ')[0]; });
  document.getElementById('feedback').textContent = '';
  document.getElementById('correctionText').value = '';
  selectedCorrection = null;

  // Buttons
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
    if (prevResult && !prevResult.skipped) {
      btn.classList.add('disabled');
      if (o.letter === q.answer_letter) btn.classList.add('correct');
      else if (o.letter === prevResult.selectedLetter && !prevResult.correct) btn.classList.add('wrong');
    } else if (!prevResult) {
      btn.onclick = () => selectOption(o.letter, btn);
    } else {
      // skipped — still allow answering
      btn.onclick = () => selectOption(o.letter, btn);
    }
    container.appendChild(btn);
  });

  // Restore answered state
  if (prevResult && !prevResult.skipped) {
    answered = true;
    nextBtn.classList.remove('skip-mode');
    const fb = document.getElementById('feedback');
    fb.className = 'feedback show ' + (prevResult.correct ? 'correct-fb' : 'wrong-fb');
    fb.textContent = prevResult.correct
      ? '✓ Correct!' + (q.explanation ? ' ' + q.explanation : '')
      : '✗ The correct answer is ' + q.answer_letter + ': ' + q.answer_text + (q.explanation ? ' — ' + q.explanation : '');
    document.getElementById('changeAnswerWrap').className = 'change-answer-wrap show';
    if (!prevResult.correct) document.getElementById('disagreeWrap').className = 'disagree-wrap show';
  } else {
    answered = false;
    nextBtn.classList.add('skip-mode');
  }

  // Show sent correction bar if exists
  if (sentCorr) {
    document.getElementById('correctionBarAnswer').textContent =
      'Your answer: ' + sentCorr.user_correction_letter + ' — ' + sentCorr.user_correction_text;
    document.getElementById('correctionBarExpl').textContent =
      sentCorr.explanation ? '"' + sentCorr.explanation + '"' : '';
    document.getElementById('correctionBar').className = 'correction-bar show';
    // Hide disagree button since correction already sent
    document.getElementById('disagreeWrap').className = 'disagree-wrap';
  }

  // Update next button style if answered
  if (answered) nextBtn.classList.remove('skip-mode');

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

  results = results.filter(r => r.number !== q.number);
  results.push({ number: q.number, correct, selectedLetter: letter });
  document.getElementById('changeAnswerWrap').className = 'change-answer-wrap show';
  if (!correct && !corrections[q.number]?.sent) {
    document.getElementById('disagreeWrap').className = 'disagree-wrap show';
  }
  const nextBtn = document.getElementById('nextBtn');
  nextBtn.classList.remove('skip-mode');
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
  const container = document.getElementById('correctionOptions');
  container.innerHTML = '';
  getOptions(q).forEach(o => {
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

function sendCorrection() {
  if (!selectedCorrection) {
    alert('Please select the option you believe is correct first.');
    return;
  }
  const q    = QUESTIONS[current];
  const opts = getOptions(q);
  const corrText = opts.find(o => o.letter === selectedCorrection)?.text || '';
  const expl     = document.getElementById('correctionText').value.trim();

  corrections[q.number] = {
    question_number:        q.number,
    question_text:          q.question,
    original_answer_letter: q.answer_letter,
    original_answer_text:   q.answer_text,
    user_correction_letter: selectedCorrection,
    user_correction_text:   corrText,
    explanation:            expl,
    sent:                   true
  };
  saveState();

  // Hide correction panel, show bar
  document.getElementById('correctionPanel').className = 'correction-panel';
  document.getElementById('disagreeWrap').className    = 'disagree-wrap';
  document.getElementById('correctionBarAnswer').textContent =
    'Your answer: ' + selectedCorrection + ' — ' + corrText;
  document.getElementById('correctionBarExpl').textContent = expl ? '"' + expl + '"' : '';
  document.getElementById('correctionBar').className = 'correction-bar show';
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

function nextQuestion() {
  const q      = QUESTIONS[current];
  const isLast = current === QUESTIONS.length - 1;

  // If not answered, record as skipped (counts as wrong at submit)
  if (!answered) {
    results = results.filter(r => r.number !== q.number);
    results.push({ number: q.number, correct: false, selectedLetter: null, skipped: true });
    saveState();
  }

  if (isLast) {
    const unanswered = QUESTIONS.filter(q2 => {
      const r = results.find(r => r.number === q2.number);
      return !r || r.skipped;
    }).length;
    // Count current question too if just skipped
    const reallyUnanswered = unanswered;
    if (reallyUnanswered > 0) {
      document.getElementById('modalMsg').textContent =
        reallyUnanswered + ' question' + (reallyUnanswered > 1 ? 's are' : ' is') +
        ' unanswered and will be marked as wrong. Ready to submit?';
      document.getElementById('submitModal').className = 'modal-overlay show';
    } else {
      doSubmit();
    }
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

// ── Modal ─────────────────────────────────────────────────────────────────────
function closeModal() { document.getElementById('submitModal').className = 'modal-overlay'; }
function confirmSubmit() { closeModal(); doSubmit(); }

// ── Submit ────────────────────────────────────────────────────────────────────
async function doSubmit() {
  document.getElementById('questionCard').style.display = 'none';
  document.querySelector('.nav').style.display          = 'none';
  document.querySelector('.qnav-wrap').style.display    = 'none';
  document.getElementById('resultsCard').className      = 'results-card show';
  document.getElementById('submitStatus').textContent   = 'Submitting…';

  // Treat all unanswered / skipped as wrong
  QUESTIONS.forEach(q => {
    if (!results.find(r => r.number === q.number)) {
      results.push({ number: q.number, correct: false, selectedLetter: null, skipped: true });
    }
  });

  const correct  = results.filter(r => r.correct).length;
  const skipped  = results.filter(r => r.skipped).length;
  const wrong    = results.filter(r => !r.correct && !r.skipped).length;
  const pct      = Math.round(correct / QUESTIONS.length * 100);

  document.getElementById('scoreBig').textContent      = correct + ' / ' + QUESTIONS.length;
  document.getElementById('scorePercent').textContent  = pct + '% Correct';
  document.getElementById('statCorrect').textContent   = correct;
  document.getElementById('statWrong').textContent     = wrong;
  document.getElementById('statSkipped').textContent   = skipped;
  document.getElementById('statBookmarks').textContent = bookmarks.size;

  const payload = {
    title:              TITLE,
    score:              correct + '/' + QUESTIONS.length,
    score_percent:      pct + '%',
    correct_answers:    correct,
    wrong_answers:      wrong,
    skipped_questions:  skipped,
    total_questions:    QUESTIONS.length,
    bookmarks: [...bookmarks].map(n => {
      const q = QUESTIONS.find(x => x.number === n);
      return { number: n, question: q?.question, answer_letter: q?.answer_letter, answer_text: q?.answer_text };
    }),
    corrections: Object.values(corrections).filter(c => c.sent)
  };

  let ok = false;
  try {
    const res = await fetch('https://smce-n8n.tx5mac.easypanel.host/webhook/bookmark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    ok = res.ok;
  } catch(e) {}

  clearState();
  await fetch('/quiz/' + QUIZ_ID, { method: 'DELETE' }).catch(() => {});
  document.getElementById('submitStatus').textContent = ok
    ? '✓ Results submitted successfully!'
    : '⚠ Could not reach server — results saved locally.';
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────
function toggleBookmark() {
  const q = QUESTIONS[current];
  bookmarks.has(q.number) ? bookmarks.delete(q.number) : bookmarks.add(q.number);
  document.getElementById('bmCount').textContent = bookmarks.size;
  document.getElementById('bmIconBtn').classList.toggle('active', bookmarks.has(q.number));
  renderBookmarkList(); renderQNav(); saveState();
}
function toggleBookmarkList() { document.getElementById('bookmarkList').classList.toggle('show'); }
function renderBookmarkList() {
  const c = document.getElementById('bookmarkItems');
  if (!bookmarks.size) { c.innerHTML = '<div class="no-bookmarks">No bookmarks yet</div>'; return; }
  c.innerHTML = [...bookmarks].sort((a,b) => a-b).map(n => {
    const q   = QUESTIONS.find(x => x.number === n);
    const idx = QUESTIONS.findIndex(x => x.number === n);
    return '<div class="bookmark-item" onclick="goToQuestion(' + idx + ')">Q' + n + '. <span>' + (q?.question||'') + '</span></div>';
  }).join('');
}

// ── Question nav ──────────────────────────────────────────────────────────────
function toggleQNav() {
  const p = document.getElementById('qnavPanel'), b = document.getElementById('qnavToggleBtn');
  p.classList.toggle('show'); b.classList.toggle('active', p.classList.contains('show'));
}
function renderQNav() {
  const grid = document.getElementById('qnavGrid');
  if (!grid) return;
  grid.innerHTML = QUESTIONS.map((q, i) => {
    const r   = results.find(r => r.number === q.number);
    let cls   = 'qnav-chip';
    if (i === current)                    cls += ' qn-current';
    else if (r && r.correct)              cls += ' qn-correct';
    else if (r && !r.correct)             cls += ' qn-wrong';
    if (bookmarks.has(q.number))          cls += ' qn-bookmarked';
    return '<button class="' + cls + '" onclick="goToQuestion(' + i + ')" title="Q' + q.number + '">' + q.number + '</button>';
  }).join('');
}

// ── Canvas background animation ───────────────────────────────────────────────
(function initBackground() {
  const canvas = document.getElementById('bgCanvas');
  const ctx    = canvas.getContext('2d');
  const mobile = window.innerWidth < 600;
  const N      = mobile ? 35 : 65;
  let dots = [], w, h, raf;

  function resize() {
    w = canvas.width  = window.innerWidth;
    h = canvas.height = window.innerHeight;
    dots = Array.from({ length: N }, () => ({
      x:  Math.random() * w,  y:  Math.random() * h,
      r:  Math.random() * 1.5 + 0.4,
      vx: (Math.random() - 0.5) * 0.38,
      vy: (Math.random() - 0.5) * 0.38,
      op: Math.random() * 0.45 + 0.12
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    // Connections
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
        const d  = Math.sqrt(dx*dx + dy*dy);
        if (d < 130) {
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(59,130,246,' + (0.09 * (1 - d/130)) + ')';
          ctx.lineWidth   = 0.6;
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
          ctx.stroke();
        }
      }
    }
    // Dots
    dots.forEach(d => {
      d.x = (d.x + d.vx + w) % w;
      d.y = (d.y + d.vy + h) % h;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(96,165,250,' + d.op + ')';
      ctx.fill();
    });
    raf = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { cancelAnimationFrame(raf); resize(); draw(); });
  resize(); draw();
})();

// ── Init ──────────────────────────────────────────────────────────────────────
document.getElementById('bmIconBtn').onclick = toggleBookmark;
loadState();
render();
</script>
</body>
</html>`;
}
