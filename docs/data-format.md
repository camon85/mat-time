# 데이터 포맷 명세

Mat Time(주짓수 출석 트래커)이 저장하는 데이터의 형식과 의미를 정의한다.
이 문서만 보고도 **다른 앱·스크립트에서 데이터를 읽고 쓰고 다시 계산**할 수 있도록 작성했다.

- 대상 구현: 코어 [`../app.js`](../app.js) · 메모 [`../notes.js`](../notes.js) ·
  동기화 [`../sync.js`](../sync.js)
- 이 문서의 규칙을 시험하는 테스트: [`../test/`](../test/) (`node --test "test/*.test.mjs"`)

---

## 1. 저장 위치

데이터는 **문서 두 개**로 나뉜다 — 코어(출석·승급·설정)와 메모.

| 위치 | 키 / 파일명 | 내용 |
|---|---|---|
| 브라우저 localStorage | `bjj-attendance` | **코어 문서** (§3) |
| 브라우저 localStorage | `bjj-notes` | **메모 문서** (§3.2) |
| 브라우저 localStorage | `bjj-attendance-sync` | 동기화 설정. **기록과 분리** |
| 백업 파일 | `bjj-attendance-<YYYY-MM-DD>.json` | **두 문서를 합친 하나** (§3.3) |
| GitHub Gist (비공개) | `bjj-attendance.json` | 코어 문서 |
| GitHub Gist (비공개) | `bjj-notes.json` | 메모 문서. 같은 gist 안의 두 번째 파일 |

직렬화는 `JSON.stringify(doc, null, 2)` (들여쓰기 2칸).
Gist 설명은 `주짓수 출석 트래커 기록`.

### 1.0 왜 나눴나

메모는 코어의 20~45배 크기가 된다 (§11). 한 문서에 두면

- 출석을 한 번 탭할 때마다 메모 전체를 직렬화해 localStorage 에 쓰고 Gist 에 PATCH 한다
- `setItem` 은 호출 하나라, 메모가 커져 저장에 실패하면 출석까지 못 쓴다
- 코어가 Gist 의 1MB inline 임계를 넘어 매번 `raw_url` 로 우회하게 될 수 있다

나눠 두면 출석 경로는 계속 작다. 실제로 출석만 바꾸면 `bjj-attendance.json` 만 PATCH 된다.

**메모 문서가 없어도 정상이다.** 앱은 `bjj-notes` 키가 없으면 빈 메모 문서로 시작하고,
Gist 에 `bjj-notes.json` 이 없으면 다음 PATCH 때 만든다. 마이그레이션 절차가 필요 없다.
gist 탐색 기준은 `bjj-attendance.json` 이므로 메모 도입 이전에 만들어진 gist 도 그대로 찾는다.

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
- **타임스탬프**: 날짜가 아닌 시각 필드는 전부 UTC ISO 8601 (`new Date().toISOString()`).
  `updatedAt` · 툼스톤 값 · 항목별 `at` · `checked` 값이 여기 해당한다.
- **항목별 시각(`at` · `checked`)은 없을 수 있고, 없으면 "가장 오래됨"으로 읽는다.**
  그래서 **빈 문자열로 저장하지 않는다** — 값이 없으면 키 자체를 넣지 않는다.
  옛 문서를 읽을 때 문서의 `updatedAt` 으로 한 번 채워 넣지만, 그것마저 비어 있으면 비워 둔다.

---

## 3. 코어 문서 스키마

```json
{
  "startedAt": "2020-03-01",
  "trackPromotion": true,
  "trackPromotionAt": "2026-08-11T01:22:03.410Z",
  "attendance": ["2026-08-01", "2026-08-04"],
  "checked": {
    "2026-08-01": "2026-08-01T11:30:02.144Z",
    "2026-08-04": "2026-08-04T12:02:55.019Z"
  },
  "removed": { "2026-07-15": "2026-08-05T02:10:11.000Z" },
  "removedHistory": { "2025-03-01": "2026-08-06T01:20:00.000Z" },
  "epoch": 0,
  "history": [
    { "date": "2025-09-10", "belt": 0, "stripe": 1, "at": "2025-09-10T13:00:41.002Z" },
    { "date": "2026-06-01", "belt": 0, "stripe": 2, "at": "2026-06-01T13:10:09.771Z" }
  ],
  "updatedAt": "2026-08-05T02:00:28.131Z"
}
```

| 필드 | 타입 | 필수 | 의미 |
|---|---|---|---|
| `startedAt` | 날짜 \| `""` | ✔ | **주짓수를 처음 시작한 날**. `""` = 미설정. 표시 전용 |
| `trackPromotion` | boolean | ✔ | 승급 진행도·로드맵·승급식 표시를 켤지. **기본 `false`** (아래) |
| `trackPromotionAt` | ISO \| `""` | ✔ | 그 값을 마지막으로 바꾼 시각. 병합에서 늦은 쪽이 이긴다 |
| `attendance` | 날짜[] | ✔ | 출석한 날. 중복 없음, 오름차순 |
| `checked` | {날짜: ISO} | ✔ | **출석을 켠 날짜 → 켠 시각.** `attendance` 의 부분집합. 병합에서 취소 시각과 겨룬다 (§7) |
| `removed` | {날짜: ISO} | ✔ | **출석을 취소한 날짜 → 취소 시각.** 병합 시 삭제를 전파하는 데 쓴다 (§7) |
| `history` | 항목[] | ✔ | 승급 이력. `date` 중복 없음, `date` 오름차순. **현재 벨트의 원천** |
| `removedHistory` | {날짜: ISO} | ✔ | **삭제한 승급일 → 삭제 시각.** `removed` 와 같은 역할을 이력에 대해 한다 |
| `updatedAt` | ISO 문자열 \| `""` | ✔ | 마지막 사용자 변경 시각(UTC). 표시(`N분 전`)와 항목별 시각의 기본값에 쓴다 |
| `epoch` | 0 이상 정수 | ✔ | **복원·초기화 세대.** 다르면 병합하지 않고 높은 쪽을 통째로 쓴다 (§7.3) |

