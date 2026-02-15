// ============================================
// trend-crawler.js - 실시간 검색어 크롤러
// ============================================
// 다중 소스에서 한국 실시간 트렌드 키워드 수집
// - Google Trends (한국)
// - Naver 실시간 검색어 (DataLab API)
// - Zum 실시간 검색어
// - Nate 실시간 검색어
// - Signal 실시간 검색어
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
// 실시간 검색어로 부적합한 일반적인 한국어 단어
const KEYWORD_STOPWORDS = new Set([
  // 일반 동사/형용사 어근 (2글자) — 뉴스 어디에나 나오는 단어
  '지지', '반대', '충격', '투사', '어린', '확인', '공개', '발표', '논란', '화제',
  '대응', '조사', '검토', '예상', '전망', '우려', '비판', '의혹', '진행', '예정',
  '결정', '승인', '거부', '요구', '주장', '강조', '보도', '문제', '상황', '사건',
  '피해', '영향', '결과', '이유', '원인', '가능', '필요', '심각', '중요', '관련',
  '해당', '감봉', '정당', '취소', '실패', '강화', '완화', '유지', '시작', '종료',
  '중단', '재개', '연기', '축소', '확대', '수정', '삭제', '생성', '복구', '지적',
  '발견', '등장', '출연', '방문', '참석', '참여', '지원', '제공', '소개', '언급',
  '우승', '패배', '승리', '도전', '경쟁', '대결', '선발', '교체', '투입', '합류',
  // 일반 부사/관형/대명사
  '많이', '매우', '정말', '진짜', '너무', '거의', '계속', '다시', '모두', '역시',
  '아직', '이미', '바로', '무슨', '어떤', '이런', '그런', '무려', '겨우', '드디어',
  // 시간 표현
  '오늘', '내일', '어제', '올해', '지난', '다음', '이번', '최근', '현재',
  // 뉴스 수식어/설명어
  '무소속', '소속', '돌연', '결국', '사실', '실제', '과연', '역대', '최초', '최대',
  '최소', '최고', '최저', '긴급', '속보', '단독', '특종', '대형', '초대형',
  '전격', '파격', '깜짝', '초유', '이례', '잇따', '연이',
  // 방향/위치
  '국내', '국외', '해외', '전국', '전역', '일대', '인근', '주변',
]);

// 한국 성씨 목록 (인명 추출 정확도 향상)
const KOREAN_FAMILY_NAMES = new Set([
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
  '한', '오', '서', '신', '권', '황', '안', '송', '류', '전',
  '홍', '고', '문', '양', '손', '배', '백', '허', '유', '남',
  '심', '노', '하', '곽', '성', '차', '주', '우', '구', '민',
  '진', '나', '변', '채', '원', '천', '방', '공', '현', '함',
  '여', '추', '도', '소', '석', '선', '설', '마', '길', '연',
  '탁', '표', '명', '기', '반', '피', '왕', '금', '옥', '육',
  '인', '맹', '제', '모', '남궁', '사공', '황보', '제갈', '선우',
]);

// 키워드 품질 검증
function isGoodKeyword(keyword) {
  if (!keyword || keyword.length < 2) return false;

  // 불용어 체크
  if (KEYWORD_STOPWORDS.has(keyword)) return false;

  const words = keyword.split(/\s+/);

  // 3단어 이상 → 문장/구절 → 부적합
  if (words.length >= 3) return false;

  // 2단어: 불용어가 포함되면 부적합 ("투사 배현진", "무소속 한동훈")
  if (words.length === 2) {
    if (words.some(w => KEYWORD_STOPWORDS.has(w))) return false;
  }

  // 동사/형용사 어미로 끝나는 구/절 → 검색어가 아님
  if (/(?:합니다|했다|한다|된다|있다|없다|하다|되다|않다|봤다|됐다|싶다|맞아|좋아해|싫어해|몰라|있어|없어|했어|됐어|봤어|해요|돼요|할까|는데|인데|거든|라고|다는|라는|거야|해야|네요|ㄴ다|ㄹ까)$/.test(keyword)) return false;

  // 숫자만
  if (/^\d+$/.test(keyword)) return false;

  return true;
}

