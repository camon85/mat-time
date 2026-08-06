# 데이터 포맷 명세

Mat Time(주짓수 출석 트래커)이 저장하는 데이터의 형식과 의미를 정의한다.
이 문서만 보고도 **다른 앱·스크립트에서 데이터를 읽고 쓰고 다시 계산**할 수 있도록 작성했다.

- 대상 구현: [`../app.js`](../app.js)

---

## 1. 저장 위치

| 위치 | 키 / 파일명 | 내용 |
|---|---|---|
| 브라우저 localStorage | `bjj-attendance` | **기록 문서** (아래 §3). 앱의 원본 데이터 |
| 브라우저 localStorage | `bjj-attendance-sync` | 동기화 설정. **기록과 분리** |
| 백업 파일 | `bjj-attendance-<YYYY-MM-DD>.json` | 기록 문서를 그대로 내보낸 것 |
| GitHub Gist (비공개) | `bjj-attendance.json` | 기록 문서. Gist 설명은 `주짓수 출석 트래커 기록` |

localStorage·백업 파일·Gist **세 곳의 내용은 완전히 동일한 형식**이다.
직렬화는 `JSON.stringify(doc, null, 2)` (들여쓰기 2칸).

### 1.1 동기화 설정 (별도 키)

```json
{ "token": "ghp_...", "gistId": "abc123...", "lastSync": "2026-08-04T02:00:55.212Z" }
```

**기록 문서에는 토큰이 절대 포함되지 않는다.** 백업 파일을 공유해도 계정이 노출되지 않는다.
새 기기에서는 이 값이 없으므로, 토큰을 다시 입력해야 Gist를 찾아 이어받는다.

---

## 2. 공통 규약

- **날짜 문자열**: `YYYY-MM-DD` 형식. **로컬 시간대의 달력 날짜**이며 시각·타임존 정보를 갖지 않는다.
  UTC 로 해석하면 시간대에 따라 하루가 어긋나므로, 파싱할 때 `new Date("2026-08-04")` 처럼
  UTC 로 읽히는 방식을 쓰지 말고 연·월·일을 분리해 로컬 날짜로 만들 것.
  ```js
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);        // 로컬 자정
  ```
- **정렬**: 날짜 문자열은 사전순 정렬이 곧 시간순 정렬이다 (`localeCompare` / `<` 비교 가능).
- **타임스탬프**: `updatedAt` 만 예외로 UTC ISO 8601 (`new Date().toISOString()`).

---

## 3. 기록 문서 스키마

```json
{
  "startedAt": "2020-03-01",
  "attendance": ["2026-08-01", "2026-08-04"],
  "removed": { "2026-07-15": "2026-08-05T02:10:11.000Z" },
  "removedHistory": { "2025-03-01": "2026-08-06T01:20:00.000Z" },
  "epoch": 0,
  "history": [
    { "date": "2025-09-10", "belt": 0, "stripe": 1 },
    { "date": "2026-06-01", "belt": 0, "stripe": 2 }
  ],
  "updatedAt": "2026-08-05T02:00:28.131Z"
}
```

| 필드 | 타입 | 필수 | 의미 |
|---|---|---|---|
| `startedAt` | 날짜 \| `""` | ✔ | **주짓수를 처음 시작한 날**. `""` = 미설정. 표시 전용 |
| `attendance` | 날짜[] | ✔ | 출석한 날. 중복 없음, 오름차순 |
| `removed` | {날짜: ISO} | ✔ | **출석을 취소한 날짜 → 취소 시각.** 병합 시 삭제를 전파하는 데 쓴다 (§7) |
| `history` | 항목[] | ✔ | 승급 이력. `date` 중복 없음, `date` 오름차순. **현재 벨트의 원천** |
| `removedHistory` | {날짜: ISO} | ✔ | **삭제한 승급일 → 삭제 시각.** `removed` 와 같은 역할을 이력에 대해 한다 |
| `updatedAt` | ISO 문자열 \| `""` | ✔ | 마지막 사용자 변경 시각(UTC). 병합 시 승자 판정에 사용 (§7) |
| `epoch` | 0 이상 정수 | ✔ | **복원·초기화 세대.** 다르면 병합하지 않고 높은 쪽을 통째로 쓴다 (§7.3) |

`history` 항목:

