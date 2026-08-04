"use strict";

/* ============================================================
   벨트 체계 / 승급 기준
   - 화이트 0~3그랄 → 다음 그랄 : 3개월 + 30일 출석
   - 화이트 4그랄 → 블루 이후 블랙까지 전 단계 : 7개월 + 90일 출석
   ============================================================ */

const BELTS = [
  { id: "white",  name: "화이트", css: "#ffffff" },
  { id: "blue",   name: "블루",   css: "#2563eb" },
  { id: "purple", name: "퍼플",   css: "#7c3aed" },
  { id: "brown",  name: "브라운", css: "#6b3410" },
  { id: "black",  name: "블랙",   css: "#14161a" }
];
const MAX_STRIPE = 4;
const BLACK = BELTS.length - 1;                 // 블랙벨트 인덱스 (최종)
const TOTAL_STEPS = BLACK * (MAX_STRIPE + 1);   // 20단계

const EASY = { months: 3, days: 30 };
const HARD = { months: 7, days: 90 };

/** 현재 위치(벨트, 그랄)에서 다음 승급까지의 최소 기준. 블랙이면 null */
function requirementOf(belt, stripe) {
  if (belt >= BLACK) return null;
  return (belt === 0 && stripe < MAX_STRIPE) ? EASY : HARD;
}

/** 현재 위치의 전체 진행 단계 인덱스 (0 ~ 20) */
function stepIndexOf(belt, stripe) {
  return belt >= BLACK ? TOTAL_STEPS : belt * (MAX_STRIPE + 1) + stripe;
}

/** 승급 후 위치 */
function nextOf(belt, stripe) {
  if (belt >= BLACK) return { belt, stripe: 0 };
  return stripe < MAX_STRIPE ? { belt, stripe: stripe + 1 } : { belt: belt + 1, stripe: 0 };
}

function labelOf(belt, stripe) {
  if (belt >= BLACK) return "블랙벨트";
  return BELTS[belt].name + " " + stripe + "그랄";
}

/* ============================================================
   날짜 유틸 — 전부 로컬 타임존 기준, 키는 "YYYY-MM-DD"
   ============================================================ */

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function key(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}
function parseKey(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function today() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
/** 월 단위 가감. 말일 넘침 방지 (1/31 + 1개월 = 2/28) */
function addMonths(d, n) {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d.getDate(), last));
  return t;
}
function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}
/** 경과 개월수 (소수 포함). 진행률 표시에 사용 */
function monthsElapsed(from, to) {
  if (to <= from) return 0;
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (addMonths(from, m) > to) m--;
  const prev = addMonths(from, m);
  const next = addMonths(from, m + 1);
  return m + (to - prev) / (next - prev);
}

/* ============================================================
   상태 / 저장
   ============================================================ */

const STORE_KEY = "bjj-attendance";

let state = {
  belt: 0,
  stripe: 0,
  startedAt: "",        // 주짓수를 처음 시작한 날. 비어 있으면 미설정
  promotedAt: key(today()),
  attendance: [],       // "YYYY-MM-DD" 배열 (정렬·중복 제거 유지)
  history: [],          // { date, belt, stripe } — 승급 이력
  updatedAt: ""         // ISO 문자열. 병합 시 스칼라 필드의 승자를 정하는 기준
};

let calCursor = today();   // 캘린더가 보고 있는 달

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object") return false;
    state = normalize(d);
    return true;
  } catch (e) {
    console.warn("저장된 데이터를 읽지 못했습니다", e);
    return false;
  }
}

function normalize(d) {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const belt = clamp(Number(d.belt) || 0, 0, BLACK);
  const stripe = belt >= BLACK ? 0 : clamp(Number(d.stripe) || 0, 0, MAX_STRIPE);
  const att = Array.isArray(d.attendance)
    ? [...new Set(d.attendance.filter(s => typeof s === "string" && DATE_RE.test(s)))].sort()
    : [];
  // 날짜를 키로 중복 제거 + 오름차순 정렬 — 손으로 만든 파일을 불러와도 불변식이 유지된다
  const hist = Array.isArray(d.history)
    ? [...new Map(d.history
        .filter(h => h && DATE_RE.test(h.date))
        .map(h => {
          const b = clamp(Number(h.belt) || 0, 0, BLACK);
          return [h.date, { date: h.date, belt: b,
                            stripe: b >= BLACK ? 0 : clamp(Number(h.stripe) || 0, 0, MAX_STRIPE) }];
        })).values()].sort((a, b) => a.date.localeCompare(b.date))
    : [];
  return {
    belt, stripe,
    startedAt: DATE_RE.test(d.startedAt) ? d.startedAt : "",
    promotedAt: DATE_RE.test(d.promotedAt) ? d.promotedAt : key(today()),
    attendance: att,
    history: hist,
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : ""
  };
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

/** 사용자 변경에 의한 저장. updatedAt 을 갱신하고 동기화를 예약한다. */
function save() {
  state.updatedAt = new Date().toISOString();
  writeLocal();
  scheduleSync();
}

/** 병합 결과 반영 등 updatedAt 을 건드리면 안 되는 저장 */
function writeLocal() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast("저장 실패 — 저장 공간을 확인하세요");
  }
}

