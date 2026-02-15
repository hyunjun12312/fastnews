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

// ========== 이미지 URL 추출 ==========
function extractImage($, url) {
  // 우선순위: og:image > twitter:image > meta image > 본문 내 이미지
  const candidates = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[property="og:image:url"]').attr('content'),
    $('meta[name="thumbnail"]').attr('content'),
    $('meta[itemprop="image"]').attr('content'),
  ];

  // 본문 내 큰 이미지 탐색
  const articleImgSelectors = [
    '#articleBodyContents img', '#newsct_article img',
    '.article_body img', '.article-body img',
    'article img', '[itemprop="articleBody"] img',
    '.news_body img', '.view_cont img',
  ];

  for (const sel of articleImgSelectors) {
    $(sel).each((i, el) => {
      const src = $(el).attr('data-src') || $(el).attr('src');
      if (src) candidates.push(src);
    });
  }

  for (let img of candidates) {
    if (!img) continue;
    img = img.trim();
    // 상대 경로 → 절대 경로
    if (img.startsWith('//')) img = 'https:' + img;
    else if (img.startsWith('/')) {
      try {
        const u = new URL(url);
        img = u.origin + img;
      } catch { continue; }
    }
    // 너무 작은 아이콘/로고 필터링
    if (img.includes('logo') || img.includes('icon') || img.includes('favicon')) continue;
    if (img.includes('1x1') || img.includes('pixel') || img.includes('blank')) continue;
    // 유효한 이미지 URL인지 확인
    if (img.startsWith('http') && /\.(jpg|jpeg|png|webp|gif)/i.test(img) || img.includes('image') || img.includes('img') || img.includes('photo')) {
      return img;
    }
    // og:image는 확장자 없을 수도 있으므로 http이면 수용
    if (img.startsWith('http')) return img;
  }

  return '';
}

// ========== 기사 본문 + 이미지 크롤링 ==========
async function fetchArticleContent(url) {
  try {
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);

    // 이미지 추출
    const image = extractImage($, url);

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
        el.find('script, style, .ad, .advertisement, .banner, iframe, .social-share').remove();
        content = el.text().trim();
        if (content.length > 100) break;
      }
    }

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

    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    if (content.length > 5000) {
      let truncated = content.substring(0, 5000);
      const lastPeriod = truncated.lastIndexOf('다.');
      if (lastPeriod > 3000) {
        truncated = truncated.substring(0, lastPeriod + 2);
      }
      content = truncated;
    }

    return { content, image };
  } catch (error) {
    logger.debug(`[뉴스] 기사 본문 크롤링 실패 [${url}]: ${error.message}`);
    return { content: '', image: '' };
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

  // 상위 기사의 본문 + 이미지 수집 (최대 5개, 병렬)
  const topArticles = uniqueArticles.slice(0, 5);
  const contentPromises = topArticles.map(async (article) => {
    if (article.link) {
      const result = await fetchArticleContent(article.link);
      if (typeof result === 'object') {
        article.fullContent = result.content;
        article.image = result.image || '';
      } else {
        // 하위 호환 (문자열 반환)
        article.fullContent = result;
        article.image = '';
      }
    }
    return article;
  });
  await Promise.allSettled(contentPromises);

  // 대표 이미지: 가장 먼저 이미지가 있는 기사에서 추출
  const representativeImage = topArticles.find(a => a.image)?.image || '';

  logger.info(`[뉴스] "${keyword}": 총 ${uniqueArticles.length}개 기사 수집 (본문 ${topArticles.filter(a => a.fullContent).length}개, 이미지 ${topArticles.filter(a => a.image).length}개)`);

  return {
    keyword,
    articles: uniqueArticles,
    topArticlesWithContent: topArticles,
    totalCount: uniqueArticles.length,
    representativeImage,
  };
}

module.exports = {
  fetchNaverNews,
  fetchGoogleNews,
  fetchArticleContent,
  fetchNewsForKeyword,
};