`history` 항목:

| 필드 | 타입 | 의미 |
|---|---|---|
| `date` | 날짜 | 승급일 |
| `belt` | `0..4` | 그날 **받은** 벨트 |
| `stripe` | `0..4` | 그날 **받은** 그랄 수. `belt === 4`이면 `0` |
| `at` | ISO \| 없음 | **이 항목을 기록한 시각.** 병합에서 `removedHistory` 와 겨룬다 (§7.1) |

#### `checked` · `at` 은 왜 따로 있나 — 문서 시각으로는 부족하다

`attendance` 에 날짜가 있다는 것만으로는 **언제 켰는지**를 알 수 없다. 예전에는 문서의
`updatedAt` 을 그 대용으로 썼는데, 그러면 그 기기가 **무엇이든** 고칠 때마다 살아 있는 모든
날짜의 주장 시각이 함께 밀려 상대의 취소 툼스톤을 통째로 이겼다.

```
폰:  8/1 출석 취소 (8/2 09:00) → Gist 에 올림
PC:  아직 동기화 안 함. 8/5 에 열어서 8/5 만 새로 체크 → updatedAt = 8/5
PC:  동기화 → 8/1 의 주장 시각도 8/5 가 되어 취소를 이김 → 8/1 이 되살아남 ✗
```

「폰에서 지우고 나중에 PC 를 연다」는 멀티기기의 기본 흐름이라 실제로 자주 걸렸다.
지금은 날짜마다 자기 시각을 갖는다. 승급 이력(`at`)과 분류(`at`)도 같은 이유로 같은 모양이다.

크기 대가는 코어 문서 기준 **약 3배**다 (§11). 그래도 메모 문서의 1/10 수준이라,
문서를 나눠 둔 덕분에 출석 경로는 여전히 작다.

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

### `trackPromotion` — 이력과 추적은 다른 사실이다

`history` 는 "지금 내 벨트가 무엇인가"이고 어느 체육관에서나 참이다.
`trackPromotion` 은 "다음 승급까지 얼마나 남았나를 보고 싶은가"이며, 그 계산은
**한 체육관의 규정**(§5 의 표, 그리고 매월 마지막 금요일 승급식)에 기댄다.

- **기본값은 `false`.** 값이 없으면 꺼짐이다
- **`history` 가 비어 있는지로 추론하지 않는다.** 벨트를 맞추려고 이력을 넣은 사람이
  남의 체육관 기준 D-day 까지 원한 것은 아니다. 두 필드는 독립이다
- 끄더라도 **어떤 데이터도 지워지지 않는다.** 파생 계산(§6)을 화면에 안 그릴 뿐이라,
  다시 켜면 그동안의 기록으로 즉시 계산된다

읽는 쪽에서 `trackPromotion` 을 무시하고 §6 을 계산해도 값 자체는 정확하다 —
그 값이 **그 사용자의 체육관에서 의미가 있는지**를 나타내는 필드일 뿐이다.

### 3.2 메모 문서 스키마

```json
{
  "notes": {
    "2026-08-07": {
      "text": "히샤우 세미나 — 데라히바 가드 패스 3종",
      "tag": "seminar",
      "at": "2026-08-07T11:02:31.884Z"
    }
  },
  "removedNotes": { "2026-07-15": "2026-08-05T02:10:11.000Z" },
  "tags": [
    { "id": "class",   "name": "수업",   "at": "2026-01-02T00:00:00.000Z" },
    { "id": "seminar", "name": "세미나", "at": "2026-01-02T00:00:00.000Z" },
    { "id": "comp",    "name": "대회",   "at": "2026-01-02T00:00:00.000Z" },
    { "id": "video",   "name": "영상",   "at": "2026-01-02T00:00:00.000Z" },
    { "id": "etc",     "name": "기타",   "at": "2026-01-02T00:00:00.000Z" },
    { "id": "노기",     "name": "노기",   "at": "2026-07-30T04:11:02.900Z" }
  ],
  "removedTags": { "드릴": "2026-08-06T09:00:00.000Z" },
  "updatedAt": "2026-08-07T11:02:31.884Z",
  "epoch": 0
}
```

| 필드 | 타입 | 필수 | 의미 |
|---|---|---|---|
| `notes` | {날짜: 항목} | ✔ | **하루에 하나.** 날짜가 곧 키다 |
| `removedNotes` | {날짜: ISO} | ✔ | 삭제한 메모 → 삭제 시각. `removed` 와 같은 역할 (§7) |
| `tags` | 분류[] | ✔ | **1~10개.** 배열 순서가 곧 화면 표시 순서 |
| `removedTags` | {분류 id: ISO} | ✔ | 삭제한 분류 → 삭제 시각 (§7.5) |
| `updatedAt` | ISO \| `""` | ✔ | 마지막 변경 시각. 코어의 것과 **독립** |
| `epoch` | 0 이상 정수 | ✔ | 복원·초기화 세대. 코어와 독립이되 항상 함께 올라간다 (§7.3) |

`notes` 항목:

