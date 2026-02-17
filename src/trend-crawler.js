// ============================================
// trend-crawler.js - 실시간 검색어 크롤러
// ============================================
// ★ 실제 검색어 랭킹 소스만 사용 (헤드라인 추출 완전 제거)
// - Google Trends RSS (한국 일반)
// - Google Trends RSS (엔터테인먼트)
// - Zum 실시간 검색어
// - Nate 실시간 검색어
// - Signal.bz 실시간 검색어 통합
//
// ※ Naver/Daum 뉴스 헤드라인에서 키워드 추출하면
//   "이들", "피해자", "오른", "표명" 같은 쓰레기가 무한 생성됨
//   → 헤드라인 추출 크롤러 전부 삭제 (2025.01)
// ============================================

const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');
const config = require('./config');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

// ========== 키워드 품질 필터 ==========
const KEYWORD_STOPWORDS = new Set([
  // 뉴스 일반 동사/행위
  '지지', '반대', '충격', '투사', '어린', '확인', '공개', '발표', '논란', '화제',
  '대응', '조사', '검토', '예상', '전망', '우려', '비판', '의혹', '진행', '예정',
  '결정', '승인', '거부', '요구', '주장', '강조', '보도', '문제', '상황', '사건',
  '피해', '영향', '결과', '이유', '원인', '가능', '필요', '심각', '중요', '관련',
  '해당', '감봉', '정당', '취소', '실패', '강화', '완화', '유지', '시작', '종료',
  '중단', '재개', '연기', '축소', '확대', '수정', '삭제', '생성', '복구', '지적',
  '발견', '등장', '출연', '방문', '참석', '참여', '지원', '제공', '소개', '언급',
  '우승', '패배', '승리', '도전', '경쟁', '대결', '선발', '교체', '투입', '합류', '응원',
  '투기', '발생', '해결', '처리', '추진', '변경', '이동', '설치', '운영', '폐쇄', '부상',
  '출발', '도착', '통과', '중지', '개방', '차단', '허용', '금지', '위반', '적발',
  // 일반 명사 (단독으로 검색어 부적합한 것만)
  '정부', '국회', '여당', '야당', '의원', '장관', '위원',
  '세대', '자연', '사회', '경제', '문화', '교육', '과학', '기술', '환경', '건강',
  '생활', '가족', '부모', '자녀', '학생', '교사', '직원', '시민', '국민', '주민',
  '시장', '가격', '비용', '수익', '매출', '투자', '금리', '물가', '임금', '연봉',
  '한국인', '외국인', '남성', '여성', '청년', '노인', '어린이', '청소년', '성인',
  '회사', '기업', '단체', '기관', '부서', '팀', '조직', '센터', '본부',
  // 부사/관형/대명사
  '많이', '매우', '정말', '진짜', '너무', '거의', '계속', '다시', '모두', '역시',
  '아직', '이미', '바로', '무슨', '어떤', '이런', '그런', '무려', '겨우', '드디어',
  // 시간
  '오늘', '내일', '어제', '올해', '지난', '다음', '이번', '최근', '현재',
  // 뉴스 수식어
  '무소속', '소속', '돌연', '결국', '사실', '실제', '과연', '역대', '최초', '최대',
  '최소', '최고', '최저', '긴급', '속보', '단독', '특종', '대형', '초대형',
  '전격', '파격', '깜짝', '초유', '이례', '잇따', '연이',
  // 방향/위치
  '국내', '국외', '해외', '전국', '전역', '일대', '인근', '주변',
  // 연결어
  '그리고', '하지만', '그래서', '그러나', '그런데', '따라서', '또한', '비록',
  // 헤드라인 잔재 (이전에 수집된 쓰레기)
  '이들', '피해자', '오른', '연속', '나선', '전면에', '표명', '유감', '눈물',
  '홍보전', '여자도', '바닥론', '비키니', '반려견놀', '낚싯바늘',
  // 일반 부사/형용사 (검색어 부적합)
  '여전히', '아직도', '점차', '더욱', '갑자기', '다소', '상당히', '끝내',
  // 너무 일반적인 명사 (2글자)
  '구성', '정상', '구조', '방식', '과정', '부분', '기본', '전체', '일반',
  '형태', '상태', '종류', '방법', '내용', '활동', '조건', '수준', '분야',
  '의미', '가치', '목적', '범위', '개념', '요소', '단계', '항목', '기능',
  '정거장', '요청', '판단', '입장', '향후', '약속', '임무', '역할',
  // 일반적 합성어 (검색어가 될 수 없는 것들)
  '개인비서', '자료정리', '구조분석', '이어트', '코르티스',
  // 너무 일반적인 단어 (단독 검색어 부적합)
  '나라', '이웃', '오빠', '언니', '동생', '형', '공항', '변호사', '의사', '교수', '판사',
  '자기야', '주인공', '조상님', '충남도', '경기도', '전남도', '전북도', '경남도', '경북도',
  '생활양식', '제사상', '그들', '여야', '뛰노', '이틀', '사흘', '며칠',
  '금하지', '파산까지', '전국', '세계', '역사', '미래',
  '설날', '추석', '명절', '연휴', '귀성', '정체', '극심',
  // 감정/상태
  '행복', '슬픔', '분노', '기쁨', '걱정', '불안', '두려움',
  // 사이트/네비게이션
  'Naver', 'naver', 'Google', 'google', 'Daum', 'daum', 'YouTube', 'youtube',
  'NAVER', 'DAUM', 'GOOGLE',
]);