| 필드 | 타입 | 의미 |
|---|---|---|
| `date` | 날짜 | 승급일 |
| `belt` | `0..4` | 그날 **받은** 벨트 |
| `stripe` | `0..4` | 그날 **받은** 그랄 수. `belt === 4`이면 `0` |

### 현재 벨트는 저장하지 않는다 — 이력에서 파생

"현재 벨트·그랄"과 "현재 단계 시작일"은 별도 필드가 아니다.
**승급 이력의 마지막 항목**이 곧 현재 상태다. 승급일과 단계 시작일이 같은 사실이기 때문.

```js
function currentRank(doc) {
  const last = doc.history[doc.history.length - 1];       // 날짜 오름차순 보장
  if (!last) return { belt: 0, stripe: 0, since: doc.startedAt || todayKey };
  return { belt: last.belt, stripe: last.stripe, since: last.date };
}
```

이력이 비어 있으면 화이트 0그랄로 보고, 기준일은 `startedAt`(없으면 오늘)을 쓴다.
따라서 최신 이력을 지우면 자동으로 직전 상태로 돌아간다.

> `startedAt` 과 현재 단계 시작일은 다르다.
> `startedAt` 은 총 수련 기간 표시에만 쓰이고 **승급 계산에 관여하지 않는다**.

---

## 4. 벨트·그랄 인코딩

| `belt` | 벨트 | `stripe` 범위 |
|---|---|---|
| 0 | 화이트 | 0–4 |
| 1 | 블루 | 0–4 |
| 2 | 퍼플 | 0–4 |
| 3 | 브라운 | 0–4 |
| 4 | 블랙 | 0 고정 (최종 단계) |

### 4.1 단계 인덱스

화이트 0그랄을 `0`, 블랙을 `20`으로 하는 선형 인덱스. 전체 진행도 계산에 쓴다.

```js
const MAX_STRIPE = 4, BLACK = 4, TOTAL_STEPS = 20;   // 4 * (4+1)

function stepIndex(belt, stripe) {
  return belt >= BLACK ? TOTAL_STEPS : belt * (MAX_STRIPE + 1) + stripe;
}
```

화이트 0→4그랄이 4단계, 화이트 4그랄→블루 0그랄이 1단계, …
블랙벨트까지 총 **20단계**다.

---

## 5. 승급 최소 기준

체육관 규정. **수련 기간과 출석 일수를 모두** 충족해야 한다.

| 구간 | 수련 기간 | 출석 일수 |
|---|---|---|
| 화이트 0그랄 → 4그랄 (4단계) | 3개월 | 30일 |
| 화이트 4그랄 → 블루, 이후 블랙까지 (16단계) | 7개월 | 90일 |

```js
function requirement(belt, stripe) {
  if (belt >= BLACK) return null;                          // 블랙 = 최종
  return (belt === 0 && stripe < MAX_STRIPE)
    ? { months: 3, days: 30 }
    : { months: 7, days: 90 };
}

function next(belt, stripe) {
  if (belt >= BLACK) return { belt, stripe: 0 };
  return stripe < MAX_STRIPE ? { belt, stripe: stripe + 1 } : { belt: belt + 1, stripe: 0 };
}
```

### 5.1 승급식 — 매월 마지막 금요일

기준을 채웠다고 그날 바로 승급하는 게 아니다. 승급식은 **매월 마지막 금요일**에 열린다.

```js
function lastFridayOf(y, m) {                    // m 은 0-based
  const last = new Date(y, m + 1, 0);            // 그 달 말일
  const back = (last.getDay() - 5 + 7) % 7;      // 금요일 = 5
  return new Date(y, m, last.getDate() - back);
}

function ceremonyOnOrAfter(d) {
  const c = lastFridayOf(d.getFullYear(), d.getMonth());
  return c >= d ? c : lastFridayOf(d.getFullYear(), d.getMonth() + 1);
}
```

**목표 승급식**은 두 조건이 모두 채워질 수 있는 가장 이른 날 이후의 첫 승급식이다.
출석은 하루 한 번뿐이라 남은 N일을 채우려면 최소 N일이 걸린다 — 이걸 빼먹으면
"이번 달 승급식"이라 해놓고 "주 8회 필요" 같은 불가능한 안내가 나온다.

```js
const earliest = max(기간충족일, 오늘 + 남은출석일수);
const ceremony = ceremonyOnOrAfter(max(earliest, 오늘));
```

---

