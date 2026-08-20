/* ======================= ترتيل — منطق التطبيق ======================= */

const API = "https://api.alquran.cloud/v1";
const $app = document.getElementById("app");
const $toast = document.getElementById("toast");

const REVIEW_INTERVALS = [1, 3, 7, 16, 35, 90]; // أيام بين كل مراجعة

/* ---------------- تخزين محلي ---------------- */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

const state = {
  reciter: store.get("tr_reciter", null), // {identifier, name}
  memorized: store.get("tr_memorized", {}), // { "2": [1,2,3, ...ayahNumbersInSurah] }
  reviewQueue: store.get("tr_review_queue", []), // [{id,surah,from,to,next,interval}]
  lastRead: store.get("tr_last_read", null), // {surah, ayah}
  surahsCache: store.get("tr_surahs_cache", null),
  recitersCache: store.get("tr_reciters_cache", null),
};

function saveState() {
  store.set("tr_reciter", state.reciter);
  store.set("tr_memorized", state.memorized);
  store.set("tr_review_queue", state.reviewQueue);
  store.set("tr_last_read", state.lastRead);
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => $toast.classList.remove("show"), 2200);
}

/* ---------------- طبقة الاتصال بواجهة القرآن ---------------- */
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("network");
  return res.json();
}

async function getSurahList() {
  if (state.surahsCache) return state.surahsCache;
  const data = await fetchJSON(`${API}/surah`);
  const list = data.data;
  state.surahsCache = list;
  store.set("tr_surahs_cache", list);
  return list;
}

async function getReciters() {
  if (state.recitersCache) return state.recitersCache;
  const data = await fetchJSON(`${API}/edition?format=audio&language=ar&type=versebyverse`);
  let list = data.data;
  if (!list || !list.length) {
    // fallback: أي إصدار صوتي عربي متاح
    const alt = await fetchJSON(`${API}/edition?format=audio&language=ar`);
    list = alt.data;
  }
  state.recitersCache = list;
  store.set("tr_reciters_cache", list);
  return list;
}

// نص السورة (رسم عثماني) + صوت آية بآية لقارئ محدد، مدموجين معًا
async function getSurahWithAudio(surahNumber, reciterId) {
  const cacheKey = `tr_surah_${surahNumber}_${reciterId}`;
  const cached = store.get(cacheKey, null);
  if (cached) return cached;

  const [textRes, audioRes] = await Promise.all([
    fetchJSON(`${API}/surah/${surahNumber}/quran-uthmani`),
    fetchJSON(`${API}/surah/${surahNumber}/${reciterId}`)
  ]);

  const textAyahs = textRes.data.ayahs;
  const audioAyahs = audioRes.data.ayahs;

  const ayahs = textAyahs.map((a, i) => ({
    number: a.number,
    numberInSurah: a.numberInSurah,
    text: a.text,
    audio: audioAyahs[i] ? audioAyahs[i].audio : null
  }));

  const result = {
    number: textRes.data.number,
    name: textRes.data.name,
    englishName: textRes.data.englishName,
    revelationType: textRes.data.revelationType,
    ayahs
  };
  try { store.set(cacheKey, result); } catch { /* تخزين ممتلئ - يتجاهل */ }
  return result;
}

async function getSurahTranslation(surahNumber, edition) {
  const cacheKey = `tr_translate_${edition}_${surahNumber}`;
  const cached = store.get(cacheKey, null);
  if (cached) return cached;
  const data = await fetchJSON(`${API}/surah/${surahNumber}/${edition}`);
  const map = {};
  data.data.ayahs.forEach(a => { map[a.numberInSurah] = a.text; });
  try { store.set(cacheKey, map); } catch { /* تخزين ممتلئ */ }
  return map;
}

/* ---------------- تطبيع النص العربي (لمطابقة تقريبية في التسميع) ---------------- */
function normalizeArabic(str) {
  return (str || "")
    .replace(/[\u064B-\u0652\u0670\u06D6-\u06ED]/g, "") // تشكيل
    .replace(/\u0640/g, "") // تطويل
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0621-\u064A\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ================= الراوتر ================= */
const routes = {};
function route(path, fn) { routes[path] = fn; }
function navigate(hash) { location.hash = hash; }

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if (!location.hash) location.hash = "#/home";
  render();
});

function parseHash() {
  const h = location.hash.replace(/^#\//, "");
  return h.split("/").filter(Boolean);
}

function render() {
  stopAudio();
  stopListening();
  const parts = parseHash();
  const top = parts[0] || "home";
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.route === top || (top === "surah" && b.dataset.route === "surahs"));
  });
  const handler = routes[top] || routes["home"];
  handler(parts.slice(1));
  window.scrollTo(0, 0);
}

document.getElementById("bottomNav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-btn");
  if (!btn) return;
  navigate("#/" + btn.dataset.route);
});

/* ================= الصفحة الرئيسية ================= */
route("home", async () => {
  $app.innerHTML = `
    <div class="appbar"><h1>ترتيل</h1></div>
    <div class="hero">
      <div class="eyebrow">بسم الله الرحمن الرحيم</div>
      <h2>رفيقك في حفظ ومراجعة القرآن</h2>
      <p>استمع، كرّر، سمّع، وتابع حفظك — بصوت القارئ الذي تحب.</p>
    </div>
    <div class="section-title"><h3>ابدأ الآن</h3></div>
    <div class="card-row">
      <button class="action-card" id="cardContinue">
        <div class="ic">▶</div><b>متابعة القراءة</b><span>${lastReadLabel()}</span>
      </button>
      <button class="action-card" id="cardSurahs">
        <div class="ic">☰</div><b>تصفح السور</b><span>١١٤ سورة</span>
      </button>
      <button class="action-card" id="cardReciter">
        <div class="ic">🎙</div><b>اختيار القارئ</b><span>${state.reciter ? state.reciter.name : "لم يتم الاختيار"}</span>
      </button>
      <button class="action-card" id="cardVideo">
        <div class="ic">🎬</div><b>اصنع فيديو آية</b><span>خلفية متحركة + صوت</span>
      </button>
    </div>
    <div class="section-title"><h3>مراجعات اليوم</h3><a id="goTracker">عرض الكل</a></div>
    <div id="dueArea" class="due-list"><div class="loading">جارِ التحميل…</div></div>
    <div class="notice">هذا التطبيق يعرض نصوص وتلاوات من مصادر مفتوحة (Al Quran Cloud)، وميزتا التسميع الصوتي وأحكام التجويد اللونية تجريبيتان وقد لا تكونان دقيقتين بالكامل — لا تُغنيان عن معلّم مُجاز.</div>
  `;
  document.getElementById("cardContinue").onclick = () => {
    if (state.lastRead) navigate(`#/surah/${state.lastRead.surah}`);
    else navigate("#/surahs");
  };
  document.getElementById("cardSurahs").onclick = () => navigate("#/surahs");
  document.getElementById("cardReciter").onclick = () => openReciterSheet();
  document.getElementById("cardVideo").onclick = () => navigate(`#/video/${state.lastRead ? state.lastRead.surah : 1}`);
  document.getElementById("goTracker").onclick = () => navigate("#/tracker");
  renderDueList();
});

