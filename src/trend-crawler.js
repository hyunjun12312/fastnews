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

// ========== Google Trends 한국 ==========
async function crawlGoogleTrends() {
  try {
    logger.info('[크롤러] Google Trends 한국 크롤링 시작...');

    // Google Trends Daily Trends API (한국)
    const url = 'https://trends.google.co.kr/trends/trendingsearches/daily/rss?geo=KR';
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const keywords = [];

    $('item').each((i, el) => {
      const title = $(el).find('title').text().trim();
      if (title) {
        keywords.push({
          keyword: title,
          source: 'google_trends',
          rank: i + 1,
        });
      }
    });

    // Google Trends 실시간 (Realtime)
    try {
      const realtimeUrl = 'https://trends.google.co.kr/trending/rss?geo=KR';
      const rtResponse = await axios.get(realtimeUrl, {
        headers: HEADERS,
        timeout: 15000,
      });

      const $rt = cheerio.load(rtResponse.data, { xmlMode: true });
      $rt('item').each((i, el) => {
        const title = $rt(el).find('title').text().trim();
        if (title && !keywords.find(k => k.keyword === title)) {
          keywords.push({
            keyword: title,
            source: 'google_trends_realtime',
            rank: i + 1,
          });
        }
      });
    } catch (e) {
      logger.debug('[크롤러] Google Trends 실시간 보조 소스 실패 (무시)');
    }

    logger.info(`[크롤러] Google Trends: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] Google Trends 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== Naver 급상승 검색어 ==========
async function crawlNaverSignal() {
  try {
    logger.info('[크롤러] Naver Signal 크롤링 시작...');

    // 네이버 데이터랩 급상승 검색어
    const url = 'https://www.naver.com/';
    const response = await axios.get(url, {
      headers: {
        ...HEADERS,
        'Referer': 'https://www.naver.com/',
      },
      timeout: 15000,
    });

    const keywords = [];

    // 네이버 메인 실시간 검색어 파싱 시도
    const $ = cheerio.load(response.data);

    // 네이버 급상승 검색어 JSON API
    try {
      const apiUrl = 'https://www.naver.com/srchrank?frm=main&ag=all&gr=1&ma=-2&si=0&en=0&sp=0';
      const apiResponse = await axios.get(apiUrl, {
        headers: {
          ...HEADERS,
          'Referer': 'https://www.naver.com/',
        },
        timeout: 10000,
      });

      if (apiResponse.data && apiResponse.data.data) {
        apiResponse.data.data.forEach((item, i) => {
          if (item.keyword) {
            keywords.push({
              keyword: item.keyword,
              source: 'naver',
              rank: item.rank || i + 1,
            });
          }
        });
      }
    } catch (e) {
      logger.debug('[크롤러] Naver API 방식 실패, HTML 파싱 시도...');
    }

    // 네이버 쇼핑 인기 검색어도 시도
    try {
      const shopUrl = 'https://shopping.naver.com/';
      const shopResponse = await axios.get(shopUrl, {
        headers: HEADERS,
        timeout: 10000,
      });
      const $shop = cheerio.load(shopResponse.data);
      // 파싱 로직은 네이버 구조에 따라 달라짐
    } catch (e) {
      // 무시
    }

    logger.info(`[크롤러] Naver: ${keywords.length}개 키워드 수집`);
    return keywords;
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
        const text = $(el).text().trim().replace(/^\d+\s*/, '');
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

// ========== Nate 실시간 검색어 ==========
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

    const selectors = [
      '.kwd_list li a',
      '.keyword_area li a',
      '.realtime_list li a',
      '[class*="rank"] li a',
      '.lst_keyword a',
    ];

    for (const selector of selectors) {
      $(selector).each((i, el) => {
        const text = $(el).text().trim().replace(/^\d+\s*/, '');
        if (text && text.length > 1 && text.length < 30) {
          keywords.push({
            keyword: text,
            source: 'nate',
            rank: i + 1,
          });
        }
      });
      if (keywords.length > 0) break;
    }

    logger.info(`[크롤러] Nate: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] Nate 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== Google Trends API (비공식) ==========
async function crawlGoogleTrendsApi() {
  try {
    logger.info('[크롤러] Google Trends API 크롤링 시작...');

    // 실시간 트렌딩 검색
    const url = `https://trends.google.co.kr/trends/api/dailytrends?hl=ko&tz=-540&geo=KR&ns=15`;
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
    });

    const keywords = [];

    // Google Trends API는 ")]}'" 접두사를 붙임
    let jsonStr = response.data;
    if (typeof jsonStr === 'string' && jsonStr.startsWith(')]}')) {
      jsonStr = jsonStr.substring(jsonStr.indexOf('{'));
    }

    try {
      const data = JSON.parse(jsonStr);
      const days = data?.default?.trendingSearchesDays || [];

      for (const day of days) {
        for (const search of (day.trendingSearches || [])) {
          const title = search?.title?.query;
          if (title) {
            keywords.push({
              keyword: title,
              source: 'google_trends_api',
              rank: keywords.length + 1,
            });
          }

          // 관련 검색어도 추가
          for (const related of (search?.relatedQueries || [])) {
            if (related?.query && !keywords.find(k => k.keyword === related.query)) {
              keywords.push({
                keyword: related.query,
                source: 'google_trends_api_related',
                rank: keywords.length + 1,
              });
            }
          }
        }
      }
    } catch (parseErr) {
      logger.debug('[크롤러] Google Trends API JSON 파싱 실패');
    }

    logger.info(`[크롤러] Google Trends API: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] Google Trends API 크롤링 실패: ${error.message}`);
    return [];
  }
}

// ========== SIGNAL (시그널) 실시간 ==========
async function crawlSignal() {
  try {
    logger.info('[크롤러] Signal(시그널) 크롤링 시작...');

    const url = 'https://signal.bz/news';
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);
    const keywords = [];

    // Signal.bz 키워드 파싱
    const selectors = [
      '.rank-text',
      '.keyword-text',
      'a.rank-item',
      '.trending-keyword',
      'ol li a',
      '.list-group-item',
    ];

    for (const selector of selectors) {
      $(selector).each((i, el) => {
        const text = $(el).text().trim().replace(/^\d+[\.\s]*/, '');
        if (text && text.length > 1 && text.length < 30) {
          keywords.push({
            keyword: text,
            source: 'signal',
            rank: i + 1,
          });
        }
      });
      if (keywords.length > 0) break;
    }

    logger.info(`[크롤러] Signal: ${keywords.length}개 키워드 수집`);
    return keywords;
  } catch (error) {
    logger.error(`[크롤러] Signal 크롤링 실패: ${error.message}`);
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
  const sources = ['Google Trends RSS', 'Google Trends API', 'Naver', 'Zum', 'Nate', 'Signal'];

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
  for (const kw of allKeywords) {
    const normalized = kw.keyword.trim().toLowerCase();
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