## 6. 파생 계산

문서에는 **원본 사실만** 저장하고, 아래 값은 모두 읽는 쪽에서 계산한다.

### 6.1 현재 단계 출석 일수

현재 단계 시작일(= 마지막 승급일) 이상 오늘 이하인 출석만 센다. 승급해도 과거 출석은 지우지 않으므로 필터가 필요하다.

승급식 **당일** 출석은 이전 단계의 마지막 수련으로 보고, **다음 날부터** 새 단계로 센다.
그래서 비교가 `>=` 가 아니라 `>` 다.

```js
const since = currentRank(doc).since;
const stageDays = doc.attendance.filter(k => k > since && k <= todayKey).length;
```

### 6.2 개월 수 — 말일 보정에 주의

"3개월"은 30일·90일이 아니라 **달력 기준**이다. 1/31 + 1개월은 2/28(윤년 2/29)로 잘라야 한다.

```js
function addMonths(d, n) {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d.getDate(), last));         // 말일 넘침 방지
  return t;
}

// 기간 조건 충족 여부
const targetDate = addMonths(parseDate(currentRank(doc).since), req.months);
const monthsMet = today >= targetDate;
```

진행률 표시용 소수 개월:

```js
function monthsElapsed(from, to) {
  if (to <= from) return 0;
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (addMonths(from, m) > to) m--;
  const prev = addMonths(from, m), nxt = addMonths(from, m + 1);
  return m + (to - prev) / (nxt - prev);           // 정수 개월 + 잔여 비율
}
```

### 6.3 진행률

두 조건을 **모두** 만족해야 승급이므로, 종합 진행률은 **둘 중 낮은 쪽**이다.

```js
const monthsPct = clamp01(monthsElapsed(from, today) / req.months);
const daysPct   = clamp01(stageDays / req.days);
const stagePct  = Math.min(monthsPct, daysPct);              // 현재 단계 진행률
const totalPct  = (stepIndex(cur.belt, cur.stripe) + stagePct) / TOTAL_STEPS;
```

### 6.4 총 수련 기간

`startedAt` 이 비어 있지 않을 때만. 한 달 미만이면 일 단위로 표시한다.

---

## 7. 병합 규칙 (동기화)

| 필드 | 규칙 |
|---|---|
| `epoch` | **다르면 병합 자체를 하지 않는다.** 높은 쪽 문서를 통째로 채택 (§7.3) |
| `attendance` / `removed` | 날짜마다 **켠 시각 vs 끈 시각**을 비교해 늦은 쪽 (아래) |
| `history` / `removedHistory` | 위와 **같은 규칙**. 합집합으로 하면 이력 삭제가 되살아난다 |
| `startedAt` | **더 이른 날짜** (빈 값은 무시). 시작일은 가장 이른 기록이 진실 |
| `updatedAt` | 둘 중 더 최신값 |

현재 벨트·단계 시작일은 이력에서 파생되므로 따로 병합할 필요가 없다.

### 7.1 출석은 왜 합집합이 아닌가

단순 합집합으로 하면 **취소가 아예 동작하지 않는다.** 방금 지운 날짜가 원격 문서에
아직 남아 있어 다음 동기화에서 그대로 되살아나기 때문이다. 기기가 한 대여도 그렇다.

그래서 취소한 날짜를 `removed` 에 **취소 시각과 함께** 남긴다. 병합할 때는 날짜마다
양쪽 문서가 주장하는 (상태, 시각)을 만들어 늦은 쪽을 채택한다.

- `removed[d]` 가 있으면 → `(off, removed[d])`
- 없고 `attendance` 에 있으면 → `(on, 그 문서의 updatedAt)`
- 둘 다 아니면 → 그 문서는 이 날짜에 대해 주장하지 않음

켠 시각을 따로 저장하지 않고 문서의 `updatedAt` 을 대용으로 쓴다. 변경 직후 곧바로
push 하므로 실용적으로 충분하다. 다시 체크하면 `removed` 키를 지우고 `attendance` 에
넣으므로, 그 문서의 `updatedAt` 이 갱신되어 재체크가 이긴다.