/* ============================================================
   출석 조작
   ============================================================ */

function hasAttended(k) {
  return state.attendance.includes(k);
}

/** 출석 토글. 미래 날짜는 무시 */
function toggleDay(k) {
  if (parseKey(k) > today()) return;
  const i = state.attendance.indexOf(k);
  if (i >= 0) {
    state.attendance.splice(i, 1);
    toast(fmtShort(k) + " 출석 취소");
  } else {
    state.attendance.push(k);
    state.attendance.sort();
    toast(fmtShort(k) + " 출석 완료 💪");
  }
  save();
  render();
}

function fmtShort(k) {
  const d = parseKey(k);
  if (k === key(today())) return "오늘";
  if (k === key(addDays(today(), -1))) return "어제";
  return (d.getMonth() + 1) + "/" + d.getDate();
}

/** 현재 단계(승급일 이후)의 출석 일수 */
function currentStageDays() {
  const from = state.promotedAt;
  const to = key(today());
  return state.attendance.filter(k => k >= from && k <= to).length;
}

/* ============================================================
   렌더링
   ============================================================ */

const $ = id => document.getElementById(id);

function render() {
  renderBelt();
  renderToday();
  renderGoal();
  renderCalendar();
  renderStats();
  renderRoadmap();
  renderSettings();
  renderSync();
}

function renderBelt() {
  const isBlack = state.belt >= BLACK;
  $("beltTitle").textContent = labelOf(state.belt, state.stripe);

  const since = daysBetween(parseKey(state.promotedAt), today());
  $("beltSub").textContent = since >= 0
    ? `${state.promotedAt} 시작 · ${since}일째`
    : `${state.promotedAt} 시작 예정`;

  const bar = $("beltBar");
  bar.style.background = BELTS[state.belt].css;
  bar.classList.toggle("is-black", isBlack);

  // 감긴 그랄만 그린다 — 빈 슬롯은 표시하지 않음
  const wrap = $("beltStripes");
  wrap.innerHTML = "";
  if (!isBlack) {
    for (let i = 0; i < state.stripe; i++) {
      const s = document.createElement("div");
      s.className = "stripe";
      wrap.appendChild(s);
    }
  }
}

function renderToday() {
  const t = today();
  const k = key(t);
  $("todayD").textContent = `${t.getFullYear()}. ${t.getMonth() + 1}. ${t.getDate()}.`;
  $("todayW").textContent = DOW[t.getDay()] + "요일";

  const btn = $("btnToday");
  const done = hasAttended(k);
  btn.textContent = done ? "✓ 출석함" : "출석 체크";
  btn.classList.toggle("done", done);
}

