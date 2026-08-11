/*
 * 복원 검증 — "전부 또는 전무". 여기가 느슨해지면 남의 JSON 이 기록을 지우고 Gist 까지 덮는다.
 * 통과한 파일은 normalize 가 아무것도 버리지 않아야 한다(그게 이 검증의 존재 이유다).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, plain } from "./harness.mjs";

const api = loadApp();
const AT = "2026-08-01T10:00:00.000Z";

/** 검증을 통과하는 최소 백업 */
const good = (patch = {}) => ({
  startedAt: "2020-03-01",
  attendance: ["2026-08-01"],
  checked: { "2026-08-01": AT },
  removed: {},
  history: [{ date: "2025-01-10", belt: 1, stripe: 0, at: AT }],
  removedHistory: {},
  notes: { "2026-08-01": { text: "드릴", tag: "class", at: AT } },
  removedNotes: {},
  tags: [{ id: "class", name: "수업" }],
  removedTags: {},
  updatedAt: AT,
  epoch: 0,
  ...patch
});

test("온전한 백업은 통과한다", () => {
  assert.equal(api.validateBackup(good()), null);
});

test("통과한 파일은 normalize 가 아무것도 버리지 않는다", () => {
  const d = good();
  assert.equal(api.validateBackup(d), null);
  const core = api.normalize(d), notes = api.normalizeNotes(d);
  assert.deepEqual(plain(core.attendance), d.attendance);
  assert.equal(core.history.length, d.history.length);
  assert.equal(Object.keys(plain(notes.notes)).length, Object.keys(d.notes).length);
  assert.equal(notes.tags.length, d.tags.length);
});

test("Mat Time 파일이 아니면 거부한다", () => {
  assert.match(api.validateBackup({ hello: 1 }), /백업 파일이 아닙니다/);
  assert.match(api.validateBackup([]), /객체가 아닙니다/);
  assert.match(api.validateBackup(null), /객체가 아닙니다/);
});

test("옛 백업(checked·at·tags·trackPromotion 없음)도 통과한다", () => {
  const old = {
    startedAt: "", attendance: ["2026-08-01"], removed: {},
    history: [{ date: "2025-01-10", belt: 1, stripe: 0 }], removedHistory: {},
    updatedAt: AT, epoch: 0
  };
  assert.equal(api.validateBackup(old), null);
  // 읽으면 항목별 시각이 문서 시각으로 확정된다
  assert.equal(api.normalize(old).checked["2026-08-01"], AT);
  assert.equal(api.normalize(old).history[0].at, AT);
  // 승급 이력이 있어도 추적은 켜지지 않는다 — 별개의 의사다
  assert.equal(api.normalize(old).trackPromotion, false);
});

test("승급 추적 설정이 백업에 실려 왕복한다", () => {
  const d = good({ trackPromotion: true, trackPromotionAt: AT });
  assert.equal(api.validateBackup(d), null);
  assert.equal(api.normalize(d).trackPromotion, true);
  // 형식이 틀리면 거부한다 (조용히 꺼진 것으로 읽으면 설정이 사라진 것처럼 보인다)
  assert.match(api.validateBackup(good({ trackPromotion: "on" })), /형식이 올바르지 않습니다/);
  assert.match(api.validateBackup(good({ trackPromotionAt: 1 })), /형식이 올바르지 않습니다/);
});

test("각 필드의 형식 위반은 사유와 함께 거부된다", () => {
  const cases = [
    [{ startedAt: "2020/03/01" }, /startedAt/],
    [{ attendance: ["nope"] }, /날짜가 아닌 값/],
    [{ attendance: ["2026-08-01", "2026-08-01"], checked: { "2026-08-01": AT } }, /중복된 날짜/],
    [{ history: [{ date: "2025-01-10", belt: 9, stripe: 0 }] }, /belt/],
    [{ history: [{ date: "2025-01-10", belt: 0, stripe: 9 }] }, /stripe/],
    [{ history: [{ date: "2025-01-10", belt: 4, stripe: 2 }] }, /블랙벨트에는 그랄이 없습니다/],
    [{ history: [{ date: "2025-01-10", belt: 1, stripe: 0, at: "" }] }, /at 이 비어 있습니다/],
    [{ removed: { "nope": AT } }, /날짜 형식이 아닙니다/],
    [{ removed: { "2026-09-09": "" } }, /값이 비어 있습니다/],
    [{ notes: { "2026-08-01": { text: "x", tag: "없는분류", at: AT } } }, /tags 에 없습니다/],
    [{ notes: { "2026-08-01": { text: "x".repeat(501), tag: "class", at: AT } } }, /500자를 넘습니다/],
    [{ notes: { "2026-08-01": { text: " ", tag: "class", at: AT } } }, /text 가 비어 있습니다/],
    [{ tags: [] }, /tags 가 비어 있습니다/],
    [{ tags: Array.from({ length: 11 }, (_, i) => ({ id: "t" + i, name: "t" + i })) }, /10개를 넘습니다/],
    [{ tags: [{ id: "class", name: "수업" }, { id: "class", name: "겹침" }] }, /중복된 id/],
    [{ epoch: -1 }, /형식이 올바르지 않습니다/],
    [{ epoch: 1.5 }, /형식이 올바르지 않습니다/]
  ];
  for (const [patch, re] of cases) {
    const why = api.validateBackup(good(patch));
    assert.ok(why, `거부됐어야 한다: ${JSON.stringify(patch).slice(0, 60)}`);
    assert.match(why, re);
  }
});