| 필드 | 타입 | 의미 |
|---|---|---|
| `text` | 문자열 | 본문. trim 후 1자 이상 **500자 이하**. 줄바꿈 허용 |
| `tag` | 분류 id | **반드시 `tags` 안에 있는 id** |
| `at` | ISO 문자열 | **이 메모를 마지막으로 저장한 시각.** 병합 시 본문 승자 판정 (§7.4) |

`tags` 항목:

| 필드 | 타입 | 의미 |
|---|---|---|
| `id` | 문자열 | 1~10자. 메모가 참조하는 값 |
| `name` | 문자열 | 1~10자. 화면에 보이는 이름 |
| `at` | ISO \| 없음 | **이 분류를 만든 시각.** 병합에서 `removedTags` 와 겨룬다 (§7.5) |

#### 분류는 상수가 아니라 데이터다

사용자가 분류를 더하고 지울 수 있으므로 목록을 문서에 저장한다.
`tags` 가 없거나 비면 아래 **초기값**으로 채워진다.

| id | 이름 |
|---|---|
| `class` | 수업 |
| `seminar` | 세미나 |
| `comp` | 대회 |
| `video` | 영상 |
| `etc` | 기타 |

기본 분류는 id 가 영문이고, **사용자가 만든 분류는 이름 자체가 id 다.**
이름 변경 기능이 없으므로 둘을 나눌 이유가 없고, 지웠다 같은 이름으로 다시 만들면
옛 메모와 다시 이어진다. 이름을 바꾸는 기능을 나중에 넣는다면 그때는 id 를 따로 발급해야 한다.

제약:

- **1개 이상 10개 이하.** 0개가 되면 메모를 쓸 수 없고, 10개를 넘으면 칩이 화면을 삼킨다
- id·이름 모두 **10자 이하**
- 같은 id 가 둘일 수 없다

#### 왜 항목마다 `at` 을 두나

출석·승급은 켜짐/꺼짐이라, 문서의 `updatedAt` 을 "켠 시각" 대용으로 써도 충분했다 (§7.1).
그러나 **메모는 내용이 바뀐다.** 문서 단위 시각만으로는 두 기기 중 어느 쪽의 어느 메모가
더 최신인지 가릴 수 없다. 예를 들어 A 가 3/1 에 메모 X 를, 3/5 에 메모 Y 를 고치면
A 의 `updatedAt` 은 둘 다 3/5 가 되어, B 가 3/2 에 고친 X 가 부당하게 밀린다.

### 3.3 백업 파일 형식

백업은 **두 문서를 이어 붙인 평평한 객체 하나**다. 코어의 모든 필드에 `notes` ·
`removedNotes` · `tags` · `removedTags` 가 더해진 모양이며, 메모 문서의 `updatedAt` · `epoch` 은
내보내지 않는다 (복원할 때 두 문서 모두 새 세대를 부여받으므로 의미가 없다).

```json
{
  "startedAt": "2020-03-01",
  "attendance": ["..."], "removed": {},
  "history": [], "removedHistory": {},
  "notes": {}, "removedNotes": {},
  "tags": [{ "id": "class", "name": "수업" }], "removedTags": {},
  "updatedAt": "...", "epoch": 3
}
```

`notes` · `tags` 키가 없는 옛 백업도 그대로 복원된다 — 메모 0개, 분류는 초기값으로 읽힌다.

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
아래 값과 §5.1 의 승급식 규칙은 **한 체육관의 것**이므로, 이 절과 §6 의 파생 계산은
`trackPromotion` 이 켜진 사용자에게만 화면에 나타난다 (§3 참조).

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

**두 문서는 따로 병합된다.** 코어는 코어끼리, 메모는 메모끼리 자기 `epoch` 을 보고 판정한다.
동기화 한 번에 두 문서를 모두 읽고, **내용이 달라진 파일만** PATCH 한다 —
출석만 바꾸면 `bjj-attendance.json` 하나만 올라간다.

| 필드 | 규칙 |
|---|---|
| `epoch` | **다르면 병합 자체를 하지 않는다.** 높은 쪽 문서를 통째로 채택 (§7.3) |
| `attendance` / `checked` / `removed` | 날짜마다 **켠 시각 vs 끈 시각**을 비교해 늦은 쪽 (아래) |
| `history` / `removedHistory` | 위와 **같은 규칙**. "켠 시각"은 항목의 `at` |
| `notes` / `removedNotes` | 날짜의 생사는 위와 같은 규칙, **본문도 항목의 `at`** 으로 판정 (§7.4) |
| `tags` / `removedTags` | 같은 규칙. 순서는 a 우선, 이름 충돌은 `at` 늦은 쪽 (§7.5) |
| `startedAt` | **더 이른 날짜** (빈 값은 무시). 시작일은 가장 이른 기록이 진실 |
| `trackPromotion` | `trackPromotionAt` 이 늦은 쪽. 켬/끔은 합쳐질 수 없으므로 나중에 바꾼 쪽 |
| `updatedAt` | 둘 중 더 최신값 (문서별로 따로) |

`trackPromotion` 에 **자기 시각(`trackPromotionAt`)이 따로 있는 이유**는 `checked` 와 같다 —
문서의 `updatedAt` 으로 가리면, 설정을 건드린 적 없는 기기에서 출석 한 번 체크한 것이
방금 바꾼 설정을 되돌린다. `startedAt` 은 「더 이른 쪽」이라는 순서 무관 규칙이 있어
시각이 필요 없지만, 불리언에는 그런 규칙이 없다.

현재 벨트·단계 시작일은 이력에서 파생되므로 따로 병합할 필요가 없다.

