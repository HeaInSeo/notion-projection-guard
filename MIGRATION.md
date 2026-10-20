# infra-lab에서 전용 저장소로 이전

## 정본과 변경 범위

코드·시험·운영 문서의 정본을 `HeaInSeo/notion-projection-guard`로 옮긴다.
infra-lab에는 이 도구의 고정 조회 버전과 서버 설치 버전을 연결하는 명세를 남긴다.
기존 저장소의 관련 변경 이력 35개를 추출했고, 각 커밋의 작성자·작성 시각·메시지와
해당 폴더 tree가 같은지 확인했다. 경로를 저장소 루트로 옮겨 커밋 ID는 달라졌다.

- 원본: infra-lab `6ea3729948a9210c557b82094caee44ab3889560`의
  `ops/notion-projection-guard`.
- 원본 보존 태그: infra-lab `archive/npg-before-split-20261020`.
- 추출 커밋: `890e9d38e4a0a50a6a44232fe378da2f7f7727fa`.
- 추출 보존 태그: 이 저장소의 `import/infra-lab-20261020`.
- [커밋 대응표](history/infra-lab-commit-map.json)와
  [source-import 명세](deployment/source-import.json)에 양쪽 관계를 기록했다.

추출한 원본 subtree tree와 새 추출 커밋의 전체 tree는
`366a7e650a7b71bb0bc4d0b3e2b0a7d326cff7b2`로 일치한다. 최초 main에는
초기 README만 생성했고, 코드 이전은 단일 이전 PR로 검토한다. 기존 리뷰 상태를
새 저장소의 main 승인으로 바꾸거나 원본 PR의 미완료 검토를 완료로 표시하지 않는다.

## 실행 코드와 설치 증거

최초 이전 커밋 `089aea20`의 실행·시험 파일 15개는 추출 커밋과 byte 단위로 같다.
이후 PR1의 P1 `r4320358702` 보정은 별도 변경으로 기록한다. broker가 유효한
UTC 수정 시각이 없는 읽기를 거부하고, 기존 시험 4파일의 가짜 revision 값을
실제 형식의 시각으로 바꾼다. 이 5파일을 동일 bytes라고 표시하지 않는다.

CI는 고정된 원본 archive tag를 가져와 대응표 35항목의 유일성·누락·양쪽
ancestry·각 subtree tree·작성자·작성 시각·메시지와 source/import head·tag를
직접 검증한다. 최초 이전의 15개 blob은 불변 import 커밋과 대조한다. 현재
작업 트리에서는 명시한 P1 보정 5파일을 제외한 10개 blob을 같은 import와
대조하며, 명세 파일의 hash만 고쳐 검사를 통과할 수 없다. 별도 regression은
누락 revision·잘못된 대응표·코드와 명세의 동시 변경을 검증한다.
새 저장소의 CI 통과는 새 커밋에 대한 리뷰 완료나 제품 검수를 대신하지 않는다.

현재 설치 receipt는 당시 실제 설치한 infra-lab
`01b8a7897bc8709450f536744577313c805c66ca`를 계속 가리킨다. 같은 bytes의
새 조회 위치가 생겨도 이 과거 receipt·승인 hash·journal·snapshot을 고쳐 쓰지 않는다.
[역사적 설치 명세](deployment/runtime-01b8a789.json)의 `repository`와 entry 경로도
그 원본을 보존한다. `verify_runtime.cjs`의 이 provenance 검증은 그대로 유효하다.

운영 코드는 새 저장소의 고정된 전체 커밋에서 루트 경로 `runner.js`와
`complete_projection.js`를 읽는다. broker는 현재 서버의 같은 고정 명령·같은
canonical state를 사용한다. 새 코드 조회 커밋과 원래 설치 커밋을 구분해 기록한다.
runner·complete entry 조회 전환과 broker 설치를 구분한다. 보정된 broker는
현재 과거 설치와 다른 bytes다. 검토·설치 승인·원자적 교체와 새 receipt 없이
배포됐다고 간주하거나 기존 설치 명세를 덮어쓰지 않는다.

## 전환 순서

1. 이전 PR의 전체 파일 readback과 Node 22·24 CI를 확인한다.
2. GitHub connector로 새 고정 커밋의 runner·complete entry를 읽어 실제 조회가
   가능한지 확인한다. 파일 bytes와 기존 서버 runtime·manifest·receipt를 대조한다.
3. 기존 중앙 감독·읽기 전용 감시의 코드 조회 위치만 바꾸고 전체 private prompt를
   readback한다. 기존 스케줄·권한·정책·worker 증거·서비스·canonical state를 유지한다.
4. infra-lab의 기존 ACTIVE PR에서 실행 코드와 중복 CI를 전용 저장소 연결로 정리한다.
   보존 태그·커밋 대응표와 정상 PR 검토/병합 게이트는 유지한다.
5. 실제 예약 실행의 채택 여부는 그 회차의 guarded receipt로 별도 확인한다.

GitHub source 조회가 실패하거나 bytes가 달라지면 전환하지 않고 원래 고정 조회
경로와 서버 설치를 유지한다. 아직 진행 중인 batch를 새 ID/state로 우회하지 않는다.
운영 원문과 전체 prompt·인증값은 공개 이전 자료에 포함하지 않는다.