function renderGoal() {
  const req = requirementOf(state.belt, state.stripe);
  const from = parseKey(state.promotedAt);
  const t = today();

  if (!req) {
    $("goalTo").textContent = "블랙벨트 도달";
    $("goalPct").textContent = "100%";
    // setBar 로 채워야 이전 렌더가 남긴 미달(주황) 클래스까지 초기화된다
    ["mMonths", "mDays"].forEach(p => {
      $(p + "Val").textContent = "–";
      setBar(p + "Bar", 1, true);
      $(p + "Note").textContent = "";
    });
    const box = $("readyBox");
    box.className = "ready";
    box.textContent = "🥋 최고 단계입니다. 오스!";
    return;
  }

  const nx = nextOf(state.belt, state.stripe);
  $("goalTo").textContent = labelOf(nx.belt, nx.stripe);

  // 기간
  const elapsed = monthsElapsed(from, t);
  const targetDate = addMonths(from, req.months);
  const monthsPct = clamp(elapsed / req.months, 0, 1);
  const monthsOk = t >= targetDate;
  const dLeft = daysBetween(t, targetDate);

  $("mMonthsVal").innerHTML = `<b>${elapsed.toFixed(1)}</b> / ${req.months}개월`;
  setBar("mMonthsBar", monthsPct, monthsOk);
  $("mMonthsNote").textContent = monthsOk
    ? `충족 · ${targetDate.getFullYear()}. ${targetDate.getMonth() + 1}. ${targetDate.getDate()}. 통과`
    : `${targetDate.getFullYear()}. ${targetDate.getMonth() + 1}. ${targetDate.getDate()}. 충족 (D-${dLeft})`;

  // 출석
  const days = currentStageDays();
  const daysPct = clamp(days / req.days, 0, 1);
  const daysOk = days >= req.days;
  const remain = req.days - days;

  $("mDaysVal").innerHTML = `<b>${days}</b> / ${req.days}일`;
  setBar("mDaysBar", daysPct, daysOk);
  $("mDaysNote").textContent = daysOk ? "충족" : `${remain}일 더 필요` + pacingHint(remain, dLeft);

  // 종합 = 두 조건 모두 필요하므로 낮은 쪽
  const overall = Math.min(monthsPct, daysPct);
  $("goalPct").textContent = Math.floor(overall * 100) + "%";

  const box = $("readyBox");
  if (monthsOk && daysOk) {
    box.className = "ready";
    box.textContent = "✅ 최소 승급 기준 충족 — 관장님만 믿습니다";
  } else {
    box.className = "ready wait";
    const parts = [];
    if (!monthsOk) parts.push(`기간 ${dLeft}일`);
    if (!daysOk) parts.push(`출석 ${remain}일`);
    box.textContent = "남은 조건 · " + parts.join(" / ");
  }
}

/** 기간 조건보다 출석이 뒤처지면 주당 몇 회 필요한지 귀띔 */
function pacingHint(remainDays, daysLeftForMonths) {
  if (remainDays <= 0 || daysLeftForMonths <= 0) return "";
  const perWeek = remainDays / (daysLeftForMonths / 7);
  if (perWeek <= 0.5) return "";
  return ` · 기간 충족일까지 주 ${perWeek.toFixed(1)}회 필요`;
}

function setBar(id, pct, ok) {
  const bar = $(id);
  bar.classList.toggle("met", ok);
  bar.classList.toggle("short", !ok);
  bar.firstElementChild.style.width = (pct * 100).toFixed(1) + "%";
}

function renderCalendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  $("calMonth").textContent = `${y}년 ${m + 1}월`;

  const grid = $("calGrid");
  grid.innerHTML = "";
  DOW.forEach((w, i) => {
    const el = document.createElement("div");
    el.className = "dow" + (i === 0 ? " sun" : i === 6 ? " sat" : "");
    el.textContent = w;
    grid.appendChild(el);
  });

  const first = new Date(y, m, 1);
  const lastDate = new Date(y, m + 1, 0).getDate();
  const tk = key(today());

  for (let i = 0; i < first.getDay(); i++) {
    const b = document.createElement("div");
    b.className = "day blank";
    grid.appendChild(b);
  }

  for (let d = 1; d <= lastDate; d++) {
    const dk = key(new Date(y, m, d));
    const btn = document.createElement("button");
    const cls = ["day"];
    if (hasAttended(dk)) cls.push("on");
    if (dk === tk) cls.push("today");
    if (dk > tk) cls.push("future");
    if (dk < state.promotedAt) cls.push("before-promo");
    btn.className = cls.join(" ");
    btn.textContent = d;
    if (dk === state.promotedAt || state.history.some(h => h.date === dk)) {
      const dot = document.createElement("span");
      dot.className = "promo-dot";
      btn.appendChild(dot);
    }
    btn.onclick = () => toggleDay(dk);
    grid.appendChild(btn);
  }

  // 다음 달 버튼: 이번 달 이후로는 못 감
  const t = today();
  $("calNext").disabled = (y > t.getFullYear()) ||
                          (y === t.getFullYear() && m >= t.getMonth());
}

/** 시작일로부터 지금까지를 "N년 M개월째" 로. 한 달 미만이면 일 단위 */
function fmtSpan(fromKey) {
  const from = parseKey(fromKey), t = today();
  if (t < from) return "시작 예정";
  const m = Math.floor(monthsElapsed(from, t));
  if (m < 1) return `${daysBetween(from, t)}일째`;
  const parts = [];
  if (Math.floor(m / 12)) parts.push(`${Math.floor(m / 12)}년`);
  if (m % 12) parts.push(`${m % 12}개월`);
  return parts.join(" ") + "째";
}