```js
function merge(a, b) {
  const histByDate = new Map();
  [...a.history, ...b.history].forEach(h => histByDate.set(h.date, h));

  const dates = new Set([...a.attendance, ...b.attendance,
                         ...Object.keys(a.removed), ...Object.keys(b.removed)]);
  const attendance = [], removed = {};
  for (const d of dates) {
    const sideOf = s => s.removed[d] ? { on: false, at: s.removed[d] }
                      : s.attendance.includes(d) ? { on: true, at: s.updatedAt || "" }
                      : null;
    const x = sideOf(a), y = sideOf(b);
    const win = !x ? y : !y ? x : (y.at > x.at ? y : x);
    if (!win) continue;
    win.on ? attendance.push(d) : (removed[d] = win.at);
  }

  return {
    startedAt: [a.startedAt, b.startedAt].filter(Boolean).sort()[0] || "",
    attendance: attendance.sort(),
    removed,
    history: [...histByDate.values()].sort((x, y) => x.date.localeCompare(y.date)),
    updatedAt: (b.updatedAt || "") > (a.updatedAt || "") ? b.updatedAt : a.updatedAt
  };
}
```

### 7.2 남는 모호함

`updatedAt` 은 그 문서의 **마지막** 변경 시각이지 해당 날짜를 켠 시각이 아니다.
A가 어떤 날짜를 취소한 뒤 다른 항목을 고쳐 `updatedAt` 만 밀리는 식의 순서에서는
판정이 뒤집힐 수 있다. 정확도를 더 올리려면 날짜마다 켠 시각을 저장하면 되지만
(문서 크기 3~5배), 실사용에서 문제된 적은 없어 현재 방식을 쓴다.

### 7.3 세대(`epoch`) — 복원·초기화

초기화·백업 복원은 병합하면 지운 데이터가 되돌아온다. 그래서 원격을 **덮어쓴다.**
그런데 덮어쓰기만으로는 부족하다 — **다른 기기가 옛 데이터를 든 채 동기화하면 전부 되살아난다.**
항목별 툼스톤은 "내가 이걸 지웠다"만 표현할 수 있고, 그 기기에만 있는 항목은
지운 쪽이 존재조차 모르므로 툼스톤을 찍을 수 없기 때문이다.

그래서 세대 번호를 둔다.

- 복원·초기화 시 `epoch = max(현재 epoch, 파일의 epoch) + 1`
- 병합 시 `epoch` 가 다르면 **병합하지 않고 높은 쪽 문서를 통째로 채택**
- 같으면 위의 항목별 규칙을 그대로 적용

```js
if (a.epoch !== b.epoch) return { ...(a.epoch > b.epoch ? a : b) };
```

`epoch` 가 없는 옛 문서는 `0` 으로 읽히므로, 그런 백업을 복원해도 세대가 올라가
정상적으로 다른 기기를 덮어쓴다.

**남는 한계** — 두 기기가 각각 오프라인에서 복원해 같은 세대에 도달하면 세대가 같아져
항목별 병합으로 떨어진다. 실사용에서 마주치기 어려운 경우라 그대로 둔다.

## 8. 불변식

앱이 저장한 문서라면 아래는 항상 참이다. 읽는 쪽에서 믿어도 된다.

1. `attendance` 는 중복이 없고 오름차순이다
2. `attendance` 와 `removed` 의 키는 겹치지 않는다
3. `history` 는 `date` 가 유일하고 오름차순이며, `removedHistory` 의 키와 겹치지 않는다
4. `history[i].belt` 는 `0..4`, `stripe` 는 `0..4`, `belt === 4`면 `stripe === 0`
5. 날짜 필드는 `YYYY-MM-DD` 이거나 (`startedAt` 한정) `""` 이다
6. `epoch` 는 0 이상의 정수이며, 복원·초기화 때만 올라간다

**보장하지 않는 것** — 사용자가 자유롭게 기록할 수 있으므로 아래는 가정하면 안 된다.

- `history` 의 벨트 순서가 단조증가할 것 (임의 순서로 기록 가능)
- `history` 에 같은 (belt, stripe) 조합이 하나뿐일 것 — 앱은 새로 만들 때 막지만,
  손으로 만든 파일이나 이 규칙 이전의 백업에는 중복이 있을 수 있다 (복원은 허용한다)
- `history` 의 마지막 날짜가 과거일 것 (미래 승급일도 기록 가능 → "승급 예정"으로 표시됨)
- `startedAt` 이 첫 승급일보다 이를 것
- 출석 날짜가 `startedAt` 이후일 것
- `history` 가 비어 있지 않을 것 (비면 화이트 0그랄로 해석)

