/*
 * 브라우저 없이 순수 함수만 시험하기 위한 로더.
 *
 * app.js · notes.js 는 번들러 없는 일반 스크립트라 import 할 수 없다. 대신 vm 컨텍스트를
 * 하나 만들어 브라우저와 **같은 방식**으로 — 전역을 공유하는 스크립트 두 장으로 — 올린다.
 * 최상위에서 DOM 을 건드리는 파일은 main.js 뿐이라 그것만 빼면 그대로 로드된다.
 *
 * 최상위 const/let 은 globalThis 의 속성이 되지 않으므로(브라우저에서도 같다) 컨텍스트
 * 안에서 한 번 모아 내보낸다. 그래서 테스트가 앱 코드에 손을 대지 않아도 된다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 앱이 최상위에서 부르지는 않지만, 실수로 닿았을 때 조용히 죽지 않도록 최소한만 흉내낸다 */
function fakeDom() {
  const el = () => ({
    style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} },
    dataset: {}, hidden: false, value: "", textContent: "", innerHTML: "",
    setAttribute() {}, removeAttribute() {}, appendChild() {}, append() {},
    querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ height: 0 })
  });
  return {
    getElementById: el, createElement: el, querySelector: () => null,
    querySelectorAll: () => [], addEventListener() {},
    documentElement: { style: { setProperty() {} } }
  };
}

function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: k => void m.delete(k),
    _map: m
  };
}

/** 내보낼 이름들. 앱에서 이름이 바뀌면 여기서 바로 터진다 (조용히 undefined 가 되지 않도록) */
const EXPORTS = [
  // 벨트·단계
  "BELTS", "MAX_STRIPE", "BLACK", "TOTAL_STEPS", "requirementOf", "stepIndexOf", "nextOf", "labelOf",
  // 날짜
  "key", "parseKey", "today", "addDays", "addMonths", "daysBetween", "monthsElapsed",
  "lastFridayOf", "ceremonyOnOrAfter", "fmtSpan",
  // 문서
  "normalize", "normalizeNotes", "stampMap", "clamp", "currentRank", "currentStageDays",
  // 병합
  "pickByStamp", "mergeStates", "mergeNotes", "sameState", "sameNotes", "newerEpoch",
  // 백업
  "validateBackup", "backupDoc",
  // 메모
  "DEFAULT_TAGS", "MAX_TAGS", "TAG_NAME_MAX", "NOTE_MAX", "toParticle", "okTagId",
  // 통계
  "weeklyStreak", "attendedThisWeek", "recentPerWeek", "trackedSince"
];

export function loadApp() {
  const sandbox = {
    document: fakeDom(),
    localStorage: fakeStorage(),
    console,
    requestAnimationFrame: fn => setTimeout(fn, 0),
    setTimeout, clearTimeout, history: { pushState() {}, back() {} },
    navigator: {}, location: { protocol: "https:" }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  for (const f of ["app.js", "notes.js"]) {
    vm.runInContext(readFileSync(join(ROOT, f), "utf8"), ctx, { filename: f });
  }

  const missing = vm.runInContext(
    `[${EXPORTS.map(n => JSON.stringify(n)).join(",")}].filter(n => typeof eval(n) === "undefined")`,
    ctx);
  if (missing.length) throw new Error(`앱에서 찾지 못한 이름: ${missing.join(", ")}`);

  vm.runInContext(
    `globalThis.__api = { ${EXPORTS.join(", ")} };
     globalThis.__setState = s => { state = s; };
     globalThis.__getState = () => state;
     globalThis.__setNotes = n => { noteDoc = n; };
     globalThis.__getNotes = () => noteDoc;`, ctx);

  const api = ctx.__api;
  api.setState = ctx.__setState;
  api.getState = ctx.__getState;
  api.setNotes = ctx.__setNotes;
  api.getNotes = ctx.__getNotes;
  api.ctx = ctx;
  return api;
}

/*
 * vm 컨텍스트가 만든 배열·객체는 바깥 realm 의 Array/Object 가 아니라서
 * deepStrictEqual 이 "구조는 같은데 참조가 다르다" 로 떨어진다. 값만 보게 평평하게 옮긴다.
 */
export const plain = v => JSON.parse(JSON.stringify(v));

/** 코어 문서를 짧게 쓰기 위한 헬퍼. normalize 를 거치므로 불변식이 항상 성립한다 */
export function coreDoc(api, patch = {}) {
  return api.normalize({
    startedAt: "", attendance: [], checked: {}, removed: {},
    history: [], removedHistory: {}, updatedAt: "", epoch: 0, ...patch
  });
}

export function notesDoc(api, patch = {}) {
  return api.normalizeNotes({
    notes: {}, removedNotes: {}, tags: undefined, removedTags: {},
    updatedAt: "", epoch: 0, ...patch
  });
}
