/* RSTトレーニング
   問題データ : data/manifest.json に列挙された JSON を読み込む
   学習記録   : このブラウザの localStorage に学習者ごとに保存（1問ごとに日時・正誤・解答時間） */
(function () {
  "use strict";

  const RS = [
    { code: "DEP", no: "RS1", name: "係り受け解析", short: "係り受け", desc: "文の骨組み（主語・述語・修飾）をとらえる" },
    { code: "ANA", no: "RS2", name: "照応解決", short: "照応", desc: "指示語や省略された言葉が指すものをとらえる" },
    { code: "PARA", no: "RS3", name: "同義文判定", short: "同義文", desc: "2つの文が同じ意味かを見分ける" },
    { code: "INF", no: "RS4", name: "推論", short: "推論", desc: "書かれていることから確実にいえることを導く" },
    { code: "REP", no: "RS5", name: "イメージ同定", short: "イメージ", desc: "文章と図・表・グラフを対応づける" },
    { code: "INST_DIC", no: "RS6", name: "具体例同定（辞書）", short: "具体例(辞書)", desc: "言葉の定義に合う例を選ぶ" },
    { code: "INST_SCI", no: "RS7", name: "具体例同定（理数）", short: "具体例(理数)", desc: "法則や定義にあてはまる例を選ぶ" },
  ];
  const RS_MAP = Object.fromEntries(RS.map((r) => [r.code, r]));
  const SUBJECTS = ["国語", "数学", "社会", "理科", "英語"];
  const GRADES = ["中1", "中2", "中3"];
  const LETTERS = ["A", "B", "C", "D"];
  const STORE_KEY = "rst-app-v2";
  const DAY = 86400000;

  const $app = document.getElementById("app");
  let DB = [];
  let Q_BY_ID = {};
  let session = null;
  let lastSetup = null;

  /* =========================================================
     保存（学習者ごと）
     ========================================================= */
  const uid = () => "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function freshStore() {
    const id = uid();
    return { version: 2, current: id, learners: [{ id, name: "わたし", created: Date.now() }], logs: { [id]: { answers: [], sessions: [] } } };
  }
  let STORE = (function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.version === 2 && Array.isArray(s.learners) && s.learners.length) {
        s.learners.forEach((l) => { s.logs[l.id] = s.logs[l.id] || { answers: [], sessions: [] }; });
        if (!s.logs[s.current]) s.current = s.learners[0].id;
        return s;
      }
    } catch (e) { /* 読めないときは新規 */ }
    return freshStore();
  })();
  let saveWarned = false;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(STORE)); }
    catch (e) { if (!saveWarned) { saveWarned = true; console.warn("学習記録を保存できませんでした", e); } }
  }
  const learner = () => STORE.learners.find((l) => l.id === STORE.current) || STORE.learners[0];
  const log = () => STORE.logs[STORE.current];
  function lastResultById() {
    const m = {};
    log().answers.forEach((a) => { m[a.q] = a.ok; });
    return m;
  }

  /* =========================================================
     ユーティリティ
     ========================================================= */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);
  const isEnglishText = (s) => /^[\x00-\x7F“”’‘—–…]+$/.test(String(s || "").trim());
  const passageLabel = (code) => (code === "PARA" ? "基準文" : code.startsWith("INST") ? "定義" : "本文");
  const pad = (n) => String(n).padStart(2, "0");
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const fmtDateTime = (ts) => { const d = new Date(ts); return `${md(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtSec = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}分${Math.round((ms % 60000) / 1000)}秒` : `${Math.round(ms / 1000)}秒`);
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

  function setNav(name) {
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
    const who = document.getElementById("who");
    if (who) who.textContent = learner().name;
  }

  function download(filename, text, type) {
    try {
      const blob = new Blob([text], { type });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return true;
    } catch (e) { return false; }
  }

  /* =========================================================
     データ読み込み
     ========================================================= */
  async function loadData() {
    if (Array.isArray(window.RST_EMBEDDED_DATA)) return { items: window.RST_EMBEDDED_DATA, info: "埋め込みデータ" };
    const res = await fetch("data/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error("data/manifest.json が見つかりません");
    const manifest = await res.json();
    const lists = await Promise.all(manifest.files.map(async (f) => {
      const r = await fetch(f.path, { cache: "no-store" });
      if (!r.ok) throw new Error(`${f.path} が読み込めません`);
      return r.json();
    }));
    const seen = new Set(); const items = [];
    lists.flat().forEach((q) => { if (!seen.has(q.id)) { seen.add(q.id); items.push(q); } });
    const d = manifest.generated_at ? new Date(manifest.generated_at) : null;
    return { items, info: `データ更新: ${d ? d.toLocaleString("ja-JP") : "-"}／バッチ ${manifest.files.map((f) => f.batch).join(", ")}` };
  }

  /* =========================================================
     画面1: 出題条件（ホーム）
     ========================================================= */
  function poolFor(setup) {
    const last = setup.onlyWrong ? lastResultById() : null;
    return DB.filter((q) => setup.subjects.has(q.subject) && setup.grades.has(q.grade) && setup.rs.has(q.rs_code)
      && (!last || last[q.id] === false));
  }
  function startFromSetup(setup) {
    const qs = shuffle(poolFor(setup));
    if (!qs.length) { location.hash = "#/"; return; }
    startSession(setup.count ? qs.slice(0, setup.count) : qs, () => startFromSetup(setup));
  }
  function defaultSetup() {
    return { subjects: new Set(SUBJECTS), grades: new Set(GRADES), rs: new Set(RS.map((r) => r.code)), count: 10, onlyWrong: false };
  }

  function viewHome() {
    setNav("home");
    const setup = lastSetup || defaultSetup();
    lastSetup = setup;
    const countFor = (key, val) => DB.filter((q) => q[key] === val).length;
    const keyOf = { subjects: "subject", grades: "grade", rs: "rs_code" };

    const chipGroup = (label, key, values, labelFn) => `
      <div class="field-group">
        <div class="field-label">${label}
          <button class="link" data-all="${key}">すべて</button>
          <button class="link" data-none="${key}">解除</button>
        </div>
        <div class="chips">${values.map((v) => `
          <button class="chip" data-group="${key}" data-val="${esc(v)}">${labelFn ? labelFn(v) : esc(v)}<span class="count">${countFor(keyOf[key], v)}</span></button>`).join("")}
        </div>
      </div>`;

    $app.innerHTML = `
      <div class="row" style="margin-bottom:4px"><h1>リーディングスキル演習</h1></div>
      <p class="lead">教科書に出てくるような文章を、正確に読み取れるかを確かめます。<br class="sp-hide">学習者：<a href="#/dashboard" class="who-link"><b>${esc(learner().name)}</b></a>（ダッシュボードで切りかえ）</p>
      <section class="card">
        ${chipGroup("教科", "subjects", SUBJECTS)}
        ${chipGroup("学年", "grades", GRADES)}
        ${chipGroup("リーディングスキル（RS）", "rs", RS.map((r) => r.code), (c) => `${RS_MAP[c].no} ${RS_MAP[c].name}`)}
        <div class="field-group">
          <div class="field-label">問題数</div>
          <div class="chips">${[5, 10, 20, 0].map((n) => `
            <button class="chip" data-count="${n}">${n ? n + "問" : "すべて"}</button>`).join("")}
            <button class="chip" data-wrong>前回まちがえた問題だけ</button>
          </div>
        </div>
        <div class="row" style="margin-top:20px">
          <div class="match" id="match"></div>
          <div class="spacer"></div>
          <button class="btn primary lg" id="start">スタート</button>
        </div>
      </section>
      <section class="card">
        <h2>7つのリーディングスキル</h2>
        <div class="small">${RS.map((r) => `<div><b>${r.no} ${r.name}</b> <span class="muted">— ${r.desc}</span></div>`).join("")}</div>
      </section>`;

    const refresh = () => {
      const n = poolFor(setup).length;
      const take = setup.count ? Math.min(setup.count, n) : n;
      document.getElementById("match").innerHTML = `条件に合う問題 <strong>${n}</strong>問 ／ 出題 <strong>${take}</strong>問`;
      document.getElementById("start").disabled = n === 0;
      $app.querySelectorAll(".chip[data-group]").forEach((b) => b.setAttribute("aria-pressed", setup[b.dataset.group].has(b.dataset.val)));
      $app.querySelectorAll(".chip[data-count]").forEach((b) => b.setAttribute("aria-pressed", setup.count === Number(b.dataset.count)));
      $app.querySelector(".chip[data-wrong]").setAttribute("aria-pressed", setup.onlyWrong);
    };
    const allValues = { subjects: SUBJECTS, grades: GRADES, rs: RS.map((r) => r.code) };

    $app.onclick = (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.group) { const s = setup[t.dataset.group]; s.has(t.dataset.val) ? s.delete(t.dataset.val) : s.add(t.dataset.val); }
      else if (t.dataset.all) { allValues[t.dataset.all].forEach((v) => setup[t.dataset.all].add(v)); }
      else if (t.dataset.none) { setup[t.dataset.none].clear(); }
      else if (t.dataset.count !== undefined) { setup.count = Number(t.dataset.count); }
      else if (t.hasAttribute("data-wrong")) { setup.onlyWrong = !setup.onlyWrong; }
      else if (t.id === "start") { startFromSetup(setup); return; }
      refresh();
    };
    refresh();
  }

  /* =========================================================
     画面2: 演習
     ========================================================= */
  function startSession(questions, regen) {
    session = { questions, index: 0, results: [], startedAt: Date.now(), answered: false, regen, saved: false };
    location.hash = "#/quiz";
    if (location.hash === "#/quiz") viewQuiz();
  }

  function viewQuiz() {
    setNav("home");
    if (!session || !session.questions.length || session.done) { location.hash = "#/"; return; }
    const q = session.questions[session.index];
    const total = session.questions.length;
    const en = q.subject === "英語" && isEnglishText(q.passage);
    const rs = RS_MAP[q.rs_code];

    $app.innerHTML = `
      <div class="quiz-head">
        <div class="progress" aria-hidden="true"><span style="width:${(session.index / total) * 100}%"></span></div>
        <div class="qnum">${session.index + 1} / ${total}</div>
        <button class="btn ghost" id="quit">終了</button>
      </div>
      <article class="card">
        <div class="tags">
          <span class="tag">${esc(rs.no)} ${esc(rs.name)}</span>
          <span class="tag plain">${esc(q.subject)}・${esc(q.grade)}</span>
          <span class="tag plain">${esc(q.unit || q.field || "")}</span>
        </div>
        <div class="passage ${en ? "en" : ""}"><div class="passage-label">${passageLabel(q.rs_code)}</div>${esc(q.passage)}</div>
        ${q.note ? `<div class="note">${esc(q.note)}</div>` : ""}
        <div class="question">${esc(q.question)}</div>
        <div class="choices" role="group" aria-label="選択肢">
          ${q.choices.map((c, i) => `
            <button class="choice ${isEnglishText(c) ? "en" : ""}" data-i="${i}">
              <span class="key">${LETTERS[i]}</span><span class="txt">${esc(c)}</span>
            </button>`).join("")}
        </div>
        <div id="fb"></div>
        <div class="quiz-foot">
          <span class="kbd-hint">キー操作：1〜4 または A〜D で解答、Enter で次へ</span>
          <button class="btn primary" id="next" hidden>${session.index + 1 < total ? "次の問題へ" : "結果を見る"}</button>
        </div>
      </article>`;
    session.answered = false;
    session.qStart = Date.now();
    $app.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });

    $app.onclick = (e) => {
      const ch = e.target.closest(".choice");
      if (ch && !session.answered) return answer(Number(ch.dataset.i));
      if (e.target.closest("#next")) return next();
      if (e.target.closest("#quit")) {
        if (session.results.length === 0) { session = null; location.hash = "#/"; }
        else finish();
      }
    };
  }

  function answer(i) {
    const q = session.questions[session.index];
    const correctIdx = LETTERS.indexOf(q.answer);
    const ok = i === correctIdx;
    const now = Date.now();
    const ms = Math.min(now - session.qStart, 30 * 60000);
    session.answered = true;
    session.results.push({ id: q.id, subject: q.subject, rs: q.rs_code, chosen: LETTERS[i], ok, ms });
    // 1問ごとにすぐ保存（途中でやめても記録が残る）
    log().answers.push({ t: now, q: q.id, s: q.subject, g: q.grade, rs: q.rs_code, ok: ok ? 1 : 0, c: LETTERS[i], ms });
    save();

    $app.querySelectorAll(".choice").forEach((b, k) => {
      b.disabled = true;
      if (k === correctIdx) b.classList.add("correct");
      else if (k === i) b.classList.add("wrong");
      else b.classList.add("dim");
    });
    document.getElementById("fb").innerHTML = `
      <div class="feedback ${ok ? "ok" : "ng"}" role="status">
        <div class="verdict">${ok ? "正解" : "不正解"}<span class="muted small" style="font-weight:400">正答は ${q.answer}</span></div>
        <div class="basis"><b>根拠：</b>${esc(q.explanation || "（根拠は未登録です）")}</div>
      </div>`;
    const nb = document.getElementById("next");
    nb.hidden = false; nb.focus({ preventScroll: true });
    nb.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function next() {
    if (session.index + 1 < session.questions.length) { session.index++; viewQuiz(); }
    else finish();
  }

  function finish() {
    if (!session.saved) {
      const res = session.results;
      log().sessions.push({
        at: session.startedAt, end: Date.now(), n: res.length, ok: res.filter((r) => r.ok).length,
        ms: res.reduce((s, r) => s + r.ms, 0), subj: [...new Set(res.map((r) => r.subject))],
      });
      save();
      session.saved = true;
    }
    session.done = true;
    location.hash = "#/result";
    if (location.hash === "#/result") viewResult();
  }

  /* ---------- RS別バー（単一系列・HTML） ---------- */
  function barsHTML(stats, prev) {
    return `<div class="bars">${RS.map((r) => {
      const s = stats[r.code];
      if (!s || !s.t) return `<div class="bar-row none"><div class="lbl">${r.no} ${r.name}</div><div class="bar-track"></div><div class="val">—</div></div>`;
      const p = pct(s.c, s.t);
      let delta = "";
      if (prev) {
        const ps = prev[r.code];
        if (ps && ps.t) { const d = p - pct(ps.c, ps.t); delta = `<span class="delta">${d > 0 ? "▲" : d < 0 ? "▼" : "±"}${Math.abs(d)}</span>`; }
      }
      return `<div class="bar-row" title="${r.no} ${r.name}：${s.c}/${s.t}問 正解（${p}%）">
        <div class="lbl">${r.no} ${r.name}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${p}%"></div></div>
        <div class="val"><b>${p}%</b> <span class="small">${s.c}/${s.t}</span>${delta}</div></div>`;
    }).join("")}</div>`;
  }

  /* =========================================================
     画面3: 結果
     ========================================================= */
  function viewResult() {
    setNav("home");
    if (!session || !session.done) { location.hash = "#/"; return; }
    const res = session.results;
    const correct = res.filter((r) => r.ok).length;
    const byRs = {};
    res.forEach((r) => { byRs[r.rs] = byRs[r.rs] || { c: 0, t: 0 }; byRs[r.rs].t++; if (r.ok) byRs[r.rs].c++; });
    const qById = Object.fromEntries(session.questions.map((q) => [q.id, q]));
    const wrong = res.filter((r) => !r.ok);
    const totalMs = res.reduce((s, r) => s + r.ms, 0);

    $app.innerHTML = `
      <h1>結果</h1>
      <section class="card">
        <div class="score-hero">
          <div class="big">${pct(correct, res.length)}<small>%</small></div>
          <div class="sub">${res.length}問中 <b>${correct}</b>問 正解 ／ かかった時間 ${fmtSec(totalMs)}（1問平均 ${fmtSec(totalMs / Math.max(1, res.length))}）</div>
        </div>
      </section>
      <section class="card">
        <h2>リーディングスキル別の正答率</h2>
        ${barsHTML(byRs)}
      </section>
      <section class="card">
        <div class="row" style="margin-bottom:10px"><h2 style="margin:0">ふり返り</h2><div class="spacer"></div><span class="muted small">タップで解説を表示</span></div>
        ${res.map((r, i) => {
          const q = qById[r.id];
          return `<details class="review-item" ${!r.ok && wrong.length <= 3 ? "open" : ""}>
            <summary><span class="mark ${r.ok ? "ok" : "ng"}">${r.ok ? "○" : "×"}</span>
              <span><span class="small muted">${i + 1}. ${esc(RS_MAP[q.rs_code].no)} ${esc(q.subject)}・${esc(q.grade)}</span><br>${esc(q.question)}</span></summary>
            <div class="review-body">
              <div class="passage ${q.subject === "英語" && isEnglishText(q.passage) ? "en" : ""}">${esc(q.passage)}</div>
              <div>あなたの答え：<b>${r.chosen}</b>　正答：<b>${q.answer}</b>（${esc(q.choices[LETTERS.indexOf(q.answer)])}）</div>
              <div class="muted" style="margin-top:4px"><b>根拠：</b>${esc(q.explanation)}</div>
            </div>
          </details>`;
        }).join("")}
      </section>
      <div class="row">
        ${wrong.length ? `<button class="btn primary" id="retry">まちがえた問題をもう一度（${wrong.length}問）</button>` : ""}
        <button class="btn" id="again">同じ条件で新しく解く</button>
        <a class="btn ghost" href="#/dashboard">ダッシュボードを見る</a>
      </div>`;

    $app.onclick = (e) => {
      if (e.target.closest("#retry")) startSession(shuffle(wrong.map((r) => qById[r.id])), session.regen);
      else if (e.target.closest("#again")) { if (session.regen) session.regen(); else location.hash = "#/"; }
    };
  }

  /* =========================================================
     画面4: ダッシュボード（期間ごとの学習履歴）
     ========================================================= */
  const dash = { preset: "30", from: null, to: null, gran: "auto" };
  const PRESETS = [["7", "7日間"], ["30", "30日間"], ["90", "90日間"], ["month", "今月"], ["lastmonth", "先月"], ["all", "全期間"], ["custom", "期間指定"]];

  function periodRange() {
    const today = startOfDay(new Date());
    let from, to = addDays(today, 1); // to は翌日0時（含まない）
    const p = dash.preset;
    if (/^\d+$/.test(p)) from = addDays(today, -(Number(p) - 1));
    else if (p === "month") from = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (p === "lastmonth") { from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 1); }
    else if (p === "all") { const first = log().answers[0]; from = first ? startOfDay(first.t) : today; }
    else {
      from = dash.from ? parseYmd(dash.from) : addDays(today, -29);
      to = dash.to ? addDays(parseYmd(dash.to), 1) : addDays(today, 1);
      if (to <= from) to = addDays(from, 1);
    }
    const days = Math.round((to - from) / DAY);
    return { from, to, days, prevFrom: addDays(from, -days), prevTo: from };
  }

  function granularity(days) {
    if (dash.gran !== "auto") return dash.gran;
    return days <= 31 ? "day" : days <= 182 ? "week" : "month";
  }

  function makeBuckets(from, to, gran) {
    const out = [];
    let cur = new Date(from);
    if (gran === "week") { const dow = (cur.getDay() + 6) % 7; cur = addDays(cur, -dow); }
    if (gran === "month") cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
    while (cur < to) {
      const next = gran === "day" ? addDays(cur, 1) : gran === "week" ? addDays(cur, 7) : new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const label = gran === "month" ? `${cur.getFullYear() % 100}/${cur.getMonth() + 1}月` : md(cur);
      const tip = gran === "day" ? `${cur.getFullYear()}/${md(cur)}` : gran === "week" ? `${md(cur)}〜${md(addDays(next, -1))}の週` : `${cur.getFullYear()}年${cur.getMonth() + 1}月`;
      out.push({ start: +cur, end: +next, label, tip, n: 0, c: 0 });
      cur = next;
    }
    return out;
  }

  function aggregate(answers) {
    const byRs = {}, bySub = {}, cross = {};
    let c = 0, ms = 0; const days = new Set();
    answers.forEach((a) => {
      c += a.ok; ms += a.ms || 0; days.add(ymd(new Date(a.t)));
      (byRs[a.rs] = byRs[a.rs] || { c: 0, t: 0 }); byRs[a.rs].t++; byRs[a.rs].c += a.ok;
      (bySub[a.s] = bySub[a.s] || { c: 0, t: 0 }); bySub[a.s].t++; bySub[a.s].c += a.ok;
      const k = a.s + "|" + a.rs; (cross[k] = cross[k] || { c: 0, t: 0 }); cross[k].t++; cross[k].c += a.ok;
    });
    return { n: answers.length, c, ms, days: days.size, byRs, bySub, cross };
  }

  function streak() {
    const days = new Set(log().answers.map((a) => ymd(new Date(a.t))));
    let d = startOfDay(new Date());
    if (!days.has(ymd(d))) d = addDays(d, -1);
    let n = 0;
    while (days.has(ymd(d))) { n++; d = addDays(d, -1); }
    return n;
  }

  function kpi(label, value, sub) {
    return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub || "&nbsp;"}</div></div>`;
  }
  function deltaText(cur, prev, unit, hasPrev) {
    if (!hasPrev) return "前の期間：記録なし";
    const d = cur - prev;
    return `前の期間より ${d > 0 ? "▲" : d < 0 ? "▼" : "±"}${Math.abs(d)}${unit}`;
  }

  function viewDashboard() {
    setNav("dashboard");
    const all = log().answers;
    const r = periodRange();
    const gran = granularity(r.days);
    const cur = all.filter((a) => a.t >= +r.from && a.t < +r.to);
    const prev = all.filter((a) => a.t >= +r.prevFrom && a.t < +r.prevTo);
    const A = aggregate(cur), P = aggregate(prev);
    const buckets = makeBuckets(r.from, r.to, gran);
    let bi = 0;
    cur.forEach((a) => { while (bi < buckets.length && a.t >= buckets[bi].end) bi++; if (buckets[bi] && a.t >= buckets[bi].start) { buckets[bi].n++; buckets[bi].c += a.ok; } });
    const sessions = log().sessions.filter((s) => s.at >= +r.from && s.at < +r.to).slice().reverse();
    const rangeLabel = `${r.from.getFullYear()}/${md(r.from)} 〜 ${md(addDays(r.to, -1))}`;
    const granLabel = { day: "日", week: "週", month: "月" }[gran];

    // 苦手：3問以上解いた 教科×RS のうち正答率が低いもの
    const weak = Object.entries(A.cross).filter(([, v]) => v.t >= 3).map(([k, v]) => ({ k, s: k.split("|")[0], rs: k.split("|")[1], p: pct(v.c, v.t), t: v.t }))
      .sort((a, b) => a.p - b.p || b.t - a.t).slice(0, 3).filter((w) => w.p < 80);

    const learnerOpts = STORE.learners.map((l) => `<option value="${l.id}" ${l.id === STORE.current ? "selected" : ""}>${esc(l.name)}</option>`).join("");

    $app.innerHTML = `
      <div class="dash-head">
        <div><h1>ダッシュボード</h1><div class="muted small">${esc(rangeLabel)}（${r.days}日間）</div></div>
        <div class="learner-box">
          <label for="lsel" class="small muted">学習者</label>
          <select id="lsel">${learnerOpts}<option value="__new">＋ 学習者を追加</option></select>
          <button class="btn ghost small-btn" id="lrename">名前変更</button>
        </div>
      </div>
      <div id="lform"></div>
      <div class="period card">
        <div class="chips">${PRESETS.map(([k, l]) => `<button class="chip" data-preset="${k}" aria-pressed="${dash.preset === k}">${l}</button>`).join("")}</div>
        ${dash.preset === "custom" ? `<div class="row date-row">
          <input type="date" id="dfrom" value="${dash.from || ymd(r.from)}"> <span>〜</span>
          <input type="date" id="dto" value="${dash.to || ymd(addDays(r.to, -1))}">
        </div>` : ""}
        <div class="row gran-row"><span class="small muted">集計の単位</span>
          ${[["auto", "自動"], ["day", "日"], ["week", "週"], ["month", "月"]].map(([k, l]) => `<button class="chip sm" data-gran="${k}" aria-pressed="${dash.gran === k}">${l}</button>`).join("")}
        </div>
      </div>

      ${all.length === 0 ? `
      <section class="card"><div class="empty">
        まだ学習記録がありません。<br><a href="#/">演習をはじめる</a>
        <div style="margin-top:14px"><button class="btn" id="sample">画面確認用のサンプル記録を作る</button>
        <div class="small muted" style="margin-top:6px">「サンプル」という学習者を追加し、過去60日分の架空の記録を入れます（あとで削除できます）。</div></div>
      </div></section>` : `

      <section class="kpis">
        ${kpi("解答数", `${A.n}<small>問</small>`, deltaText(A.n, P.n, "問", P.n > 0))}
        ${kpi("正答率", A.n ? `${pct(A.c, A.n)}<small>%</small>` : "—", A.n ? deltaText(pct(A.c, A.n), pct(P.c, P.n), "pt", P.n > 0) : "")}
        ${kpi("学習した日数", `${A.days}<small>日</small>`, `連続 ${streak()}日（今日まで）`)}
        ${kpi("1問あたりの時間", A.n ? fmtSec(A.ms / A.n) : "—", A.n && P.n ? `前の期間 ${fmtSec(P.ms / P.n)}` : "")}
      </section>

      <section class="card">
        <h2>解答数の推移<span class="muted small">（${granLabel}ごと）</span></h2>
        <div class="fig" id="ch-count"></div>
      </section>
      <section class="card">
        <h2>正答率の推移<span class="muted small">（${granLabel}ごと・解答のあった${granLabel}のみ）</span></h2>
        <div class="fig" id="ch-rate"></div>
      </section>

      <section class="card">
        <h2>リーディングスキル別の正答率<span class="muted small">（▲▼は前の期間との差・pt）</span></h2>
        ${A.n ? barsHTML(A.byRs, P.byRs) : `<div class="empty">この期間の記録はありません</div>`}
      </section>

      ${weak.length ? `<section class="card">
        <h2>重点的に練習したいところ</h2>
        <div class="weak-list">${weak.map((w) => `
          <div class="weak"><div><b>${esc(w.s)} × ${RS_MAP[w.rs].no} ${RS_MAP[w.rs].name}</b><div class="small muted">正答率 ${w.p}%（${w.t}問）</div></div>
          <button class="btn small-btn" data-practice="${esc(w.s)}|${w.rs}">練習する</button></div>`).join("")}
        </div></section>` : ""}

      <section class="card">
        <h2>教科 × リーディングスキル</h2>
        ${A.n ? `<div class="scroll"><table class="heat">
          <thead><tr><th></th>${RS.map((x) => `<th title="${x.no} ${x.name}">${x.no}<span>${x.short}</span></th>`).join("")}<th>合計</th></tr></thead>
          <tbody>${SUBJECTS.map((s) => `<tr><th>${s}</th>${RS.map((x) => heatCell(A.cross[s + "|" + x.code])).join("")}${heatCell(A.bySub[s], true)}</tr>`).join("")}</tbody>
        </table></div>
        <div class="small muted" style="margin-top:6px">数字は正答率（%）、小さい数字は解答数。色が濃いほど正答率が高い。</div>` : `<div class="empty">この期間の記録はありません</div>`}
      </section>

      <section class="card">
        <h2>演習の記録<span class="muted small">（${sessions.length}回）</span></h2>
        ${sessions.length ? `<div class="scroll"><table class="sess-table">
          <thead><tr><th>日時</th><th>教科</th><th class="num">正解</th><th class="num">正答率</th><th class="num opt">時間</th></tr></thead>
          <tbody>${sessions.slice(0, 100).map((s, i) => `<tr ${i >= 10 ? 'class="more" hidden' : ""}><td class="nw">${fmtDateTime(s.at)}</td><td class="subj">${esc(s.subj.join("・"))}</td><td class="num">${s.ok}/${s.n}</td><td class="num">${pct(s.ok, s.n)}%</td><td class="num opt">${fmtSec(s.ms || 0)}</td></tr>`).join("")}</tbody>
        </table></div>${sessions.length > 10 ? `<button class="btn ghost small-btn" id="more">すべて表示（${Math.min(100, sessions.length)}回）</button>` : ""}` : `<div class="empty">この期間の演習はありません</div>`}
      </section>`}

      <section class="card">
        <h2>記録のバックアップ</h2>
        <p class="small muted" style="margin-top:0">記録はこのブラウザだけに保存されています。端末を変えるときや、先生に提出するときは書き出してください。</p>
        <div class="row">
          <button class="btn" id="exp-csv">CSVで書き出す（${esc(learner().name)}）</button>
          <button class="btn" id="exp-json">バックアップを書き出す（全学習者）</button>
          <label class="btn" for="imp">バックアップを読み込む</label>
          <input type="file" id="imp" accept=".json,application/json" hidden>
        </div>
        <div id="io-msg" class="small" style="margin-top:8px"></div>
        <div class="row" style="margin-top:12px"><div class="spacer"></div><button class="btn ghost" id="reset">「${esc(learner().name)}」の記録を消す</button>${STORE.learners.length > 1 ? `<button class="btn ghost" id="ldel">学習者を削除</button>` : ""}</div>
      </section>`;

    if (all.length) {
      drawBarChart(document.getElementById("ch-count"), buckets.map((b) => ({ label: b.label, value: b.n, tip: `${b.tip}<br><b>${b.n}問</b>（正解 ${b.c}）` })));
      drawLineChart(document.getElementById("ch-rate"), buckets.map((b) => ({ label: b.label, value: b.n ? pct(b.c, b.n) : null, tip: b.n ? `${b.tip}<br><b>${pct(b.c, b.n)}%</b>（${b.c}/${b.n}問）` : "" })));
    }
    bindDashboard();
  }

  function heatCell(v, bold) {
    if (!v || !v.t) return `<td class="hc empty-cell">—</td>`;
    const p = pct(v.c, v.t);
    const mix = Math.round(10 + p * 0.8); // 10〜90%
    const dark = mix > 55;
    return `<td class="hc ${bold ? "tot" : ""}" style="background:color-mix(in srgb, var(--accent) ${mix}%, var(--surface));color:${dark ? "var(--surface)" : "var(--ink)"}" title="${v.c}/${v.t}問 正解">${p}<span>${v.t}問</span></td>`;
  }

  function bindDashboard() {
    const msg = (t) => { const m = document.getElementById("io-msg"); if (m) m.textContent = t; };
    $app.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.preset) { dash.preset = b.dataset.preset; return viewDashboard(); }
      if (b.dataset.gran) { dash.gran = b.dataset.gran; return viewDashboard(); }
      if (b.dataset.practice) {
        const [s, rs] = b.dataset.practice.split("|");
        const setup = { subjects: new Set([s]), grades: new Set(GRADES), rs: new Set([rs]), count: 10, onlyWrong: false };
        lastSetup = setup; return startFromSetup(setup);
      }
      if (b.id === "more") { $app.querySelectorAll("tr.more").forEach((r) => { r.hidden = false; }); b.remove(); return; }
      if (b.id === "sample") { makeSample(); return viewDashboard(); }
      if (b.id === "lrename") return showLearnerForm("rename");
      if (b.id === "exp-csv") {
        const rows = [["学習者", "日時", "問題ID", "教科", "学年", "RSコード", "RS項目", "正誤", "選んだ答え", "解答時間(秒)"]];
        log().answers.forEach((a) => { const d = new Date(a.t); rows.push([learner().name, `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, a.q, a.s, a.g, a.rs, RS_MAP[a.rs] ? RS_MAP[a.rs].name : "", a.ok ? "正解" : "不正解", a.c, Math.round((a.ms || 0) / 100) / 10]); });
        const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
        return msg(download(`RST記録_${learner().name}_${ymd(new Date())}.csv`, csv, "text/csv") ? "CSVを書き出しました。" : "この環境では書き出しができません。");
      }
      if (b.id === "exp-json") {
        return msg(download(`RSTバックアップ_${ymd(new Date())}.json`, JSON.stringify(STORE), "application/json") ? "バックアップを書き出しました。" : "この環境では書き出しができません。");
      }
      if (b.id === "reset" || b.id === "ldel") {
        if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "もう一度押すと実行します"; b.classList.remove("ghost"); return; }
        if (b.id === "reset") { STORE.logs[STORE.current] = { answers: [], sessions: [] }; }
        else {
          STORE.learners = STORE.learners.filter((l) => l.id !== STORE.current);
          delete STORE.logs[STORE.current];
          STORE.current = STORE.learners[0].id;
        }
        save(); return viewDashboard();
      }
    };
    const lsel = document.getElementById("lsel");
    lsel.onchange = () => {
      if (lsel.value === "__new") { lsel.value = STORE.current; return showLearnerForm("new"); }
      STORE.current = lsel.value; save(); viewDashboard();
    };
    const df = document.getElementById("dfrom"), dt = document.getElementById("dto");
    if (df) df.onchange = () => { dash.from = df.value; viewDashboard(); };
    if (dt) dt.onchange = () => { dash.to = dt.value; viewDashboard(); };
    document.getElementById("imp").onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try { const n = importBackup(JSON.parse(rd.result)); viewDashboard(); msg(`読み込みました（${n}件の解答を追加）。`); }
        catch (err) { msg("読み込めませんでした。RSTのバックアップファイルか確認してください。"); }
      };
      rd.readAsText(f);
    };
  }

  function showLearnerForm(mode) {
    const box = document.getElementById("lform");
    box.innerHTML = `<form class="card lform" id="lf">
      <label for="lname">${mode === "new" ? "新しい学習者の名前" : "名前を変更"}</label>
      <input id="lname" maxlength="20" required value="${mode === "new" ? "" : esc(learner().name)}" placeholder="例：1年2組 山田">
      <button class="btn primary" type="submit">${mode === "new" ? "追加" : "変更"}</button>
      <button class="btn ghost" type="button" id="lcancel">やめる</button></form>`;
    const inp = document.getElementById("lname"); inp.focus();
    document.getElementById("lcancel").onclick = () => { box.innerHTML = ""; };
    document.getElementById("lf").onsubmit = (e) => {
      e.preventDefault();
      const name = inp.value.trim(); if (!name) return;
      if (mode === "new") { const id = uid(); STORE.learners.push({ id, name, created: Date.now() }); STORE.logs[id] = { answers: [], sessions: [] }; STORE.current = id; }
      else learner().name = name;
      save(); viewDashboard();
    };
  }

  function importBackup(data) {
    if (!data || data.version !== 2 || !Array.isArray(data.learners)) throw new Error("bad");
    let added = 0;
    data.learners.forEach((l) => {
      let mine = STORE.learners.find((x) => x.id === l.id) || STORE.learners.find((x) => x.name === l.name);
      if (!mine) { mine = { id: l.id, name: l.name, created: l.created }; STORE.learners.push(mine); STORE.logs[mine.id] = { answers: [], sessions: [] }; }
      const dst = STORE.logs[mine.id], src = data.logs[l.id] || { answers: [], sessions: [] };
      const keyA = new Set(dst.answers.map((a) => a.t + a.q));
      src.answers.forEach((a) => { if (!keyA.has(a.t + a.q)) { dst.answers.push(a); added++; } });
      const keyS = new Set(dst.sessions.map((s) => s.at));
      src.sessions.forEach((s) => { if (!keyS.has(s.at)) dst.sessions.push(s); });
      dst.answers.sort((a, b) => a.t - b.t); dst.sessions.sort((a, b) => a.at - b.at);
    });
    save();
    return added;
  }

  /* 画面確認用：架空の記録を作る */
  function makeSample() {
    const id = uid();
    STORE.learners.push({ id, name: "サンプル", created: Date.now() });
    const L = STORE.logs[id] = { answers: [], sessions: [] };
    const skill = { DEP: 0.72, ANA: 0.8, PARA: 0.55, INF: 0.5, REP: 0.68, INST_DIC: 0.75, INST_SCI: 0.45 };
    const today = startOfDay(new Date());
    for (let d = 59; d >= 0; d--) {
      if (Math.random() < 0.38) continue;
      const day = addDays(today, -d);
      const growth = (59 - d) / 59 * 0.18;
      let t = +day + (16 + Math.floor(Math.random() * 5)) * 3600000;
      const n = [5, 10, 10, 20][Math.floor(Math.random() * 4)];
      const qs = shuffle(DB).slice(0, n);
      const sess = { at: t, n, ok: 0, ms: 0, subj: [] };
      qs.forEach((q) => {
        const ok = Math.random() < Math.min(0.95, skill[q.rs_code] + growth) ? 1 : 0;
        const ms = 15000 + Math.floor(Math.random() * 60000);
        t += ms;
        L.answers.push({ t, q: q.id, s: q.subject, g: q.grade, rs: q.rs_code, ok, c: ok ? q.answer : LETTERS[(LETTERS.indexOf(q.answer) + 1) % 4], ms });
        sess.ok += ok; sess.ms += ms;
      });
      sess.end = t; sess.subj = [...new Set(qs.map((q) => q.subject))];
      L.sessions.push(sess);
    }
    STORE.current = id; save();
  }

  /* ---------- SVGグラフ（単一系列・ホバーで数値表示） ---------- */
  function chartFrame(el, data, yMax, yFmt, drawMarks) {
    const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true;
    const draw = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W) return;
      const m = { l: 40, r: 10, t: 12, b: 26 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b, n = data.length, band = iw / Math.max(1, n);
      const y = (v) => m.t + ih - (v / yMax) * ih;
      const x = (i) => m.l + band * i + band / 2;
      const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));
      const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / (W < 520 ? 44 : 52)))));
      let svg = `<svg width="${W}" height="${H}" role="img">`;
      ticks.forEach((tv) => { svg += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(tv)}" y2="${y(tv)}"/><text class="axis" x="${m.l - 6}" y="${y(tv) + 4}" text-anchor="end">${yFmt(tv)}</text>`; });
      data.forEach((d, i) => { if (i % every === 0) svg += `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`; });
      svg += drawMarks({ x, y, band, ih, m });
      data.forEach((d, i) => { svg += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/>`; });
      svg += `</svg>`;
      el.innerHTML = svg; el.appendChild(tip);
      el.querySelectorAll(".hit").forEach((h) => {
        const show = () => {
          const d = data[+h.dataset.i]; if (!d.tip) { tip.hidden = true; return; }
          tip.innerHTML = d.tip; tip.hidden = false;
          const cx = x(+h.dataset.i);
          tip.style.left = Math.min(Math.max(cx - tip.offsetWidth / 2, 0), W - tip.offsetWidth) + "px";
          tip.style.top = "0px";
          el.querySelectorAll(".mk").forEach((mk) => mk.classList.toggle("on", mk.dataset.i === h.dataset.i));
        };
        h.addEventListener("mouseenter", show); h.addEventListener("click", show);
      });
      el.onmouseleave = () => { tip.hidden = true; el.querySelectorAll(".mk.on").forEach((mk) => mk.classList.remove("on")); };
    };
    const ro = new ResizeObserver(draw); ro.observe(el);
    draw();
  }

  function niceMax(v) { if (v <= 5) return 5; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p; return 10 * p; }

  function drawBarChart(el, data) {
    const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
    chartFrame(el, data, max, (v) => v, ({ x, y, band }) => {
      const bw = Math.max(2, Math.min(26, band * 0.68));
      return data.map((d, i) => {
        if (!d.value) return "";
        const x0 = x(i) - bw / 2, y0 = y(d.value), y1 = y(0), r = Math.min(4, bw / 2, y1 - y0);
        return `<path class="mk bar" data-i="${i}" d="M${x0},${y1}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${y1}Z"/>`;
      }).join("");
    });
  }

  function drawLineChart(el, data) {
    chartFrame(el, data, 100, (v) => v + "%", ({ x, y }) => {
      let path = "", pen = false, dots = "";
      data.forEach((d, i) => {
        if (d.value == null) { pen = false; return; }
        path += `${pen ? "L" : "M"}${x(i)},${y(d.value)}`; pen = true;
        dots += `<circle class="mk dot" data-i="${i}" cx="${x(i)}" cy="${y(d.value)}" r="4"/>`;
      });
      return `<path class="line" d="${path}"/>${dots}`;
    });
  }

  /* =========================================================
     画面5: 問題一覧
     ========================================================= */
  function viewBrowse() {
    setNav("browse");
    const f = viewBrowse.f || (viewBrowse.f = { subject: "", grade: "", rs: "", batch: "", text: "" });
    const batches = [...new Set(DB.map((q) => q.batch))].sort();
    const opt = (vals, cur, all, lab) => `<option value="">${all}</option>` + vals.map((v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(lab ? lab(v) : v)}</option>`).join("");

    $app.innerHTML = `
      <h1>問題一覧</h1>
      <p class="lead">登録されている問題を確認できます。タップすると選択肢・正答・根拠が開きます。</p>
      <section class="card">
        <div class="filters">
          <select id="f-subject">${opt(SUBJECTS, f.subject, "教科：すべて")}</select>
          <select id="f-grade">${opt(GRADES, f.grade, "学年：すべて")}</select>
          <select id="f-rs">${opt(RS.map((r) => r.code), f.rs, "RS：すべて", (c) => RS_MAP[c].no + " " + RS_MAP[c].name)}</select>
          <select id="f-batch">${opt(batches, f.batch, "バッチ：すべて")}</select>
          <input id="f-text" type="search" placeholder="キーワード検索（本文・設問・単元・ID）" value="${esc(f.text)}">
        </div>
        <div class="row small muted" style="margin:6px 0 8px"><span id="b-count"></span><div class="spacer"></div><button class="btn" id="b-start">この条件で演習する</button></div>
        <ul class="q-list" id="b-list"></ul>
      </section>`;

    const filtered = () => DB.filter((q) => (!f.subject || q.subject === f.subject) && (!f.grade || q.grade === f.grade)
      && (!f.rs || q.rs_code === f.rs) && (!f.batch || q.batch === f.batch)
      && (!f.text || [q.id, q.passage, q.question, q.unit, q.field, ...q.choices].join(" ").toLowerCase().includes(f.text.toLowerCase())));

    const render = () => {
      const list = filtered();
      document.getElementById("b-count").textContent = `${list.length}問`;
      const shown = list.slice(0, 300);
      document.getElementById("b-list").innerHTML = shown.map((q) => `
        <li><details>
          <summary><span class="qid">${esc(q.id)}</span>
            <span class="qtitle">${esc(q.question)}
              <span class="tags"><span class="tag">${esc(RS_MAP[q.rs_code].no)} ${esc(RS_MAP[q.rs_code].name)}</span><span class="tag plain">${esc(q.subject)}・${esc(q.grade)}</span><span class="tag plain">${esc(q.unit)}</span>${q.review_status && q.review_status !== "OK" ? `<span class="tag plain">${esc(q.review_status)}</span>` : ""}</span>
            </span></summary>
          <div class="q-detail">
            <div class="passage ${q.subject === "英語" && isEnglishText(q.passage) ? "en" : ""}" style="font-size:15px">${esc(q.passage)}</div>
            ${q.note ? `<div class="note">${esc(q.note)}</div>` : ""}
            <ol>${q.choices.map((c, i) => `<li class="${LETTERS[i] === q.answer ? "is-ans" : ""}">${LETTERS[i]}. ${esc(c)}${LETTERS[i] === q.answer ? "　← 正答" : ""}</li>`).join("")}</ol>
            <div class="muted"><b>根拠：</b>${esc(q.explanation)}</div>
            <div class="small muted" style="margin-top:4px">難易度 ${esc(q.difficulty)}／${esc(q.batch)}${q.needs_image === "要" ? "／図版化予定" : ""}</div>
          </div>
        </details></li>`).join("") + (list.length > shown.length ? `<li class="empty">ほか ${list.length - shown.length}問（条件をしぼってください）</li>` : "")
        || `<li class="empty">条件に合う問題がありません</li>`;
    };

    ["subject", "grade", "rs", "batch"].forEach((k) => document.getElementById("f-" + k).onchange = (e) => { f[k] = e.target.value; render(); });
    document.getElementById("f-text").oninput = (e) => { f.text = e.target.value.trim(); render(); };
    $app.onclick = (e) => { if (e.target.closest("#b-start")) { const go = () => { const l = shuffle(filtered()); if (l.length) startSession(l.slice(0, 20), go); }; go(); } };
    render();
  }

  /* ---------- キーボード操作 ---------- */
  document.addEventListener("keydown", (e) => {
    if (location.hash !== "#/quiz" || !session || session.done || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    const k = e.key.toUpperCase();
    const idx = ["1", "2", "3", "4"].indexOf(k) >= 0 ? Number(k) - 1 : LETTERS.indexOf(k);
    if (!session.answered && idx >= 0) { e.preventDefault(); answer(idx); }
    else if (session.answered && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); }
  });

  /* ---------- ルーティング ---------- */
  function route() {
    const h = location.hash || "#/";
    $app.onclick = null;
    if (h === "#/quiz") viewQuiz();
    else if (h === "#/result") viewResult();
    else if (h === "#/dashboard" || h === "#/history") viewDashboard();
    else if (h === "#/browse") viewBrowse();
    else viewHome();
  }

  loadData().then(({ items, info }) => {
    DB = items.filter((q) => Array.isArray(q.choices) && q.choices.length === 4 && RS_MAP[q.rs_code]);
    Q_BY_ID = Object.fromEntries(DB.map((q) => [q.id, q]));
    document.getElementById("data-info").textContent = `登録問題数 ${DB.length}問｜${info}`;
    window.addEventListener("hashchange", route);
    route();
  }).catch((err) => {
    $app.innerHTML = `<div class="error-box"><b>問題データを読み込めませんでした。</b><br>${esc(err.message)}<br><br>
      パソコンで index.html を直接開いた場合は読み込めません。GitHub Pages で公開するか、フォルダで <code>python -m http.server</code> を実行して
      <code>http://localhost:8000</code> を開いてください。</div>`;
  });
})();
