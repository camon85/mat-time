/*
 * 경계 조건. 전부 "실제로 그렇게 되는지 돌려 봤더니 아니었다" 에서 나온 것들이라,
 * 하나하나가 고쳐진 버그이거나 다시 깨지면 조용히 데이터를 잃는 지점이다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, coreDoc, notesDoc, plain } from "./harness.mjs";

const api = loadApp();
const AT = "2026-08-01T10:00:00.000Z";
const LATER = "2026-08-09T00:00:00.000Z";

const notesWith = patch => api.normalizeNotes({
  notes: {}, removedNotes: {}, removedTags: {}, updatedAt: AT, ...patch
});

/* ------------------------------------------------------------
   사전 객체와 프로토타입 이름

   분류 id 는 사용자가 정하는 10자 이하 문자열이라 `toString` · `valueOf` · `__proto__`
   가 될 수 있다. 평범한 {} 를 사전으로 쓰면 세 가지가 한꺼번에 깨진다.
   ------------------------------------------------------------ */

const PROTO_NAMES = ["__proto__", "toString", "valueOf", "hasOwnProperty".slice(0, 10)];

for (const id of PROTO_NAMES) {
  test(`분류 이름이 "${id}" 여도 사라지지 않는다`, () => {
    const n = notesWith({ tags: [{ id, name: id, at: AT }, { id: "class", name: "수업", at: AT }] });
    assert.ok(n.tags.some(t => t.id === id),
              `읽는 즉시 사라졌다: ${JSON.stringify(n.tags.map(t => t.id))}`);
  });

  test(`분류 이름이 "${id}" 인 백업도 복원할 수 있다`, () => {
    const doc = {
      attendance: [], removed: {}, history: [], removedHistory: {},
      notes: {}, removedNotes: {}, tags: [{ id, name: id }], removedTags: {},
      updatedAt: AT, epoch: 0
    };
    // `id in removedTags` 로 검사하면 프로토타입 체인에 걸려 멀쩡한 파일을 거부했다
    assert.equal(api.validateBackup(doc), null);
  });

  test(`"${id}" 분류의 삭제 툼스톤이 저장·전파된다`, () => {
    const doc = notesWith({ tags: [{ id: "class", name: "수업", at: AT }], removedTags: { [id]: AT } });
    // `map["__proto__"] = "..."` 은 setter 라 조용히 무시됐다 → 툼스톤이 사라졌다
    assert.equal(plain(doc).removedTags[id], AT, "JSON 왕복에서 툼스톤이 사라졌다");

    const had = notesWith({ tags: [{ id, name: id, at: AT }, { id: "class", name: "수업", at: AT }] });
    const deleted = notesWith({
      tags: [{ id: "class", name: "수업", at: AT }],
      removedTags: { [id]: LATER }, updatedAt: LATER
    });
    assert.ok(!api.mergeNotes(had, deleted).tags.some(t => t.id === id),
              "지운 분류가 병합에서 되살아났다");
  });
}

test("사전으로 쓰는 객체에는 프로토타입이 없다", () => {
  const doc = coreDoc(api, { attendance: ["2026-08-01"], checked: { "2026-08-01": AT } });
  for (const [name, m] of [["checked", doc.checked], ["removed", doc.removed]]) {
    assert.equal(Object.getPrototypeOf(m), null, `${name} 에 프로토타입이 붙어 있다`);
  }
  const n = notesWith({ removedTags: { toString: AT } });
  assert.equal(Object.getPrototypeOf(n.removedTags), null);
  // 그래도 직렬화는 평범한 객체와 똑같아야 한다
  assert.equal(JSON.stringify(doc.checked), `{"2026-08-01":"${AT}"}`);
});

/* ------------------------------------------------------------
   길이 상한과 이모지
   ------------------------------------------------------------ */

const noteText = text => notesWith({
  notes: { "2026-08-01": { text, tag: "class", at: AT } },
  tags: [{ id: "class", name: "수업", at: AT }]
}).notes["2026-08-01"].text;

test("500자로 자를 때 이모지를 쪼개지 않는다", () => {
  // "a" + 이모지 300개 → 500번째 코드 유닛이 서러게이트 쌍의 한가운데다
  const cut = noteText("a" + "🥋".repeat(300));
  assert.ok(!/[\uD800-\uDBFF]$/.test(cut), `반쪽 글자가 남았다: ${JSON.stringify(cut.slice(-2))}`);
  assert.ok(cut.length <= api.NOTE_MAX);
});

test("경계에 이모지가 없으면 정확히 상한까지 남는다", () => {
  assert.equal(noteText("가".repeat(600)).length, api.NOTE_MAX);
  assert.equal(noteText("짧다"), "짧다");
});

test("분류 이름도 같은 규칙으로 잘린다", () => {
  const name = notesWith({ tags: [{ id: "t", name: "🥋".repeat(8), at: AT }] }).tags[0].name;
  assert.ok(!/[\uD800-\uDBFF]$/.test(name), JSON.stringify(name));
  assert.ok(name.length <= api.TAG_NAME_MAX);
});

/* ------------------------------------------------------------
   관용적 파서의 방어선
   ------------------------------------------------------------ */

test("normalize·normalizeNotes 는 어떤 값을 넣어도 던지지 않는다", () => {
  for (const input of [null, undefined, [], 42, "str", true, { notes: 1, tags: 2 }]) {
    assert.doesNotThrow(() => api.normalize(input), `normalize(${JSON.stringify(input)})`);
    assert.doesNotThrow(() => api.normalizeNotes(input), `normalizeNotes(${JSON.stringify(input)})`);
  }
  assert.equal(api.normalize(null).attendance.length, 0);
  assert.equal(api.normalizeNotes(null).tags.length, api.DEFAULT_TAGS.length);
});

