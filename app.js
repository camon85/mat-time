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

/*
 * 문서를 둘로 나눠 둔다.
 *
 * 메모는 출석의 20~45배 크기가 된다 (10년 뒤 출석 40KB vs 메모 430KB).
 * 한 문서에 두면 출석을 한 번 탭할 때마다 메모 전체를 직렬화해 쓰고 Gist 에 올리게 되고,
 * 저장이 실패하면 둘이 같이 죽는다. 나누면 출석 경로는 계속 작게 유지된다.
 */
const STORE_KEY = "bjj-attendance";
const NOTES_KEY = "bjj-notes";

/*
 * 현재 벨트·그랄·단계 시작일은 따로 저장하지 않는다. 승급 이력(history)의
 * 마지막 항목에서 파생한다 — "단계 시작일"과 "승급일"이 같은 사실이기 때문.
 */
/*
 * 승급 추적은 옵션이고 **기본은 꺼짐**이다.
 *
 * 승급 이력을 남기는 것(= 지금 벨트가 무엇인지)과 다음 승급을 예측하는 것은 다른 일인데,
 * 후자만 체육관 규정(3개월/30일 · 7개월/90일, 매월 마지막 금요일)에 기댄다. 규정이 다른
 * 곳에서는 진행도·예상 승급식이 그냥 틀린 숫자다. 그래서 이력 유무로 추론하지 않고
 * 명시적으로 켠 경우에만 켠다 — "이력이 있으니 추적도 원하겠지" 가 성립하지 않기 때문이다.
 */
let state = {
  startedAt: "",        // 주짓수를 처음 시작한 날. 비어 있으면 미설정
  trackPromotion: false,  // 승급 진행도·로드맵·승급식 표시를 켤지
  trackPromotionAt: "",   // 그 값을 마지막으로 바꾼 시각(ISO). 병합에서 늦은 쪽이 이긴다
  attendance: [],       // "YYYY-MM-DD" 배열 (정렬·중복 제거 유지)
  checked: {},          // 출석을 켠 날짜 → 켠 시각(ISO). attendance 의 부분집합 (§withAt)
  removed: {},          // 출석을 취소한 날짜 → 취소 시각(ISO). 다시 체크하면 키 삭제
  history: [],          // { date, belt, stripe, at } — 승급 이력. 날짜 오름차순
  removedHistory: {},   // 삭제한 승급일 → 삭제 시각(ISO). 없으면 동기화가 삭제를 되살린다
  updatedAt: "",        // ISO 문자열. 마지막 변경 시각(표시·보조용)
  epoch: 0              // 복원·초기화 세대. 항목별 툼스톤으로 표현할 수 없는 "전체 교체"를 나타낸다
};

let calCursor = today();   // 캘린더가 보고 있는 달
let form = { belt: 0, stripe: 1 };   // 승급 기록 폼에서 고른 벨트·그랄

/** 현재 벨트·그랄과 그 단계가 시작된 날. 이력이 비면 화이트 0그랄 */
function currentRank() {
  const last = state.history[state.history.length - 1];
  if (!last) return { belt: 0, stripe: 0, since: state.startedAt || key(today()) };
  return { belt: last.belt, stripe: last.stripe, since: last.date };
}

/**
 * 저장된 코어 문서를 읽는다. "ok" | "empty" | "corrupt".
 *
 * 손상을 빈 문서와 구분하는 이유: 예전에는 둘 다 false 를 돌려줬고 호출부가 곧바로 save() 로
 * 덮어써서, 읽지 못한 원본이 그 자리에서 사라졌다. 동기화를 안 켠 사용자에게는 그게 곧
 * 전체 유실이다. 지금은 원본을 따로 옮겨 두고 복구 여지를 남긴다.
 */
function load() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return "empty";
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("객체가 아님");
    state = normalize(d);
    return "ok";
  } catch (e) {
    console.warn("저장된 데이터를 읽지 못했습니다", e);
    stashCorrupt(STORE_KEY, raw);
    return "corrupt";
  }
}