function lastReadLabel() {
  if (!state.lastRead) return "لم تبدأ بعد";
  const s = state.surahsCache?.find(s => s.number === state.lastRead.surah);
  return s ? `${s.name} — آية ${state.lastRead.ayah}` : `سورة ${state.lastRead.surah}`;
}

function dueToday() {
  const today = new Date().setHours(0,0,0,0);
  return state.reviewQueue.filter(r => new Date(r.next).setHours(0,0,0,0) <= today);
}

async function renderDueList() {
  const el = document.getElementById("dueArea");
  if (!el) return;
  const due = dueToday();
  if (!due.length) {
    el.innerHTML = `<div class="empty-note">لا توجد مراجعات مستحقة اليوم. أضف مقاطع محفوظة من صفحة "المراجعة".</div>`;
    return;
  }
  const list = await getSurahList().catch(() => []);
  el.innerHTML = due.slice(0, 6).map(r => {
    const s = list.find(x => x.number === r.surah);
    const name = s ? s.name : `سورة ${r.surah}`;
    return `<button class="due-item" data-id="${r.id}">
      <div class="rosette">${r.surah}</div>
      <div class="meta"><b>${name}</b><span>الآيات ${r.from}–${r.to}</span></div>
      <span class="pill">راجع الآن</span>
    </button>`;
  }).join("");
  el.querySelectorAll(".due-item").forEach(btn => {
    btn.onclick = () => {
      const r = state.reviewQueue.find(x => x.id === btn.dataset.id);
      navigate(`#/surah/${r.surah}?from=${r.from}&to=${r.to}&reviewId=${r.id}`);
    };
  });
}

/* ================= قائمة السور ================= */
route("surahs", async () => {
  $app.innerHTML = `
    <div class="appbar"><button class="back" onclick="history.back()">‹</button><h1>السور</h1></div>
    <div class="search-bar"><span>🔎</span><input id="searchBox" placeholder="ابحث عن سورة…" /></div>
    <div id="surahListArea" class="surah-list"><div class="loading">جارِ تحميل قائمة السور…</div></div>
  `;
  let list = [];
  try { list = await getSurahList(); }
  catch { document.getElementById("surahListArea").innerHTML = `<div class="empty-note">تعذّر تحميل القائمة. تحقّق من الاتصال بالإنترنت.</div>`; return; }

  const draw = (items) => {
    document.getElementById("surahListArea").innerHTML = items.map(s => `
      <button class="surah-item" data-n="${s.number}">
        <div class="num">${s.number}</div>
        <div class="info"><b>${s.englishName}</b><span>${s.revelationType === "Meccan" ? "مكية" : "مدنية"} · ${s.numberOfAyahs} آية</span></div>
        <div class="ar-name">${s.name}</div>
      </button>`).join("");
    document.querySelectorAll(".surah-item").forEach(b => b.onclick = () => navigate(`#/surah/${b.dataset.n}`));
  };
  draw(list);

  document.getElementById("searchBox").oninput = (e) => {
    const q = e.target.value.trim();
    if (!q) return draw(list);
    const filtered = list.filter(s => s.name.includes(q) || s.englishName.toLowerCase().includes(q.toLowerCase()) || String(s.number) === q);
    draw(filtered);
  };
});

/* ================= قارئ السورة (المصحف) ================= */
let playerQueue = [];
let playerIndex = 0;
let repeatCount = 1;
let repeatDone = 0;
let audioEl = new Audio();
let currentSurahData = null;
let selection = { from: null, to: null };