### 7.1 켠 시각 vs 끈 시각 — 하나의 규칙, 네 곳에 적용

단순 합집합으로 하면 **취소가 아예 동작하지 않는다.** 방금 지운 날짜가 원격 문서에
아직 남아 있어 다음 동기화에서 그대로 되살아나기 때문이다. 기기가 한 대여도 그렇다.

그래서 지운 것을 툼스톤에 **시각과 함께** 남긴다. 병합할 때는 키마다 양쪽 문서가 주장하는
(상태, 시각)을 만들어 늦은 쪽을 채택한다. 출석·승급 이력·메모·분류가 전부 같은 함수
(`pickByStamp`)를 탄다. 다른 것은 "켠 시각"을 어디서 읽느냐뿐이다.

| 대상 | 살아 있음 | 켠 시각 | 지움 |
|---|---|---|---|
| 출석 | `attendance` 에 있음 | `checked[d]` | `removed[d]` |
| 승급 이력 | `history` 에 있음 | 그 항목의 `at` | `removedHistory[d]` |
| 메모 | `notes[d]` 있음 | `notes[d].at` | `removedNotes[d]` |
| 분류 | `tags` 에 있음 | 그 항목의 `at` | `removedTags[id]` |

```js
/**
 * 키마다 (살아있음/지워짐, 시각)을 만들어 늦은 쪽을 채택한다.
 * livesIn·stampOf·tombOf 만 갈아 끼우면 출석·이력·메모·분류에 그대로 쓰인다.
 */
function pickByStamp(a, b, keysOf, tombOf, stampOf) {
  const sa = new Set(keysOf(a)), sb = new Set(keysOf(b));   // 반드시 Set (§11 의 경고)
  const ta = tombOf(a), tb = tombOf(b);
  const kept = [], tombs = {}, stamps = {};
  for (const k of new Set([...sa, ...sb, ...Object.keys(ta), ...Object.keys(tb)])) {
    const sideOf = (s, set, t) =>
      t[k]         ? { on: false, at: t[k] }
      : set.has(k) ? { on: true,  at: stampOf(s, k) }
      : null;                                     // 이 문서는 k 에 대해 주장하지 않음
    const x = sideOf(a, sa, ta), y = sideOf(b, sb, tb);
    const win = !x ? y : !y ? x : (y.at > x.at ? y : x);
    if (!win) continue;
    if (win.on) { kept.push(k); if (win.at) stamps[k] = win.at; }
    else tombs[k] = win.at;
  }
  return { kept, tombs, stamps };
}

function merge(a, b) {
  if (a.epoch !== b.epoch) return { ...(a.epoch > b.epoch ? a : b) };   // §7.3

  const att = pickByStamp(a, b, s => s.attendance, s => s.removed,
                          (s, d) => s.checked[d] || s.updatedAt || "");
  const his = pickByStamp(a, b, s => s.history.map(h => h.date), s => s.removedHistory,
                          (s, d) => atOfHistory(s, d) || s.updatedAt || "");

  // 같은 승급일에 내용이 다르면 at 이 늦은 쪽. 인자 순서에 좌우되면 안 된다
  const byDate = new Map();
  for (const h of [...a.history, ...b.history]) {
    const cur = byDate.get(h.date);
    if (!cur || (h.at || "") > (cur.at || "")) byDate.set(h.date, h);
  }

  return {
    startedAt: [a.startedAt, b.startedAt].filter(Boolean).sort()[0] || "",
    attendance: att.kept.sort(),
    checked: att.stamps,                          // 이긴 쪽 시각을 그대로 물려받는다
    removed: att.tombs,
    history: his.kept.map(d => byDate.get(d)).sort((x, y) => x.date.localeCompare(y.date)),
    removedHistory: his.tombs,
    updatedAt: (b.updatedAt || "") > (a.updatedAt || "") ? b.updatedAt : a.updatedAt,
    epoch: a.epoch
  };
}
```

**살아남은 키의 켠 시각은 이긴 쪽 값을 그대로 물려받는다.** 다시 계산하거나 지금 시각으로
덮으면, 다음 병합이 같은 판정을 반복하지 못해 같은 툼스톤을 두 번 이기거나 두 번 진다.

### 7.2 남는 모호함

- **시계가 어긋난 기기.** 판정이 전부 시각 비교라, 한 기기의 시계가 크게 틀리면
  그쪽 주장이 부당하게 이기거나 진다. 서버가 없으므로 보정할 방법이 없다.
- **툼스톤은 지워지지 않는다.** 취소한 뒤 다시 체크하지 않은 날짜는 영구히 남는다.
  「오래된 툼스톤 정리」는 안전하게 할 수 없다 — 그 툼스톤을 아직 못 본 기기가 있으면
  지운 것이 그대로 되살아난다. 실측상 크기 영향이 없어 그냥 둔다.
- **같은 세대에서 각자 오프라인 복원** (§7.3 참조).

### 7.3 세대(`epoch`) — 복원·초기화

초기화·백업 복원은 병합하면 지운 데이터가 되돌아온다. 그래서 원격을 **덮어쓴다.**
그런데 덮어쓰기만으로는 부족하다 — **다른 기기가 옛 데이터를 든 채 동기화하면 전부 되살아난다.**
항목별 툼스톤은 "내가 이걸 지웠다"만 표현할 수 있고, 그 기기에만 있는 항목은
지운 쪽이 존재조차 모르므로 툼스톤을 찍을 수 없기 때문이다.

그래서 세대 번호를 둔다.

