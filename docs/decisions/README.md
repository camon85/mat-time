# 결정 기록 (Decision Log)

선택지가 둘 이상이었던 설계·운영 결정을 결정 1건당 파일 하나로 남긴다.
"왜 이걸 이렇게 했지?" 라는 질문이 나올 수 있는 것만 적는다 — 자명한 선택은 적지 않는다.

파일명은 `DR-{번호}-{영문-kebab-case}.md`. 미해결 항목이 남았으면 `.wip.md` 를 붙이고,
해소되면 접미사를 뗀다. 새 결정을 추가하면 아래 표에도 행을 추가한다.

| 번호 | 제목 | 결정 | 상태 |
|---|---|---|---|
| [DR-001](DR-001-per-item-sync-stamps.md) | 병합의 "켠 시각" 저장 위치 | 항목마다 저장 (`checked` · `at`). 문서 크기 3배를 감수 | 결정됨 |
| [DR-002](DR-002-offline-cache-strategy.md) | 오프라인 캐시 전략 | stale-while-revalidate | 결정됨 |
| [DR-003](DR-003-test-strategy.md) | 테스트 실행 방식 | 순수 함수는 `node:vm` 하네스, 제스처·히스토리만 Playwright | 결정됨 |
| [DR-004](DR-004-overlay-history-stack.md) | 오버레이 뒤로가기 | 스택 + `history.state` 에 깊이 기록 | 결정됨 |
| [DR-005](DR-005-calendar-long-press.md) | 달력에서 메모 여는 법 | 롱프레스 (+ 데스크톱 우클릭) | 결정됨 |
| [DR-006](DR-006-optional-promotion-tracking.md) | 체육관 기준에 기댄 기능 처리 | 승급 추적을 옵션으로 분리, 기본 꺼짐 | 결정됨 |

## 관련 문서

- [`../implementation.md`](../implementation.md) — 구조와 화면 설계의 "왜"
- [`../data-format.md`](../data-format.md) — 저장 형식·병합 규칙 명세
- [`../lessons-learned.md`](../lessons-learned.md) — 걸려 넘어진 것과 처방