function renderStats() {
  const t = today();

  const note = $("startedNote");
  note.hidden = !state.startedAt;
  if (state.startedAt) {
    note.innerHTML = `주짓수 시작 ${state.startedAt} · <b>${fmtSpan(state.startedAt)}</b>`;
  }

  $("stTotal").textContent = state.attendance.length;

  const prefix = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
  $("stMonth").textContent = state.attendance.filter(k => k.startsWith(prefix)).length;

  const from = key(addDays(t, -27));
  const recent = state.attendance.filter(k => k >= from && k <= key(t)).length;
  $("stWeek").textContent = (recent / 4).toFixed(1);
}

function renderRoadmap() {
  const req = requirementOf(state.belt, state.stripe);
  const step = stepIndexOf(state.belt, state.stripe);

  let inStep = 0;
  if (req) {
    const mPct = clamp(monthsElapsed(parseKey(state.promotedAt), today()) / req.months, 0, 1);
    const dPct = clamp(currentStageDays() / req.days, 0, 1);
    inStep = Math.min(mPct, dPct);
  }
  const total = clamp((step + inStep) / TOTAL_STEPS, 0, 1);

  $("roadStep").textContent = `${step} / ${TOTAL_STEPS} 단계`;
  $("roadPct").textContent = (total * 100).toFixed(1) + "%";
  $("roadBar").style.width = (total * 100).toFixed(1) + "%";

  const list = $("roadList");
  list.innerHTML = "";
  for (let b = 0; b < BLACK; b++) {
    const row = document.createElement("div");
    row.className = "road-row" + (b === state.belt ? " cur" : "");

    const nm = document.createElement("div");
    nm.className = "nm";
    nm.textContent = BELTS[b].name;
    row.appendChild(nm);

    const dots = document.createElement("div");
    dots.className = "road-dots";
    // 5칸 = 0그랄 상태 + 1~4그랄. 지나온 칸은 done, 현재 칸은 cur
    for (let s = 0; s <= MAX_STRIPE; s++) {
      const i = document.createElement("i");
      const idx = stepIndexOf(b, s);
      if (idx < step) i.className = "done";
      else if (idx === step) i.className = "cur";
      dots.appendChild(i);
    }
    row.appendChild(dots);

    const rq = document.createElement("div");
    rq.className = "rq";
    rq.textContent = b === 0 ? "3개월/30일*" : "7개월/90일";
    row.appendChild(rq);

    list.appendChild(row);
  }

  const blackRow = document.createElement("div");
  blackRow.className = "road-row" + (state.belt >= BLACK ? " cur" : "");
  blackRow.innerHTML = `<div class="nm">블랙</div>
    <div class="road-dots"><i class="${state.belt >= BLACK ? "done" : ""}"></i></div>
    <div class="rq">목표</div>`;
  list.appendChild(blackRow);

  const note = document.createElement("p");
  note.className = "hint";
  note.style.marginTop = "10px";
  note.textContent = "* 화이트 4그랄 → 블루부터는 7개월 / 90일 기준";
  list.appendChild(note);
}

function renderSettings() {
  const bs = $("setBelt");
  if (!bs.options.length) {
    BELTS.forEach((b, i) => bs.add(new Option(b.name, i)));
    const ss = $("setStripe");
    for (let i = 0; i <= MAX_STRIPE; i++) ss.add(new Option(i + "그랄", i));
  }
  bs.value = state.belt;
  $("setStripe").value = state.stripe;
  $("setStripe").disabled = state.belt >= BLACK;
  $("setStarted").value = state.startedAt;
  $("setStarted").max = key(today());
  $("setPromoted").value = state.promotedAt;
  $("setPromoted").max = key(today());
  // 승급 기록 폼의 셀렉트도 한 번만 채운다
  const hb = $("histBelt");
  if (!hb.options.length) {
    BELTS.forEach((b, i) => hb.add(new Option(b.name, i)));
    const hs = $("histStripe");
    for (let i = 0; i <= MAX_STRIPE; i++) hs.add(new Option(i + "그랄", i));
  }
  $("histDate").max = key(today());
  $("histStripe").disabled = Number(hb.value) >= BLACK;

  renderHistory();
  renderHistEffect();
}