- 복원·초기화 시 `epoch = max(현재 epoch, 파일의 epoch, **원격 epoch**) + 1`
- 병합 시 `epoch` 가 다르면 **병합하지 않고 높은 쪽 문서를 통째로 채택**
- 같으면 위의 항목별 규칙을 그대로 적용

**원격을 반드시 함께 봐야 한다.** 로컬과 파일만 보고 세대를 정하면, 다른 기기가 이미
초기화해 원격 세대가 더 높을 때 복원 결과가 낮은 세대로 올라간다. 그러면 그 기기가 나중에
동기화할 때 옛 문서가 이겨 **복원이 통째로 되돌려진다** — 세대 장치를 둔 이유가 바로 그
상황이므로, 덮어쓰기 직전에 원격 세대를 한 번 읽는다. (읽지 못하면 오프라인으로 보고
로컬 기준으로 올린다.)

```js
if (a.epoch !== b.epoch) return { ...(a.epoch > b.epoch ? a : b) };
```

`epoch` 가 없는 옛 문서는 `0` 으로 읽히므로, 그런 백업을 복원해도 세대가 올라가
정상적으로 다른 기기를 덮어쓴다.

**남는 한계** — 두 기기가 각각 오프라인에서 복원해 같은 세대에 도달하면 세대가 같아져
항목별 병합으로 떨어진다. 실사용에서 마주치기 어려운 경우라 그대로 둔다.

두 문서는 각자 `epoch` 을 갖지만 **복원·초기화는 언제나 둘 다 올린다.** 같은 코드 경로에서
올리므로 실질적으로 보조를 맞추고, 병합 시엔 서로를 볼 필요가 없다.

### 7.4 메모 — 날짜의 생사와 본문을 따로 판정

날짜가 살아 있는지는 출석과 완전히 같은 규칙이다. `removedNotes[d]` 가 있으면 `(off, 그 시각)`,
없고 `notes[d]` 가 있으면 `(on, notes[d].at)` — 여기서 문서의 `updatedAt` 이 아니라
**항목의 `at`** 을 쓰는 것이 유일한 차이다 (§3.2 참조).

살아남은 날짜의 **본문**은 별도로 고른다. 승급 이력처럼 "뒤에 넣은 쪽이 이기는 Map" 을
쓰면 안 된다 — 이력은 날짜가 곧 사실이라 양쪽 내용이 같지만, 메모는 본문이 다르다.

```js
function mergeNotes(a, b) {
  if (a.epoch !== b.epoch) return { ...(a.epoch > b.epoch ? a : b) };

  const dates = new Set([...Object.keys(a.notes), ...Object.keys(b.notes),
                         ...Object.keys(a.removedNotes), ...Object.keys(b.removedNotes)]);
  const notes = {}, removedNotes = {};
  for (const d of dates) {
    const sideOf = s => s.removedNotes[d] ? { on: false, at: s.removedNotes[d] }
                      : s.notes[d]        ? { on: true,  at: s.notes[d].at || s.updatedAt || "" }
                      : null;
    const x = sideOf(a), y = sideOf(b);
    const win = !x ? y : !y ? x : (y.at > x.at ? y : x);
    if (!win) continue;
    if (!win.on) { removedNotes[d] = win.at; continue; }
    // 본문은 at 이 늦은 쪽
    const na = a.notes[d], nb = b.notes[d];
    notes[d] = !na ? nb : !nb ? na : ((nb.at || "") > (na.at || "") ? nb : na);
  }
  return { notes, removedNotes,
           updatedAt: (b.updatedAt || "") > (a.updatedAt || "") ? b.updatedAt : a.updatedAt,
           epoch: a.epoch };
}
```

같은 날짜를 두 기기가 각각 고치면 **나중에 저장한 쪽만 남고 다른 쪽은 사라진다.**
줄 단위 병합 같은 건 하지 않는다.

### 7.5 분류 — 합집합이 아니라 툼스톤

분류도 출석과 같은 함정을 갖는다. 합집합만 쓰면 **한쪽에서 지운 분류가 다른 기기에서 되살아난다.**
그래서 `removedTags` 툼스톤을 두고 같은 `pickByStamp` 를 태운다.
"켠 시각"은 항목의 `at` 이다 — 문서의 `updatedAt` 을 쓰면 그 기기가 메모 하나만 고쳐도
지워진 분류가 전부 되살아난다 (§7.1 의 출석과 똑같은 함정을 여기서도 밟았다).

살아남은 분류의 **순서**는 `a` 의 배열 순서를 먼저 두고 `b` 에만 있는 것을 뒤에 붙인다.
쓰던 기기에서 칩 순서가 흔들리지 않게 하기 위해서다.
**이름**이 다르면 `at` 이 늦은 쪽을 쓴다.

양쪽에서 각각 추가해 합집합이 10개를 넘으면 앞에서부터 10개만 남긴다.
결과가 0개면 초기값으로 되돌린다.

마지막으로 **분류가 사라진 메모를 첫 분류로 떨어뜨린다.** 이 정리를 빼먹으면 어느 필터에도
걸리지 않고 「전체」에서만 보이는 유령 메모가 생긴다.

앱에서 분류를 지울 때도 같은 처리를 한다 — 그 분류를 쓰던 메모를 첫 분류로 옮기고,
**옮긴 메모의 `at` 을 갱신한다.** 갱신하지 않으면 다른 기기로 이동이 전파되지 않는다.

## 8. 불변식

앱이 저장한 문서라면 아래는 항상 참이다. 읽는 쪽에서 믿어도 된다.