function qs(name) {
  const m = location.hash.match(new RegExp("[?&]" + name + "=([^&]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

route("surah", async (parts) => {
  const surahNumber = parseInt(parts[0]);
  const from = qs("from") ? parseInt(qs("from")) : null;
  const to = qs("to") ? parseInt(qs("to")) : null;
  const reviewId = qs("reviewId");

  if (!state.reciter) {
    await ensureDefaultReciter();
  }

  $app.innerHTML = `
    <div class="appbar">
      <button class="back" onclick="navigate('#/surahs')">‹</button>
      <div>
        <h1 id="surahTitle">تحميل…</h1>
        <div class="sub" id="surahSub"></div>
      </div>
    </div>
    <div class="reader-toolbar">
      <button class="chip" id="chipReciter">🎙 ${state.reciter ? state.reciter.name : "اختر قارئًا"}</button>
      <button class="chip" id="chipTikrar">🔁 تكرار مخصص</button>
      <button class="chip" id="chipTasmee">🎤 تسميع</button>
      <button class="chip" id="chipTest">✎ اختبر نفسك</button>
      <button class="chip" id="chipVideo">🎬 فيديو الآية</button>
      <button class="chip" id="chipMemorize">◈ وضع حفظ محفوظ</button>
    </div>
    <div id="mushafArea" class="loading">جارِ تحميل السورة…</div>
    <div id="playerBarArea"></div>
  `;
  document.getElementById("chipReciter").onclick = () => openReciterSheet(() => renderMushaf(surahNumber));
  document.getElementById("chipTikrar").onclick = () => openTikrarSheet(surahNumber);
  document.getElementById("chipTasmee").onclick = () => navigate(`#/tasmee/${surahNumber}${selection.from ? `?from=${selection.from}&to=${selection.to}` : ""}`);
  document.getElementById("chipTest").onclick = () => navigate(`#/test/${surahNumber}${selection.from ? `?from=${selection.from}&to=${selection.to}` : ""}`);
  document.getElementById("chipVideo").onclick = () => navigate(`#/video/${surahNumber}${selection.from ? `?from=${selection.from}&to=${selection.to}` : ""}`);
  document.getElementById("chipMemorize").onclick = () => toggleMemorizeSelection(surahNumber);

  await renderMushaf(surahNumber, from, to, reviewId);
});

async function renderMushaf(surahNumber, from, to, reviewId) {
  const mushafArea = document.getElementById("mushafArea");
  try {
    currentSurahData = await getSurahWithAudio(surahNumber, state.reciter.identifier);
  } catch {
    mushafArea.innerHTML = `<div class="empty-note">تعذّر تحميل نص أو صوت السورة. تحقّق من الاتصال ثم أعد المحاولة.</div>`;
    return;
  }
  document.getElementById("surahTitle").textContent = currentSurahData.name;
  document.getElementById("surahSub").textContent = `${currentSurahData.revelationType === "Meccan" ? "مكية" : "مدنية"} · ${currentSurahData.ayahs.length} آية`;

  if (from) selection = { from, to: to || from }; else selection = { from: null, to: null };

  const showBasmala = surahNumber !== 1 && surahNumber !== 9;
  const memorizedSet = new Set(state.memorized[surahNumber] || []);

  mushafArea.innerHTML = `
    <div class="mushaf-page" id="mushafPage">
      ${showBasmala ? `<span class="basmala">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</span>` : ""}
      ${currentSurahData.ayahs.map(a => {
        const inSel = selection.from && a.numberInSurah >= selection.from && a.numberInSurah <= selection.to;
        const mem = memorizedSet.has(a.numberInSurah);
        return `<span class="ayah${inSel ? " selected" : ""}" data-n="${a.numberInSurah}" data-idx="${a.numberInSurah - 1}" title="${mem ? "محفوظة" : ""}">${a.text}<span class="ayah-badge">${toArabicDigits(a.numberInSurah)}</span></span> `;
      }).join("")}
    </div>
  `;

  state.lastRead = { surah: surahNumber, ayah: currentSurahData.ayahs[0].numberInSurah };
  saveState();

  // اختيار نطاق آيات بالنقر (لأول نقرة: بداية، ثاني نقرة: نهاية)
  document.querySelectorAll(".ayah").forEach(el => {
    el.onclick = () => {
      const n = parseInt(el.dataset.n);
      if (!selection.from || (selection.from && selection.to)) {
        selection = { from: n, to: n };
      } else {
        selection.to = Math.max(selection.from, n);
        selection.from = Math.min(selection.from, n);
      }
      refreshSelectionHighlight();
    };
  });

  renderPlayerBar(surahNumber, reviewId);
}

function refreshSelectionHighlight() {
  document.querySelectorAll(".ayah").forEach(el => {
    const n = parseInt(el.dataset.n);
    el.classList.toggle("selected", selection.from && n >= selection.from && n <= selection.to);
  });
}

function toArabicDigits(num) {
  const d = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  return String(num).split("").map(c => d[+c] ?? c).join("");
}

function renderPlayerBar(surahNumber, reviewId) {
  const area = document.getElementById("playerBarArea");
  area.innerHTML = `
    <div class="player-bar">
      <button class="round-btn" id="btnRangeAll">الكل</button>
      <button class="round-btn primary" id="btnPlay">▶</button>
      <div class="info"><b id="playInfo">${selection.from ? `الآيات ${selection.from}–${selection.to}` : "السورة كاملة"}</b><span id="playSub">اضغط تشغيل للاستماع</span></div>
      <button class="round-btn" id="btnRepeat">×1</button>
    </div>
    ${reviewId ? `<div class="panel"><h4>وضع المراجعة</h4>
      <button class="btn-primary" id="btnReviewDone">تمت المراجعة بنجاح ✓</button>
      <button class="btn-secondary" id="btnReviewRetry">احتجت للمساعدة — أعد الجدولة</button>
    </div>` : ""}
  `;
  document.getElementById("btnRangeAll").onclick = () => { selection = { from: null, to: null }; refreshSelectionHighlight(); renderPlayerBar(surahNumber, reviewId); };
  document.getElementById("btnPlay").onclick = () => togglePlay(surahNumber);
  document.getElementById("btnRepeat").onclick = (e) => {
    repeatCount = repeatCount >= 10 ? 1 : repeatCount + 1;
    e.target.textContent = `×${repeatCount}`;
  };
  if (reviewId) {
    document.getElementById("btnReviewDone").onclick = () => markReviewResult(reviewId, true);
    document.getElementById("btnReviewRetry").onclick = () => markReviewResult(reviewId, false);
  }
}

function markReviewResult(reviewId, success) {
  const r = state.reviewQueue.find(x => x.id === reviewId);
  if (!r) return;
  if (success) {
    r.interval = Math.min(r.interval + 1, REVIEW_INTERVALS.length - 1);
  } else {
    r.interval = 0;
  }
  const days = REVIEW_INTERVALS[r.interval];
  r.next = new Date(Date.now() + days * 86400000).toISOString();
  saveState();
  toast(success ? `أحسنت! المراجعة القادمة بعد ${days} يوم` : "تم إعادة الجدولة للمراجعة قريبًا");
  navigate("#/tracker");
}

/* ---------- محرك التشغيل (استماع + تكرار) ---------- */
function togglePlay(surahNumber) {
  if (!audioEl.paused && playerQueue.length) { stopAudio(); return; }
  const ayahs = currentSurahData.ayahs;
  const from = selection.from || ayahs[0].numberInSurah;
  const to = selection.to || ayahs[ayahs.length - 1].numberInSurah;
  playerQueue = ayahs.filter(a => a.numberInSurah >= from && a.numberInSurah <= to && a.audio);
  if (!playerQueue.length) { toast("لا يوجد صوت متاح لهذا النطاق"); return; }
  playerIndex = 0; repeatDone = 0;
  playCurrent(surahNumber);
}

function playCurrent(surahNumber) {
  const item = playerQueue[playerIndex];
  if (!item) return;
  audioEl.src = item.audio;
  audioEl.play().catch(() => toast("تعذّر تشغيل الصوت"));
  document.querySelectorAll(".ayah").forEach(el => el.classList.toggle("playing", parseInt(el.dataset.n) === item.numberInSurah));
  const sub = document.getElementById("playSub");
  if (sub) sub.textContent = `آية ${item.numberInSurah} · التكرار ${repeatDone + 1} من ${repeatCount}`;
  const btn = document.getElementById("btnPlay");
  if (btn) btn.textContent = "⏸";

  audioEl.onended = () => {
    playerIndex++;
    if (playerIndex < playerQueue.length) {
      playCurrent(surahNumber);
    } else {
      repeatDone++;
      if (repeatDone < repeatCount) {
        playerIndex = 0;
        playCurrent(surahNumber);
      } else {
        stopAudio();
      }
    }
  };
}

function stopAudio() {
  audioEl.pause();
  audioEl.onended = null;
  playerQueue = [];
  document.querySelectorAll(".ayah").forEach(el => el.classList.remove("playing"));
  const btn = document.getElementById("btnPlay");
  if (btn) btn.textContent = "▶";
}

/* ---------- شيت التكرار المخصص ---------- */
function openTikrarSheet(surahNumber) {
  const maxAyah = currentSurahData.ayahs.length;
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `
    <div class="sheet">
      <div class="handle"></div>
      <h4 style="margin:0 0 14px;color:var(--gold-soft)">تكرار مخصص</h4>
      <div class="field">
        <label>من آية</label>
        <select id="selFrom">${currentSurahData.ayahs.map(a => `<option value="${a.numberInSurah}" ${selection.from === a.numberInSurah ? "selected" : ""}>${a.numberInSurah}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>إلى آية</label>
        <select id="selTo">${currentSurahData.ayahs.map(a => `<option value="${a.numberInSurah}" ${selection.to === a.numberInSurah ? "selected" : ""}>${a.numberInSurah}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>عدد مرات التكرار</label>
        <div class="stepper">
          <button id="repMinus">−</button><span class="val" id="repVal">${repeatCount}</span><button id="repPlus">+</button>
        </div>
      </div>
      <button class="btn-primary" id="startTikrar">ابدأ التكرار</button>
      <button class="btn-secondary" id="closeSheet">إغلاق</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.getElementById("closeSheet").onclick = () => overlay.remove();
  document.getElementById("repMinus").onclick = () => { repeatCount = Math.max(1, repeatCount - 1); document.getElementById("repVal").textContent = repeatCount; };
  document.getElementById("repPlus").onclick = () => { repeatCount = Math.min(20, repeatCount + 1); document.getElementById("repVal").textContent = repeatCount; };
  document.getElementById("startTikrar").onclick = () => {
    const f = parseInt(document.getElementById("selFrom").value);
    const t = parseInt(document.getElementById("selTo").value);
    selection = { from: Math.min(f,t), to: Math.max(f,t) };
    refreshSelectionHighlight();
    renderPlayerBar(surahNumber);
    overlay.remove();
    togglePlay(surahNumber);
  };
}

/* ---------- اختيار القارئ ---------- */
async function ensureDefaultReciter() {
  try {
    const list = await getReciters();
    const fav = list.find(r => r.identifier === "ar.alafasy") || list[0];
    state.reciter = { identifier: fav.identifier, name: fav.name };
    saveState();
  } catch { toast("تعذّر تحميل قائمة القراء"); }
}

async function openReciterSheet(onDone) {
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `<div class="sheet"><div class="handle"></div><h4 style="margin:0 0 14px;color:var(--gold-soft)">اختر القارئ</h4><div class="reciter-list" id="recList"><div class="loading">جارِ التحميل…</div></div></div>`;
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  try {
    const list = await getReciters();
    document.getElementById("recList").innerHTML = list.map(r => `
      <button class="reciter-item ${state.reciter?.identifier === r.identifier ? "active" : ""}" data-id="${r.identifier}" data-name="${r.name}">
        <b>${r.name}</b><span>${state.reciter?.identifier === r.identifier ? "✓" : ""}</span>
      </button>`).join("");
    document.querySelectorAll(".reciter-item").forEach(btn => {
      btn.onclick = () => {
        state.reciter = { identifier: btn.dataset.id, name: btn.dataset.name };
        saveState();
        overlay.remove();
        toast(`تم اختيار الشيخ ${btn.dataset.name}`);
        if (onDone) onDone();
        else render();
      };
    });
  } catch {
    document.getElementById("recList").innerHTML = `<div class="empty-note">تعذّر تحميل قائمة القراء.</div>`;
  }
}

/* ================= الحفظ (تمييز آيات كمحفوظة + جدولة مراجعة) ================= */
function toggleMemorizeSelection(surahNumber) {
  if (!selection.from) { toast("اختر آية أو نطاقًا أولاً بالنقر عليه في الصفحة"); return; }
  const set = new Set(state.memorized[surahNumber] || []);
  for (let i = selection.from; i <= selection.to; i++) set.add(i);
  state.memorized[surahNumber] = Array.from(set);

  const exists = state.reviewQueue.find(r => r.surah === surahNumber && r.from === selection.from && r.to === selection.to);
  if (!exists) {
    state.reviewQueue.push({
      id: `${surahNumber}-${selection.from}-${selection.to}-${Date.now()}`,
      surah: surahNumber, from: selection.from, to: selection.to,
      interval: 0, next: new Date(Date.now() + 86400000).toISOString()
    });
  }
  saveState();
  toast("تم تسجيل هذا المقطع كمحفوظ، وسيظهر في جدول المراجعة غدًا");
  renderMushaf(surahNumber);
}

/* ================= وضع التسميع ================= */
route("tasmee", async (parts) => {
  const surahNumber = parseInt(parts[0]);
  const from = qs("from") ? parseInt(qs("from")) : 1;
  const to = qs("to") ? parseInt(qs("to")) : null;

  $app.innerHTML = `
    <div class="appbar"><button class="back" onclick="navigate('#/surah/${surahNumber}')">‹</button><h1>التسميع</h1></div>
    <div id="tasmeeArea" class="loading">جارِ التحميل…</div>
  `;

  let data;
  try { data = await getSurahWithAudio(surahNumber, state.reciter.identifier); }
  catch { document.getElementById("tasmeeArea").innerHTML = `<div class="empty-note">تعذّر تحميل السورة.</div>`; return; }

  const rangeTo = to || data.ayahs.length;
  const ayahs = data.ayahs.filter(a => a.numberInSurah >= from && a.numberInSurah <= rangeTo);

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechRec;

  document.getElementById("tasmeeArea").innerHTML = `
    <div class="mushaf-page" id="tasmeePage">
      ${ayahs.map(a => `<span class="ayah" data-n="${a.numberInSurah}">${a.text}<span class="ayah-badge">${toArabicDigits(a.numberInSurah)}</span></span> `).join("")}
    </div>
    ${supported ? `
    <div class="mic-stage">
      <button class="mic-btn" id="micBtn">🎤</button>
      <div class="mic-status" id="micStatus">اضغط على الميكروفون وابدأ التسميع من حفظك</div>
    </div>
    <div id="correctionArea"></div>
    <div class="notice">التسميع الصوتي تجريبي ويعتمد على التعرف الآلي على الكلام العربي، وقد لا يميّز دقائق التجويد أو يخطئ أحيانًا في الفهم. استخدمه كمساعد للمراجعة الذاتية، لا بديلًا عن معلّم مُجاز.</div>
    ` : `<div class="empty-note">متصفحك لا يدعم التعرف على الصوت. جرّب متصفح Chrome على الجوال.</div>`}
  `;

  if (!supported) return;

  // بناء كل كلمات النطاق كمصفوفة مسطّحة مع فهرس الآية
  const wordTokens = [];
  ayahs.forEach(a => {
    normalizeArabic(a.text).split(" ").filter(Boolean).forEach(w => wordTokens.push({ word: w, ayah: a.numberInSurah }));
  });
  let pointer = 0;

  function markAyahState(numberInSurah, cls) {
    document.querySelectorAll(`.ayah[data-n="${numberInSurah}"]`).forEach(el => {
      el.classList.remove("correct", "wrong", "playing");
      if (cls) el.classList.add(cls);
    });
  }

  startListening(SpeechRec, {
    onResult: (transcript) => {
      const heard = normalizeArabic(transcript).split(" ").filter(Boolean);
      heard.forEach(hw => {
        if (pointer >= wordTokens.length) return;
        const expected = wordTokens[pointer];
        if (hw === expected.word || levenshtein(hw, expected.word) <= 1) {
          markAyahState(expected.ayah, "correct");
          pointer++;
        } else {
          markAyahState(expected.ayah, "wrong");
          showCorrection(expected.ayah, ayahs, () => { pointer++; markAyahState(expected.ayah, null); });
        }
      });
      if (pointer >= wordTokens.length) {
        document.getElementById("micStatus").textContent = "أحسنت! أتممت هذا المقطع 🎉";
        stopListening();
      }
    },
    onStatus: (s) => { const el = document.getElementById("micStatus"); if (el) el.textContent = s; }
  });

  document.getElementById("micBtn").onclick = (e) => {
    if (recognitionActive) { stopListening(); e.target.classList.remove("listening"); }
    else { resumeListening(); e.target.classList.add("listening"); }
  };
});

function showCorrection(ayahNumber, ayahs, onContinue) {
  const a = ayahs.find(x => x.numberInSurah === ayahNumber);
  const area = document.getElementById("correctionArea");
  if (!area || !a) return;
  area.innerHTML = `
    <div class="correction-box">
      <span>الصواب في الآية ${ayahNumber}:</span>
      <span class="correct-word">${a.text}</span>
      <button class="btn-primary" id="continueBtn">تابعت التصحيح — أكمل التسميع</button>
    </div>`;
  document.getElementById("continueBtn").onclick = () => { area.innerHTML = ""; onContinue(); };
}

/* ---------- محرك التعرف على الصوت ---------- */
let recognition = null;
let recognitionActive = false;
let recCallbacks = {};

function startListening(SpeechRec, callbacks) {
  recCallbacks = callbacks;
  recognition = new SpeechRec();
  recognition.lang = "ar-SA";
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    if (last.isFinal) recCallbacks.onResult(last[0].transcript);
  };
  recognition.onerror = () => recCallbacks.onStatus && recCallbacks.onStatus("حدث خطأ في الاستماع — حاول مجددًا");
  recognition.onend = () => { recognitionActive = false; };
  resumeListening();
}
function resumeListening() {
  if (!recognition) return;
  try { recognition.start(); recognitionActive = true; recCallbacks.onStatus && recCallbacks.onStatus("جارِ الاستماع… تكلّم الآن"); }
  catch { /* قد يكون يعمل بالفعل */ }
}
function stopListening() {
  if (recognition && recognitionActive) { recognition.stop(); recognitionActive = false; }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

/* ================= اختبر نفسك ================= */
route("test", async (parts) => {
  const surahNumber = parseInt(parts[0]);
  const from = qs("from") ? parseInt(qs("from")) : 1;
  const to = qs("to") ? parseInt(qs("to")) : null;

  $app.innerHTML = `
    <div class="appbar"><button class="back" onclick="navigate('#/surah/${surahNumber}')">‹</button><h1>اختبر نفسك</h1></div>
    <div id="testArea" class="loading">جارِ التحميل…</div>
  `;
  let data;
  try { data = await getSurahWithAudio(surahNumber, state.reciter.identifier); }
  catch { document.getElementById("testArea").innerHTML = `<div class="empty-note">تعذّر تحميل السورة.</div>`; return; }

  const rangeTo = to || data.ayahs.length;
  const ayahs = data.ayahs.filter(a => a.numberInSurah >= from && a.numberInSurah <= rangeTo);

  document.getElementById("testArea").innerHTML = `
    <div class="reader-toolbar">
      <button class="chip active" data-lvl="easy">سهل (٢٠٪)</button>
      <button class="chip" data-lvl="medium">متوسط (٤٠٪)</button>
      <button class="chip" data-lvl="hard">صعب (٦٠٪)</button>
    </div>
    <div class="mushaf-page" id="testPage"></div>
    <div class="panel"><button class="btn-primary" id="revealAll">إظهار كل الإجابات</button></div>
  `;

  function buildTest(ratio) {
    const page = document.getElementById("testPage");
    page.innerHTML = ayahs.map(a => {
      const words = a.text.split(" ");
      const html = words.map((w, i) => {
        const hide = Math.random() < ratio;
        return hide ? `<span class="blank" data-word="${w}">${w}</span>` : w;
      }).join(" ");
      return `<span class="ayah-word-group">${html} <span class="ayah-badge">${toArabicDigits(a.numberInSurah)}</span></span> `;
    }).join("");
    page.querySelectorAll(".blank").forEach(b => b.onclick = () => b.classList.toggle("revealed"));
  }

  const ratios = { easy: 0.2, medium: 0.4, hard: 0.6 };
  buildTest(ratios.easy);
  document.querySelectorAll("[data-lvl]").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("[data-lvl]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      buildTest(ratios[btn.dataset.lvl]);
    };
  });
  document.getElementById("revealAll").onclick = () => document.querySelectorAll(".blank").forEach(b => b.classList.add("revealed"));
});

/* ================= صانع فيديو الآية ================= */
let videoState = null; // { surahNumber, ayahs, translations, bgMode, bgImage, bgVideoEl, includeTranslation }

route("video", async (parts) => {
  const surahNumber = parseInt(parts[0]);
  const qFrom = qs("from") ? parseInt(qs("from")) : 1;
  const qTo = qs("to") ? parseInt(qs("to")) : qFrom;

  if (!state.reciter) await ensureDefaultReciter();

  $app.innerHTML = `
    <div class="appbar"><button class="back" onclick="navigate('#/surah/${surahNumber}')">‹</button><h1>صانع فيديو الآية</h1></div>
    <div id="videoArea" class="loading">جارِ التحميل…</div>
  `;

  let data;
  try { data = await getSurahWithAudio(surahNumber, state.reciter.identifier); }
  catch { document.getElementById("videoArea").innerHTML = `<div class="empty-note">تعذّر تحميل السورة.</div>`; return; }

  videoState = {
    surahNumber, surahName: data.name, englishName: data.englishName,
    allAyahs: data.ayahs, translations: null, includeTranslation: true,
    bgMode: "image", bgImage: null, bgVideoEl: null
  };

  const area = document.getElementById("videoArea");
  area.innerHTML = `
    <div class="panel">
      <h4>نطاق الآيات</h4>
      <div class="range-row">
        <select id="vFrom">${data.ayahs.map(a => `<option value="${a.numberInSurah}" ${a.numberInSurah===qFrom?"selected":""}>من آية ${a.numberInSurah}</option>`).join("")}</select>
        <select id="vTo">${data.ayahs.map(a => `<option value="${a.numberInSurah}" ${a.numberInSurah===qTo?"selected":""}>إلى آية ${a.numberInSurah}</option>`).join("")}</select>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--parchment);margin-top:4px;">
        <input type="checkbox" id="vTranslate" checked style="width:16px;height:16px;"> إظهار الترجمة الإنجليزية
      </label>
    </div>

    <div class="panel">
      <h4>القارئ</h4>
      <button class="btn-secondary" id="vReciter" style="margin-top:0">🎙 ${state.reciter.name}</button>
    </div>

    <div class="panel">
      <h4>الخلفية</h4>
      <div class="reader-toolbar" style="padding:0 0 10px">
        <button class="chip active" id="vTabImage">صورة (تكبير تلقائي)</button>
        <button class="chip" id="vTabVideo">فيديو</button>
      </div>
      <input type="file" id="vBgFile" accept="image/*" style="width:100%;color:var(--parchment);font-size:12.5px;">
      <div style="font-size:11.5px;color:var(--muted);margin-top:8px;line-height:1.8;" id="vBgHint">
        الصورة هتتحرك تلقائيًا (زووم بطيء) طول مدة التلاوة.
      </div>
    </div>

    <div class="video-stage-wrap">
      <div class="video-stage">
        <canvas id="vCanvas" width="720" height="1280"></canvas>
        <div class="video-stage-empty" id="vStageEmpty">ارفع خلفية لبدء المعاينة</div>
      </div>
    </div>

    <div class="panel">
      <button class="btn-primary" id="vGenerate" disabled>أنشئ الفيديو</button>
      <div id="vStatus" style="font-size:12.5px;color:var(--muted);margin-top:10px;line-height:1.8;">اختر نطاق الآيات وارفع خلفية.</div>
      <div id="vOutput" style="display:none;margin-top:14px;">
        <video id="vResult" controls style="width:100%;border-radius:14px;border:1px solid var(--line);"></video>
        <a id="vDownload" download="ترتيل.webm" class="btn-primary" style="display:block;text-align:center;text-decoration:none;margin-top:10px;background:var(--sage);color:#0c1a12;">تنزيل الفيديو</a>
      </div>
    </div>
    <div class="notice">التسجيل بيحصل داخل المتصفح مباشرة، وبيعتمد على قدرة المتصفح على التقاط صوت التلاوة أثناء التسجيل. لو الصوت مايظهرش في الفيديو الناتج، جرّب متصفح Chrome، أو قلّل نطاق الآيات وأعد المحاولة.</div>
  `;

  document.getElementById("vReciter").onclick = () => openReciterSheet(() => routes.video([String(surahNumber)]));

  document.getElementById("vFrom").onchange = document.getElementById("vTo").onchange = checkVideoReady;
  document.getElementById("vTranslate").onchange = (e) => { videoState.includeTranslation = e.target.checked; drawVideoPreview(); };

  document.getElementById("vTabImage").onclick = () => setVideoBgTab("image");
  document.getElementById("vTabVideo").onclick = () => setVideoBgTab("video");

  document.getElementById("vBgFile").onchange = handleVideoBgUpload;
  document.getElementById("vGenerate").onclick = generateAyahVideo;

  checkVideoReady();
});

function setVideoBgTab(mode) {
  videoState.bgMode = mode;
  document.getElementById("vTabImage").classList.toggle("active", mode === "image");
  document.getElementById("vTabVideo").classList.toggle("active", mode === "video");
  const input = document.getElementById("vBgFile");
  input.accept = mode === "image" ? "image/*" : "video/*";
  input.value = "";
  videoState.bgImage = null; videoState.bgVideoEl = null;
  document.getElementById("vBgHint").textContent = mode === "image"
    ? "الصورة هتتحرك تلقائيًا (زووم بطيء) طول مدة التلاوة."
    : "الفيديو هيتكرر (loop) لو مدته أقصر من التلاوة، وصوته الأصلي هيتكتم.";
  checkVideoReady();
}

function handleVideoBgUpload() {
  const f = document.getElementById("vBgFile").files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  if (videoState.bgMode === "image") {
    const img = new Image();
    img.onload = () => { videoState.bgImage = img; drawVideoPreview(); checkVideoReady(); };
    img.src = url;
  } else {
    const v = document.createElement("video");
    v.src = url; v.muted = true; v.loop = true; v.playsInline = true;
    v.addEventListener("loadeddata", () => { videoState.bgVideoEl = v; drawVideoPreview(); checkVideoReady(); });
  }
}

function checkVideoReady() {
  const btn = document.getElementById("vGenerate");
  if (!btn) return;
  const ready = !!(videoState.bgImage || videoState.bgVideoEl);
  btn.disabled = !ready;
  drawVideoPreview();
}

function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function wrapText(c, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "", lines = [];
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (c.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  const startY = y - (lines.length - 1) * lineHeight / 2;
  lines.forEach((l, i) => c.fillText(l, x, startY + i * lineHeight));
  return lines;
}

function drawVideoFrame(canvas, ayahText, translationText, label, badgeNumber, t) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (videoState.bgMode === "video" && videoState.bgVideoEl) {
    const v = videoState.bgVideoEl;
    const cover = Math.max(w / v.videoWidth, h / v.videoHeight) || 1;
    const dw = v.videoWidth * cover, dh = v.videoHeight * cover;
    ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else if (videoState.bgImage) {
    const img = videoState.bgImage;
    const breathe = 1 + 0.05 * (1 + Math.sin(t / 4.2));
    const cover = Math.max(w / img.width, h / img.height) * breathe;
    const dw = img.width * cover, dh = img.height * cover;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#0B3B36";
    ctx.fillRect(0, 0, w, h);
  }

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(6,10,9,0.55)");
  grad.addColorStop(0.4, "rgba(6,10,9,0.12)");
  grad.addColorStop(0.62, "rgba(6,10,9,0.55)");
  grad.addColorStop(1, "rgba(6,10,9,0.88)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(228,199,102,0.9)";
  ctx.font = "600 24px Cairo, sans-serif";
  ctx.fillText(label, w / 2, 92);

  const cardX = 46, cardY = h * 0.36, cardW = w - 92, cardH = h * 0.34;
  ctx.fillStyle = "rgba(11,20,18,0.55)";
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 22);
  ctx.fill();
  ctx.strokeStyle = "rgba(201,162,39,0.4)";
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 22);
  ctx.stroke();

  ctx.fillStyle = "#FBF6EC";
  ctx.font = "700 44px 'Amiri Quran', serif";
  ctx.direction = "rtl";
  const arLines = wrapText(ctx, ayahText, w / 2, cardY + cardH * 0.35, cardW - 70, 56);

  // badge with ayah number
  const bx = w / 2, by = cardY + cardH * 0.35 + (arLines.length) * 56 * 0.5 + 40;
  ctx.beginPath();
  ctx.arc(bx, by, 20, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(201,162,39,0.18)";
  ctx.fill();
  ctx.strokeStyle = "#E4C766";
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.fillStyle = "#E4C766";
  ctx.font = "700 16px Cairo, sans-serif";
  ctx.direction = "ltr";
  ctx.fillText(String(badgeNumber), bx, by + 5);

  if (translationText) {
    ctx.fillStyle = "rgba(251,246,236,0.82)";
    ctx.font = "400 20px Cairo, sans-serif";
    ctx.direction = "ltr";
    wrapText(ctx, translationText, w / 2, cardY + cardH * 0.86, cardW - 90, 28);
  }
}

function drawVideoPreview() {
  const canvas = document.getElementById("vCanvas");
  const empty = document.getElementById("vStageEmpty");
  if (!canvas) return;
  if (!videoState.bgImage && !videoState.bgVideoEl) { if (empty) empty.style.display = "flex"; return; }
  if (empty) empty.style.display = "none";

  const fromN = parseInt(document.getElementById("vFrom")?.value || 1);
  const ayah = videoState.allAyahs.find(a => a.numberInSurah === fromN) || videoState.allAyahs[0];
  const label = `سُورَة ${videoState.surahName} — ${videoState.englishName}`;
  drawVideoFrame(canvas, ayah.text, videoState.includeTranslation ? "…" : null, label, ayah.numberInSurah, 0);
}

async function generateAyahVideo() {
  const btn = document.getElementById("vGenerate");
  const statusEl = document.getElementById("vStatus");
  const output = document.getElementById("vOutput");
  btn.disabled = true;
  output.style.display = "none";
  const setStatus = (m) => { statusEl.textContent = m; };

  const fromN = parseInt(document.getElementById("vFrom").value);
  const toN = parseInt(document.getElementById("vTo").value);
  const lo = Math.min(fromN, toN), hi = Math.max(fromN, toN);

  const queue = videoState.allAyahs.filter(a => a.numberInSurah >= lo && a.numberInSurah <= hi && a.audio);
  if (!queue.length) { setStatus("لا يوجد صوت متاح لهذا النطاق."); btn.disabled = false; return; }

  if (videoState.includeTranslation && !videoState.translations) {
    setStatus("بنجيب الترجمة…");
    try { videoState.translations = await getSurahTranslation(videoState.surahNumber, "en.sahih"); }
    catch { videoState.translations = {}; }
  }

  const canvas = document.getElementById("vCanvas");
  try { await document.fonts.load("700 44px 'Amiri Quran'"); await document.fonts.load("400 20px Cairo"); } catch {}

  const label = `سُورَة ${videoState.surahName} — ${videoState.englishName}`;

  const vAudio = new Audio();
  vAudio.crossOrigin = "anonymous";
  vAudio.preload = "auto";

  setStatus("بنجهّز المسجّل…");
  const canvasStream = canvas.captureStream(30);
  let audioStream = null;
  try { audioStream = vAudio.captureStream ? vAudio.captureStream() : vAudio.mozCaptureStream(); }
  catch (e) {}

  if (!audioStream) {
    setStatus("تعذّر تسجيل الصوت في هذا المتصفح. جرّب Chrome على الموبايل أو الكمبيوتر.");
    btn.disabled = false;
    return;
  }

  const mimeOptions = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const mimeType = mimeOptions.find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";
  const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  let stopped = false;
  recorder.onstop = () => {
    stopped = true;
    if (videoState.bgVideoEl) videoState.bgVideoEl.pause();
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    document.getElementById("vResult").src = url;
    document.getElementById("vDownload").href = url;
    output.style.display = "block";
    setStatus("تم إنشاء الفيديو ✅");
    btn.disabled = false;
  };

  let audioTrackAdded = false;
  let queueIndex = 0;
  let globalT0 = performance.now();

  function playNext() {
    const item = queue[queueIndex];
    if (!item) { recorder.stop(); return; }
    vAudio.src = item.audio;
    vAudio.load();
    vAudio.oncanplaythrough = () => {
      vAudio.oncanplaythrough = null;
      if (!audioTrackAdded) {
        audioStream.getAudioTracks().forEach(t => canvasStream.addTrack(t));
        audioTrackAdded = true;
      }
      if (queueIndex === 0 && recorder.state === "inactive") {
        recorder.start();
        if (videoState.bgMode === "video" && videoState.bgVideoEl) {
          videoState.bgVideoEl.currentTime = 0; videoState.bgVideoEl.play().catch(() => {});
        }
        loop();
      }
      vAudio.play().catch(() => {
        setStatus("تعذّر تشغيل الصوت تلقائيًا — اضغط في أي مكان بالصفحة ثم أعد المحاولة.");
      });
    };
    vAudio.onended = () => {
      queueIndex++;
      if (queueIndex < queue.length) playNext();
      else recorder.stop();
    };
    vAudio.onerror = () => {
      setStatus(`تعذّر تحميل صوت الآية ${item.numberInSurah}، بنكمل اللي بعدها.`);
      queueIndex++;
      if (queueIndex < queue.length) playNext(); else recorder.stop();
    };
  }

  function loop() {
    if (stopped) return;
    const t = (performance.now() - globalT0) / 1000;
    const item = queue[queueIndex] || queue[queue.length - 1];
    const translationText = videoState.includeTranslation
      ? (videoState.translations && videoState.translations[item.numberInSurah]
          ? `"${videoState.translations[item.numberInSurah]}" (${videoState.surahNumber}:${item.numberInSurah})`
          : `(${videoState.surahNumber}:${item.numberInSurah})`)
      : null;
    drawVideoFrame(canvas, item.text, translationText, label, item.numberInSurah, t);
    requestAnimationFrame(loop);
  }

  setStatus(`جاري تسجيل ${queue.length} آية…`);
  playNext();
}

/* ================= المراجعة والحفظ (Tracker) ================= */
route("tracker", async () => {
  $app.innerHTML = `
    <div class="appbar"><h1>المراجعة والحفظ</h1></div>
    <div class="section-title"><h3>مستحقة اليوم</h3></div>
    <div id="trackDue" class="due-list"><div class="loading">جارِ التحميل…</div></div>
    <div class="section-title"><h3>كل المقاطع المحفوظة</h3></div>
    <div id="trackAll" class="due-list"></div>
  `;
  const list = await getSurahList().catch(() => []);
  const nameOf = (n) => list.find(s => s.number === n)?.name || `سورة ${n}`;

  const due = dueToday();
  document.getElementById("trackDue").innerHTML = due.length ? due.map(r => `
    <button class="due-item" data-id="${r.id}">
      <div class="rosette">${r.surah}</div>
      <div class="meta"><b>${nameOf(r.surah)}</b><span>الآيات ${r.from}–${r.to}</span></div>
      <span class="pill">راجع الآن</span>
    </button>`).join("") : `<div class="empty-note">لا شيء مستحق اليوم، بارك الله فيك 🌿</div>`;
  document.querySelectorAll("#trackDue .due-item").forEach(btn => {
    btn.onclick = () => { const r = state.reviewQueue.find(x => x.id === btn.dataset.id); navigate(`#/surah/${r.surah}?from=${r.from}&to=${r.to}&reviewId=${r.id}`); };
  });

  document.getElementById("trackAll").innerHTML = state.reviewQueue.length ? state.reviewQueue
    .slice().sort((a,b) => new Date(a.next) - new Date(b.next))
    .map(r => `
    <div class="due-item">
      <div class="rosette">${r.surah}</div>
      <div class="meta"><b>${nameOf(r.surah)}</b><span>الآيات ${r.from}–${r.to} · القادمة: ${new Date(r.next).toLocaleDateString("ar-EG")}</span></div>
      <button class="round-btn" data-del="${r.id}">✕</button>
    </div>`).join("") : `<div class="empty-note">لم تُضِف أي مقاطع بعد. افتح سورة، اختر آيات، واضغط "وضع حفظ محفوظ".</div>`;
  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = () => { state.reviewQueue = state.reviewQueue.filter(r => r.id !== btn.dataset.del); saveState(); routes.tracker(); };
  });
});

