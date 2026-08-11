/*
 * 동기화 병합 — 이 프로젝트에서 가장 틀리기 쉬운 곳.
 * 여기서 잡히는 버그는 전부 "지운 게 되살아난다" 또는 "쓴 게 사라진다" 로 나타난다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, coreDoc, notesDoc, plain } from "./harness.mjs";

const api = loadApp();

const T1 = "2026-08-01T10:00:00.000Z";
const T2 = "2026-08-02T09:00:00.000Z";
const T3 = "2026-08-05T10:00:00.000Z";

test("출석: 양쪽에서 따로 체크한 날짜는 합쳐진다", () => {
  const a = coreDoc(api, { attendance: ["2026-08-01"], checked: { "2026-08-01": T1 }, updatedAt: T1 });
  const b = coreDoc(api, { attendance: ["2026-08-03"], checked: { "2026-08-03": T2 }, updatedAt: T2 });
  assert.deepEqual(plain(api.mergeStates(a, b).attendance), ["2026-08-01", "2026-08-03"]);
});

test("출석: 취소가 그 이전의 체크를 이긴다", () => {
  const local = coreDoc(api, { attendance: ["2026-08-01"], checked: { "2026-08-01": T1 }, updatedAt: T1 });
  const remote = coreDoc(api, { removed: { "2026-08-01": T2 }, updatedAt: T2 });
  const m = api.mergeStates(local, remote);
  assert.deepEqual(plain(m.attendance), []);
  assert.equal(m.removed["2026-08-01"], T2);
});

test("출석: 취소 뒤 다시 체크하면 재체크가 이긴다", () => {
  const local = coreDoc(api, { attendance: ["2026-08-01"], checked: { "2026-08-01": T3 }, updatedAt: T3 });
  const remote = coreDoc(api, { removed: { "2026-08-01": T2 }, updatedAt: T2 });
  assert.deepEqual(plain(api.mergeStates(local, remote).attendance), ["2026-08-01"]);
});

/*
 * 회귀 — 예전에는 "켠 시각" 으로 문서의 updatedAt 을 썼다. 그래서 이 기기가 **다른 날짜를**
 * 체크하기만 해도 살아 있는 모든 날짜의 주장 시각이 함께 밀려, 상대가 지운 날짜까지 되살아났다.
 * 폰에서 지우고 → 나중에 PC 를 열어 오늘 체크, 라는 가장 흔한 흐름이다.
 */
test("회귀: 다른 날짜를 체크해도 상대가 지운 날짜는 되살아나지 않는다", () => {
  const pc = coreDoc(api, {
    attendance: ["2026-08-01", "2026-08-05"],
    checked: { "2026-08-01": T1, "2026-08-05": T3 },   // 8/5 만 새로 체크
    updatedAt: T3
  });
  const remote = coreDoc(api, { removed: { "2026-08-01": T2 }, updatedAt: T2 });
  const m = api.mergeStates(pc, remote);
  assert.deepEqual(plain(m.attendance), ["2026-08-05"], "8/1 이 되살아나면 안 된다");
  assert.equal(m.removed["2026-08-01"], T2);
});

test("회귀: 승급 이력도 다른 변경에 밀려 되살아나지 않는다", () => {
  const local = coreDoc(api, {
    history: [{ date: "2025-01-10", belt: 1, stripe: 0, at: T1 }],
    attendance: ["2026-08-05"], checked: { "2026-08-05": T3 },
    updatedAt: T3
  });
  const remote = coreDoc(api, { removedHistory: { "2025-01-10": T2 }, updatedAt: T2 });
  assert.deepEqual(plain(api.mergeStates(local, remote).history), []);
});

test("회귀: 분류도 메모 수정에 밀려 되살아나지 않는다", () => {
  const local = notesDoc(api, {
    tags: [{ id: "class", name: "수업", at: T1 }, { id: "노기", name: "노기", at: T1 }],
    notes: { "2026-08-05": { text: "드릴", tag: "class", at: T3 } },
    updatedAt: T3
  });
  const remote = notesDoc(api, {
    tags: [{ id: "class", name: "수업", at: T1 }],
    removedTags: { "노기": T2 }, updatedAt: T2
  });
  const m = api.mergeNotes(local, remote);
  assert.deepEqual(plain(m.tags.map(t => t.id)), ["class"]);
  assert.equal(m.removedTags["노기"], T2);
});