1. `attendance` 는 중복이 없고 오름차순이다
2. `attendance` 와 `removed` 의 키는 겹치지 않는다
3. **`checked` 의 키는 `attendance` 의 부분집합이다** — 출석 없는 날의 켠 시각은 존재하지 않는다
4. `history` 는 `date` 가 유일하고 오름차순이며, `removedHistory` 의 키와 겹치지 않는다
5. `history[i].belt` 는 `0..4`, `stripe` 는 `0..4`, `belt === 4`면 `stripe === 0`
6. 날짜 필드는 `YYYY-MM-DD` 이거나 (`startedAt` 한정) `""` 이다
7. `epoch` 는 0 이상의 정수이며, 복원·초기화 때만 올라간다
8. `notes` 의 키와 `removedNotes` 의 키는 겹치지 않는다
9. `notes[d].text` 는 trim 된 1~500자, `at` 은 빈 문자열이 아니다
10. **`notes[d].tag` 는 반드시 `tags` 안에 있다** — 없는 분류를 가리키는 메모는 존재하지 않는다
11. `tags` 는 1~10개이고 `id` 가 유일하며, `removedTags` 의 키와 겹치지 않는다
12. **시각 필드는 있으면 비어 있지 않다.** 값이 없으면 키·필드 자체가 없다
    (`checked[d]` · `history[i].at` · `tags[i].at`)
13. **`notes` 의 날짜는 `attendance` 와 아무 관계가 없다** — 출석 없는 날의 메모도, 메모 없는
    출석일도 정상이다

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
| `removed` · `removedHistory` · `checked` 의 잘못된 키·빈 값 | 해당 항목 제거 |
| `checked` 에 `attendance` 없는 날짜 | 항목 제거 |
| `checked[d]` · `history[i].at` 없음 | 문서의 `updatedAt` 으로 채움. 그것도 비면 필드 없이 둔다 |
| `history` 의 `date` 형식 위반 항목 | 항목 제거. 남은 것은 날짜 기준 중복 제거·정렬 |
| `history` 의 승급일 중복 | **뒤엣것이 남는다** |
| `startedAt` 형식 위반 | `""` (미설정) |
| `trackPromotion` 이 `true` 가 아님 (없음·문자열·1 …) | `false` (꺼짐) |
| `attendance`/`history` 가 배열이 아님 | 빈 배열 |

즉 **최소 문서는 `{}` 이며**, 이것만 넣어도 "오늘 시작한 화이트 0그랄"로 해석된다.

메모 문서는 `normalizeNotes` 가 같은 방식으로 보정한다. 코어와 필드 이름이 겹치지 않으므로
**localStorage·Gist·백업 파일 세 경로를 이 함수 하나로 읽는다.**

| 입력 | 처리 |
|---|---|
| 키가 날짜 형식이 아님 | 항목 제거 |
| 항목이 객체가 아님 | 항목 제거 |
| `text` 가 문자열 아님·trim 후 빈 문자열 | **항목 제거** (빈 메모는 메모가 아니다) |
| `text` 가 500자 초과 | 500자로 자름 |
| `tag` 가 `tags` 에 없음 | **첫 분류**로 보정 |
| `at` 이 없거나 빈 문자열 | 문서의 `updatedAt` 으로 대체 (병합에 쓸 값이 반드시 있어야 함) |
| `notes` 와 `removedNotes` 에 같은 날짜 | **삭제가 이긴다** |
| `notes` 가 객체가 아님 | 빈 객체 |
| `tags` 항목의 `id`·`name` 형식 위반 | 항목 제거 |
| `tags[i].at` 없음 | 문서의 `updatedAt` 으로 채움. 그것도 비면 필드 없이 둔다 |
| `tags` 에 중복 id | 뒤엣것 제거 (`history` 와 반대 방향이다) |
| `tags` 와 `removedTags` 에 같은 id | **삭제가 이긴다** |
| `tags` 가 10개 초과 | 앞에서 10개만 |
| `tags` 가 배열이 아니거나 결과가 0개 | **초기값 5종** |

**분류를 메모보다 먼저 정리한다** — 메모의 `tag` 를 그 목록에 맞춰 보정해야 하기 때문이다.

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
| `trackPromotion` 타입 (boolean) | `항목 형식이 올바르지 않습니다 — trackPromotion` |
| `attendance` 전 항목 날짜 형식 | `attendance 에 날짜가 아닌 값이 있습니다 — "nope"` |
| `attendance` 중복 | `attendance 에 중복된 날짜가 있습니다` |
| `history` 항목 구조·`date` | `history 의 date "..." 가 날짜 형식이 아닙니다` |
| `history` 의 `belt`·`stripe` 범위 | `belt 값이 0~4 범위의 정수가 아닙니다` |
| 블랙벨트 + 그랄 | `블랙벨트에는 그랄이 없습니다` |
| `history` 승급일 중복 | `history 에 중복된 승급일이 있습니다` |
| `history[i].at` · `tags[i].at` 이 빈 문자열 | `history[...].at 이 비어 있습니다` |
| `checked`·`removed`·`removedHistory` 키·값 | `removed["..."] 의 값이 비어 있습니다` |
| `checked` ⊄ `attendance` | `checked["..."] 에 해당하는 출석이 attendance 에 없습니다` |
| `tags` 개수 | `tags 가 10개를 넘습니다 (12개)` / `tags 가 비어 있습니다` |
| `tags` 항목 구조·`id` | `tags 의 id "..." 가 1~10자 문자열이 아닙니다` |
| `tags[i].name` 비어 있음·길이 | `tags["..."].name 이 10자를 넘습니다 (11자)` |
| `tags` id 중복 | `tags 에 중복된 id "..." 가 있습니다` |
| `notes` 키 날짜 형식 | `notes 의 키 "..." 가 날짜 형식이 아닙니다` |
| `notes` 항목 구조 | `notes["..."] 가 객체가 아닙니다` |
| `notes[d].text` 비어 있음 | `notes["..."].text 가 비어 있습니다` |
| `notes[d].text` 길이 | `notes["..."].text 가 500자를 넘습니다 (501자)` |
| `notes[d].tag` 가 `tags` 에 있는지 | `notes["..."].tag "sparring" 가 tags 에 없습니다` |
| `notes[d].at` 비어 있음 | `notes["..."].at 이 비어 있습니다` |
| `removedNotes` · `removedTags` 키·값 | `removedNotes["..."] 의 값이 비어 있습니다` |
| `tags` ∩ `removedTags` | `"..." 가 tags 와 removedTags 양쪽에 있습니다` |
| `attendance` ∩ `removed` | `... 이 attendance 와 removed 양쪽에 있습니다` |
| `history` ∩ `removedHistory` | `... 이 history 와 removedHistory 양쪽에 있습니다` |
| `notes` ∩ `removedNotes` | `... 이 notes 와 removedNotes 양쪽에 있습니다` |
| `epoch` 타입 | `항목 형식이 올바르지 않습니다 — epoch` (0 이상 정수여야 함) |

