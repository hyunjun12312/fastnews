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

  // 4. 고유명사 패턴: 한글 2~4자 이름 (문맥에서 인명/지명 추출)
  const namePattern = /([가-힣]{2,4})(씨|측|이|가|은|는|의|을|를|와|과|도|만|에게|에서|부터|까지)/g;
  let nameMatch;
  while ((nameMatch = namePattern.exec(headline)) !== null) {
    const name = nameMatch[1];
    if (name.length >= 2 && name.length <= 4) {
      addIfGood(name);
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
  ]);

  const allKeywords = [];
  const sources = ['Google Trends RSS', 'Daum 이슈', 'Naver 뉴스', 'Zum', 'Nate', 'Naver 스포츠/추가'];

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
  crawlAll,
};
