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
  '우승', '패배', '승리', '도전', '경쟁', '대결', '선발', '교체', '투입', '합류',
  '투기', '발생', '해결', '처리', '추진', '변경', '이동', '설치', '운영', '폐쇄',
  '출발', '도착', '통과', '중지', '개방', '차단', '허용', '금지', '위반', '적발',
  // 일반 명사 (국가/도시/정치)
  '미국', '중국', '일본', '한국', '북한', '러시아', '유럽', '영국', '독일', '프랑스',
  '이탈리아', '스페인', '캐나다', '호주', '인도', '브라질', '멕시코', '터키',
  '정부', '대통령', '국회', '여당', '야당', '의원', '장관', '대표', '위원', '후보',
  '경찰', '검찰', '법원', '재판', '수사', '기소', '구속', '석방', '체포', '혐의',
  '세대', '자연', '사회', '경제', '문화', '교육', '과학', '기술', '환경', '건강',
  '생활', '가족', '부모', '자녀', '학생', '교사', '직원', '시민', '국민', '주민',
  '시장', '가격', '비용', '수익', '매출', '투자', '금리', '물가', '임금', '연봉',
  '한국인', '외국인', '남성', '여성', '청년', '노인', '어린이', '청소년', '성인',
  '회사', '기업', '단체', '기관', '부서', '팀', '조직', '센터', '본부',
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '제주',
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
  // 감정/상태
  '행복', '슬픔', '분노', '기쁨', '걱정', '불안', '두려움',
  // 사이트/네비게이션
  'Naver', 'naver', 'Google', 'google', 'Daum', 'daum', 'YouTube', 'youtube',
  'NAVER', 'DAUM', 'GOOGLE',
]);

// 키워드 품질 검증
function isGoodKeyword(keyword) {
  if (!keyword || keyword.length < 2) return false;
  if (keyword.length > 15) return false;

  // 불용어 체크 (대소문자 무시)
  if (KEYWORD_STOPWORDS.has(keyword)) return false;
  if (KEYWORD_STOPWORDS.has(keyword.toLowerCase())) return false;

  const words = keyword.split(/\s+/);

  // 3단어 이상 → 문장
  if (words.length >= 3) return false;

  // 2단어: 불용어 포함 시 차단
  if (words.length === 2) {
    if (words.some(w => KEYWORD_STOPWORDS.has(w) || KEYWORD_STOPWORDS.has(w.toLowerCase()))) return false;
  }

  // 동사/형용사 어미·활용형
  if (/(?:합니다|했다|한다|된다|있다|없다|하다|되다|않다|봤다|됐다|싶다|맞아|좋아해|싫어해|몰라|있어|없어|했어|됐어|봤어|해요|돼요|할까|는데|인데|거든|라고|다는|라는|거야|해야|네요|올라가|나오다|들어가|내려가|가다|되다|보다)$/.test(keyword)) return false;

  // 2글자: 한글1자+조사/어미 (하는, 되는, 같은, 있는, 오른, 나선 등)
  if (keyword.length === 2 && /^[\uac00-\ud7a3][는을를이가의에서로와과도만은른선]$/.test(keyword)) return false;

  // 3~5글자 조사/어미로 끝남
  if (/(?:에서|으로|에게|부터|까지|처럼|만큼|대로|같이|밖에|마저|조차|도록|면서|지만|더니|려고|라서|니까|므로|거나)$/.test(keyword) && keyword.length <= 5) return false;

  // 명사+조사 패턴 (전면에, 앞에서 등)
  if (/(?:전면에|앞에서|뒤에서|위에서|밑에서|옆에서|속에서|안에서|밖에서)/.test(keyword)) return false;

  // 순수 숫자
  if (/^\d+$/.test(keyword)) return false;
  if (/^\d+[만억원조개명건호%]?$/.test(keyword)) return false;

  // 순수 영어 단어 (3글자 이하 → 약어/사이트명)
  // 단, icc, AI 같은 유명 약어는 검색어로 유효할 수 있으므로 3글자까지만 차단
  if (/^[a-zA-Z]+$/.test(keyword) && keyword.length <= 3) return false;

  // '~의 눈물', '~의 X' 같은 기사 제목 패턴
  if (/의\s+(눈물|힘|곳|때|길|맛|꿈|말|법|손|집|끝|빛|밤|낮|봄|겨울|여름|가을)$/.test(keyword)) return false;

  // 한글 1글자 단독
  if (/^[\uac00-\ud7a3]$/.test(keyword)) return false;

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

// ========== Signal.bz 실시간 검색어 통합 ==========
async function crawlSignalBz() {
  try {
    logger.info('[크롤러] Signal.bz 실시간 검색어 크롤링 시작...');

    const keywords = [];
    const seen = new Set();

    // Signal.bz 여러 페이지에서 검색어 순위 수집
    const urls = ['https://signal.bz/', 'https://signal.bz/news'];

    for (const pageUrl of urls) {
      try {
        const response = await axios.get(pageUrl, {
          headers: { ...HEADERS, Referer: 'https://signal.bz/' },
          timeout: 15000,
        });

        const $ = cheerio.load(response.data);

        const selectors = [
          '.rank-text', '.keyword-text', 'a.rank-name',
          '.list-group-item', 'ol li a', '.home-rank a',
          '[class*="keyword"] a', '[class*="rank"] span',
          '[class*="trend"] a', 'td a',
        ];

        for (const selector of selectors) {
          $(selector).each((i, el) => {
            let text = $(el).text().trim()
              .replace(/^\d+\s*/, '')
              .replace(/\s*(new|up|down|same|NEW|▲|▼|━|-)\s*$/i, '')
              .replace(/\s+/g, ' ')
              .trim();
            if (text && text.length >= 2 && text.length <= 20 && !seen.has(text.toLowerCase())) {
              seen.add(text.toLowerCase());
              keywords.push({ keyword: text, source: 'signal', rank: keywords.length + 1 });
            }
          });
          if (keywords.length >= 10) break;
        }

        if (keywords.length >= 10) break;
      } catch (e) {
        logger.debug(`[크롤러] Signal.bz ${pageUrl} 실패: ${e.message}`);
      }
    }

    logger.info(`[크롤러] Signal.bz: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] Signal.bz 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== 모든 소스 크롤링 ==========
async function crawlAll() {
  logger.info('====== 전체 실시간 검색어 크롤링 시작 ======');
  logger.info('소스: Google Trends (일반+엔터), Zum, Nate, Signal.bz');
  logger.info('※ Naver/Daum 헤드라인 추출 크롤러 제거됨 (쓰레기 키워드 방지)');

  const results = await Promise.allSettled([
    crawlGoogleTrends(),
    crawlGoogleTrendsEntertainment(),
    crawlZum(),
    crawlNate(),
    crawlSignalBz(),
  ]);

  const allKeywords = [];
  const sources = ['Google Trends', 'Google Trends 엔터', 'Zum', 'Nate', 'Signal.bz'];

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
  crawlAll,
};