아는 항목은 `startedAt` · `trackPromotion` · `trackPromotionAt` · `attendance` · `checked` ·
`removed` · `history` · `removedHistory` · `notes` · `removedNotes` · `tags` · `removedTags` ·
`updatedAt` · `epoch` 이며, **하나라도 있고 나머지 검사를 모두 통과해야** 받아들인다.

`trackPromotion` 은 **없어도 통과하고 꺼짐으로 읽힌다** (이 필드 이전의 백업).
있으면 boolean 이어야 한다 — `"on"` 같은 값을 조용히 꺼짐으로 읽으면
사용자에게는 설정이 사라진 것처럼 보인다.

항목별 시각(`checked` · `history[i].at` · `tags[i].at`)은 **없어도 통과한다** —
이 필드들이 생기기 전의 백업을 계속 복원할 수 있어야 하기 때문이다. 대신 있으면 형식을 본다.
`notes[d].at` 만은 필수인데, 메모는 앱이 만들 때 항상 시각을 붙이기 때문이다.
통과하면 §8 의 불변식이 이미 성립하므로 `normalize`·`normalizeNotes` 가 버리는 항목은 없다.
그 뒤 요약(출석 N일 · 이력 N건 · 메모 N개)을 보여주고 확인을 받은 다음 덮어쓴다.

`notes` · `tags` 검증은 **관용성이 없다.** `normalizeNotes` 라면 모르는 분류를 첫 분류로
바꾸고 501자를 잘라내겠지만, 복원 경로에서는 그런 조용한 변형이 곧 데이터 손실이므로
파일 전체를 거부한다. `tags` 가 없는 파일은 초기값 5종으로 검사한다 —
그래야 옛 백업의 `class`·`seminar` 같은 id 가 그대로 통과한다.

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

| 시나리오 | 출석 일수 | JSON | `checked` 포함 | render | 캘린더 | 잔디 | 출석 토글 | 병합 |
|---|---|---|---|---|---|---|---|---|
| 주 3회 × 10년 | 1,564 | 29.9 KB | **100.2 KB** | 2.9 ms | 0.4 ms | 0.6 ms | 2.1 ms | 0.4 ms |
| 주 5회 × 10년 | 2,607 | 48.3 KB | **165.4 KB** | 4.9 ms | 2.1 ms | 0.7 ms | 5.0 ms | 0.7 ms |
| 매일 × 10년 | 3,650 | 66.6 KB | **230.6 KB** | 3.4 ms | 0.7 ms | 0.9 ms | 3.6 ms | 0.9 ms |
| 매일 × 30년 | 10,950 | 194.9 KB | **686.8 KB** | 8.2 ms | 1.8 ms | 1.7 ms | 9.1 ms | 2.5 ms |

**날짜별 켠 시각(`checked`)이 코어 문서를 3.3~3.5배로 키운다.** ISO 문자열이 날짜 문자열보다
길기 때문이다(`"2026-08-01": "2026-08-01T12:00:00.000Z"` = 45자 vs `"2026-08-01",` = 14자).
그 값으로 사는 것이 「지운 출석이 되살아나지 않는 것」이고, 이 앱에서 가장 나쁜 버그가
그것이었으므로 치를 만한 값이다 (§7.1).

크기가 문제가 되는 지점은 **Gist 의 1 MB inline 임계** 하나인데, 최악(매일 × 30년)에도
687 KB 라 닿지 않는다. 닿더라도 `readGistFile()` 이 `raw_url` 로 우회하므로 동작은 같다.

시간 특성은 그대로다 — 병합·직렬화는 항목 수에 선형이고, 항목당 문자열이 길어졌을 뿐이다.

`removed` · `removedHistory` 는 취소하고 다시 체크하지 않은 날짜만 담으므로 보통 비어 있다.
크기에 실질적인 영향이 없어 위 표에는 반영하지 않았다.

### 11.1 메모 문서 — 왜 따로 두는지가 여기 있다

메모 실측. 본문은 한글 60자(1~3줄) 기준, `500자` 행만 상한을 매번 채운 최악을 가정.
한글은 UTF-8 3바이트 · UTF-16 2바이트라 저장 위치마다 크기가 다르다.

