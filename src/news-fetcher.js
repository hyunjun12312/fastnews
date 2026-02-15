// ============================================
// news-fetcher.js - 뉴스 기사 수집 모듈
// ============================================
// 키워드 기반으로 관련 뉴스 기사를 수집하여
// AI 기사 생성의 소스로 활용
// ============================================

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');
const logger = require('./logger');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// ========== 네이버 뉴스 검색 API ==========
async function fetchNaverNews(keyword, count = 5) {
  try {
    if (!config.naver.clientId || !config.naver.clientSecret) {
      logger.debug('[뉴스] 네이버 API 키 미설정, 스킵');
      return [];
    }

    const response = await axios.get('https://openapi.naver.com/v1/search/news.json', {
      params: {
        query: keyword,
        display: count,
        sort: 'date', // 최신순
      },
      headers: {
        'X-Naver-Client-Id': config.naver.clientId,
        'X-Naver-Client-Secret': config.naver.clientSecret,
      },
      timeout: 10000,
    });

    const articles = (response.data.items || []).map(item => ({
      title: item.title.replace(/<[^>]*>/g, ''),
      description: item.description.replace(/<[^>]*>/g, ''),
      link: item.originallink || item.link,
      pubDate: item.pubDate,
      source: 'naver_news',
    }));

    logger.info(`[뉴스] 네이버 "${keyword}": ${articles.length}개 기사 수집`);
    return articles;
  } catch (error) {
    logger.error(`[뉴스] 네이버 뉴스 검색 실패 [${keyword}]: ${error.message}`);
    return [];
  }
}

// ========== Google 뉴스 검색 (크롤링) ==========
async function fetchGoogleNews(keyword, count = 5) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const articles = [];

    $('item').each((i, el) => {
      if (i >= count) return false;
      articles.push({
        title: $(el).find('title').text().trim(),
        description: $(el).find('description').text().trim().replace(/<[^>]*>/g, ''),
        link: $(el).find('link').text().trim(),
        pubDate: $(el).find('pubDate').text().trim(),
        source: 'google_news',
      });
    });

    logger.info(`[뉴스] Google "${keyword}": ${articles.length}개 기사 수집`);
    return articles;
  } catch (error) {
    logger.error(`[뉴스] Google 뉴스 검색 실패 [${keyword}]: ${error.message}`);
    return [];
  }
}

// ========== 기사 본문 크롤링 ==========
async function fetchArticleContent(url) {
  try {
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);

    // 일반적인 뉴스 사이트의 기사 본문 셀렉터들
    const contentSelectors = [
      '#articleBodyContents',     // 네이버 뉴스
      '#articeBody',              // 네이버 뉴스 (스포츠)
      '.article_body',            // 다양한 뉴스 사이트
      '#article-body',
      '.news_end',                // 네이버 뉴스
      '#newsct_article',          // 네이버 뉴스 (신형)
      '.article-body',
      '.article_txt',
      '#content_body',
      '.view_cont',
      '.news_body',
      'article',
      '.entry-content',
      '[itemprop="articleBody"]',
      '.post-content',
      '#content',
    ];

    let content = '';

    for (const selector of contentSelectors) {
      const el = $(selector);
      if (el.length > 0) {
        // 스크립트, 스타일, 광고 제거
        el.find('script, style, .ad, .advertisement, .banner, iframe, .social-share').remove();
        content = el.text().trim();
        if (content.length > 100) break;
      }
    }

    // 본문이 짧으면 p 태그에서 수집
    if (content.length < 100) {
      const paragraphs = [];
      $('p').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 20) {
          paragraphs.push(text);
        }
      });
      content = paragraphs.join('\n\n');
    }

    // 불필요한 공백/줄바꿈 정리
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    // 최대 5000자로 제한 (AI에게 더 풍부한 컨텍스트 제공)
    if (content.length > 5000) {
      // 마지막 완전한 문장까지만 자르기
      let truncated = content.substring(0, 5000);
      const lastPeriod = truncated.lastIndexOf('다.');
      if (lastPeriod > 3000) {
        truncated = truncated.substring(0, lastPeriod + 2);
      }
      content = truncated;
    }

    return content;
  } catch (error) {
    logger.debug(`[뉴스] 기사 본문 크롤링 실패 [${url}]: ${error.message}`);
    return '';
  }
}

// ========== 키워드로 뉴스 종합 수집 ==========
async function fetchNewsForKeyword(keyword, maxArticles = 5) {
  logger.info(`[뉴스] "${keyword}" 관련 뉴스 수집 시작...`);

  // 네이버 + Google 병렬 수집
  const [naverResults, googleResults] = await Promise.allSettled([
    fetchNaverNews(keyword, maxArticles),
    fetchGoogleNews(keyword, maxArticles),
  ]);

  let allArticles = [];

  if (naverResults.status === 'fulfilled') {
    allArticles.push(...naverResults.value);
  }
  if (googleResults.status === 'fulfilled') {
    allArticles.push(...googleResults.value);
  }

  // 중복 제거 (제목 유사도)
  const uniqueArticles = [];
  const seenTitles = new Set();
  for (const article of allArticles) {
    const normalizedTitle = article.title.replace(/\s+/g, '').toLowerCase();
    if (!seenTitles.has(normalizedTitle)) {
      seenTitles.add(normalizedTitle);
      uniqueArticles.push(article);
    }
  }

  // 상위 기사의 본문 가져오기 (최대 5개로 확대 - 기사 품질 향상)
  const topArticles = uniqueArticles.slice(0, 5);
  const contentPromises = topArticles.map(async (article) => {
    if (article.link) {
      article.fullContent = await fetchArticleContent(article.link);
    }
    return article;
  });
  await Promise.allSettled(contentPromises);

  logger.info(`[뉴스] "${keyword}": 총 ${uniqueArticles.length}개 기사 수집 (본문 ${topArticles.filter(a => a.fullContent).length}개)`);

  return {
    keyword,
    articles: uniqueArticles,
    topArticlesWithContent: topArticles,
    totalCount: uniqueArticles.length,
  };
}

module.exports = {
  fetchNaverNews,
  fetchGoogleNews,
  fetchArticleContent,
  fetchNewsForKeyword,
};
