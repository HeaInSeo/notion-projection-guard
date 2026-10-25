# 중앙 동기화 코드와 서버 운영 자료 관리

## 정본과 보존 범위

`HeaInSeo/notion-projection-guard`에서 코드, 회귀 시험, 설치·복구 절차,
배포 버전 명세와 재사용 가능한 운영 프롬프트를 관리한다. 전용 저장소의 단일 ACTIVE PR을
사용한다. infra-lab의 기존 PR #41은 설치 연결을 정리하며 다른 제품 PR이나 PARKED
작업의 브랜치는 보존한다. [MIGRATION.md](MIGRATION.md)에 이전 근거를 기록한다.

| GitHub에서 관리 | 보호된 운영 저장소에서 관리 |
| --- | --- |
| broker·runner·complete entry와 시험 | 실제 journal·pending ticket·원본 receipt |
| 고정 커밋, 파일 해시, 민감정보를 제거한 장애 설명 | Notion 전체 원문·속성 스냅샷, worker 증거·세션 자료 |
| 설치·복구 절차와 프롬프트 템플릿 | 실제 장치·경로·권한 설정, 전체 자동화 프롬프트와 인증값 |

이 저장소는 공개다. 원본 운영 폴더나 자동화 프롬프트 전체를 복사해 커밋하지 않는다.
`.gitignore`는 실수 방지를 돕는다. 업로드 전에는 실제 변경 파일도 확인한다.
운영 증거는 권한을 제한한 별도 백업에 보존하고, 복구 시 같은 canonical journal과
그에 연결된 snapshot·receipt·audit를 함께 검증한다. 새 빈 state로 복구하지 않는다.

## 현재 설치 버전

버전 명세: [deployment/runtime-01b8a789.json](deployment/runtime-01b8a789.json).
서버 설치 receipt는 2026-10-19 23:02:49 UTC의
`01b8a7897bc8709450f536744577313c805c66ca`를 가리키며,
2026-10-20 00:07:09 UTC에 broker·runner·policy·approved manifest를 읽어 확인했다.
검토된 이 커밋의 broker·runner 해시와 서버 파일이 일치했다.

명세에 기록한 policy 해시는 기존 비공개 운영 정책의 식별값이다. GitHub의
`policy.json`은 `productionEnabled:false`인 기본값이므로 운영 파일을 덮어쓰는 데
사용하지 않는다. 운영 정책의 원문, 권한 범위와 변경 이력은 보호된 저장소에 보존한다.
기존 설치 receipt와 이 역사적 명세의 `repository`·`sourceCommit`·entry 경로는
당시의 infra-lab 원본을 가리킨다. 이를 새 저장소 이름으로 다시 쓰지 않는다.
검증 도구는 현재도 이 명세로 같은 설치 bytes를 대조한다. 새로운 코드 조회 위치는
별도 source-import 명세와 infra-lab의 설치 연결에 기록한다.

## 읽기 전용 버전 대조

신뢰하는 고정 GitHub 커밋에서 검증 도구와 배포 명세를 읽는다. 명세와 실제 파일을
동시에 임의 수정하면 신뢰의 기준이 없어지므로 mutable branch 이름을 승인값으로 삼지 않는다.
대조에는 현재 설치 receipt의 절대 경로를 사용한다.

```sh
node verify_runtime.cjs \
  --release deployment/runtime-01b8a789.json \
  --runtime /absolute/path/to/installed/runtime \
  --receipt /absolute/path/to/private/installation.json \
  --source /absolute/path/to/checked-out/notion-projection-guard
```

`--source`는 선택 항목이다. 사용하면 broker·runner와 hosted complete entry의
소스 해시도 대조한다. 출력의 `sourceFilesChecked`로 수행 여부를 구분한다.
도구는 파일을 읽고 해시를 계산하며, broker를 import/실행하거나 journal·lock을
열거나 변경하지 않는다. 기존 작업이 lock을 보유해도 버전 대조는 가능하다.
일치 시 `MATCH`와 exit 0, 불일치·누락·중복 manifest·오래된 receipt에는
`MISMATCH`와 exit 1을 반환한다. 원문·토큰·receipt 전체는 출력하지 않는다.

`MATCH`는 관측한 파일과 설치 기록의 일치다. 코드 리뷰 승인, 설치 허가, 현재 작업의
정상 상태나 예약 자동화의 실제 채택을 판정하지 않는다. 마지막 재조회로 관측 도중의
파일 변경을 검사하지만 이후 변경이나 과거 receipt의 진위까지 보장하지 않는다.

## 다음 버전의 설치 절차