// 키워드 품질 검증
function isGoodKeyword(keyword) {
  if (!keyword || keyword.length < 2) return false;
  if (keyword.length > 25) return false;

  const words = keyword.split(/\s+/);

  // 5단어 이상 → 문장 (실검은 보통 1~4단어)
  if (words.length >= 5) return false;

  // 1단어: 불용어면 차단
  if (words.length === 1) {
    if (KEYWORD_STOPWORDS.has(keyword) || KEYWORD_STOPWORDS.has(keyword.toLowerCase())) return false;
  }

  // 2~4단어: 모든 단어가 불용어이면 차단 (하나라도 고유명사면 통과)
  if (words.length >= 2) {
    const allStopwords = words.every(w => KEYWORD_STOPWORDS.has(w) || KEYWORD_STOPWORDS.has(w.toLowerCase()));
    if (allStopwords) return false;
  }

  // 동사/형용사 어미·활용형
  if (/(?:합니다|했다|한다|된다|있다|없다|하다|되다|않다|봤다|됐다|싶다|맞아|좋아해|싫어해|몰라|있어|없어|했어|됐어|봤어|해요|돼요|할까|는데|인데|거든|라고|다는|라는|거야|해야|네요|올라가|나오다|들어가|내려가|가다|되다|보다)$/.test(keyword)) return false;

  // 2글자: 한글1자+조사/어미 (하는, 되는, 같은, 있는, 오른, 나선 등)
  if (keyword.length === 2 && /^[\uac00-\ud7a3][는을를이가의에서로와과도만은른선]$/.test(keyword)) return false;

  // X글자 이상 키워드가 는/은/이/가 등 단일 조사로 끝남 (이한영은, 서울시는 등)
  if (/[\uac00-\ud7a3]{2,}[은는이가을를]$/.test(keyword) && keyword.length >= 3) return false;

  // 3~5글자 조사/어미로 끝남
  if (/(?:에서|으로|에게|부터|까지|처럼|만큼|대로|같이|밖에|마저|조차|도록|면서|지만|더니|려고|라서|니까|므로|거나)$/.test(keyword) && keyword.length <= 5) return false;

  // 명사+조사 패턴 (전면에, 앞에서 등)
  if (/(?:전면에|앞에서|뒤에서|위에서|밑에서|옆에서|속에서|안에서|밖에서)/.test(keyword)) return false;

  // 순수 숫자
  if (/^\d+$/.test(keyword)) return false;
  if (/^\d+[만억원조개명건호%]?$/.test(keyword)) return false;

  // 순수 영어 단어 (2글자 이하 차단, 3글자+ 약어는 허용: BTS, ICC, NBA 등)
  if (/^[a-zA-Z]+$/.test(keyword) && keyword.length <= 2) return false;

  // '~의 눈물', '~의 X' 같은 기사 제목 패턴
  if (/의\s+(눈물|힘|곳|때|길|맛|꿈|말|법|손|집|끝|빛|밤|낮|봄|겨울|여름|가을)$/.test(keyword)) return false;

  // 한글 1글자 단독
  if (/^[\uac00-\ud7a3]$/.test(keyword)) return false;

  // 따옴표/특수문자 포함
  if (/['\"''""「」]/.test(keyword)) return false;

  // 조사/어미로 끝나는 패턴 (더 넓은 범위)
  if (/(?:까지|에서|으로|에게|부터|라는|라고|이라|이다|이며|하는|되는|있는|없는)$/.test(keyword) && keyword.length >= 3) return false;

  return true;
}

// ========== Google Trends 한국 (일반) ==========
async function crawlGoogleTrends() {
  try {
    logger.info('[크롤러] Google Trends 한국 크롤링 시작...');

    const url = 'https://trends.google.com/trending/rss?geo=KR';
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const keywords = [];

    $('item').each((i, el) => {
      const title = $(el).find('title').text().trim();
      if (title && title.length > 1 && title.length <= 20) {
        keywords.push({
          keyword: title,
          source: 'google_trends',
          rank: i + 1,
        });
      }
    });

    logger.info(`[크롤러] Google Trends: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] Google Trends 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== Google Trends 엔터테인먼트 ==========
async function crawlGoogleTrendsEntertainment() {
  try {
    logger.info('[크롤러] Google Trends 엔터 크롤링 시작...');

    const response = await axios.get('https://trends.google.com/trending/rss?geo=KR&category=e', {
      headers: HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const keywords = [];

    $('item').each((i, el) => {
      const title = $(el).find('title').text().trim();
      if (title && title.length > 1 && title.length <= 20) {
        keywords.push({
          keyword: title,
          source: 'google_trends_ent',
          rank: i + 1,
        });
      }
    });

    logger.info(`[크롤러] Google Trends 엔터: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] Google Trends 엔터 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== Zum 실시간 검색어 ==========
async function crawlZum() {
  try {
    logger.info('[크롤러] Zum 실시간 검색어 크롤링 시작...');

    const url = 'https://zum.com/';
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);
    const keywords = [];

    const selectors = [
      '.keyword_list li a',
      '.realtime_keyword a',
      '.issue_keyword a',
      '.hot_keyword_list a',
      '[class*="keyword"] a',
      '[class*="search"] li a',
    ];

    for (const selector of selectors) {
      $(selector).each((i, el) => {
        let text = $(el).text().trim().replace(/^\d+\s*/, '').replace(/\s+\d+$/, '').trim();
        if (text && text.length > 1 && text.length < 20) {
          keywords.push({
            keyword: text,
            source: 'zum',
            rank: i + 1,
          });
        }
      });
      if (keywords.length > 0) break;
    }

    logger.info(`[크롤러] Zum: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] Zum 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== Nate 실시간 이슈 키워드 ==========
async function crawlNate() {
  try {
    logger.info('[크롤러] Nate 실시간 검색어 크롤링 시작...');

    const url = 'https://www.nate.com/';
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);
    const keywords = [];
    const seen = new Set();

    // 1순위: span.txt_rank
    $('span.txt_rank').each((i, el) => {
      let text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 20 && !seen.has(text)) {
        seen.add(text);
        keywords.push({ keyword: text, source: 'nate', rank: i + 1 });
      }
    });

    // 2순위: isKeywordList
    if (keywords.length === 0) {
      $('ol.isKeywordList li a, .isKeyword a').each((i, el) => {
        let text = $(el).text().trim()
          .replace(/^\d+\s*/, '')
          .replace(/\s*(동일|new|상승|하강)\s*$/i, '')
          .trim();
        if (text && text.length > 1 && text.length < 20 && !seen.has(text)) {
          seen.add(text);
          keywords.push({ keyword: text, source: 'nate', rank: i + 1 });
        }
      });
    }

    // 3순위: 폴백 셀렉터
    if (keywords.length === 0) {
      const selectors = ['.kwd_list li a', '.keyword_area li a', '.realtime_list li a', '[class*="rank"] li a'];
      for (const selector of selectors) {
        $(selector).each((i, el) => {
          let text = $(el).text().trim().replace(/^\d+\s*/, '').replace(/\s+\d+$/, '').trim();
          if (text && text.length > 1 && text.length < 20 && !seen.has(text)) {
            seen.add(text);
            keywords.push({ keyword: text, source: 'nate', rank: i + 1 });
          }
        });
        if (keywords.length > 0) break;
      }
    }

    logger.info(`[크롤러] Nate: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] Nate 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== 네이버 실시간 인기 검색어 (Naver Mobile) ==========
async function crawlNaverMobile() {
  try {
    logger.info('[크롤러] 네이버 모바일 인기검색어 크롤링 시작...');
    const keywords = [];
    const seen = new Set();

    // 방법 1: 네이버 모바일 검색 (실시간 검색어)
    const urls = [
      'https://m.search.naver.com/search.naver?query=%EC%8B%A4%EC%8B%9C%EA%B0%84+%EA%B2%80%EC%83%89%EC%96%B4',
      'https://m.search.naver.com/search.naver?query=%EC%8B%A4%EC%8B%9C%EA%B0%84+%EC%9D%B8%EA%B8%B0+%EA%B2%80%EC%83%89%EC%96%B4',
    ];

    for (const url of urls) {
      try {
        const res = await axios.get(url, {
          headers: { 
            ...HEADERS, 
            'Accept': 'text/html',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          },
          timeout: 8000,
        });
        const $ = cheerio.load(res.data);

        // 다양한 셀렉터로 키워드 추출 시도
        const selectors = [
          '.keyword_rank .item_title', '.lst_relate .tit', '.keyword_item .txt',
          '.rank_area .keyword', '.list_trend_keyword .keyword',
          '.realtime_kwd_lst li a', '.kwd_lst li a',
          'a.keyword', '.keyword_box a', '.trend_item',
          // 신규 셀렉터
          '.tit_area .tit', '.api_subject_bx .tit',
          '.fds-comps-keyword-chip', '.fds-keyword-text',
          'a[data-cr-area="rkw"]', 'a[data-cr-area="rkt"]',
          '.type_keyword .keyword', '.keyword_list .keyword',
        ];
        
        for (const sel of selectors) {
          $(sel).each((i, el) => {
            let text = $(el).text().trim().replace(/^\d+[\.\s]*/, '').trim();
            if (text && text.length >= 2 && text.length <= 20 && !seen.has(text)) {
              seen.add(text);
              keywords.push({ keyword: text, source: 'naver', rank: keywords.length + 1 });
            }
          });
          if (keywords.length >= 10) break;
        }

        if (keywords.length >= 10) break;
      } catch (e) {
        logger.debug(`[크롤러] 네이버 URL 실패: ${e.message}`);
      }
    }

    logger.info(`[크롤러] 네이버 모바일: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] 네이버 모바일 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== 네이버 DataLab 실시간 검색어 ==========
async function crawlNaverDataLab() {
  try {
    logger.info('[크롤러] 네이버 DataLab 실시간 검색어 크롤링 시작...');
    const keywords = [];
    const seen = new Set();

    // DataLab 실시간 검색어 페이지
    const urls = [
      'https://datalab.naver.com/keyword/realtimeList.naver?age=0',
      'https://datalab.naver.com/keyword/realtimeList.naver?age=20',
      'https://datalab.naver.com/keyword/realtimeList.naver?age=30',
    ];

    for (const url of urls) {
      try {
        const res = await axios.get(url, {
          headers: {
            ...HEADERS,
            'Referer': 'https://datalab.naver.com/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          timeout: 10000,
        });
        const $ = cheerio.load(res.data);

        // DataLab 실시간 검색어 셀렉터
        const selectors = [
          '.ranking_list .item_title',
          '.realtime_rank .keyword',
          '.keyword_rank li .title',
          '.ranking_keyword .keyword',
          'ol li .title', 'ol li a',
          '.list_keyword_realtime li a',
          '.keyword_list li a',
          'span.title', '.rank_text',
          '.item_box .item_title',
        ];

        for (const sel of selectors) {
          $(sel).each((i, el) => {
            let text = $(el).text().trim()
              .replace(/^\d+[\.\s]*/, '')
              .replace(/\s*(NEW|UP|DOWN|SAME|\d+단계|순위)\s*/gi, '')
              .trim();
            if (text && text.length >= 2 && text.length <= 20 && !seen.has(text)) {
              seen.add(text);
              keywords.push({ keyword: text, source: 'naver_datalab', rank: keywords.length + 1 });
            }
          });
          if (keywords.length >= 10) break;
        }

        // JSON 데이터가 페이지에 임베드되어 있는 경우 추출
        if (keywords.length === 0) {
          const scriptContent = $('script').toArray()
            .map(s => $(s).html() || '')
            .join('\n');

          // JSON 배열에서 키워드 추출 시도
          const jsonMatches = scriptContent.match(/\["[가-힣a-zA-Z0-9\s]{2,20}"/g) || [];
          for (const match of jsonMatches.slice(0, 20)) {
            const kw = match.replace(/[\[\]"]/g, '').trim();
            if (kw && kw.length >= 2 && kw.length <= 20 && !seen.has(kw)) {
              seen.add(kw);
              keywords.push({ keyword: kw, source: 'naver_datalab', rank: keywords.length + 1 });
            }
          }

          // rankKeyword 패턴
          const kwMatches = scriptContent.match(/(?:keyword|title|text)\s*[:=]\s*["']([가-힣a-zA-Z0-9\s]{2,20})["']/g) || [];
          for (const match of kwMatches.slice(0, 20)) {
            const kw = match.replace(/.*["']([^"']+)["'].*/, '$1').trim();
            if (kw && kw.length >= 2 && kw.length <= 20 && !seen.has(kw)) {
              seen.add(kw);
              keywords.push({ keyword: kw, source: 'naver_datalab', rank: keywords.length + 1 });
            }
          }
        }

        if (keywords.length >= 15) break;
      } catch (e) {
        logger.debug(`[크롤러] DataLab URL 실패: ${e.message}`);
      }
    }

    logger.info(`[크롤러] 네이버 DataLab: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] 네이버 DataLab 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== 네이버 뉴스 실시간 핫토픽 (PC 뉴스 섹션) ==========
async function crawlNaverNewsTopics() {
  try {
    logger.info('[크롤러] 네이버 뉴스 실시간 토픽 크롤링 시작...');
    const keywords = [];
    const seen = new Set();

    // 네이버 뉴스 홈 - 많이 본 뉴스에서 키워드 추출
    const urls = [
      'https://news.naver.com/main/ranking/popularDay.naver',
      'https://news.naver.com/',
      'https://m.news.naver.com/',
    ];

    for (const url of urls) {
      try {
        const isMobile = url.includes('m.news');
        const res = await axios.get(url, {
          headers: {
            ...HEADERS,
            'User-Agent': isMobile 
              ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
              : HEADERS['User-Agent'],
          },
          timeout: 10000,
        });
        const $ = cheerio.load(res.data);

        // 뉴스 랭킹/이슈 키워드 셀렉터
        const selectors = [
          // 네이버 뉴스 랭킹/핫토픽
          '.rankingnews_box .list_title', '.rankingnews_name',
          '.cjs_t', '.cjs_news_mw .title',
          '.cluster_head .cluster_text',
          // 이슈 키워드
          '.issue_keyword a', '.keyword_headline a',
          '.ofp_main_keyword li a', '.main_keyword li a',
          // 모바일
          '.newsct_article .tit', '.newsnow_tx_inner a',
          '.rcmdn_keyword a', '.keyword_area a',
          // 실시간 뉴스
          '.hdline_article_tit a', '.main_content_headline li a',
        ];

        for (const sel of selectors) {
          $(sel).each((i, el) => {
            let text = $(el).text().trim();
            // 뉴스 제목에서 핵심 키워드 추출 (2~4단어)
            text = extractKeywordFromTitle(text);
            if (text && text.length >= 2 && text.length <= 20 && !seen.has(text)) {
              seen.add(text);
              keywords.push({ keyword: text, source: 'naver_news', rank: keywords.length + 1 });
            }
          });
          if (keywords.length >= 15) break;
        }

        if (keywords.length >= 15) break;
      } catch (e) {
        logger.debug(`[크롤러] 네이버 뉴스 URL 실패: ${e.message}`);
      }
    }

    logger.info(`[크롤러] 네이버 뉴스 토픽: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] 네이버 뉴스 토픽 크롤링 실패: ${error.message}`);
    return [];
  }
}

// 뉴스 제목에서 핵심 인물/이슈 키워드 추출
function extractKeywordFromTitle(title) {
  if (!title || title.length < 3) return '';
  
  // 제목이 너무 길면 (문장형) 핵심만 추출
  if (title.length > 20) {
    // "인물명, 어쩌구" → 인물명만 추출
    const commaMatch = title.match(/^([가-힣a-zA-Z\s]{2,10})[,·…]/);
    if (commaMatch) return commaMatch[1].trim();
    
    // "인물명 + 핵심어" 패턴 (앞 2~3단어)
    const words = title.split(/[\s,·…"']/).filter(w => w.length >= 2);
    if (words.length >= 2) {
      // 인명 + 키워드 조합 (최대 2단어)
      const candidate = words.slice(0, 2).join(' ');
      if (candidate.length <= 15) return candidate;
      return words[0];
    }
    return '';
  }
  
  return title.replace(/^\d+[\.\s]*/, '').trim();
}

// ========== Signal.bz 실시간 검색어 통합 ==========
async function crawlSignalBz() {
  try {
    logger.info('[크롤러] Signal.bz 실시간 검색어 크롤링 시작...');

    const keywords = [];
    const seen = new Set();

    // 방법 1: Signal.bz API
    try {
      const response = await axios.get('https://test-api.signal.bz/news/realtime', {
        headers: { ...HEADERS, Referer: 'https://signal.bz/' },
        timeout: 8000,
      });

      const data = response.data;
      if (data && data.top10 && Array.isArray(data.top10)) {
        for (const item of data.top10) {
          if (!item.keyword) continue;
          extractSignalKeywords(keywords, seen, item.keyword, item.rank);
        }
      }
    } catch (apiErr) {
      logger.debug(`[크롤러] Signal.bz API 실패: ${apiErr.message}`);
    }

    // 방법 2: Signal.bz 웹페이지 크롤링 (API 실패 시 fallback)
    if (keywords.length === 0) {
      try {
        const webRes = await axios.get('https://signal.bz/', {
          headers: HEADERS,
          timeout: 10000,
        });
        const $ = cheerio.load(webRes.data);

        // 실시간 검색어 리스트에서 추출
        const selectors = [
          '.rank-text', '.keyword-text', '.list-item a', '.rank-list li',
          '.popular-keyword li', 'ol li', '.realtime-rank li', 'a[href*="keyword"]',
        ];
        
        for (const sel of selectors) {
          $(sel).each((i, el) => {
            const text = $(el).text().trim().replace(/^\d+\s*/, '');
            if (text && text.length >= 2 && text.length <= 30) {
              extractSignalKeywords(keywords, seen, text, i + 1);
            }
          });
          if (keywords.length >= 5) break;
        }

        // 메타 태그나 JSON-LD에서 키워드 추출 시도
        if (keywords.length === 0) {
          const bodyText = $.text();
          const rankMatches = bodyText.match(/\d+\s+([가-힣a-zA-Z\s]{2,20})/g) || [];
          for (const match of rankMatches.slice(0, 10)) {
            const kw = match.replace(/^\d+\s*/, '').trim();
            if (kw.length >= 2) {
              extractSignalKeywords(keywords, seen, kw, keywords.length + 1);
            }
          }
        }
      } catch (webErr) {
        logger.debug(`[크롤러] Signal.bz 웹 크롤링도 실패: ${webErr.message}`);
      }
    }

    logger.info(`[크롤러] Signal.bz: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] Signal.bz 크롤링 실패: ${error.message}`);
    return [];
  }
}

function extractSignalKeywords(keywords, seen, rawKeyword, rank) {
  // 물음표, 느낌표 등 문장부호 제거
  const text = rawKeyword.trim().replace(/[?？!！~…]+$/g, '').trim();
  // 쉼표로 분리된 복합 키워드 → 각각 처리
  const parts = text.split(/[,，]/).map(p => p.trim()).filter(p => p.length >= 2);
  
  for (const part of parts) {
    // 조사/어미 제거: "이한영은" → "이한영", "빌런?" → "빌런"
    const cleaned = cleanTrailingParticles(part);
    if (!cleaned || cleaned.length < 2) continue;

    const words = cleaned.split(/\s+/);
    // 2단어 이하면 그대로
    if (words.length <= 2) {
      addSignalKeyword(keywords, seen, cleaned, rank);
    } else {
      // 3단어 이상이면 첫 1~2단어 추출 (조사 제거 후)
      const w0 = cleanTrailingParticles(words[0]);
      if (w0 && w0.length >= 2) addSignalKeyword(keywords, seen, w0, rank);
      const w01 = cleanTrailingParticles(words.slice(0, 2).join(' '));
      if (w01 && w01.length >= 2) addSignalKeyword(keywords, seen, w01, rank);
    }
  }
}

// Signal.bz 문장형 키워드에서 끝의 조사/어미 제거
function cleanTrailingParticles(text) {
  return text
    .replace(/[?？!！~…\.]+$/g, '')  // 문장부호 제거
    .replace(/(?:은|는|이|가|을|를|의|에|로|와|과|도|만|서|에서|으로|까지|부터|에게|이다|이라|하는|되는|라고|라는)$/g, '')  // 끝 조사 제거
    .trim();
}

function addSignalKeyword(keywords, seen, text, rank) {
  const cleaned = text.replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim();
  if (cleaned && cleaned.length >= 2 && cleaned.length <= 20 && !seen.has(cleaned.toLowerCase())) {
    seen.add(cleaned.toLowerCase());
    keywords.push({ keyword: cleaned, source: 'signal', rank: rank });
  }
}

// ========== 모든 소스 크롤링 ==========
async function crawlAll() {
  logger.info('====== 전체 실시간 검색어 크롤링 시작 ======');
  logger.info('소스: Google Trends (일반+엔터), Zum, Nate, Signal.bz, Naver (모바일+DataLab+뉴스토픽)');

  const results = await Promise.allSettled([
    crawlGoogleTrends(),
    crawlGoogleTrendsEntertainment(),
    crawlZum(),
    crawlNate(),
    crawlSignalBz(),
    crawlNaverMobile(),
    crawlNaverDataLab(),
    crawlNaverNewsTopics(),
  ]);

  const allKeywords = [];
  const sources = ['Google Trends', 'Google Trends 엔터', 'Zum', 'Nate', 'Signal.bz', 'Naver 모바일', 'Naver DataLab', 'Naver 뉴스토픽'];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allKeywords.push(...result.value);
      logger.info(`  ✓ ${sources[index]}: ${result.value.length}개`);
    } else {
      logger.warn(`  ✗ ${sources[index]}: 실패`);
    }
  });

  // 중복 제거
  const uniqueMap = new Map();

  // 네비게이션/잡음 블랙리스트
  const BLACKLIST = new Set([
    '정정보도 모음', '전체 언론사', '오피니언', '사설', '칼럼', '포토',
    '랭킹뉴스', '많이 본 뉴스', '최신뉴스', '더보기', '뉴스홈',
    '연예', '스포츠', '경제', '사회', '정치', '세계', '문화',
    'IT/과학', '생활', '해당 언론사로 이동합니다',
    '전체보기', '닫기', '검색', '로그인', '회원가입', '설정',
  ]);

  for (const kw of allKeywords) {
    let cleaned = kw.keyword.trim()
      .replace(/\s+\d+$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned || cleaned.length < 2) continue;
    if (cleaned.length > 20) continue;
    if (BLACKLIST.has(cleaned)) continue;

    // 키워드 품질 검증
    if (!isGoodKeyword(cleaned)) {
      logger.debug(`[품질필터] 제외: "${cleaned}"`);
      continue;
    }

    kw.keyword = cleaned;
    const normalized = cleaned.toLowerCase();
    if (!uniqueMap.has(normalized)) {
      uniqueMap.set(normalized, kw);
    }
  }

  const uniqueKeywords = Array.from(uniqueMap.values());
  logger.info(`====== 크롤링 완료: 총 ${allKeywords.length}개 → 중복 제거 후 ${uniqueKeywords.length}개 ======`);

  return uniqueKeywords;
}

module.exports = {
  crawlGoogleTrends,
  crawlGoogleTrendsEntertainment,
  crawlZum,
  crawlNate,
  crawlSignalBz,
  crawlNaverMobile,
  crawlNaverDataLab,
  crawlNaverNewsTopics,
  crawlAll,
  isGoodKeyword,
};