test("옛 문서(켠 시각 없음)를 읽으면 문서 시각으로 확정된다", () => {
  const legacy = api.normalize({
    attendance: ["2026-08-01"], removed: {}, history: [], removedHistory: {},
    updatedAt: T1, epoch: 0
  });
  assert.equal(legacy.checked["2026-08-01"], T1);
  // 확정된 뒤에는 문서를 더 고쳐도 그 날짜의 주장 시각이 밀리지 않는다
  const later = { ...legacy, updatedAt: T3 };
  const remote = coreDoc(api, { removed: { "2026-08-01": T2 }, updatedAt: T2 });
  assert.deepEqual(plain(api.mergeStates(later, remote).attendance), []);
});

test("checked 는 attendance 의 부분집합으로 정리된다", () => {
  const d = api.normalize({
    attendance: ["2026-08-01"],
    checked: { "2026-08-01": T1, "2026-08-09": T1 },   // 출석에 없는 유령 도장
    removed: {}, history: [], removedHistory: {}, updatedAt: T1, epoch: 0
  });
  assert.deepEqual(plain(Object.keys(d.checked)), ["2026-08-01"]);
});

test("승급 이력: 같은 날짜에 다른 벨트면 at 이 늦은 쪽이 이긴다 (인자 순서 무관)", () => {
  const a = coreDoc(api, { history: [{ date: "2026-01-30", belt: 1, stripe: 0, at: T1 }], updatedAt: T1 });
  const b = coreDoc(api, { history: [{ date: "2026-01-30", belt: 1, stripe: 2, at: T3 }], updatedAt: T3 });
  assert.equal(api.mergeStates(a, b).history[0].stripe, 2);
  assert.equal(api.mergeStates(b, a).history[0].stripe, 2, "순서를 바꿔도 같아야 한다");
});

test("승급 추적은 기본이 꺼짐이고, 이력이 있어도 켜지지 않는다", () => {
  assert.equal(coreDoc(api).trackPromotion, false);
  const withHistory = coreDoc(api, {
    history: [{ date: "2025-01-10", belt: 1, stripe: 0, at: T1 }]
  });
  assert.equal(withHistory.trackPromotion, false, "이력 유무로 추론하면 안 된다");
  // 명시적으로 켠 것만 켜진다
  assert.equal(coreDoc(api, { trackPromotion: true }).trackPromotion, true);
  // 값이 아닌 것은 꺼짐으로 읽는다
  assert.equal(coreDoc(api, { trackPromotion: "yes" }).trackPromotion, false);
  assert.equal(coreDoc(api, { trackPromotion: 1 }).trackPromotion, false);
});

test("승급 추적 켬/끔은 나중에 바꾼 쪽이 이긴다", () => {
  const on = coreDoc(api, { trackPromotion: true, trackPromotionAt: T1, updatedAt: T1 });
  const off = coreDoc(api, { trackPromotion: false, trackPromotionAt: T3, updatedAt: T3 });
  assert.equal(api.mergeStates(on, off).trackPromotion, false);
  assert.equal(api.mergeStates(off, on).trackPromotion, false, "순서를 바꿔도 같아야 한다");
});

test("회귀: 다른 기기의 출석 체크가 방금 켠 추적 설정을 되돌리지 않는다", () => {
  // PC 에서 추적을 켬 (T3). 폰은 설정을 건드린 적 없고 출석만 체크했다 (문서 시각은 더 최신)
  const pc = coreDoc(api, { trackPromotion: true, trackPromotionAt: T3, updatedAt: T3 });
  const phone = coreDoc(api, {
    attendance: ["2026-08-09"], checked: { "2026-08-09": "2026-08-09T10:00:00.000Z" },
    updatedAt: "2026-08-09T10:00:00.000Z"      // T3 보다 늦다
  });
  assert.equal(api.mergeStates(pc, phone).trackPromotion, true,
               "설정을 건드리지 않은 쪽이 이기면 안 된다");
});

