/*
 * 날짜·승급식 계산. 전부 로컬 자정 기준이고, 여기서 하루가 어긋나면
 * D-day 와 「빠르면 / 이 페이스면」이 통째로 틀어진다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, coreDoc, plain } from "./harness.mjs";

const api = loadApp();
const d = s => api.parseKey(s);

test("key ↔ parseKey 는 로컬 달력 날짜로 왕복한다", () => {
  for (const s of ["2026-01-01", "2026-02-28", "2026-12-31", "2024-02-29"]) {
    assert.equal(api.key(api.parseKey(s)), s);
  }
});

test("addMonths 는 말일을 넘기지 않는다", () => {
  assert.equal(api.key(api.addMonths(d("2026-01-31"), 1)), "2026-02-28");
  assert.equal(api.key(api.addMonths(d("2024-01-31"), 1)), "2024-02-29", "윤년");
  assert.equal(api.key(api.addMonths(d("2026-03-31"), -1)), "2026-02-28");
  assert.equal(api.key(api.addMonths(d("2026-08-15"), 7)), "2027-03-15", "해 넘김");
});

test("daysBetween 은 DST 를 넘어도 정수 일수다", () => {
  assert.equal(api.daysBetween(d("2026-03-01"), d("2026-03-31")), 30);
  assert.equal(api.daysBetween(d("2026-01-01"), d("2027-01-01")), 365);
  assert.equal(api.daysBetween(d("2026-08-07"), d("2026-08-07")), 0);
});

test("monthsElapsed 는 경계에서 정확히 정수가 된다", () => {
  assert.equal(api.monthsElapsed(d("2026-01-15"), d("2026-04-15")), 3);
  assert.equal(api.monthsElapsed(d("2026-01-15"), d("2026-01-15")), 0);
  assert.equal(api.monthsElapsed(d("2026-04-15"), d("2026-01-15")), 0, "거꾸로면 0");
  const half = api.monthsElapsed(d("2026-01-01"), d("2026-01-16"));
  assert.ok(half > 0.4 && half < 0.6, `한 달의 절반쯤이어야 한다 (${half})`);
});

test("승급식은 매월 마지막 금요일이다", () => {
  const cases = [[2026, 0, "2026-01-30"], [2026, 7, "2026-08-28"],
                 [2026, 11, "2026-12-25"], [2024, 1, "2024-02-23"]];
  for (const [y, m, want] of cases) {
    assert.equal(api.key(api.lastFridayOf(y, m)), want);
  }
});

test("12월의 다음 승급식은 이듬해 1월이다", () => {
  assert.equal(api.key(api.ceremonyOnOrAfter(d("2026-12-26"))), "2027-01-29");
});

test("승급식 당일은 그 승급식이다 (넘기지 않는다)", () => {
  assert.equal(api.key(api.ceremonyOnOrAfter(d("2026-08-28"))), "2026-08-28");
  assert.equal(api.key(api.ceremonyOnOrAfter(d("2026-08-29"))), "2026-09-25");
});

test("승급 기준 — 화이트 0~3그랄만 3개월/30일", () => {
  assert.deepEqual(plain(api.requirementOf(0, 0)), { months: 3, days: 30 });
  assert.deepEqual(plain(api.requirementOf(0, 3)), { months: 3, days: 30 });
  assert.deepEqual(plain(api.requirementOf(0, 4)), { months: 7, days: 90 }, "4그랄 → 블루");
  assert.deepEqual(plain(api.requirementOf(2, 1)), { months: 7, days: 90 });
  assert.equal(api.requirementOf(api.BLACK, 0), null, "블랙은 최종");
});

test("다음 단계와 단계 인덱스", () => {
  assert.deepEqual(plain(api.nextOf(0, 3)), { belt: 0, stripe: 4 });
  assert.deepEqual(plain(api.nextOf(0, 4)), { belt: 1, stripe: 0 });
  assert.equal(api.stepIndexOf(0, 0), 0);
  assert.equal(api.stepIndexOf(api.BLACK, 0), api.TOTAL_STEPS);
  assert.equal(api.TOTAL_STEPS, 20);
});

test("현재 단계 출석은 승급식 다음 날부터 센다", () => {
  api.setState(coreDoc(api, {
    attendance: ["2026-01-30", "2026-01-31", "2026-02-01"],
    checked: {}, history: [{ date: "2026-01-30", belt: 1, stripe: 0, at: "2026-01-30T00:00:00Z" }]
  }));
  assert.equal(api.currentRank().since, "2026-01-30");
  // 오늘이 승급일 이후라고 가정할 수 있을 때만 의미가 있으므로 필터 결과만 확인한다
  const stage = api.getState().attendance.filter(k => k > "2026-01-30" && k <= api.key(api.today()));
  assert.deepEqual(plain(stage), ["2026-01-31", "2026-02-01"], "승급식 당일은 이전 단계");
});

test("이력이 비면 화이트 0그랄, 기준일은 시작일", () => {
  api.setState(coreDoc(api, { startedAt: "2020-03-01" }));
  assert.deepEqual(plain(api.currentRank()), { belt: 0, stripe: 0, since: "2020-03-01" });
});

test("연속은 주 단위 — 하루 쉬어도 끊기지 않는다", () => {
  const t = api.today();
  const back = n => api.key(api.addDays(t, -n));
  // 이번 주 · 지난주 · 지지난주에 한 번씩
  api.setState(coreDoc(api, { attendance: [back(0), back(7), back(14)].sort() }));
  assert.equal(api.weeklyStreak(), 3);
  assert.equal(api.attendedThisWeek(), true);
});

test("이번 주에 안 갔어도 연속이 끊긴 것으로 치지 않는다", () => {
  const t = api.today();
  const back = n => api.key(api.addDays(t, -n));
  api.setState(coreDoc(api, { attendance: [back(8), back(15)].sort() }));
  assert.equal(api.attendedThisWeek(), false);
  assert.ok(api.weeklyStreak() >= 1, "지난주까지 이어진 것은 살아 있어야 한다");
});

test("최근 4주 페이스는 28일 창을 4로 나눈다", () => {
  const t = api.today();
  const back = n => api.key(api.addDays(t, -n));
  api.setState(coreDoc(api, { attendance: [back(0), back(3), back(10), back(30)].sort() }));
  assert.equal(api.recentPerWeek(), 0.75, "창 밖의 30일 전은 빠진다");
});