/** 읽지 못한 원본을 지우지 않고 옆으로 옮긴다. 옮기지 못하면 원본을 그대로 둔다 */
function stashCorrupt(storeKey, raw) {
  const backupKey = storeKey + "-corrupt";
  try {
    localStorage.setItem(backupKey, raw);
    localStorage.removeItem(storeKey);
  } catch (e) {
    console.warn("손상 데이터를 옮기지 못했습니다", e);
  }
  return backupKey;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * { 키: ISO 시각 } 꼴만 걸러 낸다 (removed · removedHistory · removedNotes · removedTags 공용).
 * 키 검사는 기본이 날짜이고, 분류 툼스톤처럼 날짜가 아닌 키는 okKey 로 바꿔 준다.
 */
function stampMap(src, okKey) {
  const ok = okKey || (k => DATE_RE.test(k));
  const o = {};
  if (src && typeof src === "object" && !Array.isArray(src)) {
    for (const [k, v] of Object.entries(src)) {
      if (ok(k) && typeof v === "string" && v) o[k] = v;
    }
  }
  return o;
}

/**
 * 항목별 시각을 붙인다. **빈 시각은 아예 넣지 않는다** — 없는 것과 뜻이 같기 때문이다
 * (병합에서 둘 다 "가장 오래된 것"으로 취급된다).
 * 첫 실행처럼 문서 시각조차 없는 순간에 `at: ""` 를 남기면, 그 문서를 내보낸 백업이
 * 자기 검증(`at 이 비어 있습니다`)에 걸린다. normalizeNotes 도 같은 것을 쓴다.
 */
const withAt = (obj, at) => (at ? { ...obj, at } : obj);

function normalize(d) {
  const updatedAt = typeof d.updatedAt === "string" ? d.updatedAt : "";
  const att = Array.isArray(d.attendance)
    ? [...new Set(d.attendance.filter(s => typeof s === "string" && DATE_RE.test(s)))].sort()
    : [];
  const rem = stampMap(d.removed);
  const remHist = stampMap(d.removedHistory);
  // 날짜를 키로 중복 제거 + 오름차순 정렬 — 손으로 만든 파일을 불러와도 불변식이 유지된다
  const hist = Array.isArray(d.history)
    ? [...new Map(d.history
        .filter(h => h && DATE_RE.test(h.date))
        .map(h => {
          const b = clamp(Number(h.belt) || 0, 0, BLACK);
          // at 은 삭제 툼스톤과 겨룰 값 (메모의 at 과 같은 역할). 없으면 문서 시각으로 확정한다
          return [h.date, withAt({ date: h.date, belt: b,
                                   stripe: b >= BLACK ? 0 : clamp(Number(h.stripe) || 0, 0, MAX_STRIPE) },
                                 (typeof h.at === "string" && h.at) ? h.at : updatedAt)];
        })).values()].sort((a, b) => a.date.localeCompare(b.date))
    : [];

  // 켜진 날짜와 끈 날짜가 겹치면 취소가 이긴다 (재체크 시 removed 키를 지우므로)
  const attendance = att.filter(k => !rem[k]);

  /*
   * 켠 시각을 여기서 **반드시 채워 둔다.** 없는 것을 병합 때 문서의 updatedAt 으로 대신하면,
   * 그 기기가 무엇이든 고칠 때마다 살아 있는 모든 날짜의 주장 시각이 함께 밀려
   * 상대의 취소 툼스톤을 통째로 이긴다 (= 지운 출석이 되살아난다).
   * 옛 문서에는 값이 없으므로 문서 시각으로 한 번만 확정하고, 이후 토글은 자기 시각을 갖는다.
   */
  const chk = stampMap(d.checked);
  const checked = {};
  for (const k of attendance) {
    const at = chk[k] || updatedAt;
    if (at) checked[k] = at;           // 빈 시각은 넣지 않는다 (withAt 주석 참조)
  }

  return {
    startedAt: DATE_RE.test(d.startedAt) ? d.startedAt : "",
    // 값이 없으면 꺼짐. 이력이 있는지로 추론하지 않는다 — 이력과 추적은 별개의 의사다
    trackPromotion: d.trackPromotion === true,
    trackPromotionAt: typeof d.trackPromotionAt === "string" ? d.trackPromotionAt : "",
    attendance,
    checked,
    removed: rem,
    history: hist.filter(h => !remHist[h.date]),
    removedHistory: remHist,
    updatedAt,
    epoch: Number.isInteger(d.epoch) && d.epoch >= 0 ? d.epoch : 0
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
  const now = new Date().toISOString();
  const i = state.attendance.indexOf(k);
  if (i >= 0) {
    state.attendance.splice(i, 1);
    delete state.checked[k];
    state.removed[k] = now;
    toast(fmtShort(k) + " 출석 취소");
  } else {
    state.attendance.push(k);
    state.attendance.sort();
    delete state.removed[k];
    state.checked[k] = now;          // 이 날짜를 켠 시각 — 병합에서 취소 시각과 겨룬다
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

/**
 * 현재 단계의 출석 일수.
 * 승급식 당일 출석은 이전 단계의 마지막 수련으로 보고, 다음 날부터 새 단계로 센다.
 */
function currentStageDays() {
  const from = currentRank().since;
  const to = key(today());
  return state.attendance.filter(k => k > from && k <= to).length;
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
  renderNotes();
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

  const days = daysBetween(parseKey(since), today());
  if (!state.history.length) {
    // 화이트 0그랄은 승급이 아니라 시작 상태다. 날짜는 「기록」 카드가 이미 보여주므로 중복을 피한다
    $("beltSub").textContent = days > 0 ? `수련 ${days}일째` : "오늘 시작";
  } else {
    $("beltSub").textContent = days >= 0 ? `${since} 승급 · ${days}일째` : `${since} 승급 예정`;
  }
}

function renderToday() {
  const t = today(), k = key(t);
  const done = hasAttended(k);
  $("todayLine").innerHTML = done
    ? `오늘 <b>${t.getMonth() + 1}/${t.getDate()}(${DOW[t.getDay()]})</b> · <span class="yes">출석 완료</span>`
    : `오늘 <b>${t.getMonth() + 1}/${t.getDate()}(${DOW[t.getDay()]})</b> · 아직 체크 전 — 아래에서 오늘 날짜를 누르세요`;
}

/**
 * 앱이 출석을 기록하기 시작한 날.
 * 주짓수는 오래 했어도 앱은 최근에 쓰기 시작했을 수 있다. 그 경우 총 출석·연속 주가
 * 실제 수련량을 반영하지 못하므로, 어디부터 센 값인지 함께 알려야 오해가 없다.
 */
function trackedSince() {
  return state.attendance[0] || key(today());   // attendance 는 오름차순 정렬 불변식
}

/** 최근 4주 실제 페이스 (주당 출석 횟수) */
function recentPerWeek() {
  const t = today();
  return state.attendance.filter(k => k >= key(addDays(t, -27)) && k <= key(t)).length / 4;
}

function renderGoal() {
  // 꺼져 있으면 카드째 숨긴다. 계산은 전부 이 안에 있으므로 도는 일도 없다
  $("goalCard").hidden = !state.trackPromotion;
  if (!state.trackPromotion) return;

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

/**
 * 목표 승급식까지 주당 몇 회 나가야 출석 조건을 채우는지.
 *
 * 「주 8.5회 필요」 같은 불가능한 안내는 여기서 막는 게 아니라 호출부에서 이미 막혀 있다 —
 * 목표 승급식이 `오늘 + 남은 일수` 이후로 잡히므로 daysToCeremony ≥ remainDays 이고,
 * 따라서 perWeek 은 7 을 넘을 수 없다. (예전엔 여기 `> 7` 분기가 있었는데 도달할 수 없었다)
 */
function pacingHint(remainDays, daysToCeremony) {
  if (remainDays <= 0) return "";
  if (daysToCeremony <= 0) return "";
  const perWeek = remainDays / (daysToCeremony / 7);
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

  const tk = key(today());
  const since = currentRank().since;
  // 승급식 날짜는 체육관 규정이라 추적을 켠 경우에만 표시한다. "" 는 어떤 날짜와도 안 맞는다
  const ceremonyK = state.trackPromotion ? key(lastFridayOf(y, m)) : "";
  $("legCeremony").hidden = !state.trackPromotion;
  const promo = new Set(state.history.map(h => h.date));

  /*
   * 항상 6주(42칸)를 그린다. 달마다 5주·6주로 높이가 바뀌면 월을 연속으로 넘길 때
   * 아래 내용이 밀려 오조작이 난다. 앞뒤 빈칸은 이웃 달 날짜로 채워 일반 달력처럼 보이게 하되,
   * 흐리게 처리하고 누를 수 없게 해서 다른 달을 잘못 찍는 일을 막는다.
   */
  const first = new Date(y, m, 1);
  const gridStart = addDays(first, -first.getDay());          // 1일이 속한 주의 일요일

  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const dk = key(d);
    const other = d.getMonth() !== m;
    const future = dk > tk;
    const on = hasAttended(dk);
    const btn = document.createElement("button");
    btn.type = "button";

    const cls = ["day"];
    if (other) cls.push("other");
    if (on) cls.push("on");
    if (dk === tk) cls.push("today");
    if (future) cls.push("future");
    if (dk <= since) cls.push("before-promo");                // 승급식 당일까지가 이전 단계
    if (dk === ceremonyK) cls.push("ceremony");
    btn.className = cls.join(" ");
    btn.textContent = d.getDate();
    btn.dataset.d = dk;                                       // 롱프레스 위임이 읽는다

    if (promo.has(dk)) {
      const dot = document.createElement("span");
      dot.className = "promo-dot";
      btn.appendChild(dot);
    }
    // 메모 표식은 하단 중앙 — 우상단은 승급일 점이 쓴다
    const hasNote = !!noteDoc.notes[dk];
    if (hasNote) {
      const mark = document.createElement("span");
      mark.className = "note-mark";
      btn.appendChild(mark);
    }

    /*
     * 스크린리더에는 숫자만 읽히면 "15" 로 끝나 무슨 날인지 알 수 없다.
     * 날짜·요일과 상태를 함께 주고, 토글 버튼이므로 aria-pressed 를 쓴다.
     */
    if (other || future) {
      // 누를 수 없는 칸은 탭 순서에서도 빼야 한다 (CSS 로는 클릭만 막힌다)
      btn.disabled = true;
      btn.setAttribute("aria-hidden", "true");
      btn.tabIndex = -1;
    } else {
      const label = `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`;
      btn.setAttribute("aria-label",
        label + (hasNote ? " · 메모 있음" : "") + (promo.has(dk) ? " · 승급일" : ""));
      btn.setAttribute("aria-pressed", String(on));
      btn.title = "탭: 출석 체크 · 길게 누르기: 메모";
      btn.onclick = () => { if (consumeLongPress()) return; toggleDay(dk); };
    }
    grid.appendChild(btn);
  }

  // 다음 달 버튼: 이번 달 이후로는 못 감
  const t = today();
  $("calNext").disabled = (y > t.getFullYear()) ||
                          (y === t.getFullYear() && m >= t.getMonth());
}

/**
 * 달력과 그 아래 메모 목록은 같은 달을 가리키므로 함께 움직여야 한다.
 * 월 이동은 이 함수를 부른다 — 예전엔 renderCalendar 안에서 메모를 갱신했는데,
 * render() 가 renderCalendar 와 renderNotes 를 둘 다 부르는 바람에 매 렌더마다 두 번씩 그렸다.
 */
function renderCalendarMonth() {
  renderCalendar();
  renderMonthNotes();
}

/** 달력이 볼 수 있는 마지막 달 (미래로는 못 간다) */
const calMax = () => { const t = today(); return new Date(t.getFullYear(), t.getMonth(), 1); };

/** 달 이동. 목록도 함께 옮기고 접힌 상태는 물고 가지 않는다 */
function goMonth(delta) {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + delta, 1);
  monthLimit = MONTH_PAGE;
  renderCalendarMonth();
}

/**
 * 그 날짜가 있는 달로 달력을 옮기고 그 자리까지 스크롤한다 (잔디 칸을 눌렀을 때).
 * 잔디는 달력 아래에 있으므로 결과가 화면 위쪽에서 벌어진다 — 옮기기만 하면 보이지 않는다.
 */
function goToMonth(dk) {
  if (!DATE_RE.test(dk)) return;
  const d = parseKey(dk);
  const want = new Date(d.getFullYear(), d.getMonth(), 1);
  calCursor = want > calMax() ? calMax() : want;
  monthLimit = MONTH_PAGE;
  renderCalendarMonth();

  const card = $("calGrid").closest(".card");
  card.scrollIntoView({ block: "start" });
  // 순간이동이라 「눌렸다」는 신호가 없다. 도착한 카드를 잠깐 밝힌다 (메모 점프와 같은 방식)
  card.classList.remove("flash");
  void card.offsetWidth;
  card.classList.add("flash");
}

/* ------------------------------------------------------------
   달력 칸 길게 누르기 → 그날 메모

   탭은 출석 토글이라 메모에 쓸 수 있는 동작이 롱프레스밖에 없다.
   신경 쓸 것이 셋이다.

   1. **롱프레스 뒤에 오는 click 을 반드시 먹어야 한다.** 안 그러면 메모를 열면서
      출석까지 토글된다 — 이 기능에서 가장 치명적인 오작동이다
   2. 스크롤 시작과 구분해야 한다 (10px 넘게 움직이면 취소)
   3. contextmenu 를 막아야 한다. 안드로이드는 롱프레스에, 데스크톱은 우클릭에 뜬다.
      iOS 의 선택 콜아웃은 CSS(-webkit-touch-callout)로 막는다
   ------------------------------------------------------------ */

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;      // 이만큼 움직이면 스크롤로 본다

let lpTimer = null, lpFired = false, lpX = 0, lpY = 0;

/** 롱프레스가 방금 일어났으면 true 를 한 번만 돌려준다 (click 억제용) */
function consumeLongPress() {
  const fired = lpFired;
  lpFired = false;
  return fired;
}

function longPressStart(e) {
  const btn = e.target.closest(".day[data-d]");
  if (!btn || btn.disabled) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;   // 우클릭은 contextmenu 가 맡는다
  lpFired = false;                                           // 새 누름이 시작되면 초기화
  lpX = e.clientX; lpY = e.clientY;
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => {
    lpTimer = null;
    lpFired = true;
    if (navigator.vibrate) navigator.vibrate(12);             // 눌렸다는 신호 (안드로이드)
    openNote(btn.dataset.d);
  }, LONG_PRESS_MS);
}

function longPressMove(e) {
  if (!lpTimer) return;
  if (Math.abs(e.clientX - lpX) > LONG_PRESS_SLOP ||
      Math.abs(e.clientY - lpY) > LONG_PRESS_SLOP) longPressCancel();
}

function longPressCancel() {
  clearTimeout(lpTimer);
  lpTimer = null;
}

/** 안드로이드 롱프레스 메뉴 · 데스크톱 우클릭. 둘 다 여기서 메모로 돌린다 */
function longPressMenu(e) {
  const btn = e.target.closest(".day[data-d]");
  if (!btn || btn.disabled) return;
  e.preventDefault();
  if (lpFired) return;              // 타이머가 이미 열었다 (안드로이드는 둘 다 뜬다)
  longPressCancel();
  lpFired = true;
  openNote(btn.dataset.d);
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
  const tracked = trackedSince();

  for (let i = 0; i < WEEKS * 7; i++) {
    const d = addDays(start, i);
    const dk = key(d);
    const cell = document.createElement("i");
    // 기록 이전은 "안 나간 날"이 아니라 "데이터 없음" — 빈칸과 구분해 더 어둡게
    const future = d > t;
    cell.className = future ? "future"
                   : promo.has(dk) ? "promo"
                   : on.has(dk) ? "on"
                   : dk < tracked ? "untracked" : "";
    cell.title = dk + (promo.has(dk) ? " · 승급" : on.has(dk) ? " · 출석" : "");
    // 누르면 그 달로 달력을 옮긴다. 잔디에서 뭔가 발견했을 때 거기까지 스크롤로 찾아가지 않도록
    if (!future) cell.dataset.d = dk;
    grid.appendChild(cell);
  }
  const shown = state.attendance.filter(k => k >= key(start) && k <= key(t)).length;
  const span = `${key(start).slice(0, 7)} ~ ${key(t).slice(0, 7)} · ${shown}회`;
  $("heatSpan").textContent = tracked > key(start) ? `${tracked}부터 기록 · ${shown}회` : span;
}

function renderRoadmap() {
  $("roadCard").hidden = !state.trackPromotion;
  if (!state.trackPromotion) return;

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
  $("setTrack").checked = state.trackPromotion;
  renderForm();
  renderHistory();
  renderHistEffect();
}

/**
 * 승급 추적 켬/끔. **끄는 것은 숨기는 것일 뿐 지우는 것이 아니다** —
 * 승급 이력·출석·메모는 그대로 남고, 다시 켜면 그동안의 기록으로 바로 계산된다.
 */
function setTracking(on) {
  state.trackPromotion = !!on;
  state.trackPromotionAt = new Date().toISOString();
  save();
  render();
  toast(on ? "승급 진행도 추적을 켰습니다"
           : "추적을 껐습니다 · 승급 이력은 그대로입니다");
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

/**
 * 승급 기록 폼의 벨트·그랄 선택지를 그린다.
 * 선택된 벨트 칩은 고른 그랄까지 함께 보여주므로 따로 미리보기를 둘 필요가 없다.
 */
function renderForm() {
  const bc = $("beltChoices");
  bc.innerHTML = "";
  BELTS.forEach((b, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "belt-choice" + (i === form.belt ? " sel" : "");
    btn.title = b.name;
    btn.appendChild(beltEl(i, i === form.belt ? form.stripe : 0, "belt-xs"));
    btn.onclick = () => setFormBelt(i);
    bc.appendChild(btn);
  });

  const isBlack = form.belt >= BLACK;
  $("stripeRow").hidden = isBlack;
  const sc = $("stripeChoices");
  sc.innerHTML = "";
  if (isBlack) return;
  // 화이트 0그랄은 승급이 아니라 시작 상태이므로 1부터
  for (let i = (form.belt === 0 ? 1 : 0); i <= MAX_STRIPE; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stripe-choice" + (i === form.stripe ? " sel" : "");
    btn.textContent = i;
    btn.onclick = () => { form.stripe = i; renderForm(); renderHistEffect(); };
    sc.appendChild(btn);
  }
}

function setFormBelt(belt) {
  form.belt = belt;
  if (belt >= BLACK) form.stripe = 0;
  else if (belt === 0 && form.stripe === 0) form.stripe = 1;
  renderForm();
  renderHistEffect();
}

/** 폼에 입력된 값이 현재 상태를 바꾸는지 미리 알려준다 */
function renderHistEffect() {
  const el = $("histEffect");
  if (!el) return;
  const show = html => { el.innerHTML = html; el.hidden = !html; };

  const date = $("histDate").value;
  if (!DATE_RE.test(date)) return show("승급일을 선택하세요.");
  if (parseKey(date) > today()) return show("미래 날짜는 기록할 수 없습니다.");

  // 누르기 전에 알 수 있도록, 같은 등급이 이미 있으면 먼저 알린다
  const { belt, stripe } = form;
  const same = sameRankEntry(belt, stripe, date);
  if (same) {
    return show(`이미 ${same.date}에 <b>${labelOf(belt, stripe)}</b> 기록이 있습니다. ` +
                `기록하면 승급일을 옮길지 묻습니다.`);
  }

  // 가장 최근 승급이 되는 건 당연한 경우이고 벨트 칩이 이미 결과를 보여준다.
  // 예외(더 최근 기록이 있어 이력에만 남는 경우)만 알린다.
  show(becomesCurrent(date)
    ? ""
    : `더 최근 승급(${currentRank().since})이 있어 <b>이력에만</b> 남습니다.`);
}

/** 같은 등급이 다른 날짜에 이미 기록돼 있으면 그 항목 */
function sameRankEntry(belt, stripe, exceptDate) {
  return state.history.find(h => h.belt === belt && h.stripe === stripe && h.date !== exceptDate);
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
  // at 은 "이 항목을 기록한 시각" — 병합에서 삭제 툼스톤과 겨룬다 (출석의 checked 와 같은 역할)
  state.history.push({ ...rec, at: new Date().toISOString() });
  state.history.sort((a, b) => a.date.localeCompare(b.date));
  delete state.removedHistory[rec.date];      // 다시 기록하면 삭제 표시를 지운다
}

/**
 * 승급 기록 — 오늘 받은 것과 지난 승급을 같은 경로로 처리한다.
 * 현재 벨트·단계 시작일은 이력의 마지막 항목에서 파생되므로 따로 대입하지 않는다.
 * 출석 기록은 어느 쪽이든 건드리지 않는다.
 */
function recordPromotion() {
  const date = $("histDate").value;
  const { belt, stripe } = form;

  if (!DATE_RE.test(date)) { toast("승급일을 선택하세요"); return; }
  if (parseKey(date) > today()) { toast("미래 날짜는 기록할 수 없습니다"); return; }
  if (belt === 0 && stripe === 0) { toast("화이트 0그랄은 승급이 아니라 시작 상태입니다"); return; }
  const dup = state.history.find(h => h.date === date);
  if (dup && !confirm(`${date}에 이미 ${labelOf(dup.belt, dup.stripe)} 기록이 있습니다. 바꿀까요?`)) return;

  // 같은 등급은 두 번 받을 수 없다 — 새로 쌓지 말고 승급일을 옮길지 묻는다
  const same = sameRankEntry(belt, stripe, date);
  if (same) {
    if (!confirm(`이미 ${same.date}에 ${labelOf(belt, stripe)} 기록이 있습니다.\n` +
                 `승급일을 ${date}로 옮길까요?`)) return;
    state.history = state.history.filter(h => h.date !== same.date);
    state.removedHistory[same.date] = new Date().toISOString();   // 동기화에도 반영
  }

  const current = becomesCurrent(date);
  putHistory({ date, belt, stripe });
  save();
  toggleHistForm(false);
  render();
  if (current) {
    // 자랑하고 싶은 순간이 바로 지금이다. 토스트만 띄우고 끝내지 않는다
    openShare("promotion");
  } else {
    toast(`${date} · ${labelOf(belt, stripe)} 기록됨`);
  }
}

function deleteHistory(date) {
  const rec = state.history.find(h => h.date === date);
  if (!rec) return;
  if (!confirm(`${date} · ${labelOf(rec.belt, rec.stripe)} 기록을 삭제합니다.`)) return;
  state.history = state.history.filter(h => h.date !== date);
  state.removedHistory[date] = new Date().toISOString();
  save();
  render();
  toast("기록을 삭제했습니다");
}

/** 백업은 두 문서를 이어 붙인 평평한 객체 — 사용자에겐 계속 파일 하나다 */
function backupDoc() {
  return { ...state, notes: noteDoc.notes, removedNotes: noteDoc.removedNotes,
           tags: noteDoc.tags, removedTags: noteDoc.removedTags };
}

function exportData() {
  const blob = new Blob([JSON.stringify(backupDoc(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bjj-attendance-${key(today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("백업 파일을 저장했습니다");
}

/*
 * 백업 파일 검증 — 전부 받아들이거나 전부 거부한다.
 *
 * normalize() 는 우리가 쓴 데이터를 읽기 위한 관용적 파서라 아무 JSON 이나 통과시켜
 * 기본값으로 만들어 버린다. 남의 JSON 을 넣으면 기록이 지워지고 Gist 까지 덮어쓴다.
 * 게다가 일부만 걸러 받으면 "무엇이 사라졌는지" 사용자가 알기 어렵다.
 * 그래서 항목 하나라도 형식에 맞지 않으면 파일 전체를 받지 않는다.
 */
const BACKUP_FIELDS = {
  startedAt:      v => typeof v === "string",
  // 옛 백업엔 없다. 없으면 꺼진 것으로 읽힌다
  trackPromotion:   v => typeof v === "boolean",
  trackPromotionAt: v => typeof v === "string",
  attendance:     v => Array.isArray(v),
  checked:        v => v && typeof v === "object" && !Array.isArray(v),
  removed:        v => v && typeof v === "object" && !Array.isArray(v),
  history:        v => Array.isArray(v),
  removedHistory: v => v && typeof v === "object" && !Array.isArray(v),
  notes:          v => v && typeof v === "object" && !Array.isArray(v),
  removedNotes:   v => v && typeof v === "object" && !Array.isArray(v),
  tags:           v => Array.isArray(v),
  removedTags:    v => v && typeof v === "object" && !Array.isArray(v),
  updatedAt:      v => typeof v === "string",
  epoch:          v => Number.isInteger(v) && v >= 0
};

/*
 * 벨트와 그랄은 범위가 다르다. 예전엔 하나로 겸했는데 MAX_STRIPE 와 BLACK 이 둘 다 4 인
 * 우연에 기댄 것이라, 벨트를 하나만 늘려도 조용히 통과·거부가 뒤집힌다.
 */
const isBeltIdx = v => Number.isInteger(v) && v >= 0 && v <= BLACK;
const isStripe  = v => Number.isInteger(v) && v >= 0 && v <= MAX_STRIPE;
/** 있으면 비어 있지 않은 문자열이어야 하는 시각 필드 (옛 백업엔 없다) */
const okOptAt = v => v === undefined || (typeof v === "string" && !!v);

/** 시각 도장 맵({키: ISO})이 온전한지. 키 검사는 기본이 날짜, 분류 툼스톤만 okKey 를 준다 */
function badStampMap(m, name, okKey) {
  const ok = okKey || (k => DATE_RE.test(k));
  const what = okKey ? "형식에 맞지 않습니다" : "날짜 형식이 아닙니다";
  for (const [k, v] of Object.entries(m)) {
    if (!ok(k)) return `${name} 의 키 "${k}" 가 ${what}.`;
    if (typeof v !== "string" || !v) return `${name}["${k}"] 의 값이 비어 있습니다.`;
  }
  return null;
}

/** 문제가 있으면 사유 문자열, 없으면 null */
function validateBackup(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "JSON 객체가 아닙니다.";

  const known = Object.keys(BACKUP_FIELDS).filter(k => k in d);
  if (!known.length) return "Mat Time 백업 파일이 아닙니다 (아는 항목이 하나도 없습니다).";
  const badType = known.filter(k => !BACKUP_FIELDS[k](d[k]));
  if (badType.length) return `항목 형식이 올바르지 않습니다 — ${badType.join(", ")}`;

  const att = d.attendance || [], hist = d.history || [];
  const chk = d.checked || {}, rem = d.removed || {}, remHist = d.removedHistory || {};
  const notes = d.notes || {}, remNotes = d.removedNotes || {};
  const tags = d.tags || DEFAULT_TAGS, remTags = d.removedTags || {};

  if (d.startedAt && !DATE_RE.test(d.startedAt))
    return `startedAt "${d.startedAt}" 이 날짜 형식이 아닙니다.`;

  for (const x of att) {
    if (typeof x !== "string" || !DATE_RE.test(x))
      return `attendance 에 날짜가 아닌 값이 있습니다 — ${JSON.stringify(x)}`;
  }
  if (new Set(att).size !== att.length) return "attendance 에 중복된 날짜가 있습니다.";

  for (const h of hist) {
    if (!h || typeof h !== "object" || Array.isArray(h))
      return "history 에 객체가 아닌 항목이 있습니다.";
    if (!DATE_RE.test(h.date))
      return `history 의 date "${h.date}" 가 날짜 형식이 아닙니다.`;
    if (!isBeltIdx(h.belt))
      return `history[${h.date}].belt 값이 0~${BLACK} 범위의 정수가 아닙니다.`;
    if (!isStripe(h.stripe))
      return `history[${h.date}].stripe 값이 0~${MAX_STRIPE} 범위의 정수가 아닙니다.`;
    if (h.belt >= BLACK && h.stripe !== 0)
      return `history[${h.date}] — 블랙벨트에는 그랄이 없습니다.`;
    if (!okOptAt(h.at))
      return `history[${h.date}].at 이 비어 있습니다.`;
  }
  const hDates = hist.map(h => h.date);
  if (new Set(hDates).size !== hDates.length) return "history 에 중복된 승급일이 있습니다.";

  /*
   * 분류를 메모보다 먼저 검사한다 — 메모의 tag 가 이 목록 안에 있는지 봐야 하기 때문.
   * normalize 라면 모르는 분류를 첫 분류로 떨어뜨리겠지만, 복원에서 그런 조용한 변형은 손실이다.
   */
  if (tags.length > MAX_TAGS)
    return `tags 가 ${MAX_TAGS}개를 넘습니다 (${tags.length}개).`;
  const tagIds = new Set();
  for (const t of tags) {
    if (!t || typeof t !== "object" || Array.isArray(t))
      return "tags 에 객체가 아닌 항목이 있습니다.";
    if (!okTagId(t.id))
      return `tags 의 id ${JSON.stringify(t.id)} 가 1~${TAG_NAME_MAX}자 문자열이 아닙니다.`;
    if (typeof t.name !== "string" || !t.name.trim())
      return `tags["${t.id}"].name 이 비어 있습니다.`;
    if (t.name.length > TAG_NAME_MAX)
      return `tags["${t.id}"].name 이 ${TAG_NAME_MAX}자를 넘습니다 (${t.name.length}자).`;
    if (!okOptAt(t.at)) return `tags["${t.id}"].at 이 비어 있습니다.`;
    if (tagIds.has(t.id)) return `tags 에 중복된 id "${t.id}" 가 있습니다.`;
    tagIds.add(t.id);
  }
  if (!tagIds.size) return "tags 가 비어 있습니다 — 분류는 하나 이상이어야 합니다.";

  for (const [k, v] of Object.entries(notes)) {
    if (!DATE_RE.test(k)) return `notes 의 키 "${k}" 가 날짜 형식이 아닙니다.`;
    if (!v || typeof v !== "object" || Array.isArray(v))
      return `notes["${k}"] 가 객체가 아닙니다.`;
    if (typeof v.text !== "string" || !v.text.trim())
      return `notes["${k}"].text 가 비어 있습니다.`;
    if (v.text.length > NOTE_MAX)
      return `notes["${k}"].text 가 ${NOTE_MAX}자를 넘습니다 (${v.text.length}자).`;
    if (!tagIds.has(v.tag))
      return `notes["${k}"].tag "${v.tag}" 가 tags 에 없습니다.`;
    if (typeof v.at !== "string" || !v.at)
      return `notes["${k}"].at 이 비어 있습니다.`;
  }

  const stampErr = badStampMap(chk, "checked") || badStampMap(rem, "removed")
                   || badStampMap(remHist, "removedHistory")
                   || badStampMap(remNotes, "removedNotes")
                   || badStampMap(remTags, "removedTags", okTagId);
  if (stampErr) return stampErr;

  const dupT = [...tagIds].find(id => id in remTags);
  if (dupT) return `"${dupT}" 가 tags 와 removedTags 양쪽에 있습니다.`;

  // checked 는 attendance 의 부분집합이어야 한다 — 아니면 normalize 가 조용히 버린다
  const attSet = new Set(att);
  const orphan = Object.keys(chk).find(k => !attSet.has(k));
  if (orphan) return `checked["${orphan}"] 에 해당하는 출석이 attendance 에 없습니다.`;

  const dupA = att.find(k => k in rem);
  if (dupA) return `${dupA} 이 attendance 와 removed 양쪽에 있습니다.`;
  const dupH = hDates.find(k => k in remHist);
  if (dupH) return `${dupH} 이 history 와 removedHistory 양쪽에 있습니다.`;
  const dupN = Object.keys(notes).find(k => k in remNotes);
  if (dupN) return `${dupN} 이 notes 와 removedNotes 양쪽에 있습니다.`;

  return null;
}

function importData(file) {
  const r = new FileReader();
  r.onerror = () => alert("파일을 읽지 못했습니다.");
  r.onload = () => {
    let data;
    try {
      data = JSON.parse(r.result);
    } catch (e) {
      alert("복원 실패 — JSON 형식이 아닙니다.\n기존 기록은 그대로 두었습니다.");
      return;
    }

    const problem = validateBackup(data);
    if (problem) {
      alert("복원 실패 — " + problem + "\n파일 전체를 받지 않았습니다. 기존 기록은 그대로입니다.");
      return;
    }

    // 검증을 통과했으므로 normalize 가 버리는 항목은 없다
    const next = normalize(data);
    const nextNotes = normalizeNotes(data);
    const lines = [
      "불러올 내용",
      `· 출석 ${next.attendance.length}일`,
      `· 승급 이력 ${next.history.length}건`,
      `· 메모 ${Object.keys(nextNotes.notes).length}개`
    ];
    if (next.startedAt) lines.push(`· 주짓수 시작일 ${next.startedAt}`);
    lines.push("", `현재 기록(출석 ${state.attendance.length}일 · 이력 ${state.history.length}건 · ` +
                   `메모 ${Object.keys(noteDoc.notes).length}개)을 덮어씁니다. 계속할까요?`);
    if (!confirm(lines.join("\n"))) return;

    // 이전 세대보다 반드시 커야 다른 기기의 옛 데이터를 이긴다. 두 문서 모두 올린다
    next.epoch = Math.max(state.epoch, next.epoch) + 1;
    nextNotes.epoch = Math.max(noteDoc.epoch, nextNotes.epoch) + 1;
    state = next;
    noteDoc = nextNotes;
    calCursor = today();
    saveOverwrite();
    render();
    toast(`복원 완료 · 출석 ${state.attendance.length}일`);
  };
  r.readAsText(file);
}

function resetAll() {
  const extra = syncOn() ? "\n연결된 Gist의 기록도 함께 비워집니다." : "";
  if (!confirm("모든 출석 기록과 벨트 정보, 메모를 지웁니다. 되돌릴 수 없습니다." + extra)) return;
  if (!confirm("정말 초기화할까요?")) return;
  const prevEpoch = state.epoch, prevNotes = noteDoc.epoch;
  state = normalize({});
  state.epoch = prevEpoch + 1;
  noteDoc = normalizeNotes({});
  noteDoc.epoch = prevNotes + 1;
  calCursor = today();
  saveOverwrite();
  render();
  toast("초기화되었습니다");
}

/**
 * 폼이 열리면 여는 버튼을 숨긴다.
 * 버튼을 「닫기」로 바꿔 두면 폼 안의 「취소」와 닫는 방법이 둘이 되고,
 * 여는 버튼이 폼 머리처럼 남아 어색하다.
 */
function toggleHistForm(open) {
  const f = $("histForm");
  f.hidden = !open;
  const btn = $("btnAddHist");
  btn.hidden = open;
  btn.setAttribute("aria-expanded", String(open));
  if (!open) return;

  // 기본값: 오늘 + 다음 그랄/벨트. 지난 승급이면 날짜만 바꾸면 된다
  const cur = currentRank();
  const nx = nextOf(cur.belt, cur.stripe);
  $("histDate").value = key(today());
  form = { belt: nx.belt, stripe: nx.stripe };
  renderForm();
  renderHistEffect();
}

/**
 * 날짜마다 "켠 시각 vs 끈 시각"을 비교해 늦은 쪽을 따른다.
 *
 * 단순 합집합이면 방금 취소한 날짜가 원격에서 되살아나 해제가 아예 동작하지 않는다.
 * 존재 확인은 반드시 Set 으로 한다 — 배열 includes 를 날짜마다 부르면 O(n²) 이 되어
 * 10년치에서 수십 ms, 30년치에서 수백 ms 가 걸린다.
 *
 * atOf 는 **항목별 시각**을 돌려줘야 한다. 예전에는 이걸 생략하면 문서의 updatedAt 을
 * 대용으로 썼는데, 그러면 그 기기가 무엇이든 고칠 때마다 살아 있는 모든 항목의 주장 시각이
 * 함께 밀려 상대의 툼스톤을 전부 이긴다 — 「폰에서 지우고 나중에 PC 를 열어 오늘 체크」라는
 * 가장 흔한 흐름에서 지운 것이 되살아났다. 지금은 출석·이력·분류 모두 자기 시각을 갖는다.
 */
function pickByStamp(a, b, keysOf, tombOf, atOf) {
  const sa = new Set(keysOf(a)), sb = new Set(keysOf(b));
  const ta = tombOf(a), tb = tombOf(b);
  const kept = [], tombs = {}, stamps = {};
  for (const d of new Set([...sa, ...sb, ...Object.keys(ta), ...Object.keys(tb)])) {
    const sideOf = (s, set, t) =>
      t[d] ? { on: false, at: t[d] }
      : set.has(d) ? { on: true, at: atOf ? atOf(s, d) : (s.updatedAt || "") }
      : null;
    const x = sideOf(a, sa, ta), y = sideOf(b, sb, tb);
    const win = !x ? y : !y ? x : (y.at > x.at ? y : x);
    if (!win) continue;
    if (win.on) { kept.push(d); if (win.at) stamps[d] = win.at; }
    else tombs[d] = win.at;
  }
  // stamps = 살아남은 키의 "켠 시각". 이걸 그대로 다시 저장해야 다음 병합도 같은 판정을 한다
  return { kept, tombs, stamps };
}

/*
 * 복원·초기화는 "지금부터 이 문서가 진실"이라는 선언이다. 항목별 툼스톤으로는
 * 다른 기기에만 있는 데이터까지 무효로 만들 수 없어, 그 기기가 동기화하면
 * 지웠던 것이 전부 되살아난다. 그래서 세대가 다르면 병합하지 않고 높은 쪽을 통째로 쓴다.
 */
const newerEpoch = (a, b) => ({ ...(a.epoch > b.epoch ? a : b) });

/** 코어 문서 병합 — 출석 · 승급 이력 · 시작일 */
function mergeStates(a, b) {
  if (a.epoch !== b.epoch) return newerEpoch(a, b);

  const att = pickByStamp(a, b, s => s.attendance, s => s.removed,
                          (s, d) => s.checked[d] || s.updatedAt || "");

  // 이력은 항목이 객체라 date → 항목 색인을 만들어 두고 그 안의 at 을 쓴다
  const histIndex = new Map();
  const histOf = s => {
    let m = histIndex.get(s);
    if (!m) { m = new Map(s.history.map(h => [h.date, h])); histIndex.set(s, m); }
    return m;
  };
  const his = pickByStamp(a, b, s => s.history.map(h => h.date), s => s.removedHistory,
                          (s, d) => (histOf(s).get(d) || {}).at || s.updatedAt || "");

  /*
   * 같은 날짜의 내용은 at 이 늦은 쪽. 예전에는 "나중에 넣은 쪽이 이기는 Map" 이라
   * 두 기기가 같은 날짜에 다른 벨트를 기록하면 원격이 무조건 이겼다 — 다른 필드는
   * 전부 시각으로 판정하는데 여기만 인자 순서에 좌우되던 자리다.
   */
  const histByDate = new Map();
  for (const h of [...a.history, ...b.history]) {
    const cur = histByDate.get(h.date);
    if (!cur || (h.at || "") > (cur.at || "")) histByDate.set(h.date, h);
  }

  /*
   * 켬/끔은 합쳐질 수 있는 값이 아니라 **나중에 바꾼 쪽**이 이긴다.
   * 여기서도 문서의 updatedAt 을 쓰면 안 된다 — 다른 기기에서 출석 한 번 체크한 것이
   * 이쪽에서 방금 바꾼 설정을 되돌린다 (checked 와 같은 함정).
   */
  const track = (b.trackPromotionAt || "") > (a.trackPromotionAt || "") ? b : a;

  return {
    // 시작일은 "가장 이른 기록"이 진실이므로 최신 우선이 아니라 최소값을 쓴다
    startedAt: [a.startedAt, b.startedAt].filter(Boolean).sort()[0] || "",
    trackPromotion: track.trackPromotion,
    trackPromotionAt: track.trackPromotionAt,
    attendance: att.kept.sort(),
    checked: att.stamps,          // 이긴 쪽의 켠 시각을 그대로 물려받는다
    removed: att.tombs,
    // 벨트·단계 시작일은 이력에서 파생되므로 이력만 합치면 된다
    history: his.kept.map(d => histByDate.get(d)).sort((x, y) => x.date.localeCompare(y.date)),
    removedHistory: his.tombs,
    updatedAt: (b.updatedAt || "") > (a.updatedAt || "") ? b.updatedAt : a.updatedAt,
    epoch: a.epoch
  };
}

/*
 * "올릴 게 있는가"를 판정한다. 새 필드를 여기 넣는 걸 잊으면 그 필드를 고쳐도
 * 변한 게 없다고 보고 Gist 에 push 하지 않는다. 메모 쪽 짝은 notes.js 의 sameNotes.
 */
function sameState(a, b) {
  const norm = s => JSON.stringify([s.epoch, s.startedAt, s.trackPromotion, s.trackPromotionAt,
                                    s.attendance, s.checked, s.removed,
                                    s.history, s.removedHistory]);
  return norm(a) === norm(b);
}

/*
 * 자정이 지나면 "오늘"이 바뀐다. render() 는 사용자 조작과 앱 복귀 때만 돌기 때문에,
 * 켜 둔 채 자정을 넘기면 어제 칸이 오늘로 남아 **엉뚱한 날짜를 누르게 된다.**
 * 데스크톱에서 탭을 띄워 두는 흐름에서 특히 잘 걸린다.
 */
let midnightTimer = null;
function scheduleMidnight() {
  clearTimeout(midnightTimer);
  const n = new Date();
  const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5);
  midnightTimer = setTimeout(() => { render(); scheduleMidnight(); }, next - n);
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
   오버레이 스택 — 뜬 것은 전부 뒤로가기 한 번에 하나씩 닫힌다

   예전에는 「전체 메모」 화면만 히스토리를 쌓았다. 그래서 본문에서 연 메모 팝업이나 공유
   카드는 폰 뒤로가기로 닫히지 않고 **앱을 나가 버렸다** — 한 화면에서는 되고 다른 화면에서는
   안 되는 것이 가장 나쁘다. 지금은 무엇이든 뜰 때 한 칸 쌓고, 내려올 때 그 칸을 되감는다.

   닫기는 두 경로가 있다. 버튼·Escape 는 dismissOverlay 로 **즉시** 닫고 히스토리를 되감고,
   하드웨어 뒤로가기는 popstate 가 깊이를 보고 닫는다. 깊이를 state 에 적어 두므로
   여러 칸을 한 번에 되감아도(history.go(-2)) 정확히 그만큼만 닫힌다.
   ============================================================ */

let overlays = [];        // { name, close, box, mt } — 위로 쌓인 순서
let overlayDepth = 0;     // 실제로 history 에 쌓은 칸 수

/**
 * @param close 실제로 감추는 함수. 히스토리를 건드리면 안 된다 (여기가 이미 맡고 있다)
 * @param box   포커스를 가둘 요소. 화면 전환(전체 메모)처럼 모달이 아니면 생략한다
 */
function openOverlay(name, close, box) {
  if (overlays.some(o => o.name === name)) return;
  let mt = null;
  try {
    history.pushState({ mt: overlayDepth + 1 }, "");
    mt = ++overlayDepth;
  } catch (e) {
    // 히스토리를 못 쌓는 환경이면 뒤로가기만 포기하고 그대로 동작한다
    console.warn("히스토리를 쌓지 못했습니다", e);
  }
  overlays.push({ name, close, box: box || null, mt, focus: document.activeElement });
  if (box) {
    box.setAttribute("aria-modal", "true");
    focusInto(box);
  }
}

/** 버튼·Escape 로 닫을 때. 그 위에 뜬 것도 함께 내려온다 */
function dismissOverlay(name) {
  const i = overlays.findIndex(o => o.name === name);
  if (i < 0) return;
  const drop = overlays.splice(i);
  let steps = 0;
  for (let k = drop.length - 1; k >= 0; k--) {
    closeOverlayRecord(drop[k]);
    if (drop[k].mt !== null) steps++;
  }
  if (steps) { overlayDepth -= steps; history.go(-steps); }
}

function closeOverlayRecord(o) {
  o.close();
  if (o.box) o.box.removeAttribute("aria-modal");
  // 열기 전에 있던 자리로 포커스를 돌려준다 — 안 그러면 body 로 떨어져 탭 순서를 잃는다
  if (o.focus && o.focus.isConnected && o.focus.focus) o.focus.focus();
}

/** 하드웨어 뒤로가기. history.state 의 깊이까지만 내려온다 */
function popOverlaysTo(target) {
  overlayDepth = target;
  while (overlays.length) {
    const top = overlays[overlays.length - 1];
    if (top.mt !== null && top.mt <= target) break;
    closeOverlayRecord(overlays.pop());
  }
}

const topOverlay = () => overlays[overlays.length - 1] || null;
const overlayOpen = name => overlays.some(o => o.name === name);

/** 모달 안에서 초점을 받을 수 있는 것들 (숨은 것 제외) */
function focusables(box) {
  return [...box.querySelectorAll("button, [href], input, textarea, select")]
    .filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
}

function focusInto(box) {
  const f = focusables(box);
  if (f.length) f[0].focus();
}

/** 모달 밖으로 탭이 새어나가지 않게 앞뒤를 이어 붙인다 */
function trapTab(e) {
  const top = topOverlay();
  if (!top || !top.box) return;
  const f = focusables(top.box);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  else if (!top.box.contains(document.activeElement)) { first.focus(); e.preventDefault(); }
}

/* ============================================================
   날짜 선택기 — 네이티브 date 입력은 시작 요일을 브라우저 로케일이 정해
   바꿀 수 없다. 출석 달력과 같은 일요일 시작으로 맞추려고 직접 만든다.
   ============================================================ */

let pickerTarget = null;      // 값을 채울 input
let pickerCursor = today();   // 보고 있는 달

function openPicker(input) {
  if (overlayOpen("picker")) return;
  pickerTarget = input;
  const v = input.value;
  pickerCursor = DATE_RE.test(v) ? parseKey(v) : today();
  $("pickerClear").hidden = input.dataset.clearable !== "1";
  $("picker").hidden = false;
  $("pickerBack").hidden = false;
  renderPicker();
  openOverlay("picker", hidePicker, $("picker"));
}

/** 실제로 감추기만 한다. 밖에서는 closePicker() 를 쓴다 */
function hidePicker() {
  $("picker").hidden = true;
  $("pickerBack").hidden = true;
  pickerTarget = null;
}

const closePicker = () => dismissOverlay("picker");

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

  const tk = key(today());
  const sel = pickerTarget ? pickerTarget.value : "";

  // 출석 달력과 같은 이유로 항상 6주. 팝오버는 가운데 정렬이라 높이가 변하면 위아래로 흔들린다
  const first = new Date(y, m, 1);
  const gridStart = addDays(first, -first.getDay());

  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const dk = key(d);
    const btn = document.createElement("button");
    btn.type = "button";
    const cls = ["day"];
    if (d.getMonth() !== m) cls.push("other");
    if (dk === sel) cls.push("on");
    if (dk === tk) cls.push("today");
    if (dk > tk) cls.push("future");             // 미래는 어차피 거부되므로 막는다
    btn.className = cls.join(" ");
    btn.textContent = d.getDate();
    if (d.getMonth() === m && dk <= tk) btn.onclick = () => commitPicker(dk);
    grid.appendChild(btn);
  }
}

/* ============================================================
   공유 — 카드 미리보기 후 내보내기
   카드 그리기는 share-card.js 가 맡는다.
   ============================================================ */

const SHARE_URL = "https://camon85.github.io/mat-time/";

let shareBlob = null;
let sharing = false;      // 연타·재시도로 공유 시트가 두 번 뜨는 것을 막는다

/**
 * 카드를 미리 만들어 두고 모달을 연다.
 * Blob 을 여기서 먼저 만드는 이유: iOS Safari 의 navigator.share 는 사용자 제스처
 * 안에서만 동작하는데, 공유 버튼을 누른 뒤 await 로 그리면 제스처 맥락이 끊긴다.
 */
async function openShare(mode) {
  const box = $("shareBox"), back = $("shareBack");
  $("shareTitle").textContent = mode === "promotion" ? "🎉 승급을 기록했습니다" : "공유 카드";
  revokePreview();
  $("shareNote").textContent = "카드를 만드는 중…";
  box.hidden = false; back.hidden = false;
  openOverlay("share", hideShare, box);

  try {
    shareBlob = await drawShareCard(mode);
  } catch (e) {
    shareBlob = null;
    $("shareNote").textContent = "카드를 만들지 못했습니다. 링크만 복사할 수 있습니다.";
    return;
  }
  $("sharePreview").src = URL.createObjectURL(shareBlob);
  $("shareNote").textContent = "보내기 전에 어떤 내용이 담기는지 확인하세요.";
}

/** 미리보기에 걸린 blob: URL 을 반드시 회수한다 — 안 하면 카드를 열 때마다 샌다 */
function revokePreview() {
  const img = $("sharePreview");
  if (img.src && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  img.removeAttribute("src");
}

function hideShare() {
  $("shareBox").hidden = true;
  $("shareBack").hidden = true;
  revokePreview();
  shareBlob = null;
}

const closeShare = () => dismissOverlay("share");

function shareText() {
  const { belt, stripe } = currentRank();
  const span = state.startedAt ? `주짓수 ${fmtSpan(state.startedAt)} · ` : "";
  return `${span}${labelOf(belt, stripe)} — Mat Time`;
}

/**
 * 환경마다 되는 게 달라 3단으로 내려간다.
 * 1) 파일 공유(모바일, https 필요) → 2) 이미지 클립보드 → 3) 파일 저장
 */
async function sendShare() {
  if (sharing) return;
  if (!shareBlob) { toast("카드가 아직 준비되지 않았습니다"); return; }
  sharing = true;
  $("btnShareSend").disabled = true;
  try {
    await runShare();
  } finally {
    sharing = false;
    $("btnShareSend").disabled = false;
  }
}

async function runShare() {
  const file = new File([shareBlob], `mat-time-${key(today())}.png`, { type: "image/png" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: shareText(), url: SHARE_URL });
      closeShare();
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;      // 사용자가 취소한 것은 실패가 아니다
    }
  }

  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": shareBlob })]);
    toast("이미지를 복사했습니다 · 붙여넣기 하세요");
    return;
  } catch (e) { /* 다음 단계로 */ }

  saveShare();
  toast("공유가 지원되지 않아 이미지를 저장했습니다");
}

function saveShare() {
  if (!shareBlob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(shareBlob);
  a.download = `mat-time-${key(today())}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(SHARE_URL);
    toast("링크를 복사했습니다");
  } catch (e) {
    prompt("아래 주소를 복사하세요", SHARE_URL);
  }
}