// ========== 헤드라인에서 핵심 키워드 추출 ==========
// 긴 기사 제목 → 짧은 검색 키워드로 변환
function extractKeywordsFromHeadline(headline) {
  if (!headline || headline.length < 3) return [];
  
  const results = [];
  const seen = new Set();
  
  const addIfGood = (text) => {
    if (!text) return;
    text = text.trim().replace(/[…·\-~!?.,:;'"''""「」\[\]]/g, '').trim();
    // 공백이 2개 이상이면 문장이므로 건너뛰기 (키워드는 보통 1단어~2단어)
    const spaceCount = (text.match(/\s/g) || []).length;
    if (spaceCount > 1) return;
    if (text.length >= 2 && text.length <= 8 && !seen.has(text)) {
      seen.add(text);
      results.push(text);
    }
  };

  // 1. 따옴표/괄호 안 텍스트 추출: '홍대가이', "이재명"
  const quotePatterns = [
    /['']([^'']+)['']/g,
    /[""]([^""]+)["\"]/g,
    /"([^"]+)"/g,
    /「([^」]+)」/g,
  ];
  for (const pattern of quotePatterns) {
    let match;
    while ((match = pattern.exec(headline)) !== null) {
      addIfGood(match[1]);
    }
  }

  // 2. 헤드라인 자체가 짧으면 그대로 사용 (≤ 8자)
  const cleanHeadline = headline.replace(/[''"""\[\]「」]/g, '').trim();
  if (cleanHeadline.length <= 8 && cleanHeadline.length >= 2) {
    addIfGood(cleanHeadline);
  }

  // 3. 쉼표/구두점으로 분리 후 짧은 조각만 추출 (≤ 8자)
  const parts = headline.split(/[,…·\-~]+/)
    .map(p => p.trim().replace(/[''"""\[\]「」!?.]/g, '').trim())
    .filter(p => p.length >= 2 && p.length <= 8);
  for (const part of parts) {
    addIfGood(part);
  }

  // 4. 인명 패턴: 한국 성씨로 시작하는 이름만 추출 (정확도 향상)
  const namePattern = /([가-힣])([가-힣]{1,3})(씨|측|이|가|은|는|의|을|를|와|과|도|만|에게|에서|부터|까지)/g;
  let nameMatch;
  while ((nameMatch = namePattern.exec(headline)) !== null) {
    const familyName = nameMatch[1];
    const fullName = nameMatch[1] + nameMatch[2];
    // 성씨 목록에 있는 경우에만 인명으로 추출
    if (KOREAN_FAMILY_NAMES.has(familyName) && fullName.length >= 2 && fullName.length <= 4) {
      addIfGood(fullName);
    }
  }

  return results;
}

// 긴 키워드인지 판별 (헤드라인 수준)
function isHeadline(text) {
  return text.length > 12;
}