test("추적을 꺼도 승급 이력·출석·현재 벨트는 그대로다 (숨기는 것이지 지우는 게 아니다)", () => {
  const d = coreDoc(api, {
    trackPromotion: false, trackPromotionAt: T3,
    history: [{ date: "2025-01-10", belt: 1, stripe: 0, at: T1 },
              { date: "2026-03-27", belt: 2, stripe: 2, at: T1 }],
    attendance: ["2026-08-01"], checked: { "2026-08-01": T1 }
  });
  assert.equal(d.history.length, 2);
  assert.deepEqual(plain(d.attendance), ["2026-08-01"]);

  api.setState(d);
  assert.deepEqual(plain(api.currentRank()),
                   { belt: 2, stripe: 2, since: "2026-03-27" },
                   "현재 벨트는 추적과 무관하게 이력에서 파생된다");

  // 다시 켜면 그동안의 기록으로 곧바로 계산된다 (되살릴 것이 없다)
  api.setState({ ...d, trackPromotion: true });
  assert.deepEqual(plain(api.currentRank()), { belt: 2, stripe: 2, since: "2026-03-27" });
});

test("sameState 는 추적 설정 변화를 감지한다", () => {
  const a = coreDoc(api, { trackPromotion: false, trackPromotionAt: T1 });
  const b = coreDoc(api, { trackPromotion: true, trackPromotionAt: T3 });
  assert.equal(api.sameState(a, b), false);
});

test("시작일은 더 이른 쪽 (한쪽이 비어도 지워지지 않는다)", () => {
  const a = coreDoc(api, { startedAt: "2020-03-01", updatedAt: T3 });
  const b = coreDoc(api, { startedAt: "", updatedAt: T1 });
  assert.equal(api.mergeStates(a, b).startedAt, "2020-03-01");
  const c = coreDoc(api, { startedAt: "2018-01-01", updatedAt: T1 });
  assert.equal(api.mergeStates(a, c).startedAt, "2018-01-01");
});

test("epoch 이 다르면 병합하지 않고 높은 쪽을 통째로 쓴다", () => {
  const old = coreDoc(api, { attendance: ["2026-08-01"], checked: { "2026-08-01": T1 }, epoch: 0 });
  const fresh = coreDoc(api, { attendance: ["2026-08-09"], checked: { "2026-08-09": T3 }, epoch: 1 });
  assert.deepEqual(plain(api.mergeStates(old, fresh).attendance), ["2026-08-09"]);
  assert.deepEqual(plain(api.mergeStates(fresh, old).attendance), ["2026-08-09"]);
});

test("병합은 안정적이다 — 같은 입력을 다시 병합해도 변하지 않는다", () => {
  const a = coreDoc(api, {
    attendance: ["2026-08-01"], checked: { "2026-08-01": T1 },
    history: [{ date: "2025-01-10", belt: 1, stripe: 0, at: T1 }], updatedAt: T1
  });
  const b = coreDoc(api, { removed: { "2026-07-01": T2 }, updatedAt: T2 });
  const once = api.mergeStates(a, b);
  assert.ok(api.sameState(once, api.mergeStates(once, b)), "두 번 병합해도 같아야 push 가 멈춘다");
  assert.ok(api.sameState(once, api.mergeStates(once, once)));
});

test("sameState 는 checked 변화를 감지한다 (놓치면 Gist 에 안 올라간다)", () => {
  const a = coreDoc(api, { attendance: ["2026-08-01"], checked: { "2026-08-01": T1 } });
  const b = coreDoc(api, { attendance: ["2026-08-01"], checked: { "2026-08-01": T3 } });
  assert.equal(api.sameState(a, b), false);
});

test("메모: 같은 날짜를 양쪽에서 고치면 at 이 늦은 쪽이 남는다", () => {
  const a = notesDoc(api, { notes: { "2026-08-01": { text: "A", tag: "class", at: T1 } }, updatedAt: T1 });
  const b = notesDoc(api, { notes: { "2026-08-01": { text: "B", tag: "class", at: T3 } }, updatedAt: T3 });
  assert.equal(api.mergeNotes(a, b).notes["2026-08-01"].text, "B");
  assert.equal(api.mergeNotes(b, a).notes["2026-08-01"].text, "B");
});

test("메모: 지운 분류를 쓰던 메모는 첫 분류로 떨어진다 (유령 메모 방지)", () => {
  const a = notesDoc(api, {
    tags: [{ id: "class", name: "수업", at: T1 }, { id: "노기", name: "노기", at: T1 }],
    notes: { "2026-08-01": { text: "노기 롤링", tag: "노기", at: T1 } }, updatedAt: T1
  });
  const b = notesDoc(api, {
    tags: [{ id: "class", name: "수업", at: T1 }], removedTags: { "노기": T3 }, updatedAt: T3
  });
  const m = api.mergeNotes(a, b);
  assert.equal(m.notes["2026-08-01"].tag, "class");
  assert.ok(m.tags.every(t => t.id !== "노기"));
});