/**
 * 현재 단계를 만든 승급(날짜가 단계 시작일과 같은 항목)만 [되돌리기],
 * 나머지는 순수 기록이므로 [삭제].
 */
function renderHistory() {
  const h = $("histList");
  h.innerHTML = "";
  if (!state.history.length) {
    h.innerHTML = '<div class="empty">기록된 승급이 없습니다.</div>';
    return;
  }
  const sorted = [...state.history].sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach((rec, i) => {
    const item = document.createElement("div");
    item.className = "item";
    const span = document.createElement("span");
    span.innerHTML = `${rec.date} · <b>${labelOf(rec.belt, rec.stripe)}</b>`;
    item.appendChild(span);

    const btn = document.createElement("button");
    if (i === 0 && rec.date === state.promotedAt) {
      btn.textContent = "되돌리기";
      btn.onclick = undoPromotion;
    } else {
      btn.textContent = "삭제";
      btn.onclick = () => deleteHistory(rec.date);
    }
    item.appendChild(btn);
    h.appendChild(item);
  });
}

/** 폼에 입력된 값이 현재 상태를 바꾸는지 미리 알려준다 */
function renderHistEffect() {
  const el = $("histEffect");
  if (!el) return;
  const date = $("histDate").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { el.textContent = "승급일을 선택하세요."; return; }
  if (parseKey(date) > today()) { el.textContent = "미래 날짜는 기록할 수 없습니다."; return; }

  const belt = clamp(Number($("histBelt").value), 0, BLACK);
  const stripe = belt >= BLACK ? 0 : clamp(Number($("histStripe").value), 0, MAX_STRIPE);
  el.innerHTML = becomesCurrent(date)
    ? `현재 벨트가 <b>${labelOf(belt, stripe)}</b>로 바뀌고 단계 시작일이 <b>${date}</b>가 됩니다.`
    : `현재 단계 시작일(${state.promotedAt})보다 이전이라 <b>이력에만</b> 남습니다.`;
}

/** 이 승급일이 현재 단계를 대체하는지 — 단계 시작일 이후면 최신 승급으로 본다 */
function becomesCurrent(date) {
  return date >= state.promotedAt;
}

/* ============================================================
   액션
   ============================================================ */

/** 날짜를 키로 하는 upsert. 같은 날짜가 있으면 교체하고 항상 날짜순을 유지한다 */
function putHistory(rec) {
  state.history = state.history.filter(h => h.date !== rec.date);
  state.history.push(rec);
  state.history.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 승급 기록 — 오늘 받은 것과 지난 승급을 같은 경로로 처리한다.
 * 승급일이 현재 단계 시작일 이후면 현재 벨트·시작일까지 갱신하고,
 * 그보다 이전이면 이력에만 남긴다. 출석 기록은 어느 쪽이든 건드리지 않는다.
 */
function recordPromotion() {
  const date = $("histDate").value;
  const belt = clamp(Number($("histBelt").value), 0, BLACK);
  const stripe = belt >= BLACK ? 0 : clamp(Number($("histStripe").value), 0, MAX_STRIPE);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("승급일을 선택하세요"); return; }
  if (parseKey(date) > today()) { toast("미래 날짜는 기록할 수 없습니다"); return; }
  const dup = state.history.find(h => h.date === date);
  if (dup && !confirm(`${date}에 이미 ${labelOf(dup.belt, dup.stripe)} 기록이 있습니다. 바꿀까요?`)) return;

  const current = becomesCurrent(date);
  putHistory({ date, belt, stripe });
  if (current) {
    state.belt = belt;
    state.stripe = stripe;
    state.promotedAt = date;
  }
  save();
  $("histForm").hidden = true;
  render();
  toast(current
    ? `🎉 ${labelOf(belt, stripe)} 축하합니다!`
    : `${date} · ${labelOf(belt, stripe)} 기록됨`);
}

function deleteHistory(date) {
  const rec = state.history.find(h => h.date === date);
  if (!rec) return;
  if (!confirm(`${date} · ${labelOf(rec.belt, rec.stripe)} 기록을 삭제합니다.`)) return;
  state.history = state.history.filter(h => h.date !== date);
  save();
  render();
  toast("기록을 삭제했습니다");
}

