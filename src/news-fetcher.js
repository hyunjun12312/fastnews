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
      const rawTitle = $(el).find('title').text().trim();
      // 제목에서 " - 출처" 분리
      const titleParts = rawTitle.match(/^(.+?)\s*-\s*([^-]+)$/);
      const title = titleParts ? titleParts[1].trim() : rawTitle;
      const sourceName = titleParts ? titleParts[2].trim() : '';

      // Google News RSS의 description에서 실제 기사 요약 추출
      const rawDesc = $(el).find('description').text().trim();
      const descHtml = cheerio.load(rawDesc);
      // description에 <a> 태그 안에 실제 링크가 있을 수 있음
      let actualLink = '';
      descHtml('a').each((_, a) => {
        const href = descHtml(a).attr('href');
        if (href && href.startsWith('http') && !href.includes('news.google.com')) {
          actualLink = href;
          return false;
        }
      });
      const description = descHtml.text().replace(/<[^>]*>/g, '').trim();

      // Google News RSS의 link는 리다이렉트 URL
      const googleLink = $(el).find('link').text().trim();

      articles.push({
        title,
        description,
        link: actualLink || googleLink,
        pubDate: $(el).find('pubDate').text().trim(),
        source: 'google_news',
        sourceName: sourceName || 'Google News',
      });
    });

    logger.info(`[뉴스] Google "${keyword}": ${articles.length}개 기사 수집`);
    return articles;
  } catch (error) {
    logger.error(`[뉴스] Google 뉴스 검색 실패 [${keyword}]: ${error.message}`);
    return [];
  }
}

// ========== Google News 리다이렉트 URL 실제 URL 변환 ==========
async function resolveGoogleNewsUrl(googleUrl) {
  if (!googleUrl || !googleUrl.includes('news.google.com')) return googleUrl;
  try {
    const response = await axios.get(googleUrl, {
      headers: HEADERS,
      timeout: 10000,
      maxRedirects: 10,
      validateStatus: (status) => status < 400,
    });
    // 최종 리다이렉트된 URL 반환
    const finalUrl = response.request?.res?.responseUrl || response.config?.url || googleUrl;
    if (finalUrl && !finalUrl.includes('news.google.com')) {
      return finalUrl;
    }
    // HTML에서 실제 URL 추출 시도
    if (response.data) {
      const $ = cheerio.load(response.data);
      const metaRefresh = $('meta[http-equiv="refresh"]').attr('content') || '';
      const urlMatch = metaRefresh.match(/url=(.+)/i);
      if (urlMatch) return urlMatch[1].trim();
      // data-redirect 속성 등
      const redirectLink = $('a[data-redirect]').attr('href') || $('c-wiz a').attr('href');
      if (redirectLink && redirectLink.startsWith('http')) return redirectLink;
    }
    return googleUrl;
  } catch (error) {
    logger.debug(`[뉴스] Google News URL 해석 실패: ${error.message}`);
    return googleUrl;
  }
}

