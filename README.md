# 스티커 메모 (Windows ↔ 휴대폰 실시간 동기화)

Windows 스티커 메모처럼 바탕화면에 메모를 띄워두고, 휴대폰에서도 같은 메모를 실시간으로 보고 고칠 수 있는 개인용 앱입니다.

| | Windows 앱 | 휴대폰 (웹앱/PWA) |
|---|---|---|
| 메모 목록 | 목록 창 (검색, 수정 시각 표시) | 2열 카드 / 1열 목록 전환, 정렬 |
| 메모 편집 | 메모마다 별도 창, 바탕화면에 띄워두기 | 전체 화면 편집 |
| 서식 | 굵게·기울임·밑줄·취소선·글머리 기호·사진 | 같음 |
| 색상 | 노랑·초록·분홍·보라·파랑·회색·차콜 | 같음 |
| 기타 | 창 위치 기억 및 재시작 시 복원, 항상 위, Windows 시작 시 실행, 트레이, `Ctrl+Alt+N` 새 메모 | 길게 눌러 여러 개 선택, 상단 고정, 공유, 홈 화면에 설치 |
| 공통 | **실시간 동기화**, 오프라인 작업(연결되면 자동 전송), 어두운 테마, 빈 메모 자동 삭제 | |

**단축키 (Windows)**: `Ctrl+N` 새 메모 · `Ctrl+W` 닫기 · `Ctrl+D` 삭제 · `Ctrl+H` 노트 목록 · `Ctrl+B/I/U` 서식 · `Ctrl+T` 취소선 · `Ctrl+Shift+L` 글머리 기호 · `Ctrl+F` 검색

---

## 내가 해야 할 일 (처음 한 번, 약 15분)

### 1. Firebase 프로젝트 만들기 (동기화 서버, 무료)
1. https://console.firebase.google.com 접속 → **프로젝트 추가** → 이름 입력(예: `my-sticky-note`) → 애널리틱스는 꺼도 됨
2. 왼쪽 메뉴 **빌드 → Authentication → 시작하기 → 로그인 방법 → 이메일/비밀번호 → 사용 설정 → 저장**
3. 왼쪽 메뉴 **빌드 → Firestore Database → 데이터베이스 만들기** → 위치 `asia-northeast3 (서울)` → **프로덕션 모드**로 시작
4. Firestore 화면의 **규칙** 탭 → 이 저장소의 `firestore.rules` 내용을 그대로 붙여넣고 **게시**
5. 프로젝트 개요 옆 톱니바퀴 **프로젝트 설정 → 내 앱 → 웹(`</>`) 아이콘** → 앱 이름 입력 → 등록
   → 화면에 나오는 `firebaseConfig = { ... }` 값을 복사

### 2. 설정값 넣기
- `src/firebase-config.js` 파일을 열어 복사한 값(apiKey, authDomain, projectId …)을 붙여넣기
- `.firebaserc` 의 `YOUR_FIREBASE_PROJECT_ID` 를 내 프로젝트 ID로 바꾸기
- GitHub에 커밋/푸시 (이 값들은 비밀번호가 아니라서 올려도 괜찮습니다. 내 메모는 보안 규칙으로 나만 읽을 수 있습니다.)

### 3. Windows 앱 설치
- 푸시하면 GitHub **Actions** 탭에서 자동으로 설치 파일이 만들어집니다(약 5분).
- Actions → 가장 최근 "Windows 설치 파일 빌드" → 아래 **Artifacts → StickyNote-Windows** 다운로드 → 압축 풀고 `StickyNote-Setup-1.0.0.exe` 실행
- 서명되지 않은 개인용 앱이라 "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**
- 처음 실행 시 **회원가입** (이메일 + 비밀번호 6자 이상)

### 4. 휴대폰 웹앱 올리기 (내 PC에서 한 번)
PC에 [Node.js LTS](https://nodejs.org) 설치 후, 이 저장소 폴더에서:
```bash
npm install
```
```bash
npx firebase-tools login
```
```bash
npm run deploy
```
→ `https://<프로젝트ID>.web.app` 주소가 나옵니다.

휴대폰 크롬에서 그 주소 접속 → 같은 계정으로 로그인 → 메뉴(⋮) → **홈 화면에 추가** (아이폰은 사파리 공유 → 홈 화면에 추가). 이제 앱처럼 실행됩니다.

### 5. 자동 배포 설정 (한 번만) — 이후 코드 수정은 push 만 하면 끝
1. Firebase 콘솔 → 톱니바퀴 **프로젝트 설정 → 서비스 계정** 탭 → **새 비공개 키 생성** → JSON 파일이 다운로드됨
2. GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: 받은 JSON 파일을 메모장으로 열어 **내용 전체**를 붙여넣기 → Add secret
3. 받은 JSON 파일은 지우세요 (비밀번호와 같은 파일입니다. 채팅이나 저장소에 올리지 마세요.)

**이후 업데이트 방식**
- GitHub에 push → "웹앱 자동 배포"가 실행되어 1~2분 뒤 휴대폰·Windows 앱 모두 새 버전
- 앱은 15분마다 새 버전을 확인하고, **입력 중이 아닐 때(창이 가려지거나 포커스가 없을 때)** 조용히 새로고침합니다.
- Windows 앱은 화면을 `https://sticky-note-hk.web.app` 에서 불러옵니다 (`electron/remote.json`). 인터넷이 끊기면 마지막으로 받은 버전, 처음부터 오프라인이면 설치 파일에 들어 있는 버전으로 열립니다.
- Windows 전용 기능(`electron/` 폴더: 창·트레이·자동 실행)을 바꿀 때만 새 설치 파일이 만들어지고, 그때만 다시 설치하면 됩니다.

---

## 개발용 명령어
```bash
npm run dev            # 브라우저에서 웹앱 개발 (휴대폰 화면)
npm run electron:dev   # Windows 앱 개발 모드
npm run dist:win       # Windows 설치 파일 직접 만들기 (Windows PC에서)
```

## 구조
```
src/             화면 (웹앱과 Windows 앱이 같은 코드 사용)
  main.js          로그인, 메모 목록, 휴대폰 편집 화면, 설정
  noteWindow.js    Windows 메모 창
  editor.js        서식 편집기 (사진 붙여넣기·자동 압축, 원격 변경 반영)
  store.js         저장소 (Firebase 실시간 동기화 / 로컬)
  firebase-config.js  ← 내 Firebase 설정값
electron/        Windows 앱 (창 관리, 트레이, 자동 실행)
firestore.rules  보안 규칙 (본인 메모만 접근)
```

## 참고
- 데이터 위치: Firestore `users/{내 uid}/notes/{메모id}`. 무료 한도(하루 읽기 5만·쓰기 2만 건)는 개인 사용에 충분합니다.
- 사진은 자동으로 줄여서 메모 안에 저장됩니다(메모 1개당 약 1MB 한도). 큰 사진을 여러 장 넣으면 저장이 거부될 수 있습니다.
- 두 기기에서 **같은 메모를 동시에** 고치면 마지막에 저장한 쪽이 남습니다.
- 기존 Windows 스티커 메모(Microsoft)의 메모를 자동으로 가져오지는 않습니다. 필요한 메모는 복사해서 붙여넣으세요.