// ========== Google Trends 한국 ==========
async function crawlGoogleTrends() {
  try {
    logger.info('[크롤러] Google Trends 한국 크롤링 시작...');

    // Google Trends RSS (2024+ 신규 URL)
    const url = 'https://trends.google.com/trending/rss?geo=KR';
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const keywords = [];

    $('item').each((i, el) => {
      const title = $(el).find('title').text().trim();
      if (title && title.length > 1) {
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

// ========== Naver 뉴스 헤드라인 → 핵심 키워드 추출 ==========
async function crawlNaverSignal() {
  try {
    logger.info('[크롤러] Naver 뉴스 키워드 크롤링 시작...');

    const keywords = [];
    const seen = new Set();

    const addKeyword = (kw, source) => {
      const normalized = kw.toLowerCase().trim();
      if (normalized.length >= 2 && normalized.length <= 12 && !seen.has(normalized)) {
        seen.add(normalized);
        keywords.push({ keyword: kw.trim(), source, rank: keywords.length + 1 });
      }
    };

    // 1. 네이버 뉴스 메인 헤드라인에서 핵심 키워드 추출
    try {
      const response = await axios.get('https://news.naver.com/', {
        headers: { ...HEADERS, Referer: 'https://www.naver.com/' },
        timeout: 10000,
      });
      const $ = cheerio.load(response.data);

      $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if ((href.includes('/article/') || href.includes('news.naver.com')) && text.length > 5 && text.length < 60) {
          const title = text.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
          // 짧으면 그대로, 길면 핵심 키워드 추출
          if (title.length <= 12 && title.length >= 2) {
            addKeyword(title, 'naver_news');
          } else if (title.length > 12) {
            const extracted = extractKeywordsFromHeadline(title);
            for (const kw of extracted) {
              addKeyword(kw, 'naver_news');
            }
          }
        }
      });
    } catch (e) {
      logger.debug('[크롤러] Naver 뉴스 헤드라인 실패: ' + e.message);
    }

    // 2. 네이버 연예 뉴스 헤드라인
    try {
      const response = await axios.get('https://entertain.naver.com/home', {
        headers: { ...HEADERS, Referer: 'https://www.naver.com/' },
        timeout: 10000,
      });
      const $ = cheerio.load(response.data);

      $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if ((href.includes('/article/') || href.includes('/read/')) && text.length > 5 && text.length < 60) {
          const title = text.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
          if (title.length <= 12 && title.length >= 2) {
            addKeyword(title, 'naver_entertain');
          } else if (title.length > 12) {
            const extracted = extractKeywordsFromHeadline(title);
            for (const kw of extracted) {
              addKeyword(kw, 'naver_entertain');
            }
          }
        }
      });
    } catch (e) {
      logger.debug('[크롤러] Naver 연예 뉴스 실패: ' + e.message);
    }

    // 상위 15개만 사용
    const result = keywords.slice(0, 15);
    logger.info(`[크롤러] Naver: ${result.length}개 키워드 수집`);
    return result;
  } catch (error) {
    logger.error(`[크롤러] Naver 크롤링 실패: ${error.message}`);
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

    // Zum 실시간 인기 검색어 영역 파싱
    // 여러 셀렉터 시도
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
        if (text && text.length > 1 && text.length < 30) {
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

    // 1순위: Nate 이슈 키워드 (span.txt_rank)
    $('span.txt_rank').each((i, el) => {
      let text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 30 && !seen.has(text)) {
        seen.add(text);
        keywords.push({ keyword: text, source: 'nate', rank: i + 1 });
      }
    });

    // 2순위: isKeywordList 링크
    if (keywords.length === 0) {
      $('ol.isKeywordList li a, .isKeyword a').each((i, el) => {
        let text = $(el).text().trim()
          .replace(/^\d+\s*/, '')
          .replace(/\s*(동일|new|상승|하강)\s*$/i, '')
          .trim();
        if (text && text.length > 1 && text.length < 30 && !seen.has(text)) {
          seen.add(text);
          keywords.push({ keyword: text, source: 'nate', rank: i + 1 });
        }
      });
    }

    // 3순위: 기존 폴백 셀렉터
    if (keywords.length === 0) {
      const selectors = [
        '.kwd_list li a',
        '.keyword_area li a',
        '.realtime_list li a',
        '[class*="rank"] li a',
      ];
      for (const selector of selectors) {
        $(selector).each((i, el) => {
          let text = $(el).text().trim().replace(/^\d+\s*/, '').replace(/\s+\d+$/, '').trim();
          if (text && text.length > 1 && text.length < 30 && !seen.has(text)) {
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

// ========== Daum 이슈 키워드 ==========
async function crawlGoogleTrendsApi() {
  try {
    logger.info('[크롤러] Daum 이슈 키워드 크롤링 시작...');

    const response = await axios.get('https://www.daum.net/', {
      headers: HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);
    const keywords = [];
    const seen = new Set();

    const addKeyword = (kw, source) => {
      const normalized = kw.toLowerCase().trim();
      if (normalized.length >= 2 && normalized.length <= 12 && !seen.has(normalized)) {
        seen.add(normalized);
        keywords.push({ keyword: kw.trim(), source, rank: keywords.length + 1 });
      }
    };

    // 1순위: Daum 이슈/랭킹 영역 (짧은 검색어)
    $('[class*="issue"] a, [class*="popular"] a, [class*="hot"] a, [class*="rank"] a').each((i, el) => {
      const text = $(el).text().trim();
      if (text.length >= 2 && text.length <= 12) {
        addKeyword(text, 'daum');
      }
    });

    // 2순위: 뉴스 헤드라인에서 핵심 키워드 추출 (전체 제목 X)
    if (keywords.length < 5) {
      $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if ((href.includes('v.daum.net') || href.includes('news.') || href.includes('/v/')) &&
            text.length > 5 && text.length < 60) {
          const title = text.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
          if (title.length <= 12 && title.length >= 2) {
            addKeyword(title, 'daum');
          } else if (title.length > 12) {
            const extracted = extractKeywordsFromHeadline(title);
            for (const kw of extracted) {
              addKeyword(kw, 'daum');
            }
          }
        }
      });
    }

    const result = keywords.slice(0, 15);
    logger.info(`[크롤러] Daum: ${result.length}개 키워드 수집`);
    return result;
  } catch (error) {
    logger.error(`[크롤러] Daum 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== Naver 스포츠/연예 핫이슈 ==========
async function crawlSignal() {
  try {
    logger.info('[크롤러] Naver 스포츠 핫이슈 크롤링 시작...');

    const keywords = [];
    const seen = new Set();

    const addKeyword = (kw, source) => {
      const normalized = kw.toLowerCase().trim();
      if (normalized.length >= 2 && normalized.length <= 12 && !seen.has(normalized)) {
        seen.add(normalized);
        keywords.push({ keyword: kw.trim(), source, rank: keywords.length + 1 });
      }
    };

    // 1. 네이버 스포츠 뉴스 헤드라인 → 핵심 키워드 추출
    try {
      const response = await axios.get('https://sports.naver.com/', {
        headers: HEADERS,
        timeout: 10000,
      });
      const $ = cheerio.load(response.data);

      $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if ((href.includes('/article/') || href.includes('/news/')) &&
            text.length > 5 && text.length < 60) {
          const title = text.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
          if (title.length <= 12 && title.length >= 2) {
            addKeyword(title, 'naver_sports');
          } else if (title.length > 12) {
            const extracted = extractKeywordsFromHeadline(title);
            for (const kw of extracted) {
              addKeyword(kw, 'naver_sports');
            }
          }
        }
      });
    } catch (e) {
      logger.debug('[크롤러] Naver 스포츠 실패: ' + e.message);
    }

    // 2. Google Trends 엔터테인먼트 카테고리 (이미 짧은 키워드)
    try {
      const response = await axios.get('https://trends.google.com/trending/rss?geo=KR&category=e', {
        headers: HEADERS,
        timeout: 10000,
      });
      const $ = cheerio.load(response.data, { xmlMode: true });
      $('item').each((i, el) => {
        const title = $(el).find('title').text().trim();
        if (title && title.length > 1) {
          addKeyword(title, 'google_trends_ent');
        }
      });
    } catch (e) {
      logger.debug('[크롤러] Google Trends 엔터 실패: ' + e.message);
    }

    const result = keywords.slice(0, 15);
    logger.info(`[크롤러] Naver 스포츠/추가: ${result.length}개 키워드 수집`);
    return result;
  } catch (error) {
    logger.error(`[크롤러] Naver 스포츠 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== Signal.bz 실시간 검색어 (검색어 통합 순위 사이트) ==========
async function crawlSignalBz() {
  try {
    logger.info('[크롤러] Signal.bz 실시간 검색어 크롤링 시작...');

    const response = await axios.get('https://signal.bz/news', {
      headers: {
        ...HEADERS,
        Referer: 'https://signal.bz/',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);
    const keywords = [];
    const seen = new Set();

    // Signal.bz 검색어 순위 목록 (여러 셀렉터 시도)
    const selectors = [
      '.rank-text',
      '.keyword-text',
      'a.rank-name',
      '.list-group-item',
      'ol li a',
      'ul li a',
      '.home-rank a',
      '[class*="keyword"] a',
      '[class*="rank"] span',
      '[class*="trend"] a',
    ];

    for (const selector of selectors) {
      $(selector).each((i, el) => {
        let text = $(el).text().trim()
          .replace(/^\d+\s*/, '')        // 앞 순위 번호 제거
          .replace(/\s*(new|up|down|same|NEW|▲|▼|━)\s*$/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (text && text.length >= 2 && text.length <= 20 && !seen.has(text.toLowerCase())) {
          seen.add(text.toLowerCase());
          keywords.push({ keyword: text, source: 'signal', rank: i + 1 });
        }
      });
      if (keywords.length >= 5) break;
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

  const results = await Promise.allSettled([
    crawlGoogleTrends(),
    crawlGoogleTrendsApi(),
    crawlNaverSignal(),
    crawlZum(),
    crawlNate(),
    crawlSignal(),
    crawlSignalBz(),
  ]);

  const allKeywords = [];
  const sources = ['Google Trends RSS', 'Daum 이슈', 'Naver 뉴스', 'Zum', 'Nate', 'Naver 스포츠/추가', 'Signal.bz'];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allKeywords.push(...result.value);
      logger.info(`  ✓ ${sources[index]}: ${result.value.length}개`);
    } else {
      logger.warn(`  ✗ ${sources[index]}: 실패`);
    }
  });

  // 중복 제거 (키워드 기준)
  const uniqueMap = new Map();

  // 네비게이션/잡음 키워드 블랙리스트
  const BLACKLIST = new Set([
    '정정보도 모음', '전체 언론사', '오피니언', '사설', '칼럼', '포토',
    '랭킹뉴스', '많이 본 뉴스', '최신뉴스', '더보기', '뉴스홈',
    '연예', '스포츠', '경제', '사회', '정치', '세계', '문화',
    'IT/과학', '생활', '해당 언론사로 이동합니다',
  ]);

  for (const kw of allKeywords) {
    // 키워드 정제: 앞뒤 공백, 뒤에 붙은 불필요한 숫자 제거 (댓글수/순위 등)
    let cleaned = kw.keyword.trim()
      .replace(/\s+\d+$/, '')     // 끝에 " 숫자" 제거 (예: "캐나다 방송 오류 9")
      .replace(/\s+/g, ' ')       // 다중 공백 → 단일 공백
      .trim();
    
    if (!cleaned || cleaned.length < 2) continue;
    if (BLACKLIST.has(cleaned)) continue;
    // 너무 짧은 (1글자)이나 너무 긴 (뉴스 전체 제목)은 제외
    if (cleaned.length > 20) continue;
    // 키워드 품질 검증 (일반 단어, 문장 조각 제거)
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
  crawlGoogleTrendsApi,
  crawlNaverSignal,
  crawlZum,
  crawlNate,
  crawlSignal,
  crawlSignalBz,
  crawlAll,
};