/** 최신 이력을 지우고 현재 벨트·단계 시작일을 그 이전 이력으로 되돌린다 */
function undoPromotion() {
  if (!state.history.length) return;
  const sorted = [...state.history].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  if (!confirm(`${last.date} · ${labelOf(last.belt, last.stripe)} 승급을 되돌립니다. 계속할까요?`)) return;

  state.history = sorted.slice(0, -1);
  const prev = state.history[state.history.length - 1];
  if (prev) {
    state.belt = prev.belt;
    state.stripe = prev.stripe;
    state.promotedAt = prev.date;
  } else {
    // 이력이 비면 한 단계 아래로 되돌리되, 시작일은 사용자가 설정에서 조정
    const step = Math.max(0, stepIndexOf(state.belt, state.stripe) - 1);
    state.belt = Math.floor(step / (MAX_STRIPE + 1));
    state.stripe = step % (MAX_STRIPE + 1);
  }
  save();
  render();
  toast("승급을 되돌렸습니다");
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bjj-attendance-${key(today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("백업 파일을 저장했습니다");
}

function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data || typeof data !== "object") throw new Error("형식 오류");
      if (!confirm("현재 데이터를 백업 파일 내용으로 덮어씁니다. 계속할까요?")) return;
      state = normalize(data);
      calCursor = today();
      saveOverwrite();
      render();
      toast("복원 완료 · 출석 " + state.attendance.length + "일");
    } catch (e) {
      alert("복원 실패: 올바른 백업 파일이 아닙니다.");
    }
  };
  r.readAsText(file);
}

function resetAll() {
  const extra = syncOn() ? "\n연결된 Gist의 기록도 함께 비워집니다." : "";
  if (!confirm("모든 출석 기록과 벨트 정보를 지웁니다. 되돌릴 수 없습니다." + extra)) return;
  if (!confirm("정말 초기화할까요?")) return;
  state = normalize({ promotedAt: key(today()) });
  calCursor = today();
  saveOverwrite();
  render();
  toast("초기화되었습니다");
}

/* ============================================================
   기기 간 동기화 — GitHub Gist
   토큰은 state 와 분리해 별도 키에 보관한다 (백업 파일에 섞이지 않도록).
   ============================================================ */

const SYNC_KEY = "bjj-attendance-sync";
const GIST_FILE = "bjj-attendance.json";
const GIST_DESC = "주짓수 출석 트래커 기록";

let sync = { token: "", gistId: "", lastSync: "" };
let syncStatus = { kind: "off", msg: "" };   // off | ok | busy | err
let syncTimer = null;

function loadSync() {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) Object.assign(sync, JSON.parse(raw));
  } catch (e) { /* 손상된 값은 무시하고 미연결 상태로 시작 */ }
}
function saveSync() {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) {}
}
const syncOn = () => !!(sync.token && sync.gistId);

async function gh(path, opts = {}) {
  const headers = { "Accept": "application/vnd.github+json",
                    "Authorization": "Bearer " + sync.token };
  if (opts.body) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch("https://api.github.com" + path, { ...opts, headers });
  } catch (e) {
    throw new Error("네트워크에 연결할 수 없습니다");
  }
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "토큰이 유효하지 않거나 만료되었습니다"
      : res.status === 403 ? "권한이 없습니다 — 토큰에 gist 권한이 있는지 확인하세요"
      : res.status === 404 ? "Gist를 찾을 수 없습니다 — 연결을 해제하고 다시 연결하세요"
      : "깃허브 오류 " + res.status);
  }
  return res.json();
}

/** 출석 날짜는 합집합, 벨트·시작일 등 스칼라는 나중에 수정한 쪽이 이긴다 */
function mergeStates(a, b) {
  const newer = (b.updatedAt || "") > (a.updatedAt || "") ? b : a;
  const histByDate = new Map();
  [...a.history, ...b.history].forEach(h => histByDate.set(h.date, h));
  return {
    belt: newer.belt,
    stripe: newer.stripe,
    // 시작일은 "가장 이른 기록"이 진실이므로 최신 우선이 아니라 최소값을 쓴다
    startedAt: [a.startedAt, b.startedAt].filter(Boolean).sort()[0] || "",
    promotedAt: newer.promotedAt,
    attendance: [...new Set([...a.attendance, ...b.attendance])].sort(),
    history: [...histByDate.values()].sort((x, y) => x.date.localeCompare(y.date)),
    updatedAt: newer.updatedAt || ""
  };
}

function sameState(a, b) {
  const norm = s => JSON.stringify([s.belt, s.stripe, s.startedAt, s.promotedAt,
                                    s.attendance, s.history]);
  return norm(a) === norm(b);
}

