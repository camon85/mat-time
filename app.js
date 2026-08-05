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

/** 한글 조사 이/가 선택 — 받침 유무로 갈린다 ("그랄이" vs "블랙벨트가") */
function subjectParticle(word) {
  const c = word.charCodeAt(word.length - 1);
  const hangul = c >= 0xac00 && c <= 0xd7a3;
  return hangul && (c - 0xac00) % 28 !== 0 ? "이" : "가";
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

/*
 * 현재 벨트·그랄·단계 시작일은 따로 저장하지 않는다. 승급 이력(history)의
 * 마지막 항목에서 파생한다 — "단계 시작일"과 "승급일"이 같은 사실이기 때문.
 */
let state = {
  startedAt: "",        // 주짓수를 처음 시작한 날. 비어 있으면 미설정
  attendance: [],       // "YYYY-MM-DD" 배열 (정렬·중복 제거 유지)
  removed: {},          // 출석을 취소한 날짜 → 취소 시각(ISO). 다시 체크하면 키 삭제
  history: [],          // { date, belt, stripe } — 승급 이력. 날짜 오름차순
  updatedAt: ""         // ISO 문자열. 병합 시 승자 판정 기준
};

let calCursor = today();   // 캘린더가 보고 있는 달

/** 현재 벨트·그랄과 그 단계가 시작된 날. 이력이 비면 화이트 0그랄 */
function currentRank() {
  const last = state.history[state.history.length - 1];
  if (!last) return { belt: 0, stripe: 0, since: state.startedAt || key(today()) };
  return { belt: last.belt, stripe: last.stripe, since: last.date };
}

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
  const att = Array.isArray(d.attendance)
    ? [...new Set(d.attendance.filter(s => typeof s === "string" && DATE_RE.test(s)))].sort()
    : [];
  const rem = {};
  if (d.removed && typeof d.removed === "object" && !Array.isArray(d.removed)) {
    for (const [k, v] of Object.entries(d.removed)) {
      if (DATE_RE.test(k) && typeof v === "string" && v) rem[k] = v;
    }
  }
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
  // 켜진 날짜와 끈 날짜가 겹치면 취소가 이긴다 (재체크 시 removed 키를 지우므로)
  return {
    startedAt: DATE_RE.test(d.startedAt) ? d.startedAt : "",
    attendance: att.filter(k => !rem[k]),
    removed: rem,
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

/**
 * 출석 토글. 미래 날짜는 무시.
 * 취소는 removed 에 시각과 함께 남긴다 — 그러지 않으면 동기화 시 원격의
 * 합집합 병합으로 방금 지운 날짜가 되살아난다.
 */
function toggleDay(k) {
  if (parseKey(k) > today()) return;
  const i = state.attendance.indexOf(k);
  if (i >= 0) {
    state.attendance.splice(i, 1);
    state.removed[k] = new Date().toISOString();
    toast(fmtShort(k) + " 출석 취소");
  } else {
    state.attendance.push(k);
    state.attendance.sort();
    delete state.removed[k];
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
  const from = currentRank().since;
  const to = key(today());
  return state.attendance.filter(k => k >= from && k <= to).length;
}

/* ============================================================
   승급식 — 매월 마지막 금요일
   ============================================================ */

/** y년 m월(0-based)의 마지막 금요일 */
function lastFridayOf(y, m) {
  const last = new Date(y, m + 1, 0);            // 그 달 말일
  const back = (last.getDay() - 5 + 7) % 7;      // 금요일 = 5
  return new Date(y, m, last.getDate() - back);
}

/** d 이상인 첫 승급식 */
function ceremonyOnOrAfter(d) {
  const c = lastFridayOf(d.getFullYear(), d.getMonth());
  return c >= d ? c : lastFridayOf(d.getFullYear(), d.getMonth() + 1);
}

function fmtMD(d) {
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
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

/**
 * 벨트 그래픽을 그린다. 감긴 그랄만 표시하고 빈 슬롯은 그리지 않는다.
 * 헤더·진행도·로드맵이 모두 이 함수를 쓴다.
 */
function paintBelt(bar, belt, stripe) {
  const isBlack = belt >= BLACK;
  bar.style.background = BELTS[belt].css;
  bar.classList.toggle("is-black", isBlack);
  bar.setAttribute("aria-label", labelOf(belt, stripe));
  bar.title = labelOf(belt, stripe);

  let wrap = bar.querySelector(".stripes");
  if (!wrap) {
    bar.innerHTML = '<div class="black-tip"></div><div class="stripes"></div>';
    wrap = bar.querySelector(".stripes");
  }
  wrap.innerHTML = "";
  if (!isBlack) {
    for (let i = 0; i < stripe; i++) {
      const s = document.createElement("div");
      s.className = "stripe";
      wrap.appendChild(s);
    }
  }
}

/** 새 벨트 그래픽 요소를 만든다 (로드맵·진행도용) */
function beltEl(belt, stripe, cls) {
  const mount = document.createElement("div");
  mount.className = "belt-mount " + (cls || "");
  const bar = document.createElement("div");
  bar.className = "belt-bar";
  mount.appendChild(bar);
  paintBelt(bar, belt, stripe);
  return mount;
}

function renderBelt() {
  const { belt, stripe, since } = currentRank();
  paintBelt($("beltBar"), belt, stripe);

  // 승급 이력이 없으면 "승급"이 아니라 "시작"이다
  const word = state.history.length ? "승급" : "시작";
  const days = daysBetween(parseKey(since), today());
  $("beltSub").textContent = days >= 0
    ? `${since} ${word} · ${days}일째`
    : `${since} ${word} 예정`;
}

function renderToday() {
  const t = today(), k = key(t);
  const done = hasAttended(k);
  $("todayLine").innerHTML = done
    ? `오늘 <b>${t.getMonth() + 1}/${t.getDate()}(${DOW[t.getDay()]})</b> · <span class="yes">출석 완료</span>`
    : `오늘 <b>${t.getMonth() + 1}/${t.getDate()}(${DOW[t.getDay()]})</b> · 아직 체크 전 — 아래에서 오늘 날짜를 누르세요`;
}

/** 최근 4주 실제 페이스 (주당 출석 횟수) */
function recentPerWeek() {
  const t = today();
  return state.attendance.filter(k => k >= key(addDays(t, -27)) && k <= key(t)).length / 4;
}

function renderGoal() {
  const { belt, stripe, since } = currentRank();
  const req = requirementOf(belt, stripe);
  const from = parseKey(since);
  const t = today();
  const goalBelt = $("goalBelt");

  if (!req) {
    goalBelt.hidden = true;
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

  const nx = nextOf(belt, stripe);
  goalBelt.hidden = false;
  paintBelt($("goalBeltBar"), nx.belt, nx.stripe);

  // 기간
  const elapsed = monthsElapsed(from, t);
  const targetDate = addMonths(from, req.months);
  const monthsPct = clamp(elapsed / req.months, 0, 1);
  const monthsOk = t >= targetDate;
  const dLeft = daysBetween(t, targetDate);

  $("mMonthsVal").innerHTML = `<b>${elapsed.toFixed(1)}</b> / ${req.months}개월`;
  setBar("mMonthsBar", monthsPct, monthsOk);
  $("mMonthsNote").textContent = monthsOk
    ? `충족 · ${key(targetDate)} 통과`
    : `${key(targetDate)} 충족 (D-${dLeft})`;

  // 출석
  const days = currentStageDays();
  const daysPct = clamp(days / req.days, 0, 1);
  const daysOk = days >= req.days;
  const remain = req.days - days;

  /*
   * 승급식은 매월 마지막 금요일. 두 조건이 모두 채워질 수 있는 가장 이른 날 이후의
   * 첫 승급식이 목표다. 출석은 하루 한 번이라 남은 N일을 채우려면 최소 N일이 걸리는데,
   * 이걸 빼먹으면 "8/28 승급식"이라 해놓고 "주 8.5회 필요" 같은 모순이 나온다.
   */
  const earliest = new Date(Math.max(targetDate, addDays(t, Math.max(0, remain))));
  const ceremony = ceremonyOnOrAfter(earliest > t ? earliest : t);
  const dCeremony = daysBetween(t, ceremony);

  $("mDaysVal").innerHTML = `<b>${days}</b> / ${req.days}일`;
  setBar("mDaysBar", daysPct, daysOk);
  $("mDaysNote").textContent = daysOk
    ? "충족"
    : `${remain}일 더 필요` + pacingHint(remain, dCeremony);

  // 종합 = 두 조건 모두 필요하므로 낮은 쪽
  $("goalPct").textContent = Math.floor(Math.min(monthsPct, daysPct) * 100) + "%";

  const box = $("readyBox");
  if (monthsOk && daysOk) {
    box.className = "ready";
    box.innerHTML = `✅ 기준 충족 · <b>${fmtMD(ceremony)} 승급식</b> D-${dCeremony}`;
  } else {
    box.className = "ready wait";
    const parts = [];
    if (!monthsOk) parts.push(`기간 D-${dLeft}`);
    if (!daysOk) parts.push(`출석 ${remain}일 부족`);

    // 이론상 최단(하루 1회)과 실제 페이스를 나란히 — 벌어진 폭이 곧 경고다
    const perWeek = recentPerWeek();
    const fast = `빠르면 <b>${fmtMD(ceremony)}</b>`;
    let tail;
    if (remain <= 0) {
      tail = fast;
    } else if (perWeek <= 0) {
      tail = `${fast} · 최근 출석이 없어 페이스 예측 불가`;
    } else {
      const paceCer = ceremonyOnOrAfter(
        new Date(Math.max(targetDate, addDays(t, Math.ceil(remain / perWeek * 7)))));
      tail = key(paceCer) === key(ceremony)
        ? `${fast} · 지금 페이스로도 동일`
        : `${fast} · 이 페이스면 <b>${fmtMD(paceCer)}</b>`;
    }
    box.innerHTML = `${parts.join(" · ")}<br>승급식 — ${tail}`;
  }
}

/** 목표 승급식까지 주당 몇 회 나가야 출석 조건을 채우는지 */
function pacingHint(remainDays, daysToCeremony) {
  if (remainDays <= 0) return "";
  if (daysToCeremony <= 0) return "";
  const weeks = daysToCeremony / 7;
  const perWeek = remainDays / weeks;
  // 주 7회를 넘으면 그 승급식엔 물리적으로 불가능
  if (perWeek > 7) return " · 다음 승급식엔 불가능";
  if (perWeek <= 0.5) return "";
  return ` · 승급식까지 주 ${perWeek.toFixed(1)}회`;
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
  const since = currentRank().since;
  const ceremonyK = key(lastFridayOf(y, m));      // 이 달의 승급식

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
    if (dk < since) cls.push("before-promo");
    if (dk === ceremonyK) cls.push("ceremony");
    btn.className = cls.join(" ");
    btn.textContent = d;
    if (state.history.some(h => h.date === dk)) {
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

  // 세 칸의 성격을 겹치지 않게 — 누적 / 유지 / 속도
  $("stTotal").textContent = state.attendance.length;
  $("stStreak").textContent = weeklyStreak();
  $("stPace").textContent = recentPerWeek().toFixed(1);

  // 라벨 칸은 좁아 두 줄로 접힌다 — 점만 두고 설명은 아래 페이스 줄에서 한다
  $("stStreakBox").classList.toggle("week-done", attendedThisWeek());

  const thisMonth = state.attendance.filter(k => k.slice(0, 7) === key(t).slice(0, 7)).length;
  renderPace(thisMonth);
  renderHeatmap();
}

/** 이번 주(일~토)에 한 번이라도 나갔는지 */
function attendedThisWeek() {
  const t = today();
  const ws = addDays(t, -t.getDay());
  for (let i = 0; i < 7; i++) if (state.attendance.includes(key(addDays(ws, i)))) return true;
  return false;
}

/**
 * 주 단위 연속 출석. 주짓수는 매일 하는 운동이 아니라 일 단위 연속을 쓰면
 * 하루만 쉬어도 0이 되어 오히려 의욕을 꺾는다. 주(일~토)에 한 번이라도 나갔으면 이어진 것으로 본다.
 * 이번 주는 아직 안 갔을 수 있으므로 끊긴 것으로 치지 않는다.
 */
function weeklyStreak() {
  const set = new Set(state.attendance);
  const hasIn = ws => {
    for (let i = 0; i < 7; i++) if (set.has(key(addDays(ws, i)))) return true;
    return false;
  };
  const t = today();
  let ws = addDays(t, -t.getDay());          // 이번 주 일요일
  if (!hasIn(ws)) ws = addDays(ws, -7);
  let n = 0;
  while (hasIn(ws)) { n++; ws = addDays(ws, -7); }
  return n;
}

/** 지난달 같은 기간과 비교한다. 승급식 예측은 진행도 카드가 맡는다 */
function renderPace(thisMonth) {
  const t = today();

  // 이번 달은 아직 진행 중이므로 지난달 "같은 날짜까지"와 비교해야 공평하다
  const lastFrom = key(new Date(t.getFullYear(), t.getMonth() - 1, 1));
  const lastTo = key(addMonths(t, -1));
  const lastSame = state.attendance.filter(k => k >= lastFrom && k <= lastTo).length;
  const diff = thisMonth - lastSame;
  const mark = diff > 0 ? `<span class="up">+${diff}</span>`
             : diff < 0 ? `<span class="down">${diff}</span>` : "±0";

  const week = attendedThisWeek()
    ? `이번 주 <span class="up">출석 완료</span>`
    : `이번 주 <b>아직</b>`;
  $("paceNote").innerHTML =
    `이번 달 <b>${thisMonth}회</b> · 지난달 같은 기간 대비 ${mark}<br>${week}`;
}

/** 최근 1년 출석 잔디. 열 = 주(일~토), 행 = 요일 */
function renderHeatmap() {
  const WEEKS = 53;
  const grid = $("heatGrid");
  grid.innerHTML = "";

  const t = today();
  const end = addDays(t, 6 - t.getDay());              // 이번 주 토요일
  const start = addDays(end, -(WEEKS * 7 - 1));        // 53주 전 일요일
  const on = new Set(state.attendance);
  const promo = new Set(state.history.map(h => h.date));

  for (let i = 0; i < WEEKS * 7; i++) {
    const d = addDays(start, i);
    const dk = key(d);
    const cell = document.createElement("i");
    cell.className = d > t ? "future" : promo.has(dk) ? "promo" : on.has(dk) ? "on" : "";
    cell.title = dk;
    grid.appendChild(cell);
  }
  const shown = state.attendance.filter(k => k >= key(start) && k <= key(t)).length;
  $("heatSpan").textContent = `${key(start).slice(0, 7)} ~ ${key(t).slice(0, 7)} · ${shown}회`;
}

function renderRoadmap() {
  const { belt, stripe } = currentRank();
  const step = stepIndexOf(belt, stripe);

  const list = $("roadList");
  list.innerHTML = "";
  for (let b = 0; b < BLACK; b++) {
    const row = document.createElement("div");
    row.className = "road-row" + (b === belt ? " cur" : "");

    // 벨트 이름 텍스트 대신 벨트 그래픽. 그랄은 오른쪽 칸이 나타내므로 0그랄로 그린다
    row.appendChild(beltEl(b, 0, "belt-xs"));

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
  blackRow.className = "road-row" + (belt >= BLACK ? " cur" : "");
  blackRow.appendChild(beltEl(BLACK, 0, "belt-xs"));
  const bDots = document.createElement("div");
  bDots.className = "road-dots";
  bDots.innerHTML = `<i class="${belt >= BLACK ? "done" : ""}"></i>`;
  blackRow.appendChild(bDots);
  const bRq = document.createElement("div");
  bRq.className = "rq";
  bRq.textContent = "목표";
  blackRow.appendChild(bRq);
  list.appendChild(blackRow);

  const note = document.createElement("p");
  note.className = "hint";
  note.style.marginTop = "10px";
  note.textContent = "* 화이트 4그랄 → 블루부터는 7개월 / 90일 기준";
  list.appendChild(note);
}

function renderSettings() {
  $("setStarted").value = state.startedAt;
  // 승급 기록 폼의 셀렉트는 한 번만 채운다
  const hb = $("histBelt");
  if (!hb.options.length) {
    BELTS.forEach((b, i) => hb.add(new Option(b.name, i)));
    const hs = $("histStripe");
    for (let i = 0; i <= MAX_STRIPE; i++) hs.add(new Option(i + "그랄", i));
  }
  $("histStripe").disabled = Number(hb.value) >= BLACK;

  renderHistory();
  renderHistEffect();
}

/**
 * 현재 벨트는 마지막 항목에서 파생되므로, 최신 항목을 지우면 자동으로
 * 직전 상태로 돌아간다 — 되돌리기와 삭제를 따로 둘 필요가 없다.
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
    span.className = "hist-label";
    span.appendChild(beltEl(rec.belt, rec.stripe, "belt-xs"));
    const txt = document.createElement("span");
    txt.innerHTML = `${rec.date}${i === 0 ? " · <b>현재</b>" : ""}`;
    span.appendChild(txt);
    item.appendChild(span);

    const btn = document.createElement("button");
    btn.textContent = "삭제";
    btn.onclick = () => deleteHistory(rec.date);
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
    ? `현재 벨트가 <b>${labelOf(belt, stripe)}</b>${subjectParticle(labelOf(belt, stripe))} 되고, 이 날부터 다음 승급 기준을 셉니다.`
    : `더 최근 승급(${currentRank().since})이 있어 <b>이력에만</b> 남습니다.`;
}

/** 이 승급일이 가장 최근이 되는지 — 그러면 현재 벨트가 이 기록으로 바뀐다 */
function becomesCurrent(date) {
  const last = state.history[state.history.length - 1];
  return !last || date >= last.date;
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
 * 현재 벨트·단계 시작일은 이력의 마지막 항목에서 파생되므로 따로 대입하지 않는다.
 * 출석 기록은 어느 쪽이든 건드리지 않는다.
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

/**
 * 문서 병합.
 *
 * 출석은 단순 합집합이 아니다 — 그러면 방금 취소한 날짜가 원격에서 되살아나
 * 해제가 아예 동작하지 않는다. 날짜마다 "켠 시각 vs 끈 시각"을 비교해 늦은 쪽을 따른다.
 * 켠 시각은 따로 저장하지 않고 그 문서의 updatedAt 을 대용으로 쓴다
 * (변경 직후 곧바로 push 하므로 충분히 근사하다).
 */
function mergeStates(a, b) {
  const histByDate = new Map();
  [...a.history, ...b.history].forEach(h => histByDate.set(h.date, h));

  const dates = new Set([...a.attendance, ...b.attendance,
                         ...Object.keys(a.removed), ...Object.keys(b.removed)]);
  const attendance = [], removed = {};
  for (const d of dates) {
    // 각 문서가 이 날짜에 대해 주장하는 (상태, 시각)
    const sideOf = s => s.removed[d] ? { on: false, at: s.removed[d] }
                      : s.attendance.includes(d) ? { on: true, at: s.updatedAt || "" }
                      : null;
    const x = sideOf(a), y = sideOf(b);
    const win = !x ? y : !y ? x : (y.at > x.at ? y : x);
    if (!win) continue;
    if (win.on) attendance.push(d);
    else removed[d] = win.at;
  }

  return {
    // 시작일은 "가장 이른 기록"이 진실이므로 최신 우선이 아니라 최소값을 쓴다
    startedAt: [a.startedAt, b.startedAt].filter(Boolean).sort()[0] || "",
    attendance: attendance.sort(),
    removed,
    // 벨트·단계 시작일은 이력에서 파생되므로 이력만 합치면 된다
    history: [...histByDate.values()].sort((x, y) => x.date.localeCompare(y.date)),
    updatedAt: (b.updatedAt || "") > (a.updatedAt || "") ? b.updatedAt : a.updatedAt
  };
}

function sameState(a, b) {
  const norm = s => JSON.stringify([s.startedAt, s.attendance, s.removed, s.history]);
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
   날짜 선택기 — 네이티브 date 입력은 시작 요일을 브라우저 로케일이 정해
   바꿀 수 없다. 출석 달력과 같은 일요일 시작으로 맞추려고 직접 만든다.
   ============================================================ */

let pickerTarget = null;      // 값을 채울 input
let pickerCursor = today();   // 보고 있는 달

function openPicker(input) {
  pickerTarget = input;
  const v = input.value;
  pickerCursor = /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseKey(v) : today();
  $("pickerClear").hidden = input.dataset.clearable !== "1";
  $("picker").hidden = false;
  $("pickerBack").hidden = false;
  renderPicker();
}

function closePicker() {
  $("picker").hidden = true;
  $("pickerBack").hidden = true;
  pickerTarget = null;
}

function commitPicker(value) {
  if (!pickerTarget) return;
  pickerTarget.value = value;
  pickerTarget.dispatchEvent(new Event("change"));
  closePicker();
}

function renderPicker() {
  const y = pickerCursor.getFullYear(), m = pickerCursor.getMonth();
  $("pickerTitle").textContent = `${y}년 ${m + 1}월`;

  const grid = $("pickerGrid");
  grid.innerHTML = "";
  DOW.forEach((w, i) => {                       // 출석 달력과 동일하게 일요일부터
    const el = document.createElement("div");
    el.className = "dow" + (i === 0 ? " sun" : i === 6 ? " sat" : "");
    el.textContent = w;
    grid.appendChild(el);
  });

  const first = new Date(y, m, 1);
  const lastDate = new Date(y, m + 1, 0).getDate();
  const tk = key(today());
  const sel = pickerTarget ? pickerTarget.value : "";

  for (let i = 0; i < first.getDay(); i++) {
    const b = document.createElement("div");
    b.className = "day blank";
    grid.appendChild(b);
  }
  for (let d = 1; d <= lastDate; d++) {
    const dk = key(new Date(y, m, d));
    const btn = document.createElement("button");
    btn.type = "button";
    const cls = ["day"];
    if (dk === sel) cls.push("on");
    if (dk === tk) cls.push("today");
    if (dk > tk) cls.push("future");            // 미래는 어차피 거부되므로 막는다
    btn.className = cls.join(" ");
    btn.textContent = d;
    btn.onclick = () => commitPicker(dk);
    grid.appendChild(btn);
  }
}

/* ============================================================
   이벤트 바인딩
   ============================================================ */

$("setStarted").dataset.clearable = "1";        // 주짓수 시작일은 비울 수 있다
[$("setStarted"), $("histDate")].forEach(inp => { inp.onclick = () => openPicker(inp); });
$("picker").querySelectorAll("[data-nav]").forEach(b => {
  b.onclick = () => {
    pickerCursor = addMonths(new Date(pickerCursor.getFullYear(), pickerCursor.getMonth(), 1),
                             Number(b.dataset.nav));
    renderPicker();
  };
});
$("pickerToday").onclick = () => commitPicker(key(today()));
$("pickerClear").onclick = () => commitPicker("");
$("pickerClose").onclick = closePicker;
$("pickerBack").onclick = closePicker;
document.addEventListener("keydown", e => { if (e.key === "Escape") closePicker(); });

$("calPrev").onclick = () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
  renderCalendar();
};
$("calNext").onclick = () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
  renderCalendar();
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

$("btnAddHist").onclick = () => {
  const f = $("histForm");
  f.hidden = !f.hidden;
  if (!f.hidden) {
    // 기본값: 오늘 + 다음 그랄/벨트. 지난 승급이면 날짜만 바꾸면 된다
    const cur = currentRank();
    const nx = nextOf(cur.belt, cur.stripe);
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