| 시나리오 | 메모 수 | 코어 문서 | 메모 문서 (Gist·UTF-8) | 메모 문서 (localStorage·UTF-16) |
|---|---|---|---|---|
| 주 3회 × 1년 | 156 | 3 KB | 32 KB | 45 KB |
| 주 3회 × 10년 | 1,560 | 28 KB | 315 KB | 447 KB |
| 매일 × 10년 | 3,653 | 64 KB | 738 KB | 1,048 KB |
| 주 3회 × 10년 · 매번 500자 | 1,560 | 28 KB | 2,446 KB | 1,846 KB |

**메모가 코어의 10~30배다.** 한 문서에 뒀다면 출석 한 번 탭할 때마다 이만큼을 다시 쓰고
업로드했을 것이다. 나눠 두었으므로 출석 경로는 어느 시나리오에서든 28~64 KB 에 머문다.

시간 (중앙값 9회, 첫 호출은 JIT 워밍업이라 버림):

| 시나리오 | `render()` | 메모 목록 | `mergeNotes()` | 검색 1타 | 직렬화 |
|---|---|---|---|---|---|
| 주 3회 × 1년 | 1.0 ms | 0.0 ms | 0.2 ms | 0.0 ms | 0.0 ms |
| 주 3회 × 10년 | 2.9 ms | 0.2 ms | 1.5 ms | 0.4 ms | 0.4 ms |
| 매일 × 10년 | 4.4 ms | 0.4 ms | 3.0 ms | 0.9 ms | 1.0 ms |
| 주 3회 × 10년 · 매번 500자 | 2.3 ms | 0.2 ms | 1.2 ms | **12.9 ms** | 1.6 ms |

달력 카드의 `renderMonthNotes()` 가 메모 수와 거의 무관한 건 3개씩만 그리기 때문이다.
「전체 메모」 화면의 `renderAllNotes()` 는 **전부** 그리는데, 그래도 10년치(1,560개)가 7.2 ms 다
(연·월 그룹 머리글 포함). 자세한 수치는
[`implementation.md`](implementation.md) 의 「더 보기를 없앤 이유」 참조.
검색은 **150 ms 디바운스**를 걸어, 위 12.9 ms 가 타이핑 한 글자마다가 아니라 멈춘 뒤 한 번만 든다.

관련 한계선:

- **Gist API 응답 잘림**: 파일 1 MB 초과 시 `truncated: true` 가 되고 본문 대신 `raw_url` 을 받는다.
  코어는 30년치가 687 KB 이므로 도달하려면 **40년 이상** 필요하다.
  메모는 매번 500자를 채우면 10년에 2.4 MB 로 넘길 수 있는데, `readGistFile()` 이 두 파일 모두
  잘림을 처리하므로 동작에는 문제가 없다 — 읽을 때 요청이 한 번 더 갈 뿐이다.
  **코어가 이 경로를 타지 않게 만든 것이 분리의 효과 중 하나다**
- **localStorage 할당량**: 브라우저당 보통 5~10 MB. 최악 시나리오(1.8 MB)에서도 여유가 있다.
  단 **할당량은 오리진 단위라 키를 나눠도 총량은 늘지 않는다.** 분리가 버는 것은 용량이 아니라,
  한도에 닿았을 때 실패가 메모 쪽 `setItem` 에만 떨어져 출석 저장이 살아남는다는 점이다
- **검색은 유일하게 선형 비용이 체감될 수 있는 경로다.** 전체 본문을 훑으므로 최악
  시나리오에서 12.9 ms 로 한 프레임(16.7 ms)에 가까워진다. 그래서 **150 ms 디바운스**를 건다 —
  타이핑 중에는 돌지 않고 멈춘 뒤 한 번만 돈다
- 그 밖의 모든 연산이 항목 수에 **선형**으로만 늘어난다

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

# 대회 메모만 최신순으로. 백업 파일이면 notes 가 최상위에 있다
for d, note in sorted(doc.get("notes", {}).items(), reverse=True):
    if note["tag"] == "comp":
        print(d, note["text"])
```

> Gist 나 localStorage 에서 직접 읽는다면 메모는 **다른 파일·다른 키**에 있다
> (`bjj-notes.json` / `bjj-notes`). 그때는 `doc["notes"]` 가 아니라 메모 문서의
> 최상위 `notes` 를 본다. 백업 파일만 둘이 합쳐진 형태다 (§3.3).

### JavaScript — 최소 문서 만들기

```js
const doc = {
  startedAt: "2020-03-01",
  attendance: ["2026-06-02", "2026-06-04"],
  // checked · at 은 생략해도 된다. 앱이 읽을 때 updatedAt 으로 채운다
  removed: {},
  history: [{ date: "2026-06-01", belt: 1, stripe: 2 }],   // ← 현재 = 블루 2그랄
  removedHistory: {},
  updatedAt: new Date().toISOString(),
  epoch: 0
};
localStorage.setItem("bjj-attendance", JSON.stringify(doc, null, 2));

// 메모는 별도 키 (없어도 앱은 정상 동작한다)
const notes = {
  notes: {
    "2026-06-02": { text: "클로즈 가드 브레이크", tag: "class",
                    at: new Date().toISOString() }
  },
  removedNotes: {},
  updatedAt: new Date().toISOString(),
  epoch: 0
};
localStorage.setItem("bjj-notes", JSON.stringify(notes, null, 2));
```

앱의 **복원** 기능에 넣을 때는 둘을 합친 평평한 파일 하나로 만든다 (§3.3).

```js
const backup = { ...doc, notes: notes.notes, removedNotes: notes.removedNotes };
```