/** 토큰으로 기존 Gist 를 찾고, 없으면 새로 만든다 */
async function connectSync(token) {
  sync.token = token.trim();
  setSyncStatus("busy", "연결 중…");
  try {
    const list = await gh("/gists?per_page=100");
    const found = list.find(g => g.files && g.files[GIST_FILE]);
    if (found) {
      sync.gistId = found.id;
    } else {
      const created = await gh("/gists", {
        method: "POST",
        body: JSON.stringify({
          description: GIST_DESC, public: false,
          files: { [GIST_FILE]: { content: JSON.stringify(state, null, 2) } }
        })
      });
      sync.gistId = created.id;
    }
    saveSync();
    await syncNow(true);
    toast(found ? "기존 기록을 이어받았습니다" : "동기화를 시작합니다");
  } catch (e) {
    sync.token = ""; sync.gistId = "";
    setSyncStatus("err", e.message);
    render();
  }
}

/** 원격을 읽어 병합하고, 달라진 게 있으면 올린다 */
async function syncNow(manual = false) {
  if (!syncOn()) return;
  setSyncStatus("busy", "동기화 중…");
  try {
    const gist = await gh("/gists/" + sync.gistId);
    const file = gist.files && gist.files[GIST_FILE];
    let remote = null;
    if (file) {
      // 1MB 초과 시 content 가 잘리고 truncated=true — 이 앱 데이터 크기로는 사실상 없음
      const text = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
      try { remote = normalize(JSON.parse(text)); } catch (e) { remote = null; }
    }

    const merged = remote ? mergeStates(state, remote) : { ...state };
    const localChanged = !sameState(state, merged);
    const remoteChanged = !remote || !sameState(remote, merged);

    if (localChanged) {
      state = merged;
      writeLocal();
    }
    if (remoteChanged) {
      await gh("/gists/" + sync.gistId, {
        method: "PATCH",
        body: JSON.stringify({
          description: GIST_DESC,
          files: { [GIST_FILE]: { content: JSON.stringify(state, null, 2) } }
        })
      });
    }

    sync.lastSync = new Date().toISOString();
    saveSync();
    setSyncStatus("ok", "");
    render();
    if (manual) toast("동기화 완료");
  } catch (e) {
    setSyncStatus("err", e.message);
    render();
    if (manual) toast(e.message);
  }
}

function scheduleSync() {
  if (!syncOn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(false), 1500);
}

/**
 * 초기화·복원처럼 "덮어쓰기"가 의도된 경우. 병합하면 지운 기록이 원격에서
 * 되돌아오므로 원격을 현재 상태로 밀어버린다.
 */
async function saveOverwrite() {
  state.updatedAt = new Date().toISOString();
  writeLocal();
  if (!syncOn()) return;
  clearTimeout(syncTimer);
  setSyncStatus("busy", "동기화 중…");
  try {
    await gh("/gists/" + sync.gistId, {
      method: "PATCH",
      body: JSON.stringify({
        description: GIST_DESC,
        files: { [GIST_FILE]: { content: JSON.stringify(state, null, 2) } }
      })
    });
    sync.lastSync = new Date().toISOString();
    saveSync();
    setSyncStatus("ok", "");
  } catch (e) {
    setSyncStatus("err", e.message);
    toast(e.message);
  }
  render();
}

function disconnectSync() {
  if (!confirm("연결을 해제합니다. Gist에 저장된 기록은 남아 있고, 같은 토큰으로 다시 연결할 수 있습니다.")) return;
  sync = { token: "", gistId: "", lastSync: "" };
  localStorage.removeItem(SYNC_KEY);
  $("syncToken").value = "";
  setSyncStatus("off", "");
  render();
  toast("연결을 해제했습니다");
}

function setSyncStatus(kind, msg) {
  syncStatus = { kind, msg };
  renderSync();
}

function fmtSince(iso) {
  if (!iso) return "";
  const diff = Math.floor((new Date() - new Date(iso)) / 1000);
  if (diff < 60) return "방금";
  if (diff < 3600) return Math.floor(diff / 60) + "분 전";
  if (diff < 86400) return Math.floor(diff / 3600) + "시간 전";
  return Math.floor(diff / 86400) + "일 전";
}

