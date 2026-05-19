const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

const STORE_FILE = path.join(__dirname, 'quizzes.json');
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

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
  store[id] = { title, questions, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS };
  saveStore(store);

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const link = `${protocol}://${host}/quiz/${id}`;

  res.json({ link, id, expiresIn: '2 hours' });
});

// DELETE /quiz/:id — expire quiz
app.delete('/quiz/:id', (req, res) => {
  const store = loadStore();
  delete store[req.params.id];
  saveStore(store);
  res.json({ ok: true });
});

// GET /quiz/:id — serve quiz UI
app.get('/quiz/:id', (req, res) => {
  const store = cleanup(loadStore());
  const quiz = store[req.params.id];
  if (!quiz) return res.status(404).send(expiredPage());
  res.send(quizPage(req.params.id, quiz));
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

    .container{max-width:680px;margin:0 auto;padding:24px 16px 120px;position:relative;z-index:1;}

    .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;padding-bottom:16px;border-bottom:1px solid var(--border);}
    .title{font-family:var(--mono);font-size:.75rem;color:var(--accent);letter-spacing:.12em;text-transform:uppercase;}

    .header-right{display:flex;gap:8px;align-items:center;}
    .bm-icon-btn{background:none;border:1px solid var(--border);color:var(--muted);width:38px;height:38px;border-radius:10px;
      font-size:1rem;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;}
    .bm-icon-btn:hover{border-color:var(--bookmark);color:var(--bookmark);}
    .bm-icon-btn.active{border-color:var(--bookmark);color:var(--bookmark);background:rgba(245,158,11,.08);}

    .bm-list-btn{background:none;border:1px solid var(--border);color:var(--muted);padding:6px 14px;border-radius:20px;
      font-family:'Sora',sans-serif;font-size:.78rem;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:6px;}
    .bm-list-btn:hover{border-color:var(--bookmark);color:var(--bookmark);}

    .progress-wrap{margin-bottom:28px;}
    .progress-label{display:flex;justify-content:space-between;font-size:.75rem;color:var(--muted);font-family:var(--mono);margin-bottom:8px;}
    .progress-bar{height:3px;background:var(--border);border-radius:2px;overflow:hidden;}
    .progress-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:2px;transition:width .5s cubic-bezier(.4,0,.2,1);}

    .bookmark-list{display:none;margin-bottom:20px;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
    .bookmark-list.show{display:block;animation:fadeIn .3s ease;}
    .bookmark-list-header{padding:12px 16px;font-family:var(--mono);font-size:.72rem;color:var(--bookmark);border-bottom:1px solid var(--border);letter-spacing:.1em;}
    .bookmark-item{padding:12px 16px;font-size:.82rem;color:var(--muted);border-bottom:1px solid var(--border);}
    .bookmark-item:last-child{border-bottom:none;}
    .bookmark-item span{color:var(--text);}
    .no-bookmarks{padding:16px;color:var(--muted);font-size:.85rem;text-align:center;}

    .question-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;margin-bottom:16px;animation:slideIn .35s cubic-bezier(.4,0,.2,1);}
    @keyframes slideIn{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
    @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}

    .q-number{font-family:var(--mono);font-size:.7rem;color:var(--accent);letter-spacing:.1em;margin-bottom:12px;}
    .q-text{font-size:1.05rem;font-weight:400;line-height:1.65;color:var(--text);}

    .options{display:flex;flex-direction:column;gap:10px;margin-top:24px;}
    .option{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:14px 18px;
      cursor:pointer;display:flex;align-items:center;gap:12px;transition:all .18s;font-size:.92rem;color:var(--text);text-align:left;width:100%;}
    .option:hover:not(.disabled){border-color:var(--accent);background:rgba(59,130,246,.06);}
    .option.disabled{cursor:default;pointer-events:none;}
    .option.correct{border-color:var(--correct);background:rgba(34,197,94,.08);color:var(--correct);}
    .option.wrong{border-color:var(--wrong);background:rgba(239,68,68,.08);color:var(--wrong);}
    .opt-letter{font-family:var(--mono);font-size:.72rem;font-weight:600;width:26px;height:26px;border-radius:6px;
      background:var(--border);color:var(--muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .18s;}
    .option.correct .opt-letter{background:var(--correct);color:#fff;}
    .option.wrong .opt-letter{background:var(--wrong);color:#fff;}

    .feedback{margin-top:16px;padding:14px 18px;border-radius:10px;font-size:.88rem;line-height:1.6;display:none;}
    .feedback.show{display:block;animation:fadeIn .25s ease;}
    .feedback.correct-fb{background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.2);color:#86efac;}
    .feedback.wrong-fb{background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);color:#fca5a5;}

    .disagree-wrap{margin-top:14px;display:none;}
    .disagree-wrap.show{display:block;animation:fadeIn .3s ease;}
    .disagree-btn{background:none;border:1px dashed var(--muted);color:var(--muted);padding:8px 16px;border-radius:8px;
      font-family:'Sora',sans-serif;font-size:.8rem;cursor:pointer;transition:all .2s;}
    .disagree-btn:hover{border-color:var(--bookmark);color:var(--bookmark);}

    .correction-panel{margin-top:14px;display:none;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;}
    .correction-panel.show{display:block;animation:fadeIn .3s ease;}
    .correction-panel > p{font-size:.8rem;color:var(--muted);margin-bottom:12px;}
    .correction-options{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;}
    .correction-option{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;
      cursor:pointer;display:flex;align-items:center;gap:10px;font-size:.85rem;color:var(--text);transition:all .18s;text-align:left;width:100%;}
    .correction-option:hover{border-color:var(--accent);background:rgba(59,130,246,.05);}
    .correction-option.selected{border-color:var(--bookmark);background:rgba(245,158,11,.08);color:var(--bookmark);}
    .co-letter{font-family:var(--mono);font-size:.7rem;font-weight:600;width:24px;height:24px;border-radius:5px;
      background:var(--border);color:var(--muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .correction-option.selected .co-letter{background:var(--bookmark);color:#fff;}

    textarea{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);
      font-family:'Sora',sans-serif;font-size:.85rem;padding:12px;resize:vertical;min-height:80px;outline:none;transition:border-color .2s;}
    textarea:focus{border-color:var(--accent);}
    textarea::placeholder{color:var(--muted);}

    .nav{display:flex;gap:10px;margin-top:20px;}
    .btn{flex:1;padding:14px;border-radius:12px;border:none;font-family:'Sora',sans-serif;font-size:.9rem;font-weight:600;cursor:pointer;transition:all .2s;}
    .btn-next{background:linear-gradient(135deg,var(--accent),#1d4ed8);color:#fff;}
    .btn-next:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(59,130,246,.3);}
    .btn-next:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none;}

    .results-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:36px 28px;
      text-align:center;display:none;animation:slideIn .4s cubic-bezier(.4,0,.2,1);}
    .results-card.show{display:block;}
    .score-big{font-family:var(--mono);font-size:3.5rem;font-weight:600;
      background:linear-gradient(135deg,var(--accent),var(--correct));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px;}
    .score-label{color:var(--muted);font-size:.9rem;margin-bottom:28px;}
    .stats{display:flex;gap:16px;justify-content:center;margin-bottom:28px;flex-wrap:wrap;}
    .stat{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 20px;text-align:center;}
    .stat-val{font-family:var(--mono);font-size:1.4rem;font-weight:600;}
    .stat-val.c{color:var(--correct);}
    .stat-val.w{color:var(--wrong);}
    .stat-val.b{color:var(--bookmark);}
    .stat-label{font-size:.72rem;color:var(--muted);margin-top:2px;}
    .btn-submit{background:linear-gradient(135deg,var(--correct),#15803d);color:#fff;padding:16px 40px;border-radius:12px;
      border:none;font-family:'Sora',sans-serif;font-size:1rem;font-weight:600;cursor:pointer;transition:all .2s;width:100%;}
    .btn-submit:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(34,197,94,.3);}
    .btn-submit:disabled{opacity:.5;cursor:not-allowed;transform:none;}
    .submit-status{margin-top:14px;font-size:.85rem;color:var(--muted);min-height:20px;}
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
    <div class="disagree-wrap" id="disagreeWrap">
      <button class="disagree-btn" onclick="showCorrectionPanel()">✏️ Disagree with answer? Correct it</button>
    </div>
    <div class="correction-panel" id="correctionPanel">
      <p>Tap the option you believe is correct, then explain your reasoning:</p>
      <div class="correction-options" id="correctionOptions"></div>
      <textarea id="correctionText" placeholder="Why do you think this is the correct answer? (optional)"></textarea>
    </div>
  </div>

  <div class="nav">
    <button class="btn btn-next" id="nextBtn" onclick="nextQuestion()" disabled></button>
  </div>

  <div class="results-card" id="resultsCard">
    <div class="score-big" id="scoreBig"></div>
    <div class="score-label">Final Score</div>
    <div class="stats">
      <div class="stat"><div class="stat-val c" id="statCorrect">0</div><div class="stat-label">CORRECT</div></div>
      <div class="stat"><div class="stat-val w" id="statWrong">0</div><div class="stat-label">WRONG</div></div>
      <div class="stat"><div class="stat-val b" id="statBookmarks">0</div><div class="stat-label">BOOKMARKED</div></div>
    </div>
    <button class="btn-submit" id="submitBtn" onclick="submitQuiz()">Submit & Finish</button>
    <div class="submit-status" id="submitStatus"></div>
  </div>

</div>
<script>
const QUIZ_ID   = ${JSON.stringify(id)};
const TITLE     = ${titleJson};
const QUESTIONS = ${questionsJson};

let current = 0;
let answered = false;
let bookmarks = new Set();
let corrections = {};
let results = [];
let selectedCorrection = null;
const LETTERS = ['a','b','c','d','e'];

function getOptions(q) {
  return LETTERS.map(l => ({ letter: l.toUpperCase(), text: q['option_' + l] })).filter(o => o.text && o.text.trim());
}

function render() {
  const q = QUESTIONS[current];
  const total = QUESTIONS.length;
  document.getElementById('quizTitle').textContent = TITLE;
  document.getElementById('qNum').textContent = 'QUESTION ' + q.number;
  document.getElementById('qText').textContent = q.question;
  document.getElementById('qProgress').textContent = 'Question ' + (current + 1);
  document.getElementById('qFraction').textContent = (current + 1) + ' / ' + total;
  document.getElementById('progressFill').style.width = ((current + 1) / total * 100) + '%';
  document.getElementById('nextBtn').disabled = true;
  document.getElementById('nextBtn').textContent = current < total - 1 ? 'Next →' : 'See Results';
  document.getElementById('bmIconBtn').classList.toggle('active', bookmarks.has(q.number));
  document.getElementById('feedback').className = 'feedback';
  document.getElementById('feedback').textContent = '';
  document.getElementById('disagreeWrap').className = 'disagree-wrap';
  document.getElementById('correctionPanel').className = 'correction-panel';
  document.getElementById('correctionText').value = '';
  selectedCorrection = null;

  const opts = getOptions(q);
  const container = document.getElementById('options');
  container.innerHTML = '';
  opts.forEach(o => {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.innerHTML = '<span class="opt-letter">' + o.letter + '</span><span>' + o.text + '</span>';
    btn.onclick = () => selectOption(o.letter, btn);
    container.appendChild(btn);
  });
  answered = false;
}

function selectOption(letter, btn) {
  if (answered) return;
  answered = true;
  const q = QUESTIONS[current];
  const correct = letter === q.answer_letter;
  document.querySelectorAll('.option').forEach(b => {
    b.classList.add('disabled');
    if (b.querySelector('.opt-letter').textContent === q.answer_letter) b.classList.add('correct');
  });
  if (!correct) {
    btn.classList.add('wrong');
    document.getElementById('disagreeWrap').className = 'disagree-wrap show';
  }
  const fb = document.getElementById('feedback');
  fb.className = 'feedback show ' + (correct ? 'correct-fb' : 'wrong-fb');
  fb.textContent = correct
    ? '✓ Correct!' + (q.explanation ? ' ' + q.explanation : '')
    : '✗ The correct answer is ' + q.answer_letter + ': ' + q.answer_text + (q.explanation ? ' — ' + q.explanation : '');
  results.push({ number: q.number, correct });
  document.getElementById('nextBtn').disabled = false;
}

function showCorrectionPanel() {
  const q = QUESTIONS[current];
  document.getElementById('correctionPanel').className = 'correction-panel show';
  document.getElementById('disagreeWrap').className = 'disagree-wrap';
  const opts = getOptions(q);
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

function nextQuestion() {
  const q = QUESTIONS[current];
  if (selectedCorrection) {
    corrections[q.number] = {
      question_number: q.number,
      question_text: q.question,
      original_answer_letter: q.answer_letter,
      original_answer_text: q.answer_text,
      user_correction_letter: selectedCorrection,
      user_correction_text: getOptions(q).find(o => o.letter === selectedCorrection)?.text || '',
      explanation: document.getElementById('correctionText').value.trim()
    };
  }
  current++;
  if (current >= QUESTIONS.length) { showResults(); return; }
  const card = document.getElementById('questionCard');
  card.style.opacity = '0';
  card.style.transform = 'translateY(12px)';
  setTimeout(() => {
    render();
    card.style.transition = 'opacity .3s, transform .3s';
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  }, 150);
}

function toggleBookmark() {
  const q = QUESTIONS[current];
  bookmarks.has(q.number) ? bookmarks.delete(q.number) : bookmarks.add(q.number);
  document.getElementById('bmCount').textContent = bookmarks.size;
  document.getElementById('bmIconBtn').classList.toggle('active', bookmarks.has(q.number));
  renderBookmarkList();
}

function toggleBookmarkList() {
  document.getElementById('bookmarkList').classList.toggle('show');
}

function renderBookmarkList() {
  const c = document.getElementById('bookmarkItems');
  if (!bookmarks.size) { c.innerHTML = '<div class="no-bookmarks">No bookmarks yet</div>'; return; }
  c.innerHTML = [...bookmarks].sort((a,b)=>a-b).map(n => {
    const q = QUESTIONS.find(x => x.number === n);
    return '<div class="bookmark-item">Q' + n + '. <span>' + (q?.question||'') + '</span></div>';
  }).join('');
}

function showResults() {
  document.getElementById('questionCard').style.display = 'none';
  document.querySelector('.nav').style.display = 'none';
  document.getElementById('resultsCard').className = 'results-card show';
  const correct = results.filter(r => r.correct).length;
  document.getElementById('scoreBig').textContent = correct + '/' + results.length;
  document.getElementById('statCorrect').textContent = correct;
  document.getElementById('statWrong').textContent = results.length - correct;
  document.getElementById('statBookmarks').textContent = bookmarks.size;
}

async function submitQuiz() {
  const btn = document.getElementById('submitBtn');
  const status = document.getElementById('submitStatus');
  btn.disabled = true;
  status.textContent = 'Submitting...';
  const correct = results.filter(r => r.correct).length;
  const payload = {
    title: TITLE,
    score: correct + '/' + results.length,
    score_percent: Math.round(correct / results.length * 100) + '%',
    correct_answers: correct,
    wrong_answers: results.length - correct,
    total_questions: results.length,
    bookmarks: [...bookmarks].map(n => {
      const q = QUESTIONS.find(x => x.number === n);
      return { number: n, question: q?.question, answer_letter: q?.answer_letter, answer_text: q?.answer_text };
    }),
    corrections: Object.values(corrections)
  };
  try {
    const res = await fetch('https://smce-n8n.tx5mac.easypanel.host/webhook/bookmark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    status.textContent = res.ok ? '✓ Submitted successfully!' : '⚠ Submitted with a warning.';
    await fetch('/quiz/' + QUIZ_ID, { method: 'DELETE' }).catch(() => {});
  } catch (e) {
    status.textContent = '⚠ Could not reach server. Results saved locally.';
  }
}

document.getElementById('bmIconBtn').onclick = toggleBookmark;
render();
</script>
</body>
</html>`;
}