test("분류가 모두 지워지면 초기값으로 돌아가고 메모도 유효한 분류를 갖는다", () => {
  const n = notesWith({
    tags: [{ id: "class", name: "수업", at: AT }], removedTags: { class: AT },
    notes: { "2026-08-01": { text: "x", tag: "class", at: AT } }
  });
  assert.equal(n.tags.length, api.DEFAULT_TAGS.length);
  const ids = new Set(n.tags.map(t => t.id));
  assert.ok(ids.has(n.notes["2026-08-01"].tag), "어느 필터에도 안 걸리는 유령 메모가 생겼다");
});

/* ------------------------------------------------------------
   다기기 수렴 — 병합이 대수적으로 얌전한가
   ------------------------------------------------------------ */

test("세 기기가 라운드로빈으로 동기화하면 한 상태로 수렴한다", () => {
  const t = n => `2026-08-0${n}T10:00:00.000Z`;
  let remote = coreDoc(api, {});
  const devs = [
    coreDoc(api, { attendance: ["2026-08-01"], checked: { "2026-08-01": t(1) }, updatedAt: t(1) }),
    coreDoc(api, { attendance: ["2026-08-02"], checked: { "2026-08-02": t(2) }, updatedAt: t(2) }),
    coreDoc(api, { removed: { "2026-08-01": t(3) }, updatedAt: t(3) })
  ];
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < devs.length; i++) {
      devs[i] = api.mergeStates(devs[i], remote);
      remote = devs[i];
    }
  }
  const sigs = devs.map(x => JSON.stringify(plain([x.attendance, x.removed])));
  assert.equal(new Set(sigs).size, 1, `수렴하지 않았다: ${sigs.join(" | ")}`);
  assert.deepEqual(plain(devs[0].attendance), ["2026-08-02"], "가장 늦은 취소가 이겨야 한다");
});

test("병합은 인자 순서와 무관하다 (교환법칙)", () => {
  const a = coreDoc(api, {
    attendance: ["2026-08-01"], checked: { "2026-08-01": AT },
    history: [{ date: "2025-01-10", belt: 1, stripe: 0, at: AT }],
    startedAt: "2020-01-01", trackPromotion: true, trackPromotionAt: AT, updatedAt: AT
  });
  const b = coreDoc(api, {
    removed: { "2026-08-01": LATER }, removedHistory: { "2025-01-10": LATER },
    startedAt: "2019-01-01", updatedAt: LATER
  });
  assert.deepEqual(plain(api.mergeStates(a, b)), plain(api.mergeStates(b, a)));
});

test("병합은 멱등이다 (자기 자신과 합쳐도 그대로)", () => {
  const a = coreDoc(api, {
    attendance: ["2026-08-01"], checked: { "2026-08-01": AT },
    history: [{ date: "2025-01-10", belt: 1, stripe: 0, at: AT }], updatedAt: AT
  });
  assert.ok(api.sameState(api.mergeStates(a, a), a));
  const n = notesDoc(api, { notes: { "2026-08-01": { text: "x", tag: "class", at: AT } }, updatedAt: AT });
  assert.ok(api.sameNotes(api.mergeNotes(n, n), n));
});

/* ------------------------------------------------------------
   날짜·벨트 경계
   ------------------------------------------------------------ */

test("말일이 금요일인 달은 그날이 승급식이다", () => {
  assert.equal(api.key(api.lastFridayOf(2026, 4)), "2026-05-29");
  // 승급식 다음 날에 물으면 다음 달로 넘어간다
  const c = api.lastFridayOf(2026, 7);
  assert.equal(api.key(api.ceremonyOnOrAfter(api.addDays(c, 1))), "2026-09-25");
});

test("윤년 2/29 는 왕복하고, 1년 뒤는 2/28 로 잘린다", () => {
  assert.equal(api.key(api.parseKey("2024-02-29")), "2024-02-29");
  assert.equal(api.key(api.addMonths(api.parseKey("2024-02-29"), 12)), "2025-02-28");
});

test("블랙벨트는 기준도 다음 단계도 없다", () => {
  assert.equal(api.requirementOf(api.BLACK, 0), null);
  assert.deepEqual(plain(api.nextOf(api.BLACK, 0)), { belt: api.BLACK, stripe: 0 });
  assert.equal(api.stepIndexOf(api.BLACK, 0), api.TOTAL_STEPS);
});

test("미래 승급일(손으로 만든 파일)이 있어도 깨지지 않는다", () => {
  api.setState(coreDoc(api, { history: [{ date: "2099-01-01", belt: 1, stripe: 0, at: AT }] }));
  assert.equal(api.currentRank().since, "2099-01-01");
  assert.equal(api.currentStageDays(), 0, "아직 오지 않은 단계의 출석은 0이어야 한다");
  assert.equal(api.fmtSpan("2099-01-01"), "시작 예정");
});

test("기록이 하나도 없을 때의 통계", () => {
  api.setState(coreDoc(api, {}));
  assert.equal(api.recentPerWeek(), 0);
  assert.equal(api.weeklyStreak(), 0);
  assert.equal(api.attendedThisWeek(), false);
  assert.equal(api.trackedSince(), api.key(api.today()));
});