// ========== 네이버 웹 검색으로 실제 뉴스 URL 확보 ==========
async function fetchNaverSearchNews(keyword, count = 5) {
  try {
    // 네이버 모바일 뉴스 검색 크롤링
    const url = `https://m.search.naver.com/search.naver?where=m_news&query=${encodeURIComponent(keyword)}&sort=1`;
    const response = await axios.get(url, {
      headers: {
        ...HEADERS,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const articles = [];

    // 뉴스 검색 결과 파싱
    $('.news_wrap, .bx, .news_area').each((i, el) => {
      if (i >= count) return false;
      const titleEl = $(el).find('.news_tit, .tit, a.title_link').first();
      const title = titleEl.text().trim();
      const link = titleEl.attr('href') || '';
      const desc = $(el).find('.news_dsc, .dsc_wrap, .api_txt_lines').first().text().trim();
      const source = $(el).find('.info_group .press, .sub_txt, .info.press').first().text().trim();

      if (title && link.startsWith('http')) {
        articles.push({
          title: title.replace(/<[^>]*>/g, ''),
          description: desc.replace(/<[^>]*>/g, ''),
          link,
          pubDate: '',
          source: 'naver_search',
          sourceName: source || '네이버 뉴스',
        });
      }
    });

    if (articles.length > 0) {
      logger.info(`[뉴스] 네이버 웹검색 "${keyword}": ${articles.length}개 기사 수집`);
    }
    return articles;
  } catch (error) {
    logger.debug(`[뉴스] 네이버 웹검색 실패 [${keyword}]: ${error.message}`);
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
    $('meta[name="twitter:image:src"]').attr('content'),
    $('meta[name="thumbnail"]').attr('content'),
    $('meta[itemprop="image"]').attr('content'),
    $('link[rel="image_src"]').attr('href'),
  ];

  // 본문 내 큰 이미지 탐색 (더 다양한 셀렉터)
  const articleImgSelectors = [
    '#articleBodyContents img', '#newsct_article img',
    '#dic_area img', '#articeBody img',
    '.article_body img', '.article-body img',
    '.news_end img', '.view_cont img',
    '.article_txt img', '#content_body img',
    'article img', '[itemprop="articleBody"] img',
    '.news_body img', '.post-content img',
    '#newsEndContents img', '.article_view img',
    '.detail_body img', '#news_body img',
  ];

  for (const sel of articleImgSelectors) {
    $(sel).each((i, el) => {
      const src = $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || $(el).attr('src');
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
    if (img.includes('btn_') || img.includes('button') || img.includes('banner_ad')) continue;
    // base64 데이터 URI 스킵
    if (img.startsWith('data:')) continue;
    // Google lh3 이미지 → 고해상도로 변환
    if (img.includes('lh3.googleusercontent.com') || img.includes('lh4.googleusercontent.com') || img.includes('lh5.googleusercontent.com')) {
      img = img.replace(/=s\d+-w\d+(-rw)?/, '=s800-w800').replace(/=w\d+(-h\d+)?(-[a-z]+)*/, '=w800');
    }
    // 네이버 이미지 → 고해상도로 변환
    if (img.includes('imgnews.pstatic.net') || img.includes('mimgnews.pstatic.net')) {
      img = img.replace(/\/dimthumbnail\/\d+x\d+_\d+_\d+\//, '/').replace(/\?type=\w+/, '?type=w800');
    }
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

  // 네이버 API + Google RSS + 네이버 웹검색 병렬 수집
  const [naverResults, googleResults, naverSearchResults] = await Promise.allSettled([
    fetchNaverNews(keyword, maxArticles),
    fetchGoogleNews(keyword, maxArticles),
    fetchNaverSearchNews(keyword, maxArticles),
  ]);

  let allArticles = [];

  if (naverResults.status === 'fulfilled') {
    allArticles.push(...naverResults.value);
  }
  // 네이버 웹검색 결과 (실제 URL이 있어서 본문 크롤링 성공률 높음)
  if (naverSearchResults.status === 'fulfilled') {
    allArticles.push(...naverSearchResults.value);
  }
  if (googleResults.status === 'fulfilled') {
    allArticles.push(...googleResults.value);
  }

  // 중복 제거 (제목 유사도)
  const uniqueArticles = [];
  const seenTitles = new Set();
  for (const article of allArticles) {
    const normalizedTitle = article.title.replace(/\s+/g, '').replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase();
    // 앞 15자로 유사 제목도 중복 처리
    const shortTitle = normalizedTitle.substring(0, 15);
    if (!seenTitles.has(normalizedTitle) && !seenTitles.has(shortTitle)) {
      seenTitles.add(normalizedTitle);
      seenTitles.add(shortTitle);
      uniqueArticles.push(article);
    }
  }

  // Google News 리다이렉트 URL 해석 (실제 URL이 아닌 경우만)
  for (const article of uniqueArticles) {
    if (article.link && article.link.includes('news.google.com')) {
      article.link = await resolveGoogleNewsUrl(article.link);
    }
  }

  // 상위 기사의 본문 + 이미지 수집 (최대 5개, 병렬)
  const topArticles = uniqueArticles.slice(0, 5);
  const contentPromises = topArticles.map(async (article) => {
    if (article.link && !article.link.includes('news.google.com')) {
      const result = await fetchArticleContent(article.link);
      if (typeof result === 'object') {
        article.fullContent = result.content;
        article.image = result.image || '';
      } else {
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
  fetchNaverSearchNews,
  fetchArticleContent,
  fetchNewsForKeyword,
};