## 9. 관용적 파싱 (`normalize`)

앱은 **자기가 저장한 문서**를 읽을 때 검증하지 않고 **보정**한다. 손으로 만든 파일도 안전하게 읽힌다.

> 주의 — 이 관용성은 **파일 복원에는 그대로 쓰면 안 된다.** 아무 JSON 이나 통과시켜
> 전부 기본값으로 만들어 버리므로, 남의 JSON 을 넣으면 기록이 지워진다.
> 복원 경로에는 §9.1 의 검증을 먼저 통과시키며, 거기서는 **일부 보정 없이 전부 또는 전무**로 판정한다.

| 입력 | 처리 |
|---|---|
| 모르는 필드 | **버림** (확장 필드를 넣어도 앱은 깨지지 않지만, 저장 시 사라짐) |
| `history[i].belt`/`stripe` 가 범위 밖·숫자 아님 | `0..4` 로 clamp, 숫자가 아니면 `0` |
| `history[i].belt === 4` 인데 `stripe > 0` | `stripe = 0` 으로 강제 |
| `attendance` 의 형식 위반 문자열 | 개별 제거 후 중복 제거·정렬 |
| `attendance` 와 `removed` 에 같은 날짜 | **취소가 이긴다** (`attendance` 에서 제거) |
| `history` 와 `removedHistory` 에 같은 날짜 | **삭제가 이긴다** (`history` 에서 제거) |
| `removed` · `removedHistory` 의 잘못된 키·빈 값 | 해당 항목 제거 |
| `history` 의 `date` 형식 위반 항목 | 항목 제거. 남은 것은 날짜 기준 중복 제거·정렬 |
| `startedAt` 형식 위반 | `""` (미설정) |
| `attendance`/`history` 가 배열이 아님 | 빈 배열 |

즉 **최소 문서는 `{}` 이며**, 이것만 넣어도 "오늘 시작한 화이트 0그랄"로 해석된다.

### 9.1 복원 시 검증 (`validateBackup`) — 전부 또는 전무

파일에서 불러올 때는 보정 전에 형식을 확인하고, **항목 하나라도 어긋나면 파일 전체를 받지 않는다.**
일부만 걸러 받으면 무엇이 사라졌는지 알기 어렵기 때문이다. 거부 시 기존 기록은 그대로 둔다.

| 검사 | 거부 사유 예 |
|---|---|
| JSON 파싱 | `JSON 형식이 아닙니다` |
| 객체 여부 (배열·원시값 거부) | `JSON 객체가 아닙니다` |
| 아는 항목이 하나라도 있는지 | `Mat Time 백업 파일이 아닙니다` |
| 있는 항목의 타입 | `항목 형식이 올바르지 않습니다 — attendance, history` |
| `startedAt` 날짜 형식 | `startedAt "2020/03/01" 이 날짜 형식이 아닙니다` |
| `attendance` 전 항목 날짜 형식 | `attendance 에 날짜가 아닌 값이 있습니다 — "nope"` |
| `attendance` 중복 | `attendance 에 중복된 날짜가 있습니다` |
| `history` 항목 구조·`date` | `history 의 date "..." 가 날짜 형식이 아닙니다` |
| `history` 의 `belt`·`stripe` 범위 | `belt 값이 0~4 범위의 정수가 아닙니다` |
| 블랙벨트 + 그랄 | `블랙벨트에는 그랄이 없습니다` |
| `history` 승급일 중복 | `history 에 중복된 승급일이 있습니다` |
| `removed`·`removedHistory` 키·값 | `removed["..."] 의 값이 비어 있습니다` |
| `attendance` ∩ `removed` | `... 이 attendance 와 removed 양쪽에 있습니다` |
| `history` ∩ `removedHistory` | `... 이 history 와 removedHistory 양쪽에 있습니다` |

| `epoch` 타입 | `항목 형식이 올바르지 않습니다 — epoch` (0 이상 정수여야 함) |

아는 항목은 `startedAt` · `attendance` · `removed` · `history` · `removedHistory` ·
`updatedAt` · `epoch` 이며, **하나라도 있고 나머지 검사를 모두 통과해야** 받아들인다.
통과하면 §8 의 불변식이 이미 성립하므로 `normalize` 가 버리는 항목은 없다.
그 뒤 요약(출석 N일 · 이력 N건)을 보여주고 확인을 받은 다음 덮어쓴다.