/* ================= الإعدادات ================= */
route("settings", async () => {
  $app.innerHTML = `
    <div class="appbar"><h1>الإعدادات</h1></div>
    <div class="panel">
      <h4>القارئ المفضّل</h4>
      <button class="btn-secondary" id="setReciter">${state.reciter ? state.reciter.name : "اختيار قارئ"}</button>
    </div>
    <div class="panel">
      <h4>تثبيت التطبيق</h4>
      <p style="font-size:12.5px;color:var(--muted);line-height:1.9;margin:0 0 12px">
        لتثبيت "ترتيل" كتطبيق على شاشتك الرئيسية: افتح قائمة المتصفح ثم اختر "إضافة إلى الشاشة الرئيسية" (Add to Home Screen). يعمل التطبيق بعدها حتى بدون إنترنت للسور التي فتحتها من قبل.
      </p>
    </div>
    <div class="panel">
      <h4>البيانات</h4>
      <button class="btn-secondary" id="clearCache">مسح الملفات المخزّنة مؤقتًا</button>
      <button class="btn-secondary" id="clearAll" style="color:var(--maroon)">حذف كل بيانات الحفظ والمراجعة</button>
    </div>
    <div class="notice">مصادر النصوص والتلاوات: Al Quran Cloud (api.alquran.cloud). التطبيق لا يستخدم أي بيانات صوتية خاصة بك سوى ما يلزم مؤقتًا لميزة التسميع داخل متصفحك، ولا يُرسل صوتك إلى أي خادم تابع للتطبيق.</div>
  `;
  document.getElementById("setReciter").onclick = () => openReciterSheet(() => routes.settings());
  document.getElementById("clearCache").onclick = () => {
    Object.keys(localStorage).filter(k => k.startsWith("tr_surah_")).forEach(k => localStorage.removeItem(k));
    toast("تم مسح الملفات المؤقتة");
  };
  document.getElementById("clearAll").onclick = () => {
    if (!confirm("سيتم حذف كل تقدّمك في الحفظ والمراجعة نهائيًا. متابعة؟")) return;
    localStorage.clear();
    location.reload();
  };
});

/* اجعل navigate متاحة من HTML inline */
window.navigate = navigate;
