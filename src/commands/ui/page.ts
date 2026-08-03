// Single-page client for `ship ui`. Served inline — no build step, no deps.
// Client JS uses string concatenation (not template literals) because this
// whole page lives inside a TS template literal.
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ship</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --bg: #fafaf8; --muted: #8a8a86; --card: #fff; --line: #e6e6e2; --accent: #0a7c42; --danger: #b3341f; }
  @media (prefers-color-scheme: dark) { :root { --fg: #ececea; --bg: #131312; --muted: #8f8f8a; --card: #1c1c1b; --line: #2c2c2a; --accent: #3fb576; --danger: #e06a52; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 32px 20px 120px; }
  nav { display: flex; gap: 4px; margin-bottom: 24px; align-items: baseline; }
  nav a { color: var(--muted); text-decoration: none; padding: 4px 10px; border-radius: 7px; font-weight: 500; }
  nav a.active { color: var(--fg); background: var(--card); border: 1px solid var(--line); }
  nav .brand { font-weight: 700; margin-right: 10px; }
  #progress { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 24px; margin-bottom: 14px; }
  .card.editing { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent), 0 0 28px color-mix(in srgb, var(--accent) 10%, transparent); transition: box-shadow .2s, border-color .2s; }
  .meta { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
  .badge { border: 1px solid var(--line); border-radius: 99px; padding: 1px 10px; font-weight: 500; color: var(--fg); }
  .score { font-variant-numeric: tabular-nums; }
  .serif, textarea.grow { font: 17px/1.55 Georgia, "Times New Roman", serif; }
  textarea.grow { width: 100%; border: none; background: none; color: inherit; resize: none; padding: 0; outline: none; display: block; }
  #wrap { position: relative; }
  #backdrop { position: absolute; inset: 0; pointer-events: none; white-space: pre-wrap; overflow-wrap: break-word; font: 17px/1.55 Georgia, "Times New Roman", serif; color: transparent; }
  #backdrop mark { background: color-mix(in srgb, var(--accent) 28%, transparent); border-radius: 3px; color: transparent; }
  #ask { display: none; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
  #ask.show { display: flex; gap: 8px; align-items: center; }
  #ask input { flex: 1; border: 1px solid var(--line); background: var(--bg); color: inherit; border-radius: 7px; padding: 7px 12px; font: 14px -apple-system, sans-serif; outline: none; }
  #ask input:focus { border-color: var(--accent); }
  #ask .hint { color: var(--muted); font-size: 12px; white-space: nowrap; }
  #ask.busy input { opacity: .5; pointer-events: none; }
  footer { position: fixed; inset: auto 0 0 0; background: var(--bg); border-top: 1px solid var(--line); }
  .keys { max-width: 640px; margin: 0 auto; padding: 14px 20px; display: flex; gap: 18px; color: var(--muted); font-size: 13px; }
  kbd { border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; padding: 0 6px; font: 12px ui-monospace, monospace; color: var(--fg); }
  #toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px 16px; font-size: 13px; opacity: 0; transition: opacity .15s; pointer-events: none; z-index: 10; }
  #toast.show { opacity: 1; }
  #toast a { color: var(--accent); }
  .empty { text-align: center; color: var(--muted); padding: 60px 0; }
  #chars { margin-left: auto; }
  #chars.over { color: var(--danger); }
  button.primary { background: var(--accent); color: #fff; border: none; border-radius: 7px; padding: 8px 16px; font: 500 14px -apple-system, sans-serif; cursor: pointer; }
  button.primary:disabled { opacity: .5; cursor: default; }
  button.ghost { background: none; color: var(--fg); border: 1px solid var(--line); border-radius: 7px; padding: 7px 14px; font: 500 14px -apple-system, sans-serif; cursor: pointer; }
  button.ghost:hover { border-color: var(--muted); }
  button.ghost.danger { color: var(--danger); }
  .row { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
  .row.tall { align-items: flex-start; }
  .row .lines { flex: 1; min-width: 0; }
  .row .lines .who { font-size: 13px; color: var(--muted); }
  .row .lines .sum { font-size: 13px; color: var(--muted); font-style: italic; }
  .row:last-child { border-bottom: none; }
  .row .grow-cell { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .dim { color: var(--muted); font-size: 13px; }
  .toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
  .toolbar .spacer { flex: 1; }
  pre.log { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; font: 12px/1.6 ui-monospace, monospace; max-height: 320px; overflow-y: auto; white-space: pre-wrap; color: var(--muted); }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
  .tile .n { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .tile .l { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .bar { height: 8px; background: var(--line); border-radius: 99px; overflow: hidden; margin-top: 8px; }
  .bar > div { height: 100%; background: var(--accent); }
  .tweet { border-left: 3px solid var(--line); padding-left: 12px; margin-bottom: 14px; }
  .tweet .parent { color: var(--muted); font-size: 13px; border-left: 2px solid var(--line); padding-left: 10px; margin-bottom: 8px; }
  .tweet a { color: inherit; text-decoration: none; }
  .tweet .who { font-weight: 600; }
  .tweet .stats { color: var(--muted); font-size: 13px; }
  .actions { display: flex; gap: 10px; margin-top: 14px; }
  .view { display: none; }
  .view.active { display: block; }
  input[type=checkbox] { accent-color: var(--accent); width: 15px; height: 15px; }
</style>
</head>
<body>
<main>
  <nav>
    <span class="brand">ship</span>
    <a href="#generate" data-tab="generate">Generate</a>
    <a href="#review" data-tab="review">Review</a>
    <a href="#reply" data-tab="reply">Reply</a>
    <a href="#stats" data-tab="stats">Stats</a>
    <a href="#unfollow" data-tab="unfollow">Unfollow</a>
    <span id="progress"></span>
  </nav>

  <section class="view" id="view-review">
    <div class="card" id="card">
      <div class="meta">
        <span class="badge" id="platform"></span>
        <span class="score" id="score"></span>
        <span id="source"></span>
        <span id="chars"></span>
      </div>
      <div id="wrap">
        <div id="backdrop" aria-hidden="true"></div>
        <textarea id="content" class="grow" spellcheck="true"></textarea>
      </div>
      <div id="ask">
        <input id="askInput" placeholder="ask fable to change the selection…">
        <span class="hint">⏎ rewrite · esc cancel</span>
      </div>
    </div>
    <div class="empty" id="done" style="display:none">Queue clear. 🎉</div>
  </section>

  <section class="view" id="view-generate">
    <div class="toolbar" id="genStatus" style="display:none">
      <span class="dim" id="genStatusText" style="color:var(--muted);font-size:13px"></span>
    </div>
    <div class="card" id="genCard" style="display:none">
      <div class="meta">
        <span class="badge" id="genName"></span>
        <span id="genWho"></span>
        <span id="chars-gen" style="margin-left:auto" class="dim"></span>
      </div>
      <div id="genSummary" style="font-style:italic;color:var(--muted);margin-bottom:12px"></div>
      <div id="genText" class="serif" style="max-height:340px;overflow-y:auto;white-space:pre-wrap;border-top:1px solid var(--line);padding-top:12px"></div>
      <div class="actions">
        <button class="primary" id="genProcess">Process</button>
        <button class="ghost" id="genSkip">Skip</button>
      </div>
    </div>
    <div class="empty" id="genDone" style="display:none">No transcripts waiting. 🎉</div>
    <pre class="log" id="genLog" style="display:none"></pre>
  </section>

  <section class="view" id="view-reply">
    <div class="toolbar">
      <button class="primary" id="replyScan">Scan timeline</button>
      <span class="dim" id="replyNote"></span>
    </div>
    <pre class="log" id="replyLog" style="display:none"></pre>
    <div id="replyList"></div>
  </section>

  <section class="view" id="view-stats">
    <div class="empty" id="statsLoading">Loading stats (X API can take a moment)…</div>
    <div id="statsBody" style="display:none"></div>
  </section>

  <section class="view" id="view-unfollow">
    <div class="toolbar">
      <button class="primary" id="unfScan">Load candidates</button>
      <span class="spacer"></span>
      <button class="ghost" id="unfWhitelist" style="display:none">Whitelist selected</button>
      <button class="ghost danger" id="unfRun" style="display:none">Unfollow selected</button>
    </div>
    <pre class="log" id="unfLog" style="display:none"></pre>
    <div class="card" id="unfList" style="display:none"></div>
  </section>
</main>

<footer>
<div class="keys" id="keysReview">
  <span><kbd>s</kbd> stage</span>
  <span><kbd>r</kbd> reject</span>
  <span><kbd>e</kbd> edit</span>
  <span><kbd>k</kbd> skip</span>
</div>
<div class="keys" id="keysEdit" style="display:none">
  <span><kbd>⌘s</kbd> stage</span>
  <span>select text → <kbd>tab</kbd> ask fable</span>
  <span><kbd>esc</kbd> done</span>
</div>
</footer>
<div id="toast"></div>

<script>
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtN = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);

function toast(html) {
  $('toast').innerHTML = html;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2500);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}

function pollJob(name, logEl, onDone) {
  const tick = async () => {
    try {
      const job = await api('GET', '/api/job/' + name);
      if (logEl) {
        logEl.style.display = 'block';
        logEl.textContent = job.log.slice(-40).join('\\n');
        logEl.scrollTop = logEl.scrollHeight;
      }
      if (job.running) setTimeout(tick, 1500);
      else onDone(job);
    } catch (e) {
      toast('⚠️ ' + e.message);
    }
  };
  tick();
}

// ── tabs ──────────────────────────────────────────────────────────────
let activeTab = 'review';
const tabInits = { review: false, generate: false, reply: false, stats: false, unfollow: false };

function showTab(name) {
  activeTab = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
  $('view-' + name).classList.add('active');
  $('progress').textContent = '';
  document.querySelector('footer').style.display = name === 'review' ? 'block' : 'none';
  if (!tabInits[name]) {
    tabInits[name] = true;
    ({ review: initReview, generate: initGenerate, reply: initReply, stats: initStats, unfollow: initUnfollow })[name]();
  } else if (name === 'review') {
    showPost();
  } else if (name === 'generate') {
    showTranscript();
  }
}
window.addEventListener('hashchange', () => showTab(location.hash.slice(1) || 'review'));

// ── review ────────────────────────────────────────────────────────────
let queue = [], idx = 0, busy = false, sel = null;

function initReview() {
  api('GET', '/api/posts').then((d) => { queue = d.posts; showPost(); }).catch((e) => toast('⚠️ ' + e.message));
}

function showPost() {
  if (activeTab !== 'review') return;
  const p = queue[idx];
  if (!p) { $('card').style.display = 'none'; $('done').style.display = 'block'; $('progress').textContent = ''; return; }
  $('card').style.display = 'block';
  $('done').style.display = 'none';
  $('platform').textContent = p.platform === 'linkedin' ? 'LinkedIn' : 'X';
  $('score').textContent = p.score ? (p.score >= 70 ? '🔥 ' : '') + p.score + '/99' : 'no score';
  $('source').textContent = p.sourceFile.replace(/^input\\//, '').replace(/\\.txt$/, '');
  const draft = localStorage.getItem('draft:' + p.id);
  $('content').value = draft !== null ? draft : p.content;
  $('progress').textContent = (queue.length - idx) + ' remaining';
  hideAsk();
  updateChars();
  autosize($('content'));
  $('content').blur();
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function updateChars() {
  const p = queue[idx];
  if (!p) return;
  const n = $('content').value.length;
  $('chars').textContent = n + (p.platform === 'x' ? ' / 280' : '');
  $('chars').className = p.platform === 'x' && n > 280 ? 'over' : '';
}

async function decide(action) {
  if (busy || activeTab !== 'review') return;
  const p = queue[idx];
  if (!p) return;
  busy = true;
  try {
    const body = await api('POST', '/api/decision', { id: p.id, action, content: $('content').value });
    localStorage.removeItem('draft:' + p.id);
    toast(action === 'stage'
      ? (body.share_url ? 'Staged → <a href="' + body.share_url + '" target="_blank">Typefully</a>' : 'Staged → Typefully')
      : 'Rejected');
    queue.splice(idx, 1);
    showPost();
  } catch (e) { toast('⚠️ ' + e.message); }
  busy = false;
}

function paintSelection() {
  if (!sel) { $('backdrop').innerHTML = ''; return; }
  const v = $('content').value;
  $('backdrop').innerHTML =
    escapeHtml(v.slice(0, sel.start)) + '<mark>' + escapeHtml(v.slice(sel.start, sel.end)) + '</mark>' + escapeHtml(v.slice(sel.end));
}

function checkSelection() {
  const c = $('content');
  if (document.activeElement !== c) return;
  if (c.selectionEnd > c.selectionStart) {
    sel = { start: c.selectionStart, end: c.selectionEnd };
    $('ask').classList.add('show');
    paintSelection();
  } else if (sel) {
    hideAsk();
  }
}

function hideAsk() {
  $('ask').classList.remove('show', 'busy');
  $('askInput').value = '';
  sel = null;
  paintSelection();
}

async function askFable() {
  const p = queue[idx];
  const instruction = $('askInput').value.trim();
  if (!p || !sel || !instruction) return;
  $('ask').classList.add('busy');
  try {
    const body = await api('POST', '/api/rewrite', {
      content: $('content').value, start: sel.start, end: sel.end, instruction, platform: p.platform,
    });
    const c = $('content');
    const v = c.value;
    c.value = v.slice(0, sel.start) + body.replacement + v.slice(sel.end);
    const end = sel.start + body.replacement.length;
    hideAsk();
    updateChars();
    autosize(c);
    localStorage.setItem('draft:' + p.id, c.value);
    c.focus();
    c.setSelectionRange(end, end);
    toast('✨ rewritten');
  } catch (e) {
    toast('⚠️ ' + e.message);
    $('ask').classList.remove('busy');
  }
}

function setEditing(on) {
  $('card').classList.toggle('editing', on);
  $('keysReview').style.display = on ? 'none' : 'flex';
  $('keysEdit').style.display = on ? 'flex' : 'none';
}

document.addEventListener('keydown', (e) => {
  if (activeTab === 'generate' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 'p') processTranscript();
    else if (e.key === 'k') skipTranscript();
    return;
  }
  if (activeTab !== 'review') return;
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); decide('stage'); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'r' && e.shiftKey) { e.preventDefault(); decide('reject'); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.activeElement === $('askInput')) {
    if (e.key === 'Enter') askFable();
    else if (e.key === 'Escape') { hideAsk(); $('content').focus(); }
    return;
  }
  const editing = document.activeElement === $('content');
  if (editing) {
    if (e.key === 'Escape') {
      if ($('ask').classList.contains('show')) hideAsk();
      else $('content').blur();
    } else if (e.key === 'Tab' && $('ask').classList.contains('show')) {
      e.preventDefault();
      $('askInput').focus();
    }
    return;
  }
  if (e.key === 's') decide('stage');
  else if (e.key === 'r') decide('reject');
  else if (e.key === 'k') { idx = (idx + 1) % Math.max(queue.length, 1); showPost(); }
  else if (e.key === 'e') { e.preventDefault(); $('content').focus(); }
});

$('content').addEventListener('select', checkSelection);
$('content').addEventListener('mouseup', checkSelection);
$('content').addEventListener('focus', () => setEditing(true));
$('askInput').addEventListener('focus', () => setEditing(true));
$('content').addEventListener('blur', (e) => { if (e.relatedTarget !== $('askInput')) setEditing(false); });
$('askInput').addEventListener('blur', (e) => { if (e.relatedTarget !== $('content')) setEditing(false); });
$('content').addEventListener('input', () => {
  if (sel) hideAsk(); // typing/deleting invalidates the selection and its highlight
  updateChars();
  autosize($('content'));
  const p = queue[idx];
  if (p) {
    if ($('content').value !== p.content) localStorage.setItem('draft:' + p.id, $('content').value);
    else localStorage.removeItem('draft:' + p.id);
  }
});

// ── generate ──────────────────────────────────────────────────────────
let gqueue = [], gpolling = false;

function initGenerate() {
  api('GET', '/api/transcripts').then((d) => {
    gqueue = d.transcripts;
    showTranscript();
  }).catch((e) => toast('⚠️ ' + e.message));
  $('genProcess').onclick = processTranscript;
  $('genSkip').onclick = skipTranscript;
  watchGenerate(); // pick up any batch already running server-side
}

async function showTranscript() {
  const t = gqueue[0];
  if (activeTab === 'generate') $('progress').textContent = t ? gqueue.length + ' waiting' : '';
  if (!t) {
    $('genCard').style.display = 'none';
    $('genDone').style.display = 'block';
    return;
  }
  $('genCard').style.display = 'block';
  $('genDone').style.display = 'none';
  $('genName').textContent = t.name.replace(/\\.(txt|md)$/, '');
  $('genWho').textContent = t.attendees.length ? 'with ' + t.attendees.join(', ') : '';
  $('chars-gen').textContent = fmtN(t.size) + 'b';
  $('genSummary').textContent = t.summary || '…';
  $('genText').textContent = '';
  if (!t.summary) {
    api('POST', '/api/transcripts/summary', { name: t.name })
      .then((r) => { if (gqueue[0] === t) { t.summary = r.summary; $('genSummary').textContent = r.summary; } })
      .catch(() => { if (gqueue[0] === t) $('genSummary').textContent = ''; });
  }
  api('GET', '/api/transcripts/content?name=' + encodeURIComponent(t.name))
    .then((r) => { if (gqueue[0] === t) $('genText').textContent = r.content; })
    .catch(() => {});
}

function processTranscript() {
  const t = gqueue[0];
  if (!t) return;
  api('POST', '/api/generate', { files: [t.name] }).then(() => {
    toast('Processing ' + t.name.replace(/\\.(txt|md)$/, ''));
    gqueue.shift();
    showTranscript();
    watchGenerate();
    tabInits.review = false; // refresh review queue next visit
  }).catch((e) => toast('⚠️ ' + e.message));
}

function skipTranscript() {
  const t = gqueue[0];
  if (!t) return;
  api('POST', '/api/transcripts/skip', { name: t.name }).then(() => {
    gqueue.shift();
    showTranscript();
  }).catch((e) => toast('⚠️ ' + e.message));
}

function watchGenerate() {
  if (gpolling) return;
  gpolling = true;
  const tick = async () => {
    try {
      const s = await api('GET', '/api/generate/status');
      if (s.running) {
        $('genStatus').style.display = 'flex';
        const name = s.active ? s.active.replace(/\\.(txt|md)$/, '') : '…';
        $('genStatusText').textContent = '⚙︎ processing ' + name + (s.queued ? ' · ' + s.queued + ' queued' : '') + ' — ' + s.lastLine;
        setTimeout(tick, 2000);
      } else {
        gpolling = false;
        if ($('genStatus').style.display !== 'none') {
          $('genStatusText').textContent = s.error ? '⚠️ ' + s.error : '✓ batch done — new posts in Review';
          tabInits.review = false;
        }
      }
    } catch { gpolling = false; }
  };
  tick();
}

// ── reply ─────────────────────────────────────────────────────────────
function initReply() {
  $('replyScan').onclick = () => {
    $('replyScan').disabled = true;
    $('replyList').innerHTML = '';
    api('POST', '/api/reply/scan').then(() => {
      pollJob('reply', $('replyLog'), (job) => {
        $('replyScan').disabled = false;
        $('replyLog').style.display = 'none';
        if (job.error) { toast('⚠️ ' + job.error); return; }
        renderReplies(job.result.opportunities);
      });
    }).catch((e) => { toast('⚠️ ' + e.message); $('replyScan').disabled = false; });
  };
}

function renderReplies(opps) {
  if (!opps.length) {
    $('replyList').innerHTML = '<div class="empty">No good reply opportunities right now.</div>';
    return;
  }
  $('replyNote').textContent = opps.length + ' opportunities';
  $('replyList').innerHTML = opps.map((o, i) =>
    '<div class="card" data-i="' + i + '">' +
    '<div class="tweet">' +
    (o.parentText ? '<div class="parent">@' + escapeHtml(o.parentAuthor || '') + ': ' + escapeHtml(o.parentText) + '</div>' : '') +
    '<div><a href="' + escapeHtml(o.url) + '" target="_blank"><span class="who">@' + escapeHtml(o.author) + '</span></a>' +
    ' <span class="stats">' + fmtN(o.followers) + ' followers · ♥ ' + fmtN(o.likes) + ' · 💬 ' + fmtN(o.replies) + '</span></div>' +
    '<div class="serif">' + escapeHtml(o.text) + '</div>' +
    '</div>' +
    '<textarea class="grow reply-text" spellcheck="true">' + escapeHtml(o.suggestedReply) + '</textarea>' +
    '<div class="actions">' +
    '<button class="primary reply-post">Post + like</button>' +
    '<button class="ghost reply-skip">Skip</button>' +
    '<span class="dim" style="align-self:center">' + escapeHtml(o.reasoning || '') + '</span>' +
    '</div></div>'
  ).join('');
  document.querySelectorAll('#replyList .reply-text').forEach((t) => {
    autosize(t);
    t.addEventListener('input', () => autosize(t));
  });
  document.querySelectorAll('#replyList .reply-post').forEach((btn) => btn.addEventListener('click', async (e) => {
    const card = e.target.closest('.card');
    const o = opps[+card.dataset.i];
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/reply/post', { tweetId: o.tweetId, text: card.querySelector('.reply-text').value });
      toast('Posted → <a href="' + r.url + '" target="_blank">view</a>');
      card.remove();
    } catch (err) { toast('⚠️ ' + err.message); btn.disabled = false; }
  }));
  document.querySelectorAll('#replyList .reply-skip').forEach((btn) => btn.addEventListener('click', async (e) => {
    const card = e.target.closest('.card');
    const o = opps[+card.dataset.i];
    try {
      await api('POST', '/api/reply/skip', { tweetId: o.tweetId });
      card.remove();
    } catch (err) { toast('⚠️ ' + err.message); }
  }));
}

// ── stats ─────────────────────────────────────────────────────────────
function initStats() {
  api('GET', '/api/stats').then((s) => {
    $('statsLoading').style.display = 'none';
    $('statsBody').style.display = 'block';
    const pct = Math.min(100, Math.round((s.goal.projected / s.goal.target) * 100));
    const tile = (n, l) => '<div class="tile"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>';
    $('statsBody').innerHTML =
      '<div class="tiles">' +
      tile(fmtN(s.account ? s.account.followers : 0), '@' + escapeHtml(s.username) + ' followers') +
      tile(fmtN(s.d7.impressions), 'impressions · 7d') +
      tile(s.d7.posts, 'posts · 7d') +
      tile(fmtN(s.d7.likes), 'likes · 7d') +
      tile(fmtN(s.d7.replies), 'replies · 7d') +
      tile(s.d7.engagementRate.toFixed(2) + '%', 'engagement · 7d') +
      '</div>' +
      '<div class="card"><div class="meta"><span class="badge">90-day goal</span><span>' + fmtN(s.goal.projected) + ' projected of ' + fmtN(s.goal.target) + '</span></div>' +
      '<div class="bar"><div style="width:' + pct + '%"></div></div>' +
      '<div class="dim" style="margin-top:8px;color:var(--muted);font-size:13px">' + fmtN(s.goal.dailyAvg) + '/day now · best hours: ' +
      s.bestHours.map((h) => (h % 12 || 12) + (h >= 12 ? 'PM' : 'AM')).join(', ') + '</div></div>' +
      (s.topPost
        ? '<div class="card"><div class="meta"><span class="badge">top post · 7d</span><span>' + fmtN(s.topPost.impressions) + ' imp · ♥ ' + fmtN(s.topPost.likes) + '</span></div>' +
          '<div class="serif">' + escapeHtml(s.topPost.text) + '</div></div>'
        : '') +
      (s.cached ? '<div class="empty" style="padding:10px">cached · refreshes hourly</div>' : '');
  }).catch((e) => {
    $('statsLoading').textContent = '⚠️ ' + e.message;
  });
}

// ── unfollow ──────────────────────────────────────────────────────────
function initUnfollow() {
  $('unfScan').onclick = () => {
    $('unfScan').disabled = true;
    api('POST', '/api/unfollow/scan').then(() => {
      pollJob('unfollow-scan', $('unfLog'), (job) => {
        $('unfScan').disabled = false;
        $('unfLog').style.display = 'none';
        if (job.error) { toast('⚠️ ' + job.error); return; }
        renderUnfollow(job.result);
        $('unfScan').textContent = 'Refresh candidates';
      });
    }).catch((e) => { toast('⚠️ ' + e.message); $('unfScan').disabled = false; });
  };
  $('unfWhitelist').onclick = () => {
    const boxes = [...document.querySelectorAll('#unfList input:checked')];
    if (!boxes.length) return;
    const entries = boxes.map((b) => ({ id: b.value, username: b.closest('.row').querySelector('b').textContent.slice(1) }));
    api('POST', '/api/unfollow/whitelist', { entries }).then(() => {
      boxes.forEach((b) => b.closest('.row').remove());
      toast('Whitelisted ' + entries.length + ' — never suggested again');
    }).catch((e) => toast('⚠️ ' + e.message));
  };
  $('unfScan').click(); // auto-load from the cached following list
  $('unfRun').onclick = () => {
    const boxes = [...document.querySelectorAll('#unfList input:checked')];
    if (!boxes.length) return;
    const entries = boxes.map((b) => ({ id: b.value, username: b.closest('.row').querySelector('b').textContent.slice(1) }));
    boxes.forEach((b) => {
      const mark = document.createElement('span');
      mark.textContent = '✓';
      mark.style.cssText = 'color:var(--accent);width:15px;text-align:center;font-weight:700';
      b.replaceWith(mark);
      mark.closest('.row').style.opacity = '0.55';
    });
    api('POST', '/api/unfollow/run', { entries }).then((r) => {
      toast('Held ' + entries.length + ' unfollow decision' + (entries.length === 1 ? '' : 's') + ' (' + r.pending + ' pending)');
      watchUnfollow();
    }).catch((e) => toast('⚠️ ' + e.message));
  };
}

let unfPolling = false;
function watchUnfollow() {
  if (unfPolling) return;
  unfPolling = true;
  const tick = async () => {
    try {
      const job = await api('GET', '/api/job/unfollow-run');
      const last = job.log.filter((l) => l.trim()).slice(-1)[0] || '';
      $('unfLog').style.display = 'block';
      $('unfLog').textContent = job.running ? '⚙︎ ' + last : (job.error ? '⚠️ ' + job.error : '✓ ' + last);
      if (job.running) setTimeout(tick, 2000);
      else unfPolling = false;
    } catch { unfPolling = false; }
  };
  tick();
}

function renderUnfollow(result) {
  $('unfList').style.display = 'block';
  $('unfRun').style.display = 'inline-block';
  $('unfWhitelist').style.display = 'inline-block';
  $('replyNote').textContent = '';
  if (!result.candidates.length) {
    $('unfList').innerHTML = '<div class="empty">No unfollow candidates — following ' + result.followingCount + ' accounts.</div>';
    return;
  }
  const pendingHtml = result.pendingCount
    ? '<span>· ' + result.pendingCount + ' pending <a href="#" id="unfRetry" style="color:var(--accent)">retry</a></span>'
    : '';
  $('unfList').innerHTML =
    '<div class="meta"><span class="badge">following ' + result.followingCount + '</span><span>' + result.candidates.length + ' candidates (worst first)</span>' + pendingHtml + '</div>' +
    result.candidates.map((c) => {
      const reason = c.reason.split(', ').filter((r) => !/followers$/.test(r) && !/tweets \\(inactive\\)$/.test(r)).join(', ');
      return '<label class="row tall" style="padding:12px 0"><input type="checkbox" value="' + escapeHtml(c.id) + '">' +
      '<span class="lines">' +
      '<div><a href="https://x.com/' + escapeHtml(c.username) + '" target="_blank" style="color:inherit"><b>@' + escapeHtml(c.username) + '</b></a> <span class="who">' + escapeHtml(c.name) + '</span></div>' +
      '<div class="who">' + fmtN(c.followers) + ' followers · ' + fmtN(c.tweets) + ' posts' + (reason ? ' · ' + escapeHtml(reason) : '') + '</div>' +
      '</span></label>';
    }).join('');
  const retry = $('unfRetry');
  if (retry) retry.onclick = (e) => {
    e.preventDefault();
    api('POST', '/api/unfollow/retry').then(() => { toast('Retrying pending unfollows'); watchUnfollow(); })
      .catch((err) => toast('⚠️ ' + err.message));
  };
}

// ── boot ──────────────────────────────────────────────────────────────
showTab(location.hash.slice(1) || 'review');
</script>
</body>
</html>`;