---

## 10. 형식 변경

지금은 **버전 필드를 두지 않는다.** 최초 릴리즈 전이라 구분할 과거 버전이 없기 때문이다.

앞으로 형식을 바꿀 때 지킬 것.

- **필드 추가**는 아무 표시도 필요 없다. 모르는 필드는 `normalize()` 가 버리므로 구버전 앱이 깨지지 않는다
- **의미 변경·필드 제거**처럼 호환되지 않는 변경이 생기면 그때 `version` 필드를 도입한다.
  `version` 이 없는 문서는 **최초 형식**으로 간주하면 된다
- 그런 변경이 실제로 필요해지면 localStorage 키도 함께 바꾸고(`bjj-attendance-2` 등)
  기존 키에서 한 번만 옮겨오는 편이 안전하다

## 11. 크기·성능 특성

실측값 (Chromium, 데스크톱). `render()` 는 전체 화면 재구성 1회 기준.

| 시나리오 | 출석 일수 | JSON | 압축 시 | render | 캘린더 | 잔디 | 출석 토글 | 병합 |
|---|---|---|---|---|---|---|---|---|
| 주 3회 × 10년 | 1,566 | 29.2 KB | 20.8 KB | 2.9 ms | 0.4 ms | 0.6 ms | 2.1 ms | 0.4 ms |
| 주 5회 × 10년 | 2,610 | 47.5 KB | 34.1 KB | 4.9 ms | 2.1 ms | 0.7 ms | 5.0 ms | 0.7 ms |
| 매일 × 10년 | 3,653 | 65.9 KB | 47.3 KB | 3.4 ms | 0.7 ms | 0.9 ms | 3.6 ms | 0.9 ms |
| 매일 × 30년 | 10,958 | 194.3 KB | 140.1 KB | 8.2 ms | 1.8 ms | 1.7 ms | 9.1 ms | 2.5 ms |

`removed` · `removedHistory` 는 취소하고 다시 체크하지 않은 날짜만 담으므로 보통 비어 있다.
크기에 실질적인 영향이 없어 위 표에는 반영하지 않았다.

관련 한계선:

- **Gist API 응답 잘림**: 파일 1 MB 초과 시 `truncated: true` 가 되고 본문 대신 `raw_url` 을 받아야 한다.
  30년치가 194 KB 이므로 도달하려면 **150년 이상** 필요하다. 앱은 잘림도 이미 처리한다
- **localStorage 할당량**: 브라우저당 보통 5 MB. 30년치가 0.2 MB
- 모든 연산이 출석 수에 **선형**으로만 늘어난다. 실사용 규모에서 체감 지연은 없다

> **구현 주의** — 병합에서 날짜 존재 확인은 반드시 `Set` 으로 해야 한다.
> 배열 `includes` 를 날짜마다 부르면 O(n²) 이 되어 30년치 병합이 210 ms 까지 늘어난다
> (같은 코드를 `Set` 으로 바꿔 2.5 ms 로 회복한 실측이 있다). 병합은 출석을 체크할 때마다
> 도는 경로라 여기서 막히면 바로 체감된다.

## 12. 다른 도구에서 읽기

### Python — 월별 출석 집계

```python
import json, collections
doc = json.load(open("bjj-attendance-2026-08-04.json"))
by_month = collections.Counter(d[:7] for d in doc["attendance"])
for m, n in sorted(by_month.items()):
    print(m, n)

# 현재 단계 출석 일수 (현재 벨트는 이력의 마지막 항목)
since = doc["history"][-1]["date"] if doc["history"] else doc.get("startedAt", "")
stage = [d for d in doc["attendance"] if d >= since]
print("현재 단계:", len(stage), "일")
```

### JavaScript — 최소 문서 만들기

```js
const doc = {
  startedAt: "2020-03-01",
  attendance: ["2026-06-02", "2026-06-04"],
  removed: {},
  history: [{ date: "2026-06-01", belt: 1, stripe: 2 }],   // ← 현재 = 블루 2그랄
  removedHistory: {},
  updatedAt: new Date().toISOString(),
  epoch: 0
};
localStorage.setItem("bjj-attendance", JSON.stringify(doc, null, 2));
```

앱의 **복원** 기능에 이 JSON 파일을 넣어도 동일하게 반영된다.
