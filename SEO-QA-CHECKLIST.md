# SEO QA 체크리스트

## 1) 크롤링/인덱싱 기본
- [ ] `public/robots.txt`에서 `/`, `/articles/`, `/category/`, `/archive/` 허용 확인
- [ ] `public/sitemap.xml` 접근 가능 및 200 응답 확인
- [ ] `public/news-sitemap.xml` 접근 가능 및 최근 기사 중심으로 구성 확인
- [ ] `public/rss.xml` 접근 가능 및 최신 발행 기사 반영 확인

## 2) URL/캐노니컬 정합성
- [ ] 기사 URL이 퍼센트 인코딩 규칙으로 일관되게 생성되는지 확인
- [ ] 기사 페이지 `canonical`이 실제 URL과 1:1 매칭되는지 확인
- [ ] 카테고리/아카이브 페이지 `canonical` 경로가 올바른지 확인

## 3) 메타 태그 품질
- [ ] 각 페이지 `title`이 중복 없이 고유한지 확인
- [ ] `meta description` 길이가 과도하게 짧거나 긴 문장이 아닌지 확인
- [ ] OG/Twitter 메타(`og:title`, `og:description`, `og:url`, `og:image`) 존재 확인
- [ ] 기사 페이지 `twitter:card`가 `summary_large_image`인지 확인

## 4) 구조화 데이터(JSON-LD)
- [ ] 기사 페이지 `NewsArticle`에 `headline`, `datePublished`, `dateModified`, `mainEntityOfPage` 확인
- [ ] 목록형 페이지에 `CollectionPage` 또는 `ItemList` 존재 확인
- [ ] 브레드크럼 페이지에 `BreadcrumbList` 존재 확인
- [ ] 리치 결과 테스트(구글)에서 치명적 오류 없음 확인

## 5) 사이트맵 품질
- [ ] `sitemap.xml`에 홈, 카테고리, 아카이브, 기사 URL 포함 확인
- [ ] `lastmod`가 최신 발행 시각을 반영하는지 확인
- [ ] 뉴스 사이트맵이 과도한 오래된 항목 없이 최신 범위 중심인지 확인

## 6) 콘텐츠 품질(발행 전 샘플링)
- [ ] 최근 기사 5~10개에서 제목 중복/템플릿 문구 반복 여부 확인
- [ ] 본문 첫 문단이 키워드만 반복하지 않고 정보 전달이 되는지 확인
- [ ] 출처 링크가 유효하고 끊긴 링크가 없는지 확인

## 7) 배포 후 확인
- [ ] Search Console에 `sitemap.xml` 제출 및 수집 성공 확인
- [ ] URL 검사로 대표 기사 3개 인덱싱 가능 상태 확인
- [ ] 서버 로그에서 크롤러 접근(`Googlebot`, `Naver`) 확인

## 실행 명령
```bash
npm run build:seo
```