test("같은 키가 살아있는 곳과 툼스톤에 동시에 있으면 거부한다", () => {
  assert.match(api.validateBackup(good({ removed: { "2026-08-01": AT } })), /양쪽에 있습니다/);
  assert.match(api.validateBackup(good({ removedHistory: { "2025-01-10": AT } })), /양쪽에 있습니다/);
  assert.match(api.validateBackup(good({ removedNotes: { "2026-08-01": AT } })), /양쪽에 있습니다/);
  assert.match(api.validateBackup(good({ removedTags: { class: AT } })), /양쪽에 있습니다/);
});

test("출석에 없는 날짜의 켠 시각은 거부한다 (normalize 가 조용히 버리는 자리)", () => {
  assert.match(api.validateBackup(good({ checked: { "2026-08-01": AT, "2026-09-09": AT } })),
               /attendance 에 없습니다/);
});

test("normalize 는 자기 문서에는 관대하다 — 이상한 값을 보정하고 버린다", () => {
  const d = api.normalize({
    startedAt: "엉망",
    attendance: ["2026-08-02", "2026-08-01", "2026-08-01", 42, "nope"],
    removed: { "2026-08-02": AT },                     // 취소가 이긴다
    history: [{ date: "2025-01-10", belt: "99", stripe: 9 },
              { date: "2024-05-05", belt: 1, stripe: 7 }],
    removedHistory: {}, updatedAt: AT, epoch: "x"
  });
  assert.equal(d.startedAt, "");
  assert.deepEqual(plain(d.attendance), ["2026-08-01"], "중복·비날짜 제거 + 취소 반영");
  assert.deepEqual(plain(d.history.map(h => h.date)), ["2024-05-05", "2025-01-10"], "날짜 오름차순");
  const black = d.history.find(h => h.date === "2025-01-10");
  assert.equal(black.belt, api.BLACK, "범위를 넘는 벨트는 clamp");
  assert.equal(black.stripe, 0, "블랙이면 그랄은 0");
  assert.equal(d.history.find(h => h.date === "2024-05-05").stripe, api.MAX_STRIPE);
  assert.equal(d.epoch, 0);
});

test("승급일이 중복되면 뒤엣것이 남는다", () => {
  const d = api.normalize({
    attendance: [], removed: {},
    history: [{ date: "2025-01-10", belt: 0, stripe: 1 },
              { date: "2025-01-10", belt: 1, stripe: 0 }],
    removedHistory: {}, updatedAt: AT, epoch: 0
  });
  assert.equal(d.history.length, 1);
  assert.equal(d.history[0].belt, 1);
});

test("normalizeNotes 는 없는 분류를 첫 분류로 떨어뜨린다", () => {
  const n = api.normalizeNotes({
    notes: { "2026-08-01": { text: "x", tag: "유령", at: AT } },
    tags: [{ id: "class", name: "수업" }], removedNotes: {}, removedTags: {}, updatedAt: AT
  });
  assert.equal(n.notes["2026-08-01"].tag, "class");
});

test("분류가 하나도 안 남으면 초기값 5종으로 되돌린다", () => {
  const n = api.normalizeNotes({ tags: [], notes: {}, removedNotes: {}, removedTags: {} });
  assert.deepEqual(plain(n.tags.map(t => t.id)), plain(api.DEFAULT_TAGS.map(t => t.id)));
});

test("백업은 두 문서를 합친 평평한 객체다", () => {
  api.setState(api.normalize(good()));
  api.setNotes(api.normalizeNotes(good()));
  const doc = plain(api.backupDoc());
  for (const f of ["attendance", "checked", "removed", "history", "notes", "tags"]) {
    assert.ok(f in doc, `${f} 가 백업에 있어야 한다`);
  }
  assert.equal(api.validateBackup(doc), null, "내보낸 백업은 다시 복원할 수 있어야 한다");
});

test("조사(로/으로)는 받침을 보고 고른다", () => {
  assert.equal(api.toParticle("수업"), "으로");
  assert.equal(api.toParticle("기타"), "로");
  assert.equal(api.toParticle("서울"), "로");      // ㄹ 받침
  assert.equal(api.toParticle("NoGi"), "로");      // 한글이 아니면 기본형
});
