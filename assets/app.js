/* ヨミトレ（リーディングスキルテスト形式の読解トレーニング）
   問題データ : data/manifest.json に列挙された JSON を読み込む
   学習記録   : このブラウザの localStorage に学習者ごとに保存（1問ごとに日時・正誤・解答時間） */
(function () {
  "use strict";

  const RS = [
    { code: "DEP", no: "RS1", name: "係り受け解析", nick: "骨組み読み", stamp: "骨", short: "係り受け", desc: "文の骨組み（主語・述語・修飾）をとらえる" },
    { code: "ANA", no: "RS2", name: "照応解決", nick: "指示語さがし", stamp: "指", short: "照応", desc: "指示語や省略された言葉が指すものをとらえる" },
    { code: "PARA", no: "RS3", name: "同義文判定", nick: "言いかえ判定", stamp: "言", short: "同義文", desc: "2つの文が同じ意味かを見分ける" },
    { code: "INF", no: "RS4", name: "推論", nick: "推理", stamp: "推", short: "推論", desc: "書かれていることから確実にいえることを導く" },
    { code: "REP", no: "RS5", name: "イメージ同定", nick: "図とマッチ", stamp: "図", short: "イメージ", desc: "文章と図・表・グラフを対応づける" },
    { code: "INST_DIC", no: "RS6", name: "具体例同定（辞書）", nick: "ことばの例さがし", stamp: "例", short: "具体例(辞書)", desc: "言葉の定義に合う例を選ぶ" },
    { code: "INST_SCI", no: "RS7", name: "具体例同定（理数）", nick: "法則の例さがし", stamp: "法", short: "具体例(理数)", desc: "法則や定義にあてはまる例を選ぶ" },
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
  let PASSAGES = [];   // 長文読解
  let lsession = null; // 長文読解の進行状態
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
     XP・レベル・バッジ（学習記録から計算。保存形式は変えない）
     ========================================================= */
  const XP_OK = 10, XP_NG = 3, XP_LONG = 20;
  const xpOf = (answers, sessions) => answers.reduce((s, a) => s + (a.ok ? XP_OK : XP_NG), 0) + sessions.filter((x) => x.mode === "L").length * XP_LONG;
  const totalXP = () => xpOf(log().answers, log().sessions);
  const levelStart = (L) => 50 * L * (L - 1);           // Lv.L になるのに必要な累計XP
  const levelOf = (xp) => Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * xp)) / 2));
  function levelInfo(xp) {
    const L = levelOf(xp), a = levelStart(L), b = levelStart(L + 1);
    return { L, cur: xp - a, need: b - a, pct: Math.round(((xp - a) / (b - a)) * 100) };
  }
  function longestStreak() {
    const days = [...new Set(log().answers.map((a) => ymd(new Date(a.t))))].sort();
    let best = 0, run = 0, prev = null;
    days.forEach((d) => { const t = +parseYmd(d); run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = t; });
    return best;
  }
  const BADGES = [
    { id: "first", stamp: "初", name: "はじめの一歩", how: "1問解く", test: (c) => c.n >= 1 },
    { id: "n100", stamp: "百", name: "100問チャレンジ", how: "合計100問解く", test: (c) => c.n >= 100 },
    { id: "n1000", stamp: "千", name: "1000問マスター", how: "合計1000問解く", test: (c) => c.n >= 1000 },
    { id: "s3", stamp: "連", name: "3日れんぞく", how: "3日続けて解く", test: (c) => c.streak >= 3 },
    { id: "s7", stamp: "週", name: "1週間れんぞく", how: "7日続けて解く", test: (c) => c.streak >= 7 },
    { id: "perfect", stamp: "満", name: "パーフェクト", how: "5問以上を全問正解", test: (c) => c.perfect },
    { id: "long1", stamp: "長", name: "長文デビュー", how: "長文読解を1回やりとげる", test: (c) => c.longN >= 1 },
    { id: "long10", stamp: "読", name: "長文10本", how: "ちがう長文を10本読む", test: (c) => c.longKinds >= 10 },
    ...RS.map((r) => ({ id: "rs_" + r.code, stamp: r.stamp, name: `${r.nick}の達人`, how: `${r.nick}を20問以上解き、正答率80%以上`, test: (c) => c.rs[r.code] && c.rs[r.code].t >= 20 && c.rs[r.code].c / c.rs[r.code].t >= 0.8 })),
  ];
  function badgeContext() {
    const A = log().answers, S = log().sessions, rs = {};
    A.forEach((a) => { (rs[a.rs] = rs[a.rs] || { c: 0, t: 0 }); rs[a.rs].t++; rs[a.rs].c += a.ok; });
    const L = S.filter((s) => s.mode === "L");
    return { n: A.length, streak: longestStreak(), perfect: S.some((s) => s.n >= 5 && s.ok === s.n), longN: L.length, longKinds: new Set(L.map((s) => s.p)).size, rs };
  }
  const earnedBadges = () => { const c = badgeContext(); return new Set(BADGES.filter((b) => b.test(c)).map((b) => b.id)); };
  function badgesHTML(earned, fresh, opt) {
    opt = opt || {};
    let list = opt.only ? BADGES.filter((b) => opt.only.has(b.id)) : BADGES.slice();
    if (opt.limit) list = list.filter((b) => earned.has(b.id)).concat(list.filter((b) => !earned.has(b.id))).slice(0, opt.limit);
    return `<div class="stamps ${opt.only ? "only-on" : ""}">${list.map((b) => {
      const on = earned.has(b.id), isNew = fresh && fresh.has(b.id);
      return `<div class="stamp ${on ? "on" : ""} ${isNew ? "new" : ""}" title="${esc(b.name)}：${esc(b.how)}">
        <span class="stamp-face" aria-hidden="true">${esc(b.stamp)}</span>
        <span class="stamp-name">${on ? esc(b.name) : "？？？"}</span>
        <span class="stamp-how">${esc(b.how)}</span></div>`;
    }).join("")}</div>`;
  }
  const snapshot = () => ({ xp: totalXP(), badges: earnedBadges() });
  const starsOf = (c, n) => { const p = n ? c / n : 0; return p >= 0.9 ? 3 : p >= 0.7 ? 2 : p >= 0.4 ? 1 : 0; };
  function rewardHTML(before, c, n) {
    const after = snapshot();
    const gain = after.xp - before.xp;
    const lvB = levelOf(before.xp), info = levelInfo(after.xp);
    const fresh = new Set([...after.badges].filter((id) => !before.badges.has(id)));
    const stars = starsOf(c, n);
    const msg = stars === 3 ? "すばらしい！ かんぺきに読めています" : stars === 2 ? "いい調子！ もう少しで満点" : stars === 1 ? "その調子。まちがえた所をふり返ろう" : "根拠の文をたしかめて、もう一度やってみよう";
    return `<section class="card reward">
      ${stars === 3 ? `<div class="confetti" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.12}s;--r:${(i * 53) % 360}deg"></i>`).join("")}</div>` : ""}
      <div class="stars" aria-label="星${stars}つ">${[1, 2, 3].map((k) => `<span class="star ${k <= stars ? "on" : ""}" style="--k:${k}">★</span>`).join("")}</div>
      <div class="score-line"><span class="score-big">${c}</span><span class="score-of">/ ${n}問 正解</span></div>
      <p class="reward-msg">${msg}</p>
      <div class="xp-gain"><b>+${gain} XP</b>${info.L > lvB ? `<span class="lvup">レベルアップ！ Lv.${info.L}</span>` : ""}</div>
      <div class="lv-row"><span class="lv-badge">Lv.${info.L}</span><div class="xpbar"><span style="width:${info.pct}%"></span></div><span class="small muted">次のレベルまで ${info.need - info.cur} XP</span></div>
      ${fresh.size ? `<div class="new-badges"><div class="nb-title">新しいバッジをゲット！</div>${badgesHTML(fresh, fresh, { only: fresh })}</div>` : ""}
    </section>`;
  }


  /* =========================================================
     考え方のアドバイス（スキル別・設問のパターン別）
     ========================================================= */
  const TIPS = {
    DEP: { lead: "文の骨組みをつかむ", steps: [
        "まず文の最後にある述語（「〜した」「〜だ」）を見つける。",
        "述語から「だれが・何が」をさかのぼって探す。「は」「が」のついた言葉が目印。",
        "「〜の」「〜した」のように、ほかの言葉をくわしくしている部分は、いったん外して読む。"],
      check: "選んだのは、述語と直接つながる言葉だった？ くわしくしている部分の中の言葉を選んでいないか見直そう。" },
    ANA: { lead: "指示語が指すものを見つける", steps: [
        "指示語（これ・それ・その・そこ など）の答えは、たいてい直前の文や言葉にある。",
        "見つけた候補を、指示語の場所に入れて読んでみる。意味が通れば正解に近い。",
        "主語が書かれていない文は、前の文の主語が続いていることが多い。"],
      check: "選んだ答えを指示語の場所に入れて、もう一度読んでみよう。意味が通らなかったら、さらに前の文を見よう。" },
    PARA: { lead: "同じ意味の文を見分ける", steps: [
        "基準文の「だれが・何を・どうした」を書き出す。",
        "選択肢と1つずつ比べる。受け身（〜される）、否定（〜ない）、比べる向き（より・ほど）が入れかわっていないか注意する。",
        "同じ言葉が使われていても、関係が逆になっていれば別の意味。"],
      check: "言葉が似ているだけで選んでいない？「だれが」「何を」の関係が、基準文と同じか確かめよう。" },
    INF: { lead: "書かれていることから確実に考える", steps: [
        "本文に書いてあることだけを根拠にする。常識や想像で足さない。",
        "「必ず」「すべて」「まったく」など、言いすぎの言葉がある選択肢は要注意。",
        "選んだ答えの根拠になる文を、本文の中で指させるか確かめる。"],
      check: "その答えの根拠を、本文の中で指させる？ 本文にないことを足していないか見直そう。" },
    REP: { lead: "文章と図・表を対応させる", steps: [
        "本文の数・順番・位置を、メモや簡単な図に書き出す。",
        "選択肢と、1つの項目ずつ比べる（いちばん大きいもの、順番、上下左右など）。",
        "計算が必要なときは、途中の数も書いておく。"],
      check: "本文の数や順番を書き出して、選択肢と1つずつ比べ直そう。1か所だけちがう選択肢に注意。" },
    INST_DIC: { lead: "定義にあてはまる例を選ぶ", steps: [
        "定義を「〜で、〜なもの」のように、いくつかの条件に分ける。",
        "選択肢が、条件を全部満たしているか1つずつ確かめる。",
        "名前やふんいきが似ているだけの選択肢に注意する。"],
      check: "定義の条件を全部満たしているか、1つずつチェックしよう。1つでも合わない条件があれば×。" },
    INST_SCI: { lead: "法則や式にあてはめる", steps: [
        "式や法則のどこに、どの数を入れるのかを先に確かめる。",
        "単位（cmとm、分と秒など）をそろえてから計算する。",
        "答えが大きすぎたり小さすぎたりしないか、だいたいの数で見積もる。"],
      check: "式のどこにどの数を入れたか、単位がそろっているかを見直そう。" },
  };
  const PATTERN_TIPS = [
    [/主語と述語/, "述語（文の最後の「〜した」「〜だ」）を先に見つけ、「だれが・何が」そうしたのかをさかのぼって探そう。途中の「〜した」「〜の」は、くわしくしているだけの部分。"],
    [/指す|指示語|「これ」|「それ」|「その」|「この」|「そこ」|「そう」|「こう」/, "指示語の答えは、たいてい直前にある。見つけた言葉を指示語の場所に入れて読み、意味が通るか確かめよう。"],
    [/同じ意味|同じ内容|言いかえ/, "基準文の「だれが・何を・どうした」を、選択肢と1つずつ比べよう。受け身（〜される）、否定（〜ない）、比べる向き（より・ほど）が入れかわっていないか注意。"],
    [/確実にいえる|確実に/, "「確実にいえる」は、本文だけで100%言えるもの。本文にない情報を足している選択肢や、「必ず」「すべて」のような言いすぎの選択肢は×。"],
    [/理由|なぜ/, "「〜から」「〜ため」「そのため」「なぜなら」など、理由を表す言葉の近くに答えがあることが多い。"],
    [/気持ち|心情|思い/, "人物の行動・表情・せりふ（ため息、目を細める、手がふるえる など）が気持ちのヒント。自分ならどう感じるかではなく、本文の様子から考えよう。"],
    [/要旨|筆者の考え|伝えたい|主張/, "筆者の考えは、最後の段落や「〜が大切だ」「〜べきだ」「〜のである」の文にまとまっていることが多い。一部分だけの内容や、言いすぎの選択肢に注意。"],
    [/段落の役割|目的|例をあげた|構成|順番として/, "その段落や例が、前後とどうつながるかを考えよう。例のすぐ前後に、例で言いたいことがまとめて書いてあることが多い。"],
    [/グラフ|表|図|年表|柱状図|配置|位置|様子として正しい|座り方/, "本文の数・順番・位置を、メモや図に書き出してから、選択肢と1つずつ比べよう。"],
    [/のはだれ|は何ですか|のは何|はどこ/, "その動作をしている人・物を探すときは、述語から「は」「が」のついた言葉へさかのぼろう。くわしくしている部分にまどわされないように。"],
    [/例として正しい|にあたるもの|あてはまる|例を選び/, "定義をいくつかの条件に分けて、選択肢がその条件を全部満たすか確かめよう。名前が似ているだけのものに注意。"],
  ];
  function tipFor(q) {
    const t = TIPS[q.rs_code] || TIPS.INF;
    const text = (q.question || "") + " " + (q.kind || "");
    const hit = q.rs_code === "INST_SCI" ? null : PATTERN_TIPS.find(([re]) => re.test(text));
    return { lead: t.lead, point: hit ? hit[1] : t.steps[0], check: t.check, steps: t.steps };
  }
  function adviceHTML(q, ok) {
    const t = tipFor(q);
    return ok
      ? `<details class="advice ok"><summary>考え方のポイント</summary><p>${esc(t.point)}</p></details>`
      : `<div class="advice"><div class="advice-h">次はここに気をつけよう</div><p class="advice-point">${esc(t.point)}</p><p class="advice-check">${esc(t.check)}</p></div>`;
  }

  /* ---------- 足場かけ：同じスキルで、より易しい問題を選ぶ ---------- */
  function easierFor(q, exclude, grade) {
    const maxD = Math.max(1, (q.difficulty || 2) - 1);
    const subj = q.subject || "国語";
    let pool = DB.filter((x) => x.rs_code === q.rs_code && x.id !== q.id && !exclude.has(x.id) && (x.difficulty || 2) <= maxD
      && (!grade || x.grade <= grade));
    if (!pool.length) pool = DB.filter((x) => x.rs_code === q.rs_code && x.id !== q.id && !exclude.has(x.id) && (x.difficulty || 2) <= maxD);
    if (!pool.length) return null;
    const score = (x) => (x.subject === subj ? 4 : 0) + (x.unit && x.unit === q.unit ? 3 : 0) + (x.field && x.field === q.field ? 1 : 0) + (x.grade <= (q.grade || "中3") ? 1 : 0) + Math.random() * 1.5;
    return pool.map((x) => [score(x), x]).sort((a, b) => b[0] - a[0])[0][1];
  }
  function scaffoldSet(wrongQs, grade) {
    const used = new Set(wrongQs.map((q) => q.id)), out = [];
    wrongQs.forEach((q) => { const e = easierFor(q, used, grade); if (e) { used.add(e.id); out.push(e); } });
    return out;
  }

  let QMAP = null;
  const qById = (id) => { if (!QMAP || QMAP.size !== DB.length) QMAP = new Map(DB.map((q) => [q.id, q])); return QMAP.get(id); };
  // まちがえた問題に「近い」問題を選ぶ（同じ教科・単元を優先）
  function nearScore(x, refs) {
    let best = 0;
    refs.forEach((q) => { best = Math.max(best, (x.subject === q.subject ? 4 : 0) + (x.unit && x.unit === q.unit ? 3 : 0) + (x.field && x.field === q.field ? 1 : 0)); });
    return best + Math.random() * 1.5;
  }
  function pickNear(refs, filter, n, used) {
    const seen = seenSet();
    return DB.filter((x) => filter(x) && !used.has(x.id))
      .map((x) => [nearScore(x, refs) + (seen.has(x.id) ? 0 : 2), x])
      .sort((a, b) => b[0] - a[0]).slice(0, n).map((p) => { used.add(p[1].id); return p[1]; });
  }

  /* =========================================================
     学習ルート：診断 → 補充 → 確認
     ========================================================= */
  const DIAG_PER_RS = 2, REVIEW_N = 5, CHECK_N = 5, PASS = 4;
  const getRoute = () => log().route || null;
  function seenSet() { return new Set(log().answers.map((a) => a.q)); }
  function pickQs(filter, n, preferUnseen) {
    const seen = preferUnseen ? seenSet() : new Set();
    const pool = shuffle(DB.filter(filter));
    const fresh = pool.filter((q) => !seen.has(q.id)), old = pool.filter((q) => seen.has(q.id));
    // 教科がかたよらないように、教科ごとに順番に取る
    const bySub = {};
    fresh.concat(old).forEach((q) => { (bySub[q.subject] = bySub[q.subject] || []).push(q); });
    const subs = shuffle(Object.keys(bySub)), out = [];
    while (out.length < n && subs.some((s) => bySub[s].length)) subs.forEach((s) => { if (out.length < n && bySub[s].length) out.push(bySub[s].shift()); });
    return out;
  }
  function startDiagnosis(grade) {
    const qs = [];
    RS.forEach((r) => {
      let got = pickQs((q) => q.rs_code === r.code && q.grade <= grade && q.difficulty === 2, DIAG_PER_RS, true);
      if (got.length < DIAG_PER_RS) got = got.concat(pickQs((q) => q.rs_code === r.code && q.grade <= grade && !got.includes(q), DIAG_PER_RS - got.length, true));
      qs.push(...got);
    });
    log().route = { v: 1, grade, startedAt: Date.now(), diag: null, weak: [], items: {} };
    save();
    startSession(shuffle(qs), null, { kind: "diag" });
  }
  // 補充で解き直す問題（まだ正解できていない、まちがえた問題。最大2問）
  function retryTargets(rs) {
    const R = getRoute(), it = R && R.items[rs];
    if (!it || !it.missed) return [];
    const fixed = it.fixed || [];
    return it.missed.filter((id) => !fixed.includes(id)).map(qById).filter(Boolean).slice(0, 2);
  }
  function startReview(rs) {
    const R = getRoute(); if (!R) return;
    const it = R.items[rs] || {};
    const retry = retryTargets(rs);
    const refs = retry.length ? retry : (it.missed || []).map(qById).filter(Boolean);
    const used = new Set((it.missed || []).concat(it.exId ? [it.exId] : []));
    const inGrade = (q) => q.rs_code === rs && q.grade <= R.grade;
    let easy = [];
    // まず、まちがえた問題1問ごとに、それより易しい近い問題を選ぶ
    refs.forEach((q) => { const e = easierFor(q, used, R.grade); if (e && easy.length < 3) { used.add(e.id); easy.push(e); } });
    easy = easy.concat(pickNear(refs, (q) => inGrade(q) && q.difficulty === 1, 3 - easy.length, used));
    let normal = pickNear(refs, (q) => inGrade(q) && q.difficulty === 2, 2, used);
    let qs = easy.concat(normal);
    if (qs.length < REVIEW_N) qs = qs.concat(pickNear(refs, (q) => q.rs_code === rs, REVIEW_N - qs.length, used));
    // 最後に、まちがえた問題そのものにもう一度挑戦
    startSession(qs.concat(retry), null, { kind: "review", rs, retryIds: retry.map((q) => q.id) });
  }
  function startCheck(rs) {
    const R = getRoute(); if (!R) return;
    const avoid = new Set((R.items[rs] && R.items[rs].missed) || []);
    let qs = pickQs((q) => q.rs_code === rs && q.grade <= R.grade && q.difficulty >= 2 && !avoid.has(q.id), CHECK_N, true);
    if (qs.length < CHECK_N) qs = qs.concat(pickQs((q) => q.rs_code === rs && q.difficulty >= 2 && !qs.includes(q), CHECK_N - qs.length, true));
    startSession(shuffle(qs), null, { kind: "check", rs });
  }
  function applyRoute(meta, res) {
    const R = getRoute(); if (!R || !meta) return null;
    const byRs = {};
    res.forEach((r) => { (byRs[r.rs] = byRs[r.rs] || { c: 0, t: 0 }); byRs[r.rs].t++; byRs[r.rs].c += r.ok ? 1 : 0; });
    const out = { kind: meta.kind, rs: meta.rs };
    if (meta.kind === "diag") {
      R.diag = { at: Date.now(), byRs };
      R.weak = RS.map((r) => r.code).filter((c) => byRs[c] && byRs[c].c < byRs[c].t);
      R.items = Object.fromEntries(R.weak.map((c) => [c, { stage: "review", round: 1, hist: [],
        missed: res.filter((r) => r.rs === c && !r.ok).map((r) => r.id), fixed: [] }]));
      out.weak = R.weak;
    } else if (R.items[meta.rs]) {
      const it = R.items[meta.rs], s = byRs[meta.rs] || { c: 0, t: 0 };
      it.hist.push({ kind: meta.kind, at: Date.now(), c: s.c, t: s.t });
      it.missed = it.missed || []; it.fixed = it.fixed || [];
      if (meta.kind === "review") {
        it.stage = "check";
        const retry = meta.retryIds || [];
        out.retry = res.filter((r) => retry.includes(r.id)).map((r) => ({ id: r.id, ok: r.ok }));
        out.retry.forEach((r) => { if (r.ok && !it.fixed.includes(r.id)) it.fixed.push(r.id); });
        out.leftCount = it.missed.filter((id) => !it.fixed.includes(id)).length;
      }
      if (meta.kind === "check") {
        out.pass = s.c >= Math.min(PASS, s.t);
        if (out.pass) { it.stage = "done"; it.doneAt = Date.now(); }
        else {
          it.stage = "review"; it.round++;
          // 確認テストでまちがえた問題も、次の補充の「解き直し」の対象にする
          const newMiss = res.filter((r) => r.rs === meta.rs && !r.ok).map((r) => r.id);
          it.missed = it.missed.filter((id) => !it.fixed.includes(id)).concat(newMiss.filter((id) => !it.missed.includes(id))).slice(0, 3);
          it.fixed = [];
        }
      }
      out.c = s.c; out.t = s.t;
    }
    save();
    return out;
  }
  function routeNext() {
    const R = getRoute();
    if (!R || !R.diag) return { step: 0 };
    const todo = R.weak.filter((c) => R.items[c] && R.items[c].stage !== "done");
    if (!todo.length) return { step: 3, done: true };
    const c = todo[0], st = R.items[c].stage;
    return { step: st === "review" ? 1 : 2, rs: c, stage: st };
  }
  function stepperHTML(step, done) {
    const names = ["診断", "補充", "確認"];
    return `<ol class="stepper">${names.map((n, i) => {
      const cls = done || step > i ? "done" : step === i ? "now" : "";
      return `<li class="${cls}"><span class="st-dot">${done || step > i ? "✓" : i + 1}</span><span class="st-name">${n}</span></li>`;
    }).join("")}</ol>`;
  }
  function nextActionHTML() {
    const n = routeNext(), R = getRoute();
    if (n.step === 0) return `<button class="btn primary lg" data-go="route">診断テストを受ける（${RS.length * DIAG_PER_RS}問）</button>`;
    if (n.done) return `<div class="small">補充したスキルを、すべて習得しました。</div><button class="btn primary" data-go="route">もう一度診断する</button>`;
    const r = RS_MAP[n.rs];
    return n.stage === "review"
      ? `<div class="small">次は「<b>${esc(r.nick)}</b>」の補充${R.items[n.rs].round > 1 ? `（${R.items[n.rs].round}回目）` : ""}</div><button class="btn primary lg" data-lesson="${n.rs}">コツを見て練習する</button>`
      : `<div class="small">次は「<b>${esc(r.nick)}</b>」の確認テスト（${CHECK_N}問中${PASS}問で合格）</div><button class="btn primary lg" data-check="${n.rs}">確認テストを受ける</button>`;
  }
  function bindRouteButtons(e) {
    const b = e.target.closest("[data-go],[data-lesson],[data-check],[data-review]");
    if (!b) return false;
    if (b.dataset.go === "route") { location.hash = "#/route"; return true; }
    if (b.dataset.lesson) { lessonRs = b.dataset.lesson; location.hash = "#/lesson"; return true; }
    if (b.dataset.review) { startReview(b.dataset.review); return true; }
    if (b.dataset.check) { startCheck(b.dataset.check); return true; }
    return false;
  }

  function viewRoute() {
    setNav("home");
    const R = getRoute(), n = routeNext();
    const gradeSel = (R && R.grade) || "中1";
    $app.innerHTML = `
      <h1>学習ルート</h1>
      <p class="lead">「診断」で苦手なスキルを見つけ、「補充」でコツをつかみ、「確認」で身についたかを確かめます。</p>
      <section class="card route-main">
        ${stepperHTML(n.step, n.done)}
        ${!R || !R.diag || n.done ? `
          <div class="diag-start">
            <h2>診断テスト</h2>
            <p class="small muted">7つのスキルを2問ずつ、全${RS.length * DIAG_PER_RS}問。今の学年までの問題から出ます。</p>
            <div class="field-label">学年</div>
            <div class="chips" id="gsel">${GRADES.map((g) => `<button class="chip" data-g="${g}" aria-pressed="${g === gradeSel}">${g}</button>`).join("")}</div>
            <div style="margin-top:16px"><button class="btn primary lg" id="dstart">診断テストをはじめる</button></div>
          </div>` : `<div class="next-box">${nextActionHTML()}</div>`}
      </section>
      ${R && R.diag ? `<section class="card">
        <div class="row" style="margin-bottom:10px"><h2 style="margin:0">診断の結果</h2><div class="spacer"></div><span class="small muted">${fmtDateTime(R.diag.at)}（${esc(R.grade)}）</span></div>
        <div class="route-list">${RS.map((r) => {
          const d = R.diag.byRs[r.code] || { c: 0, t: 0 }, it = R.items[r.code];
          const st = !it ? "ok" : it.stage;
          const label = { ok: "合格", review: "補充する", check: "確認する", done: "習得！" }[st];
          const act = st === "review" ? `<button class="btn small-btn" data-lesson="${r.code}">補充する</button>` : st === "check" ? `<button class="btn small-btn primary" data-check="${r.code}">確認する</button>` : "";
          return `<div class="rl-item ${st}"><div class="rl-main"><b>${esc(r.nick)}</b><span class="small muted">診断 ${d.c}/${d.t}${it && it.hist.length ? `・補充 ${it.hist.filter((h) => h.kind === "review").length}回` : ""}${it && it.missed && it.missed.length && st !== "done" ? `・解き直し ${(it.fixed || []).length}/${it.missed.length}問クリア` : ""}</span></div>
            ${act || `<span class="rl-state">${label}</span>`}</div>`;
        }).join("")}</div>
      </section>` : ""}`;
    let g = gradeSel;
    $app.onclick = (e) => {
      if (bindRouteButtons(e)) return;
      const gb = e.target.closest("[data-g]");
      if (gb) { g = gb.dataset.g; $app.querySelectorAll("[data-g]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.g === g)); return; }
      if (e.target.closest("#dstart")) startDiagnosis(g);
    };
  }

  let lessonRs = null;
  function viewLesson() {
    setNav("home");
    const R = getRoute();
    if (!R || !lessonRs || !RS_MAP[lessonRs]) { location.hash = "#/route"; return; }
    const r = RS_MAP[lessonRs], t = TIPS[lessonRs];
    const it = R.items[lessonRs] || {};
    const retry = retryTargets(lessonRs);
    const refs = retry.length ? retry : (it.missed || []).map(qById).filter(Boolean);
    const exUsed = new Set(it.missed || []);
    const ex = (refs[0] && easierFor(refs[0], exUsed, R.grade))
      || pickQs((q) => q.rs_code === lessonRs && q.difficulty === 1 && q.grade <= R.grade, 1, true)[0] || pickQs((q) => q.rs_code === lessonRs, 1, false)[0];
    if (ex && R.items[lessonRs]) { R.items[lessonRs].exId = ex.id; save(); }
    const nPlay = REVIEW_N + retry.length;
    const ai = ex ? LETTERS.indexOf(ex.answer) : -1;
    $app.innerHTML = `
      <p class="result-title">補充：${esc(r.nick)}<span class="small muted">（${esc(r.no)} ${esc(r.name)}）</span></p>
      <section class="card lesson">
        <h1 class="lesson-h"><span class="hl">${esc(t.lead)}</span>コツ</h1>
        <ol class="tips">${t.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      </section>
      ${retry.length ? `<section class="card missed-card">
        <div class="worked-h miss">まちがえた問題</div>
        <ul class="missed-list">${retry.map((q) => `<li><span class="small muted">${esc(q.subject)}・${esc(q.grade)}・${esc(q.unit || q.field || "")}</span><br>${esc(q.question)}</li>`).join("")}</ul>
        <p class="small muted">この問題に近い、易しい問題から練習します。最後にこの問題にもう一度挑戦します。</p>
      </section>` : ""}
      ${ex ? `<section class="card worked">
        <div class="worked-h">例題で確かめよう</div>
        <div class="passage ${ex.subject === "英語" && isEnglishText(ex.passage) ? "en" : ""}"><div class="passage-label">${passageLabel(ex.rs_code)}</div>${esc(ex.passage)}</div>
        ${ex.note ? `<div class="note">${esc(ex.note)}</div>` : ""}
        <div class="question">${esc(ex.question)}</div>
        <div class="choices">${ex.choices.map((c, i) => `<div class="choice ${i === ai ? "correct" : "dim"}"><span class="key">${LETTERS[i]}</span><span class="txt ${i === ai ? "hl-on" : ""}">${esc(c)}</span></div>`).join("")}</div>
        <div class="feedback ok"><div class="verdict">考え方</div>
          <div class="basis"><b>根拠：</b>${esc(ex.explanation)}</div>
          <p class="advice-point" style="margin:8px 0 0">${esc(tipFor(ex).point)}</p></div>
      </section>` : ""}
      <div class="row center-row">
        <button class="btn primary lg" data-review="${lessonRs}">練習をはじめる（${REVIEW_N}問${retry.length ? `＋解き直し${retry.length}問` : ""}）</button>
        <a class="btn ghost" href="#/route">ルートにもどる</a>
      </div>
      <p class="small muted center">易しい問題 → ふつうの問題${retry.length ? " → まちがえた問題の解き直し" : ""}の順に出ます。まちがえても、アドバイスを読んで次に生かそう。</p>`;
    $app.onclick = (e) => { bindRouteButtons(e); };
  }

  function routeResultHTML(out, res) {
    if (!out) return "";
    if (out.kind === "diag") {
      const w = out.weak || [];
      return `<section class="card route-banner">
        ${stepperHTML(w.length ? 1 : 3, !w.length)}
        <h2>診断の結果</h2>
        ${w.length ? `<p>補充するスキル：${w.map((c) => `<b class="pill">${esc(RS_MAP[c].nick)}</b>`).join(" ")}</p>
          <p class="small muted">まずコツと例題を見てから、易しい問題で練習しよう。</p>
          <button class="btn primary lg" data-lesson="${w[0]}">「${esc(RS_MAP[w[0]].nick)}」の補充をはじめる</button>`
        : `<p>すべてのスキルで2問とも正解！ 長文読解やチャレンジで、さらに力をのばそう。</p><a class="btn primary" href="#/long">長文読解へ</a>`}
      </section>`;
    }
    const r = RS_MAP[out.rs];
    if (out.kind === "review") return `<section class="card route-banner">
        ${stepperHTML(2)}
        <h2>「${esc(r.nick)}」の補充おわり</h2>
        ${out.retry && out.retry.length ? `<div class="retry-box"><div class="small"><b>まちがえた問題の解き直し</b></div>
          <ul class="retry-list">${out.retry.map((x) => { const q = qById(x.id); return `<li class="${x.ok ? "ok" : "ng"}"><span class="mark ${x.ok ? "ok" : "ng"}">${x.ok ? "○" : "×"}</span><span>${esc(q ? q.question : x.id)}<br><b class="small">${x.ok ? "今回は正解できた！" : "まだ。根拠をもう一度読もう"}</b></span></li>`; }).join("")}</ul></div>` : ""}
        <p class="small muted">次は、まだ解いていない問題で確認テスト。${CHECK_N}問中${PASS}問正解で「習得」です。${out.leftCount ? `（解き直しできなかった問題は、確認テストのあとにもう一度出ます）` : ""}</p>
        <button class="btn primary lg" data-check="${out.rs}">確認テストを受ける</button>
      </section>`;
    if (out.kind === "check") {
      const n = routeNext();
      return `<section class="card route-banner ${out.pass ? "pass" : ""}">
        ${stepperHTML(out.pass ? 3 : 1, out.pass)}
        <h2>${out.pass ? `「${esc(r.nick)}」を習得！` : `「${esc(r.nick)}」はあと少し`}</h2>
        <p class="small muted">${out.pass ? `確認テスト ${out.c}/${out.t}問 正解。` : `確認テスト ${out.c}/${out.t}問 正解（合格は${PASS}問）。もう一度コツを確かめて練習しよう。`}</p>
        ${out.pass ? (n.done ? `<p>補充したスキルを、すべて習得しました。</p><a class="btn primary" href="#/route">学習ルートを見る</a>` : `<div class="next-box">${nextActionHTML()}</div>`)
          : `<button class="btn primary lg" data-lesson="${out.rs}">もう一度補充する</button>`}
      </section>`;
    }
    return "";
  }
  const KIND_LABEL = { diag: "診断", review: "補充", check: "確認", scaffold: "やさしい問題", retry: "再挑戦" };

  /* =========================================================
     データ読み込み
     ========================================================= */
  async function loadData() {
    if (Array.isArray(window.RST_EMBEDDED_DATA)) return { items: window.RST_EMBEDDED_DATA, passages: window.RST_EMBEDDED_PASSAGES || [], info: "埋め込みデータ" };
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
    let passages = [];
    if (manifest.passages && manifest.passages.path) {
      try { const r = await fetch(manifest.passages.path, { cache: "no-store" }); if (r.ok) passages = await r.json(); }
      catch (e) { console.warn("長文データを読み込めませんでした", e); }
    }
    const d = manifest.generated_at ? new Date(manifest.generated_at) : null;
    return { items, passages, info: `データ更新: ${d ? d.toLocaleDateString("ja-JP") : "-"}` };
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
    const xp = totalXP(), lv = levelInfo(xp), st = streak();
    const allA = log().answers, my = aggregate(allA);
    const earned = earnedBadges();
    const todayN = allA.filter((a) => a.t >= +startOfDay(new Date())).length;

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
      <section class="hero">
        <div class="hero-top">
          <div>
            <p class="hello">${esc(learner().name)}さん、${todayN ? `今日は${todayN}問解いたね` : "今日も読みにいこう"}</p>
            <h1 class="wordmark"><span class="hl">ヨミトレ</span></h1>
            <p class="tagline">文章を正しく読む力を、1問ずつきたえよう。</p>
          </div>
          <div class="streak ${st ? "on" : ""}" title="続けて学習した日数"><span class="streak-num">${st}</span><span class="streak-lbl">日れんぞく</span></div>
        </div>
        <div class="lv-row"><span class="lv-badge">Lv.${lv.L}</span><div class="xpbar"><span style="width:${lv.pct}%"></span></div><span class="small">${xp} XP</span></div>
      </section>

      <section class="card route-card">
        <div class="row" style="margin-bottom:6px"><h2 style="margin:0">学習ルート</h2><div class="spacer"></div><a class="small" href="#/route">くわしく見る</a></div>
        ${(() => { const n = routeNext(); return stepperHTML(n.step, n.done); })()}
        <div class="next-box">${nextActionHTML()}</div>
      </section>

      <button class="quick" id="quick">
        <span class="quick-main"><b>10問チャレンジ</b><span>自由練習：全教科からランダムに出題</span></span>
        <span class="quick-go" aria-hidden="true">スタート</span>
      </button>

      <details class="card setup" ${lastSetup.opened ? "open" : ""} id="setupbox">
        <summary><b>教科やスキルをえらんで解く</b><span class="small muted">教科・学年・スキル・問題数</span></summary>
        <div class="setup-body">
          ${chipGroup("教科", "subjects", SUBJECTS)}
          ${chipGroup("学年", "grades", GRADES)}
          ${chipGroup("スキル", "rs", RS.map((r) => r.code), (c) => `${RS_MAP[c].nick}`)}
          <div class="field-group">
            <div class="field-label">問題数</div>
            <div class="chips">${[5, 10, 20, 0].map((n) => `
              <button class="chip" data-count="${n}">${n ? n + "問" : "すべて"}</button>`).join("")}
              <button class="chip" data-wrong>前回まちがえた問題だけ</button>
            </div>
          </div>
          <div class="row" style="margin-top:16px">
            <div class="match" id="match"></div>
            <div class="spacer"></div>
            <button class="btn primary lg" id="start">この条件でスタート</button>
          </div>
        </div>
      </details>

      ${PASSAGES.length ? `<a class="card long-promo" href="#/long">
        <span class="lp-badge" aria-hidden="true">長文</span>
        <span class="lp-body"><b>長文読解</b><span class="small muted">600〜800字の文章を読んで、5問に答える（${PASSAGES.length}文章）</span></span>
        <span class="lp-arrow" aria-hidden="true">›</span></a>` : ""}

      <section class="card">
        <div class="row" style="margin-bottom:10px"><h2 style="margin:0">わたしのスキル</h2><div class="spacer"></div><span class="small muted">これまでの正答率</span></div>
        ${barsHTML(my.byRs)}
        ${my.n ? "" : `<p class="small muted" style="margin:10px 0 0">問題を解くと、スキルごとの正答率がここに出ます。</p>`}
      </section>

      <section class="card">
        <div class="row" style="margin-bottom:10px"><h2 style="margin:0">バッジ</h2><div class="spacer"></div><a class="small" href="#/dashboard">${earned.size} / ${BADGES.length}　すべて見る</a></div>
        ${badgesHTML(earned, null, { limit: 6 })}
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
    document.getElementById("setupbox").addEventListener("toggle", (e) => { setup.opened = e.target.open; });

    $app.onclick = (e) => {
      if (bindRouteButtons(e)) return;
      const t = e.target.closest("button");
      if (!t) return;
      if (t.id === "quick") { const q = defaultSetup(); return startFromSetup(q); }
      if (t.dataset.group) { const s = setup[t.dataset.group]; s.has(t.dataset.val) ? s.delete(t.dataset.val) : s.add(t.dataset.val); }
      else if (t.dataset.all) { allValues[t.dataset.all].forEach((v) => setup[t.dataset.all].add(v)); }
      else if (t.dataset.none) { setup[t.dataset.none].clear(); }
      else if (t.dataset.count !== undefined) { setup.count = Number(t.dataset.count); }
      else if (t.hasAttribute("data-wrong")) { setup.onlyWrong = !setup.onlyWrong; }
      else if (t.id === "start") { startFromSetup(setup); return; }
      else return;
      refresh();
    };
    refresh();
  }

  /* =========================================================
     画面2: 演習
     ========================================================= */
  function startSession(questions, regen, meta) {
    if (!questions || !questions.length) return;
    session = { questions, index: 0, results: [], startedAt: Date.now(), answered: false, regen, saved: false, before: snapshot(), meta: meta || null };
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
        ${session.meta && KIND_LABEL[session.meta.kind] ? `<span class="kind-pill k-${session.meta.kind}">${KIND_LABEL[session.meta.kind]}</span>` : ""}
        <div class="qnum">${session.index + 1} / ${total}</div>
        <button class="btn ghost" id="quit">終了</button>
      </div>
      <article class="card">
        <div class="tags">
          <span class="tag" title="${esc(rs.no)} ${esc(rs.name)}">${esc(rs.nick)}</span>
          <span class="tag plain">${esc(q.subject)}・${esc(q.grade)}</span>
          <span class="tag plain">${esc(q.unit || q.field || "")}</span>
          ${session.meta && session.meta.retryIds && session.meta.retryIds.includes(q.id) ? `<span class="tag retry">まちがえた問題の解き直し</span>` : ""}
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
    let combo = 0;
    for (let k = session.results.length - 1; k >= 0 && session.results[k].ok; k--) combo++;
    $app.querySelectorAll(".choice")[correctIdx].querySelector(".txt").classList.add("hl-on");
    document.getElementById("fb").innerHTML = `
      <div class="feedback ${ok ? "ok" : "ng"}" role="status">
        <div class="verdict">${ok ? "正解！" : "不正解"}<span class="xp-chip">+${ok ? XP_OK : XP_NG} XP</span>${ok && combo >= 2 ? `<span class="combo">${combo}問れんぞく正解</span>` : ""}<span class="muted small" style="font-weight:400;margin-left:auto">正答は ${q.answer}</span></div>
        <div class="basis"><b>根拠：</b>${esc(q.explanation || "（根拠は未登録です）")}</div>
        ${adviceHTML(q, ok)}
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
        ...(session.meta ? { kind: session.meta.kind, rs: session.meta.rs } : {}),
      });
      save();
      session.saved = true;
      session.routeOut = session.meta && /^(diag|review|check)$/.test(session.meta.kind) && res.length ? applyRoute(session.meta, res) : null;
    }
    session.done = true;
    location.hash = "#/result";
    if (location.hash === "#/result") viewResult();
  }

  /* ---------- RS別バー（単一系列・HTML） ---------- */
  function barsHTML(stats, prev) {
    return `<div class="bars">${RS.map((r) => {
      const s = stats[r.code];
      if (!s || !s.t) return `<div class="bar-row none"><div class="lbl">${r.nick}<small>${r.no} ${r.name}</small></div><div class="bar-track"></div><div class="val">—</div></div>`;
      const p = pct(s.c, s.t);
      let delta = "";
      if (prev) {
        const ps = prev[r.code];
        if (ps && ps.t) { const d = p - pct(ps.c, ps.t); delta = `<span class="delta">${d > 0 ? "▲" : d < 0 ? "▼" : "±"}${Math.abs(d)}</span>`; }
      }
      return `<div class="bar-row" title="${r.no} ${r.name}：${s.c}/${s.t}問 正解（${p}%）">
        <div class="lbl">${r.nick}<small>${r.no} ${r.name}</small></div>
        <div class="bar-track"><div class="bar-fill ${p >= 80 ? "hi" : p < 50 ? "lo" : ""}" style="width:${p}%"></div></div>
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
      ${session.meta && KIND_LABEL[session.meta.kind] ? `<p class="result-title">${KIND_LABEL[session.meta.kind]}${session.meta.rs ? `：${esc(RS_MAP[session.meta.rs].nick)}` : ""}の結果</p>` : ""}
      ${routeResultHTML(session.routeOut, res)}
      ${rewardHTML(session.before || { xp: 0, badges: new Set() }, correct, res.length)}
      ${session.meta && session.meta.kind === "scaffold" && session.meta.originals && session.meta.originals.length ? `<section class="card route-banner">
        ${stepperHTML(2)}
        <h2>やさしい問題で練習しました</h2>
        <p class="small muted">考え方を確かめたら、さっきまちがえた問題にもう一度挑戦しよう。</p>
        <button class="btn primary lg" id="retry-orig">さっきまちがえた問題にもう一度（${session.meta.originals.length}問）</button>
      </section>` : ""}
      ${!session.routeOut && wrong.length && (!session.meta || session.meta.kind !== "scaffold") ? (() => {
        const wq = wrong.map((r) => qById[r.id]);
        const rsCount = {}; wq.forEach((q) => { rsCount[q.rs_code] = (rsCount[q.rs_code] || 0) + 1; });
        const top = Object.keys(rsCount).sort((a, b) => rsCount[b] - rsCount[a]).slice(0, 2);
        const sc = scaffoldSet(wq);
        return `<section class="card advice-card">
          <h2>今回のふり返りアドバイス</h2>
          ${top.map((c) => `<div class="adv-item"><b>${esc(RS_MAP[c].nick)}</b>（${rsCount[c]}問まちがい）<p>${esc(TIPS[c].check)}</p></div>`).join("")}
          ${sc.length ? `<div class="scaf">
            <div class="small muted">まちがえた問題と同じスキルで、もう少し易しい問題を用意しました。</div>
            <div class="row" style="margin-top:8px"><button class="btn primary" id="scaffold">やさしい問題で練習（${sc.length}問）→ もう一度挑戦</button></div>
          </div>` : ""}
        </section>`;
      })() : ""}
      <p class="small muted center">かかった時間 ${fmtSec(totalMs)}（1問平均 ${fmtSec(totalMs / Math.max(1, res.length))}）</p>
      <section class="card">
        <h2>スキル別の正答率</h2>
        ${barsHTML(byRs)}
      </section>
      <section class="card">
        <div class="row" style="margin-bottom:10px"><h2 style="margin:0">ふり返り</h2><div class="spacer"></div><span class="muted small">タップで解説を表示</span></div>
        ${res.map((r, i) => {
          const q = qById[r.id];
          return `<details class="review-item" ${!r.ok && wrong.length <= 3 ? "open" : ""}>
            <summary><span class="mark ${r.ok ? "ok" : "ng"}">${r.ok ? "○" : "×"}</span>
              <span><span class="small muted">${i + 1}. ${esc(RS_MAP[q.rs_code].nick)}・${esc(q.subject)}・${esc(q.grade)}</span><br>${esc(q.question)}</span></summary>
            <div class="review-body">
              <div class="passage ${q.subject === "英語" && isEnglishText(q.passage) ? "en" : ""}">${esc(q.passage)}</div>
              <div>あなたの答え：<b>${r.chosen}</b>　正答：<b>${q.answer}</b>（${esc(q.choices[LETTERS.indexOf(q.answer)])}）</div>
              <div class="muted" style="margin-top:4px"><b>根拠：</b>${esc(q.explanation)}</div>
            </div>
          </details>`;
        }).join("")}
      </section>
      <div class="row">
        ${wrong.length && !session.routeOut ? `<button class="btn" id="retry">まちがえた問題をもう一度（${wrong.length}問）</button>` : ""}
        ${session.regen ? `<button class="btn" id="again">同じ条件で新しく解く</button>` : `<a class="btn" href="#/">ホームへ</a>`}
        <a class="btn ghost" href="#/dashboard">ダッシュボードを見る</a>
      </div>`;

    const wrongQs = wrong.map((r) => qById[r.id]);
    const scaffoldQs = !session.routeOut && wrong.length ? null : [];
    $app.onclick = (e) => {
      if (bindRouteButtons(e)) return;
      if (e.target.closest("#retry")) startSession(shuffle(wrongQs), session.regen, { kind: "retry" });
      else if (e.target.closest("#retry-orig")) { const ids = session.meta.originals; startSession(ids.map((id) => Q_BY_ID[id]).filter(Boolean), null, { kind: "retry" }); }
      else if (e.target.closest("#scaffold")) startSession(scaffoldSet(wrongQs), null, { kind: "scaffold", originals: wrongQs.map((q) => q.id) });
      else if (e.target.closest("#again")) { if (session.regen) session.regen(); else location.hash = "#/"; }
    };
    void scaffoldQs;
  }


  /* =========================================================
     画面: 長文読解（国語）
     ========================================================= */
  const GENRES = ["説明文", "論説文", "小説", "随筆"];
  const longFilter = { grades: new Set(GRADES), genres: new Set(GENRES) };
  const isNarrow = () => window.matchMedia("(max-width: 899px)").matches;

  function lastLongSession(pid) {
    const s = log().sessions.filter((x) => x.mode === "L" && x.p === pid);
    return s.length ? s[s.length - 1] : null;
  }

  function viewLongList() {
    setNav("long");
    if (!PASSAGES.length) { location.hash = "#/"; return; }
    const genres = GENRES.concat([...new Set(PASSAGES.map((p) => p.genre).filter((g) => g && !GENRES.includes(g)))]);
    genres.forEach((g) => { if (!longFilter.genres.has(g) && !viewLongList.init) longFilter.genres.add(g); });
    viewLongList.init = true;
    const chips = (key, vals) => vals.map((v) => `<button class="chip" data-lf="${key}" data-val="${esc(v)}" aria-pressed="${longFilter[key].has(v)}">${esc(v)}<span class="count">${PASSAGES.filter((p) => (key === "grades" ? p.grade : p.genre) === v).length}</span></button>`).join("");
    const list = PASSAGES.filter((p) => longFilter.grades.has(p.grade) && longFilter.genres.has(p.genre));
    $app.innerHTML = `
      <h1>長文読解</h1>
      <p class="lead">600〜800字の文章を読んで、4〜5問に答えます。本文はいつでも読み返せます。答えたあと、根拠になる部分が本文の中で示されます。</p>
      <section class="card">
        <div class="field-group"><div class="field-label">学年</div><div class="chips">${chips("grades", GRADES)}</div></div>
        <div class="field-group"><div class="field-label">ジャンル</div><div class="chips">${chips("genres", genres)}</div></div>
      </section>
      <div class="long-list">${list.map((p) => {
        const last = lastLongSession(p.id);
        return `<button class="card long-item" data-pid="${esc(p.id)}">
          <span class="li-main"><span class="li-title">${esc(p.title)}</span>
            <span class="tags"><span class="tag">${esc(p.genre || "文章")}</span><span class="tag plain">${esc(p.grade)}</span><span class="tag plain">${p.chars || p.paras.join("").length}字・${p.questions.length}問</span></span></span>
          <span class="li-status ${last ? (last.ok === last.n ? "done" : "tried") : ""}">${last ? `前回<br><b>${last.ok}/${last.n}</b>` : "未挑戦"}</span>
        </button>`;
      }).join("") || `<div class="card empty">条件に合う文章がありません</div>`}</div>`;
    $app.onclick = (e) => {
      const c = e.target.closest("[data-lf]");
      if (c) { const s = longFilter[c.dataset.lf]; s.has(c.dataset.val) ? s.delete(c.dataset.val) : s.add(c.dataset.val); return viewLongList(); }
      const it = e.target.closest("[data-pid]");
      if (it) startLong(PASSAGES.find((p) => p.id === it.dataset.pid));
    };
  }

  function startLong(p) {
    if (!p) return;
    lsession = { p, phase: "read", qi: 0, results: [], startedAt: Date.now(), readStart: Date.now(), readMs: 0,
      tab: "text", answered: false, saved: false, done: false, mark: null, before: snapshot() };
    location.hash = "#/long/play";
    if (location.hash === "#/long/play") viewLongPlay();
  }

  function passageHTML(p, mark) {
    return p.paras.map((t, i) => {
      let h = esc(t);
      if (mark && mark.para === i + 1 && mark.text) {
        const e = esc(mark.text), k = h.indexOf(e);
        if (k >= 0) h = h.slice(0, k) + `<mark class="ev" id="ev-mark">${e}</mark>` + h.slice(k + e.length);
      }
      return `<p class="para ${mark && mark.para === i + 1 ? "has-ev" : ""}" id="para-${i + 1}"><span class="pno" aria-label="第${i + 1}段落">${i + 1}</span>${h}</p>`;
    }).join("");
  }

  function setLongTab(tab) {
    lsession.tab = tab;
    const w = document.getElementById("lr-wrap");
    if (w) w.dataset.tab = tab;
    $app.querySelectorAll("[data-ltab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.ltab === tab));
    if (isNarrow()) window.scrollTo({ top: 0 });
  }

  function viewLongPlay() {
    setNav("long");
    const L = lsession;
    if (!L || L.done) { location.hash = "#/long"; return; }
    const p = L.p, n = p.questions.length;
    const reading = L.phase === "read";
    const q = reading ? null : p.questions[L.qi];
    $app.innerHTML = `
      <div class="quiz-head">
        <div class="progress" aria-hidden="true"><span style="width:${reading ? 0 : (L.qi / n) * 100}%"></span></div>
        <div class="qnum">${reading ? "本文を読む" : `設問 ${L.qi + 1} / ${n}`}</div>
        <button class="btn ghost" id="lquit">終了</button>
      </div>
      <div class="lr-tabs" role="tablist" aria-label="表示の切りかえ">
        <button role="tab" data-ltab="text">本文</button>
        <button role="tab" data-ltab="q">${reading ? "設問" : `設問 ${L.qi + 1}/${n}`}</button>
      </div>
      <div class="lr-wrap" id="lr-wrap" data-tab="${L.tab}">
        <article class="card lr-text" id="lr-text" aria-label="本文">
          <div class="lr-title">${esc(p.title)}</div>
          <div class="tags"><span class="tag">${esc(p.genre || "文章")}</span><span class="tag plain">国語・${esc(p.grade)}</span><span class="tag plain">${p.chars || p.paras.join("").length}字</span></div>
          <div class="lr-body" id="lr-body">${passageHTML(p, L.mark)}</div>
          ${reading ? `<div class="lr-readdone"><button class="btn primary lg" id="lgo">読み終えた・設問へ</button><div class="small muted">ここまでの時間が「読む時間」として記録されます</div></div>` : `<button class="btn ghost lr-back sm-only-block" data-ltab="q">設問にもどる</button>`}
        </article>
        <article class="card lr-q" id="lr-q" aria-label="設問">
          ${reading ? `<div class="lr-intro">
              <b>まず本文を読みましょう。</b>
              <p class="small muted">全${n}問。設問に答えている間も、本文はいつでも読み返せます。</p>
              <button class="btn primary" id="lgo2">読み終えた・設問へ</button>
            </div>` : `
            <div class="tags">
              <span class="tag" title="${esc(RS_MAP[q.rs_code].no)} ${esc(RS_MAP[q.rs_code].name)}">${esc(RS_MAP[q.rs_code].nick)}</span>
              ${q.kind ? `<span class="tag plain">${esc(q.kind)}</span>` : ""}
            </div>
            <div class="question">${esc(q.question)}</div>
            <div class="choices" role="group" aria-label="選択肢">
              ${q.choices.map((c, i) => `<button class="choice" data-i="${i}"><span class="key">${LETTERS[i]}</span><span class="txt">${esc(c)}</span></button>`).join("")}
            </div>
            <div id="lfb"></div>
            <div class="quiz-foot">
              <button class="btn ghost sm-only-inline" data-ltab="text">本文を見る</button>
              <span class="kbd-hint">1〜4 または A〜D で解答、Enter で次へ</span>
              <button class="btn primary" id="lnext" hidden>${L.qi + 1 < n ? "次の設問へ" : "結果を見る"}</button>
            </div>`}
        </article>
      </div>`;
    setLongTab(L.tab);
    L.answered = false;
    if (!reading) L.qStart = Date.now();
    $app.onclick = (e) => {
      const t = e.target.closest("[data-ltab]");
      if (t) return setLongTab(t.dataset.ltab);
      if (e.target.closest("#lgo") || e.target.closest("#lgo2")) {
        L.readMs = Math.min(Date.now() - L.readStart, 60 * 60000);
        L.phase = "q"; L.qi = 0; L.tab = "q"; L.mark = null;
        return viewLongPlay();
      }
      const ch = e.target.closest(".choice");
      if (ch && !L.answered && L.phase === "q") return longAnswer(Number(ch.dataset.i));
      if (e.target.closest("#lnext")) return longNext();
      if (e.target.closest("#lshow")) return showEvidence();
      if (e.target.closest("#lquit")) {
        if (!L.results.length) { lsession = null; location.hash = "#/long"; }
        else longFinish();
      }
    };
  }

  function showEvidence() {
    setLongTab("text");
    const m = document.getElementById("ev-mark") || document.getElementById("para-" + (lsession.mark && lsession.mark.para));
    if (!m) return;
    const box = document.getElementById("lr-text");
    if (!isNarrow() && box && box.scrollHeight > box.clientHeight) box.scrollTo({ top: m.offsetTop - 80, behavior: "smooth" });
    else m.scrollIntoView({ block: "center", behavior: "smooth" });
    m.classList.remove("flash"); void m.offsetWidth; m.classList.add("flash");
  }

  function longAnswer(i) {
    const L = lsession, p = L.p, q = p.questions[L.qi];
    const correctIdx = LETTERS.indexOf(q.answer);
    const ok = i === correctIdx;
    const now = Date.now();
    const ms = Math.min(now - L.qStart, 30 * 60000);
    L.answered = true;
    L.results.push({ id: q.id, rs: q.rs_code, chosen: LETTERS[i], ok, ms });
    log().answers.push({ t: now, q: q.id, s: p.subject || "国語", g: p.grade, rs: q.rs_code, ok: ok ? 1 : 0, c: LETTERS[i], ms, m: "L", p: p.id });
    save();
    $app.querySelectorAll(".choice").forEach((b, k) => {
      b.disabled = true;
      if (k === correctIdx) b.classList.add("correct"); else if (k === i) b.classList.add("wrong"); else b.classList.add("dim");
    });
    L.mark = q.evidence ? { para: q.evidence_para, text: q.evidence } : (q.evidence_para ? { para: q.evidence_para, text: "" } : null);
    document.getElementById("lr-body").innerHTML = passageHTML(p, L.mark);
    $app.querySelectorAll(".choice")[correctIdx].querySelector(".txt").classList.add("hl-on");
    document.getElementById("lfb").innerHTML = `
      <div class="feedback ${ok ? "ok" : "ng"}" role="status">
        <div class="verdict">${ok ? "正解！" : "不正解"}<span class="xp-chip">+${ok ? XP_OK : XP_NG} XP</span><span class="muted small" style="font-weight:400;margin-left:auto">正答は ${q.answer}</span></div>
        <div class="basis"><b>根拠：</b>${esc(q.explanation || "")}</div>
        ${L.mark ? `<div class="ev-quote"><span class="small muted">第${L.mark.para}段落</span>${L.mark.text ? `「${esc(L.mark.text)}」` : ""}</div>
        <button class="btn small-btn" id="lshow">本文で根拠を確かめる</button>` : ""}
        ${adviceHTML(q, ok)}
      </div>`;
    if (!isNarrow()) showEvidence();
    const nb = document.getElementById("lnext");
    nb.hidden = false; nb.focus({ preventScroll: true });
    if (isNarrow()) nb.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function longNext() {
    const L = lsession;
    if (L.qi + 1 < L.p.questions.length) { L.qi++; L.mark = null; L.tab = "q"; viewLongPlay(); }
    else longFinish();
  }

  function longFinish() {
    const L = lsession;
    if (!L.saved) {
      const res = L.results;
      log().sessions.push({ at: L.startedAt, end: Date.now(), n: res.length, ok: res.filter((r) => r.ok).length,
        ms: L.readMs + res.reduce((s, r) => s + r.ms, 0), subj: [L.p.subject || "国語"], mode: "L", p: L.p.id,
        title: L.p.title, read: L.readMs, chars: L.p.chars || L.p.paras.join("").length });
      save(); L.saved = true;
    }
    L.done = true;
    location.hash = "#/long/result";
    if (location.hash === "#/long/result") viewLongResult();
  }

  const readSpeed = (chars, ms) => (ms >= 5000 ? Math.round(chars / (ms / 60000)) : null);

  function viewLongResult() {
    setNav("long");
    const L = lsession;
    if (!L || !L.done) { location.hash = "#/long"; return; }
    const p = L.p, res = L.results;
    const correct = res.filter((r) => r.ok).length;
    const qById = Object.fromEntries(p.questions.map((q) => [q.id, q]));
    const ansMs = res.reduce((s, r) => s + r.ms, 0);
    const chars = p.chars || p.paras.join("").length;
    const spd = readSpeed(chars, L.readMs);
    const byRs = {};
    res.forEach((r) => { byRs[r.rs] = byRs[r.rs] || { c: 0, t: 0 }; byRs[r.rs].t++; if (r.ok) byRs[r.rs].c++; });
    const others = PASSAGES.filter((x) => x.id !== p.id && !lastLongSession(x.id));
    const nextP = others.find((x) => x.grade === p.grade) || others[0];
    $app.innerHTML = `
      <p class="result-title">長文読解「${esc(p.title)}」</p>
      ${rewardHTML(L.before || { xp: 0, badges: new Set() }, correct, res.length)}
      <div class="read-stats">
        <div><span class="small muted">読む時間</span><b>${fmtSec(L.readMs)}</b></div>
        <div><span class="small muted">読む速さ</span><b>${spd ? `${spd}字/分` : "—"}</b></div>
        <div><span class="small muted">答える時間</span><b>${fmtSec(ansMs)}</b></div>
      </div>
      <section class="card">
        <h2>スキル別</h2>
        ${barsHTML(byRs)}
      </section>
      <section class="card">
        <div class="row" style="margin-bottom:10px"><h2 style="margin:0">ふり返り</h2><div class="spacer"></div><span class="muted small">タップで根拠を表示</span></div>
        ${res.map((r) => {
          const q = qById[r.id];
          return `<details class="review-item" ${!r.ok ? "open" : ""}>
            <summary><span class="mark ${r.ok ? "ok" : "ng"}">${r.ok ? "○" : "×"}</span>
              <span><span class="small muted">設問${q.no || ""} ${esc(RS_MAP[q.rs_code].nick)}${q.kind ? "・" + esc(q.kind) : ""}</span><br>${esc(q.question)}</span></summary>
            <div class="review-body">
              <div>あなたの答え：<b>${r.chosen}</b>　正答：<b>${q.answer}</b>（${esc(q.choices[LETTERS.indexOf(q.answer)])}）</div>
              ${q.evidence_para ? `<div class="ev-quote"><span class="small muted">第${q.evidence_para}段落</span>${q.evidence ? `「${esc(q.evidence)}」` : ""}</div>` : ""}
              <div class="muted" style="margin-top:4px"><b>根拠：</b>${esc(q.explanation)}</div>
            </div>
          </details>`;
        }).join("")}
      </section>
      <section class="card">
        <details><summary class="small"><b>本文をもう一度読む</b></summary><div class="lr-body" style="margin-top:10px">${passageHTML(p, null)}</div></details>
      </section>
      ${res.some((r) => !r.ok) ? (() => {
        const wq = res.filter((r) => !r.ok).map((r) => ({ ...qById[r.id], subject: "国語", grade: p.grade, difficulty: 2 }));
        const sc = scaffoldSet(wq, p.grade);
        return `<section class="card advice-card">
          <h2>今回のふり返りアドバイス</h2>
          ${[...new Set(wq.map((q) => q.rs_code))].slice(0, 2).map((c) => `<div class="adv-item"><b>${esc(RS_MAP[c].nick)}</b><p>${esc(TIPS[c].check)}</p></div>`).join("")}
          ${sc.length ? `<div class="small muted">まちがえた設問と同じスキルの、短くて易しい問題で練習できます。</div>
          <div class="row" style="margin-top:8px"><button class="btn primary" id="lscaf">やさしい問題で練習（${sc.length}問）</button></div>` : ""}
        </section>`;
      })() : ""}
      <div class="row">
        ${nextP ? `<button class="btn primary" id="lnextp">次の文章へ（${esc(nextP.title)}）</button>` : ""}
        <button class="btn" id="lagain">この文章をもう一度解く</button>
        <a class="btn ghost" href="#/long">文章の一覧</a>
      </div>`;
    $app.onclick = (e) => {
      if (e.target.closest("#lscaf")) { const wq = res.filter((r) => !r.ok).map((r) => ({ ...qById[r.id], subject: "国語", grade: p.grade, difficulty: 2 })); return startSession(scaffoldSet(wq, p.grade), null, { kind: "scaffold" }); }
      if (e.target.closest("#lagain")) startLong(p);
      else if (e.target.closest("#lnextp")) startLong(nextP);
    };
  }

  /* =========================================================
     画面4: ダッシュボード（期間ごとの学習履歴）
     ========================================================= */
  const dash = { preset: "30", from: null, to: null, gran: "auto", mode: "all" };
  const MODES = [["all", "すべて"], ["S", "短文の演習"], ["L", "長文読解"]];
  const modeOk = (m) => dash.mode === "all" || (dash.mode === "L" ? m === "L" : m !== "L");
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
    const all = log().answers.filter((a) => modeOk(a.m));
    const r = periodRange();
    const gran = granularity(r.days);
    const cur = all.filter((a) => a.t >= +r.from && a.t < +r.to);
    const prev = all.filter((a) => a.t >= +r.prevFrom && a.t < +r.prevTo);
    const A = aggregate(cur), P = aggregate(prev);
    const buckets = makeBuckets(r.from, r.to, gran);
    let bi = 0;
    cur.forEach((a) => { while (bi < buckets.length && a.t >= buckets[bi].end) bi++; if (buckets[bi] && a.t >= buckets[bi].start) { buckets[bi].n++; buckets[bi].c += a.ok; } });
    const sessions = log().sessions.filter((s) => s.at >= +r.from && s.at < +r.to && modeOk(s.mode)).slice().reverse();
    const longS = sessions.filter((s) => s.mode === "L");
    const longChars = longS.reduce((t, s) => t + (s.chars || 0), 0), longRead = longS.reduce((t, s) => t + (s.read || 0), 0);
    const longN = longS.reduce((t, s) => t + s.n, 0), longOk = longS.reduce((t, s) => t + s.ok, 0);
    const longSpd = longRead >= 5000 ? Math.round(longChars / (longRead / 60000)) : null;
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
        ${PASSAGES.length ? `<div class="row gran-row"><span class="small muted">対象</span>
          ${MODES.map(([k, l]) => `<button class="chip sm" data-mode="${k}" aria-pressed="${dash.mode === k}">${l}</button>`).join("")}
        </div>` : ""}
        <div class="row gran-row"><span class="small muted">集計の単位</span>
          ${[["auto", "自動"], ["day", "日"], ["week", "週"], ["month", "月"]].map(([k, l]) => `<button class="chip sm" data-gran="${k}" aria-pressed="${dash.gran === k}">${l}</button>`).join("")}
        </div>
      </div>

      ${all.length === 0 && dash.mode !== "all" ? `
      <section class="card"><div class="empty">「${MODES.find((x) => x[0] === dash.mode)[1]}」の記録はまだありません。<br><a href="${dash.mode === "L" ? "#/long" : "#/"}">${dash.mode === "L" ? "長文読解をはじめる" : "演習をはじめる"}</a></div></section>` : all.length === 0 ? `
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
      ${(() => { const xp = totalXP(), lv = levelInfo(xp), eb = earnedBadges(); return `<section class="card">
        <div class="row" style="margin-bottom:10px"><h2 style="margin:0">レベルとバッジ</h2><div class="spacer"></div><span class="small muted">バッジ ${eb.size} / ${BADGES.length}</span></div>
        <div class="lv-row" style="margin-bottom:14px"><span class="lv-badge">Lv.${lv.L}</span><div class="xpbar"><span style="width:${lv.pct}%"></span></div><span class="small muted">${xp} XP（全期間）</span></div>
        ${badgesHTML(eb)}</section>`; })()}

      ${longS.length ? `<section class="card">
        <h2>長文読解<span class="muted small">（この期間）</span></h2>
        <div class="kpis kpis-in">
          ${kpi("読んだ文章", `${longS.length}<small>回</small>`, `${new Set(longS.map((s) => s.p)).size}種類の文章`)}
          ${kpi("正答率", `${pct(longOk, longN)}<small>%</small>`, `${longOk}/${longN}問`)}
          ${kpi("1回の読む時間", fmtSec(longRead / longS.length), "本文を読み終えるまで")}
          ${kpi("読む速さ", longSpd ? `${longSpd}<small>字/分</small>` : "—", "読む時間から計算")}
        </div>
      </section>` : ""}

      <section class="card">
        <h2>解答数の推移<span class="muted small">（${granLabel}ごと）</span></h2>
        <div class="fig" id="ch-count"></div>
      </section>
      <section class="card">
        <h2>正答率の推移<span class="muted small">（${granLabel}ごと・解答のあった${granLabel}のみ）</span></h2>
        <div class="fig" id="ch-rate"></div>
      </section>

      <section class="card">
        <h2>スキル別の正答率<span class="muted small">（▲▼は前の期間との差・pt）</span></h2>
        ${A.n ? barsHTML(A.byRs, P.byRs) : `<div class="empty">この期間の記録はありません</div>`}
      </section>

      ${weak.length ? `<section class="card">
        <h2>重点的に練習したいところ</h2>
        <div class="weak-list">${weak.map((w) => `
          <div class="weak"><div><b>${esc(w.s)} × ${RS_MAP[w.rs].nick}</b><div class="small muted">正答率 ${w.p}%（${w.t}問）</div></div>
          <button class="btn small-btn" data-practice="${esc(w.s)}|${w.rs}">練習する</button></div>`).join("")}
        </div></section>` : ""}

      <section class="card">
        <h2>教科 × スキル</h2>
        ${A.n ? `<div class="scroll"><table class="heat">
          <thead><tr><th></th>${RS.map((x) => `<th title="${x.no} ${x.name}">${x.nick}<span>${x.no}</span></th>`).join("")}<th>合計</th></tr></thead>
          <tbody>${SUBJECTS.map((s) => `<tr><th>${s}</th>${RS.map((x) => heatCell(A.cross[s + "|" + x.code])).join("")}${heatCell(A.bySub[s], true)}</tr>`).join("")}</tbody>
        </table></div>
        <div class="small muted" style="margin-top:6px">数字は正答率（%）、小さい数字は解答数。色が濃いほど正答率が高い。</div>` : `<div class="empty">この期間の記録はありません</div>`}
      </section>

      <section class="card">
        <h2>演習の記録<span class="muted small">（${sessions.length}回）</span></h2>
        ${sessions.length ? `<div class="scroll"><table class="sess-table">
          <thead><tr><th>日時</th><th>教科</th><th class="num">正解</th><th class="num">正答率</th><th class="num opt">時間</th></tr></thead>
          <tbody>${sessions.slice(0, 100).map((s, i) => `<tr ${i >= 10 ? 'class="more" hidden' : ""}><td class="nw">${fmtDateTime(s.at)}</td><td class="subj">${s.mode === "L" ? `長文「${esc(s.title || "")}」` : `${s.kind && KIND_LABEL[s.kind] ? `<span class="kind-pill k-${s.kind}">${KIND_LABEL[s.kind]}${s.rs && RS_MAP[s.rs] ? "：" + esc(RS_MAP[s.rs].nick) : ""}</span> ` : ""}${esc(s.subj.join("・"))}`}</td><td class="num">${s.ok}/${s.n}</td><td class="num">${pct(s.ok, s.n)}%</td><td class="num opt">${fmtSec(s.ms || 0)}</td></tr>`).join("")}</tbody>
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
      if (b.dataset.mode) { dash.mode = b.dataset.mode; return viewDashboard(); }
      if (b.dataset.practice) {
        if (dash.mode === "L") { location.hash = "#/long"; return; }
        const [s, rs] = b.dataset.practice.split("|");
        const setup = { subjects: new Set([s]), grades: new Set(GRADES), rs: new Set([rs]), count: 10, onlyWrong: false };
        lastSetup = setup; return startFromSetup(setup);
      }
      if (b.id === "more") { $app.querySelectorAll("tr.more").forEach((r) => { r.hidden = false; }); b.remove(); return; }
      if (b.id === "sample") { makeSample(); return viewDashboard(); }
      if (b.id === "lrename") return showLearnerForm("rename");
      if (b.id === "exp-csv") {
        const rows = [["学習者", "日時", "問題ID", "教科", "学年", "RSコード", "RS項目", "正誤", "選んだ答え", "解答時間(秒)", "モード", "文章ID"]];
        log().answers.forEach((a) => { const d = new Date(a.t); rows.push([learner().name, `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, a.q, a.s, a.g, a.rs, RS_MAP[a.rs] ? RS_MAP[a.rs].name : "", a.ok ? "正解" : "不正解", a.c, Math.round((a.ms || 0) / 100) / 10, a.m === "L" ? "長文" : "短文", a.p || ""]); });
        const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
        return msg(download(`ヨミトレ記録_${learner().name}_${ymd(new Date())}.csv`, csv, "text/csv") ? "CSVを書き出しました。" : "この環境では書き出しができません。");
      }
      if (b.id === "exp-json") {
        return msg(download(`ヨミトレバックアップ_${ymd(new Date())}.json`, JSON.stringify(STORE), "application/json") ? "バックアップを書き出しました。" : "この環境では書き出しができません。");
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
        catch (err) { msg("読み込めませんでした。ヨミトレ（RSTトレーニング）のバックアップファイルか確認してください。"); }
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
    if (location.hash === "#/long/play" && lsession && lsession.phase === "q" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
      const k = e.key.toUpperCase();
      const idx = ["1", "2", "3", "4"].indexOf(k) >= 0 ? Number(k) - 1 : LETTERS.indexOf(k);
      if (!lsession.answered && idx >= 0) { e.preventDefault(); longAnswer(idx); }
      else if (lsession.answered && e.key === "Enter") { e.preventDefault(); longNext(); }
      return;
    }
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
    document.body.dataset.view = h.replace(/[^a-z]/g, "") || "home";
    const tb = document.querySelector(".topbar");
    if (tb) document.documentElement.style.setProperty("--topbar-h", tb.offsetHeight + "px");
    if (h === "#/quiz") viewQuiz();
    else if (h === "#/result") viewResult();
    else if (h === "#/dashboard" || h === "#/history") viewDashboard();
    else if (h === "#/browse") viewBrowse();
    else if (h === "#/route") viewRoute();
    else if (h === "#/lesson") viewLesson();
    else if (h === "#/long") viewLongList();
    else if (h === "#/long/play") viewLongPlay();
    else if (h === "#/long/result") viewLongResult();
    else viewHome();
  }

  loadData().then(({ items, passages, info }) => {
    DB = items.filter((q) => Array.isArray(q.choices) && q.choices.length === 4 && RS_MAP[q.rs_code]);
    Q_BY_ID = Object.fromEntries(DB.map((q) => [q.id, q]));
    PASSAGES = (passages || []).map((p) => ({ ...p, questions: (p.questions || []).filter((q) => Array.isArray(q.choices) && q.choices.length === 4 && RS_MAP[q.rs_code]) }))
      .filter((p) => p.questions.length && Array.isArray(p.paras) && p.paras.length);
    const longQ = PASSAGES.reduce((s, p) => s + p.questions.length, 0);
    document.getElementById("data-info").textContent = `登録問題数 ${DB.length}問${PASSAGES.length ? `・長文 ${PASSAGES.length}文章（${longQ}問）` : ""}｜${info}`;
    document.querySelectorAll('[data-nav="long"]').forEach((a) => { a.hidden = !PASSAGES.length; });
    window.addEventListener("hashchange", route);
    route();
  }).catch((err) => {
    $app.innerHTML = `<div class="error-box"><b>問題データを読み込めませんでした。</b><br>${esc(err.message)}<br><br>
      パソコンで index.html を直接開いた場合は読み込めません。GitHub Pages で公開するか、フォルダで <code>python -m http.server</code> を実行して
      <code>http://localhost:8000</code> を開いてください。</div>`;
  });
})();