1. GitHub의 기존 ACTIVE PR에서 변경을 검토하고 해당 고정 커밋의 시험·CI·정상
   검토 게이트를 확인한다. main 반영과 실제 서버 설치는 각각의 기록을 남긴다.
2. 후보 코드와 hosted entry를 같은 고정 커밋에서 준비하고 실제 bytes의 해시를
   확인한다. 설치 명세에는 커밋, broker·runner, 별도 승인된 policy의 해시를 기록한다.
3. 중앙 쓰기를 잠시 멈춘 상태에서 현재 runtime·manifest·policy·journal을 읽는다.
   canonical active batch가 없음을 확인하고 기존 broker lock을 취득한다.
   미확정·HALTED·busy lock은 해당 상태를 보존하고 기존 복구 절차로 처리한다.
4. 기존 runtime·manifest·policy와 journal의 정확한 private 사본을 보존한다.
   코드·manifest는 각각 같은 파일시스템의 임시 파일에 쓰고 fsync·rename·directory
   fsync한다. broker와 runner를 함께 교체하고 manifest를 마지막에 게시한다.
   여러 파일 전체의 교체는 원자적이지 않으므로 중간 장애 시 실행을 멈춘 채 보존
   사본과 설치 기록을 대조한다. 혼합 버전을 사용하거나 임의 재시작하지 않는다.
5. 코드 0555, policy·manifest 0444, state 0700와 증거 파일 0600을 확인한다.
   journal bytes와 policy가 설치 중 보존됐는지 대조하고 설치 receipt를 fsync·readback한다.
   receipt에는 `sourceCommit`, `at`, `before`, `after`, `journalHash`, 정책·worker
   서비스 변경 여부를 기록한다. 이번 도구는 이 receipt 형식과 호환된다.
6. 새 버전 명세로 읽기 전용 대조와 관련 거부 시험을 수행한다. 실제 hosted 자동화의
   고정 runner·complete entry·broker command를 대조하고 보호된 prompt readback을
   남긴다. 기존 스케줄·범위·worker 권한과 정상 검토/병합 게이트를 유지한다.
7. 정상 관측을 수행하고 전체 body·native property 보존 및 실제 guarded receipt를
   확인한 후 중앙 감독을 기존 스케줄로 유지한다. 예약 실행의 채택은 그 회차의
   실제 실행 기록으로 별도 확인한다.

이 문서는 설치 절차를 기록한다. 현재 서버 파일·자동화 설정을 변경하는 설치기는
포함하지 않는다. 이전 단일 사고 복구 helper는 해당 원본 사건에만 적용한다.

## 운영 프롬프트 재사용

- [templates/central-supervisor.md](templates/central-supervisor.md): 중앙 갱신 경로의
  공통 규칙. 실제 사용 시 현재 원본·정책·제품별 게이트를 가진 비공개 설정과 결합한다.
- [templates/queue-watch.md](templates/queue-watch.md): 읽기 전용 관측·보고 규칙.

템플릿의 자리표시자는 실제 읽기로 확정한다. 저장소의 공통 템플릿만으로 기존 전체
운영 프롬프트를 대체하지 않는다. 권한·사용량·BORI 사용자 직접 관리 제한 등 현재
운영 규칙을 함께 보존해야 한다. 실제 자동화 변경은 보호된 전체 설정 readback과 별도 전환 기록으로 관리한다.

## 검증

```sh
node --test test_guard.cjs test_runtime.cjs
```

runtime 시험은 live lock 옆의 읽기 전용 실행, runtime·manifest·receipt를 함께
변조한 경우의 거부, 중복 manifest, 오래된 receipt, hosted entry drift와 CLI 실패를
확인한다. 실제 Notion 원문 대신 합성 입력만 사용한다.
실제 서버 대조와 로컬 시험 결과는
[VERIFICATION_20261020_OPERATIONS.md](VERIFICATION_20261020_OPERATIONS.md)에 기록했다.

## Hosted supervision gate verification (PR6 P2)

A release declaring `hostedSupervisionGate` must supply `--source`. The verifier
checks the repository-specific exact gate path, SHA256, regular source file,
and final source reread alongside the broker, runner and hosted entry. Stale,
changed, missing or symlink gate files cannot return MATCH. Provenance also pins
`supervision_gate.js` independently of the mutable deployment manifest.

Only the four checked-in historical repo/source-commit pairs predating the gate
descriptor may omit it. Their result explicitly reports `legacyManifest:true`
and `hostedSupervisionGateChecked:false`; this is not a hosted-gate match. New
source commits missing the descriptor fail `HOSTED_GATE_REQUIRED`. Declared gate
with no source fails `SOURCE_REQUIRED` before returning any MATCH result.

