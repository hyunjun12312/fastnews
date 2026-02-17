# 🇰🇷 한국 실시간 트렌드 자동 퍼블리셔

실시간 검색어를 자동 감지 → 뉴스 수집 → AI 기사 생성 → 자동 퍼블리싱하는 **완전 자동화 시스템**

## 🔄 시스템 흐름도

```
[Google Trends KR] ─┐
[Naver 급상승]     ─┤
[Zum 실시간]       ─┼→ [크롤러] → [신규 키워드 감지]
[Nate 실시간]      ─┤      ↓
[Signal.bz]        ─┘  [뉴스 수집] (네이버 API + Google News)
                           ↓
                    [AI 기사 생성] (OpenAI GPT)
                           ↓
                    [자동 퍼블리싱] (SEO 최적화 HTML)
                           ↓
                    [사이트맵 + RSS 자동 갱신]
                           ↓
                    [대시보드 실시간 모니터링]
```

## ⚡ 빠른 시작 (5분)

### 1. 설치

```bash
cd korean-trend-autopublisher
npm install
```

### 2. 환경변수 설정

```bash
# .env.example을 복사
copy .env.example .env
```

`.env` 파일을 열고 API 키를 설정:

```env
# [필수] OpenAI API 키 - AI 기사 생성용
OPENAI_API_KEY=sk-your-key-here

# [선택] 네이버 API - 뉴스 검색 품질 향상
NAVER_CLIENT_ID=your-id
NAVER_CLIENT_SECRET=your-secret
```

> ⚠️ **OpenAI 키 없이도 동작합니다!** 폴백 모드로 뉴스 기반 기사를 자동 구성합니다.

### 3. 실행

```bash
# 전체 시스템 시작
npm start

# 또는 테스트 먼저 실행
npm test
```

### 4. 대시보드 접속

브라우저에서 `http://localhost:3000/dashboard` 접속

## 📁 프로젝트 구조

```
korean-trend-autopublisher/
├── src/
│   ├── main.js              # 🎯 메인 오케스트레이터 (전체 흐름 관리)
│   ├── config.js             # ⚙️ 설정 관리
│   ├── logger.js             # 📋 로깅 시스템
│   ├── database.js           # 💾 SQLite DB 관리
│   ├── trend-crawler.js      # 🔍 실시간 검색어 크롤러 (6개 소스)
│   ├── news-fetcher.js       # 📰 뉴스 기사 수집기
│   ├── article-generator.js  # 🤖 AI 기사 자동 생성기
│   ├── publisher.js          # 📤 자동 퍼블리싱 + SEO
│   ├── dashboard.js          # 📊 실시간 관리 대시보드
│   └── test.js               # 🧪 통합 테스트
├── public/                   # 생성된 정적 사이트
│   ├── index.html            # 메인 페이지 (자동 생성)
│   ├── sitemap.xml           # 사이트맵 (자동 갱신)
│   ├── rss.xml               # RSS 피드 (자동 갱신)
│   └── articles/             # 기사 HTML 파일들
├── data/                     # SQLite DB 파일
├── logs/                     # 로그 파일
├── .env.example              # 환경변수 템플릿
└── package.json
```

## 🔍 크롤링 소스 (6개)

| 소스 | 방식 | 특징 |
|------|------|------|
| Google Trends RSS | RSS 피드 | 일일 트렌딩 키워드 |
| Google Trends API | 비공식 API | 실시간 트렌딩 + 관련 검색어 |
| Naver | API/크롤링 | 한국 최대 포털 급상승 |
| Zum | 크롤링 | 포털 실시간 검색어 |
| Nate | 크롤링 | 포털 실시간 검색어 |
| Signal.bz | 크롤링 | 실시간 검색어 통합 서비스 |

## 🤖 AI 기사 생성

- **OpenAI GPT-4o-mini** (기본) 사용
- SEO 최적화된 제목, 메타 설명, 본문 자동 생성
- 수집된 실제 뉴스를 참고하여 사실 기반 기사 작성
- **폴백 모드**: API 없이도 뉴스 기반 자동 기사 구성

## 📊 대시보드 기능

- 실시간 키워드 모니터링 (Socket.IO)
- 기사 생성/발행 현황
- 시스템 로그 실시간 확인
- 통계 자동 갱신 (30초)

## 🔧 SEO 산출물 재생성

운영 중 정적 SEO 파일(메인/카테고리/아카이브/사이트맵/RSS/robots)만 다시 만들고 싶다면 아래 명령을 사용하세요.

```bash
npm run build:seo
```

이 명령은 발행된 기사 DB를 기준으로 `public/` 산출물을 재생성하고, 정상 완료 시 종료코드 `0`으로 끝납니다.

배포 직전 자동 검증까지 포함하려면:

```bash
npm run release:seo
```

검증만 отдельно 실행하려면:

```bash
npm run verify:seo
```

## ⚙️ 주요 설정

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `CRAWL_INTERVAL_MINUTES` | 3 | 크롤링 주기 (분) |
| `MAX_ARTICLES_PER_HOUR` | 20 | 시간당 최대 기사 생성 수 |
| `AUTO_PUBLISH` | true | 자동 발행 여부 |
| `AI_MODEL` | gpt-4o-mini | 사용할 AI 모델 |

## 💰 수익화 방법

1. **Google AdSense**: 각 기사 페이지에 광고 슬롯이 이미 배치되어 있음
2. **제휴 마케팅**: 관련 키워드에 제휴 링크 삽입
3. **네이티브 광고**: 기사 사이 광고 삽입

### AdSense 적용 방법

`src/publisher.js`에서 `광고 영역 (AdSense)` 부분을 실제 AdSense 코드로 교체:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-YOUR_ID" crossorigin="anonymous"></script>
<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-YOUR_ID" data-ad-slot="YOUR_SLOT" data-ad-format="auto"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
```

## 🚀 배포 옵션

### Vercel (무료)
```bash
npm i -g vercel
vercel deploy --prod
```

### Cloudflare Pages (무료)
public/ 폴더를 Cloudflare Pages에 연결

### VPS (자체 서버)
```bash
# PM2로 영구 실행
npm i -g pm2
pm2 start src/main.js --name trend-publisher
pm2 save
pm2 startup
```

## ⚠️ 주의사항

- 크롤링 주기를 너무 짧게 하면 IP 차단 가능 (최소 2분 권장)
- OpenAI API 비용에 주의 (gpt-4o-mini는 저렴)
- 생성된 콘텐츠의 저작권/팩트체크 확인 필요
- robots.txt 및 이용약관 준수