function renderSync() {
  const on = syncOn();
  $("syncSetup").hidden = on;
  $("syncActive").hidden = !on;

  const box = $("syncState");
  const k = syncStatus.kind;
  box.className = "sync-state" + (on || k === "err" || k === "busy" ? " " + k : "");

  let msg;
  if (k === "busy") msg = syncStatus.msg || "동기화 중…";
  else if (k === "err") msg = syncStatus.msg;
  else if (on) msg = "깃허브 Gist에 백업 중" + (sync.lastSync ? ` · ${fmtSince(sync.lastSync)}` : "");
  else msg = "이 기기에만 저장됨 — 백업 안 됨";
  $("syncMsg").textContent = msg;

  $("footNote").textContent = on
    ? "기록이 깃허브 Gist에 백업됩니다. 다른 기기에서 같은 토큰으로 연결하면 이어집니다."
    : "데이터는 이 브라우저에만 저장됩니다. 설정에서 깃허브에 연결하거나 백업 파일을 받아 두세요.";
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

/* ============================================================
   이벤트 바인딩
   ============================================================ */

$("btnToday").onclick = () => toggleDay(key(today()));

$("calPrev").onclick = () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
  renderCalendar();
};
$("calNext").onclick = () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
  renderCalendar();
};

$("setBelt").onchange = e => {
  state.belt = clamp(Number(e.target.value), 0, BLACK);
  if (state.belt >= BLACK) state.stripe = 0;
  save(); render();
};
$("setStripe").onchange = e => {
  state.stripe = clamp(Number(e.target.value), 0, MAX_STRIPE);
  save(); render();
};
$("setStarted").onchange = e => {
  const v = e.target.value;
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { e.target.value = state.startedAt; return; }
  if (v && parseKey(v) > today()) {
    alert("주짓수 시작일은 오늘 이후일 수 없습니다.");
    e.target.value = state.startedAt;
    return;
  }
  state.startedAt = v;                       // 빈 값이면 미설정으로 되돌린다
  save(); render();
};

$("setPromoted").onchange = e => {
  const v = e.target.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { e.target.value = state.promotedAt; return; }
  if (parseKey(v) > today()) {
    alert("단계 시작일은 오늘 이후일 수 없습니다.");
    e.target.value = state.promotedAt;
    return;
  }
  state.promotedAt = v;
  save(); render();
};

$("btnAddHist").onclick = () => {
  const f = $("histForm");
  f.hidden = !f.hidden;
  if (!f.hidden) {
    // 기본값: 오늘 + 다음 그랄/벨트. 지난 승급이면 날짜만 바꾸면 된다
    const nx = nextOf(state.belt, state.stripe);
    $("histDate").value = key(today());
    $("histBelt").value = nx.belt;
    $("histStripe").value = nx.stripe;
    $("histStripe").disabled = nx.belt >= BLACK;
    renderHistEffect();
  }
};
$("histDate").onchange = renderHistEffect;
$("histStripe").onchange = renderHistEffect;
$("histBelt").onchange = e => {
  $("histStripe").disabled = Number(e.target.value) >= BLACK;
  renderHistEffect();
};
$("btnHistSave").onclick = recordPromotion;
$("btnHistCancel").onclick = () => { $("histForm").hidden = true; };

$("btnExport").onclick = exportData;
$("btnImport").onclick = () => $("fileImport").click();
$("fileImport").onchange = e => {
  const f = e.target.files[0];
  if (f) importData(f);
  e.target.value = "";
};
$("btnReset").onclick = resetAll;

$("btnConnect").onclick = () => {
  const t = $("syncToken").value.trim();
  if (!t) { toast("토큰을 붙여넣어 주세요"); return; }
  connectSync(t);
};
$("syncToken").onkeydown = e => { if (e.key === "Enter") $("btnConnect").click(); };
$("btnSyncNow").onclick = () => syncNow(true);
$("btnGistOpen").onclick = () =>
  window.open("https://gist.github.com/" + sync.gistId, "_blank", "noopener");
$("btnDisconnect").onclick = disconnectSync;

// 앱으로 돌아올 때: 날짜 기준을 갱신하고, 다른 기기의 변경을 가져온다
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  render();
  if (syncOn() && (!sync.lastSync || new Date() - new Date(sync.lastSync) > 60000)) {
    syncNow(false);
  }
});

/* ============================================================
   시작
   ============================================================ */

loadSync();
if (!load()) {
  save();                                  // 첫 실행: 기본값 저장
  $("settings").open = true;               // 벨트/시작일부터 설정하도록 안내
}
render();
if (syncOn()) syncNow(false);              // 다른 기기에서 올린 기록 반영