## Codex 검토 장기 RUNNING: 한정 timeout 계약 (미채택 정책)

`review_timeout_policy.cjs`의 `assess(snapshot)`은 순수 판정만 제공한다. 파일·서버·
GitHub·시계에 접근하지 않으며 요청, 취소, 예약, 원장 저장, owner 잠금이나 병합을
수행하지 않는다. `dispatchAuthorized:false`, `gate:NOT_ASSESSED`는 모든 반환에
유지된다. 이 코드와 템플릿을 수정한 것만으로 실제 운영 채택 또는 중복 방지를
완료했다고 보고하지 않는다. CLI/CI 검토 전환과 gate 동등성 변경은 범위 밖이다.
기존 transport factory 검증(issue #8)도 별도 범위다.

### 판정과 증거

- 최초 요청 전 영속 intent 시각을 기다림의 시작으로 삼는다. UTC ISO 밀리초
  시각(`2026-10-25T00:00:00.000Z`)을 사용하며 재관측·재진입으로 리셋하지 않는다.
  30분 이상이면 WARN, 정확히 60분까지는 대기, 60분 **초과**면 timeout이다.
- `scope`와 `current`에는 정확한 `repo`, `pr`, 40자리 `head`, `base`를 넣는다.
  `attempts`는 원본부터 빠짐없는 1~2개 계보다. `number`, `requestId`,
  `parentRequestId`, `scope`, `owner`, `intentAt`, `intentReceipt`, `delivery`,
  `channel`, `cancelSupported`, `termination`을 기록한다. ACKNOWLEDGED에는
  실제 `requestReceipt`가 필요하다. INTENT/UNKNOWN 전송은 시간이 지나도
  `RECONCILE_DELIVERY_NO_RESEND`이며 새 ID로 재전송하지 않는다.
- GitHub `@codex review`는 `channel:GITHUB_CODEX`, `cancelSupported:false`다.
  취소 API가 확인되지 않았으므로 cancel 성공을 만들지 않는다. timeout한 선행
  실행은 `termination:UNKNOWN`으로 보존하고 동일 head/base의 대체 검토 후보를
  최대 1회만 낸다. UNKNOWN은 종료 관측 불가이며 실제 kill 또는 통과가 아니다.
- 이미 승인된 취소 가능 실행에 대해서만 MANAGED_PROCESS capability를 표현할 수
  있다. 이 모듈은 그 실행기나 전환 경로를 제공하지 않는다. timeout 시 지원되는
  취소를 수행한 뒤 실제 exit의 `terminationReceipt`와 `terminatedAt`을 확인해야
  대체 후보가 된다. cancel 요청 접수만으로 CONFIRMED를 기록하지 않는다.
- 대체는 원본의 `timeoutReceipt`와 parent ID를 요구하고 같은 채널·head/base를
  유지한다. 대체까지 timeout이면 `BLOCKED / REPLACEMENT_TIMEOUT`과 `nextOwner`,
  `next`, `nextTrigger`를 남긴다. 세 번째 요청은 없다. 취소 가능 실행의 실제 종료 확인은 계속
  담당자에게 인계하되, 종료 대기로 blocked 상태를 숨기거나 요청 횟수를 늘리지 않는다.
- `results`는 request ID, scope, result ID, 시각, 원본 receipt, verdict와 finding ID
  목록을 가진다. `findings`는 result ID, finding ID, receipt, OPEN/FIXED/DISMISSED
  처분을 가진다. 처분 완료에는 owner, 현재 scope, 검증 evidence가 필요하다.
  늦게 도착한 선행 결과와 새 head 이전의 결함도 삭제하지 않는다. OPEN finding은
  대체 clean보다 우선해 차단한다. 결과·finding을 누락한 원장을 만들지 않는다.
  이전 head/base clean은 현재 검토에 쓸 수 없다. 결과를 받으면 기존 Codex·독립
  검토·thread 처분·CI·병합 게이트로 돌려보낼 뿐 이 함수는 PASS를 반환하지 않는다.

### 구현된 로컬 계층과 실제 적용 전 통합 조건

`review_timeout_ledger.cjs`는 아래 원장·lease/fencing/CAS·intent/receipt 경계를
Linux 로컬 파일시스템과 주입형 transport로 구현한다. 운영 dispatch 진입점은
`review_timeout_isolated.cjs`의 별도 supervisor/worker 격리를 필수로 사용한다.
동기 무한 정지는 로컬 worker를 종료하고 UNKNOWN을 보존하며 provider 취소가 아니다.
직접 in-process API만 사용하는 운영 경로는 NOT ACCEPTED다. 실제 GitHub adapter나 예약은
포함하지 않는다. API·crash 회귀·안전한 전환과 남은 채택 blocker는
[REVIEW_TIMEOUT_TRANSITION.md](REVIEW_TIMEOUT_TRANSITION.md)에 기록한다.

1. 기존 운영 담당자와 owner를 다시 확인하고 중앙 owner **하나**만 dispatch하도록
   한다. 현재 WIP-20261025-v1 §3의 검토 취소·재요청 권한을 추가하지 않는 기존
   문구는 유지한다. 이번 승인은 이 별도 timeout 계약으로 연결하며 WIP/HOLD,
   사용자 직접 관리 제한, 기존 canonical pending/HALTED 장벽을 바꾸지 않는다.
2. 보호된 영속 검토 원장에 전체 계보·결과·finding·handoff를 보존한다. 정확한
   repo/PR/head/base를 묶되 대체 예산은 **repo/PR/head당 최대 1회**다. base 변경,
   원장 회차, owner 교체, 프로세스 재시작, 새 root ID로 같은 head의 예산을
   초기화하지 않는다. head 변경 시 새 검토와 이전 finding의 처분을 연결한다.
3. owner lease/fencing과 원장 revision CAS 또는 동등한 원자적 단일 writer 잠금 아래
   최신 head/base·전체 원장·기존 GitHub 요청/결과를 읽는다. 후보 판정 후 외부 전송
   **전에** 고유 request ID와 parent, 예산 소진, intent를 내구성 있게 저장하고
   readback한다. REPLACEMENT_CANDIDATE 자체는 예약·전송 권한이 아니다.
4. 외부 요청은 그 예약에 대해 최대 한 번만 전송하고 실제 응답 receipt를 내구성 있게
   기록·readback한다. intent 뒤 crash, 응답 유실, 저장 실패는 UNKNOWN으로 보존한다.
   요청 존재 여부를 원본 ID로 조회해 reconcile하며 미확정 상태에서 재전송하지 않는다.
   확실한 미전송이라도 이 정책은 자동 재시도를 승인하지 않는다. lock/lease 만료,
   예약 후 head 변경, 다른 owner 인계는 해당 intent를 인계·조정하고 새 요청을 금한다.
5. 이전 실행의 polling/결과 수집은 대체 이후에도 유지한다. stale clean은 무효로
   보존하고 유효 결함은 원 task/PR에서 수정 또는 근거 있는 기각으로 처분한다.
   전체 원장의 누락·재생·owner 위조 방지는 이 순수 함수가 입증할 수 없다.
6. 재진입·동시 owner·전송 직전/직후 crash·불확실 응답·늦은 결과·head/base 변경을
   통합 시험한다. 검토된 고정 커밋/해시와 adapter, 보호된 전체 prompt readback,
   실제 예약 실행 receipt를 따로 확인해야 운영 채택을 주장할 수 있다. 새 정책 파일은
   별도 `deployment/review-timeout-candidate.json`에 로컬 후보 SHA256으로 고정했다.
   설치·채택 기록이 아니며 기존 runtime manifest/provenance pin은 변경하지 않았다.
7. 이 단계는 checkout 코드·문서·합성 시험만이다. push, PR 생성/병합, 배포, 서버
   명령, 예약 변경, 실제 검토 요청은 후속 담당자의 별도 게시·채택 조정 범위다.
   protected 원장/전체 운영 prompt/인증값은 공개 저장소에 넣지 않는다.

검토 timeout으로 해당 의존 경로를 BLOCKED 처리해도 독립 작업은 기존 권한·WIP/HOLD
범위에서 진행할 수 있다. canonical pending/HALTED 또는 supervision gate를 우회하는
허가는 아니다. `supervision_gate.js`의 `prewriteDecision`은 Notion preflight 전용으로
유지하며 검토 재요청에 사용하지 않는다.

합성 정책·실행 통합 시험: `node --test review_timeout_policy_cases.cjs review_timeout_ledger_cases.cjs`.
후보 파일 검증: `node verify_review_timeout_candidate.cjs`.

정책은 execution-queues §3의 별도 계약이며 공개 projection broker 허용 대상이 아니다.
기존 전체 private prompt를 읽고 보존하며 갱신할 경로는 아직 확인되지 않았다. 실제
정책/prompt 채택은 기존 소유자 경로가 필요한 미완료 단계다. allowlist 확대나 Notion
직접 쓰기로 우회하지 않는다.
