// ============================================
// news-fetcher.js - 뉴스 기사 수집 모듈
// ============================================
// 키워드 기반으로 관련 뉴스 기사를 수집하여
// AI 기사 생성의 소스로 활용
// ============================================

const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const config = require('./config');
const logger = require('./logger');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

let naverApiDisabled = false;

function detectCharset(contentType = '', htmlPreview = '') {
  const fromHeader = String(contentType).match(/charset\s*=\s*([^;\s]+)/i)?.[1];
  const fromMeta = String(htmlPreview).match(/<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i)?.[1]
    || String(htmlPreview).match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([^"'\s;>]+)/i)?.[1];

  const raw = (fromHeader || fromMeta || 'utf-8').trim().toLowerCase();

  if (raw === 'euc-kr' || raw === 'ks_c_5601-1987' || raw === 'x-windows-949') return 'cp949';
  if (raw === 'utf8') return 'utf-8';
  return raw;
}

function decodeHtmlResponse(response) {
  const data = response?.data;
  if (!Buffer.isBuffer(data)) return typeof data === 'string' ? data : String(data || '');

  const contentType = response?.headers?.['content-type'] || '';
  const preview = data.toString('ascii', 0, Math.min(data.length, 4096));
  const charset = detectCharset(contentType, preview);

  try {
    return iconv.decode(data, charset);
  } catch (_) {
    return data.toString('utf8');
  }
}

// ========== 네이버 뉴스 검색 API ==========
async function fetchNaverNews(keyword, count = 5) {
  try {
    if (naverApiDisabled) return [];

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
    if (error?.response?.status === 401) {
      naverApiDisabled = true;
      logger.warn('[뉴스] 네이버 API 인증 실패(401)로 이번 실행에서 네이버 API 수집을 비활성화합니다. 환경변수 NAVER_CLIENT_ID/NAVER_CLIENT_SECRET 확인 필요');
      return [];
    }
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

      // Google News RSS의 description에서 실제 기사 요약 + 이미지 추출
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
      // description HTML에서 이미지 추출
      let descImage = '';
      descHtml('img').each((_, img) => {
        const src = descHtml(img).attr('src');
        if (src && src.startsWith('http') && !descImage) {
          descImage = src;
        }
      });
      const description = descHtml.text().replace(/<[^>]*>/g, '').trim();

      // media:content, enclosure 태그에서 이미지 추출
      let mediaImage = '';
      const mediaContent = $(el).find('media\\:content, content').attr('url') || '';
      const enclosure = $(el).find('enclosure').attr('url') || '';
      const mediaThumbnail = $(el).find('media\\:thumbnail, thumbnail').attr('url') || '';
      mediaImage = mediaContent || enclosure || mediaThumbnail || descImage || '';

      // Google News RSS의 link는 리다이렉트 URL
      const googleLink = $(el).find('link').text().trim();

      articles.push({
        title,
        description,
        link: actualLink || googleLink,
        pubDate: $(el).find('pubDate').text().trim(),
        source: 'google_news',
        sourceName: sourceName || 'Google News',
        image: mediaImage,
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
      responseType: 'arraybuffer',
    });

    const html = decodeHtmlResponse(response);
    const $ = cheerio.load(html);
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
      responseType: 'arraybuffer',
    });

    const html = decodeHtmlResponse(response);
    const $ = cheerio.load(html);

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

  // 대표 이미지 선택: 키워드와 가장 관련 있는 이미지를 우선 선택
  let representativeImage = selectBestImage(topArticles, uniqueArticles, keyword);

  // 뉴스 기사에서 이미지를 못 찾으면 이미지 검색으로 폴백
  if (!representativeImage) {
    logger.info(`[이미지] "${keyword}": 뉴스 기사에서 이미지 못 찾음 → 이미지 검색 시도`);
    try {
      representativeImage = await searchImageForKeyword(keyword);
    } catch (e) {
      logger.debug(`[이미지] "${keyword}": 이미지 검색 실패: ${e.message}`);
    }
  }

  logger.info(`[뉴스] "${keyword}": 총 ${uniqueArticles.length}개 기사 수집 (본문 ${topArticles.filter(a => a.fullContent).length}개, 이미지 ${topArticles.filter(a => a.image).length}개, 대표이미지: ${representativeImage ? 'O' : 'X'})`);

  return {
    keyword,
    articles: uniqueArticles,
    topArticlesWithContent: topArticles,
    totalCount: uniqueArticles.length,
    representativeImage,
  };
}

// ========== 대표 이미지 선정 (키워드 관련성 기반) ==========
function selectBestImage(topArticles, allArticles, keyword) {
  // 이미지가 있는 기사들 수집
  const articlesWithImage = topArticles.filter(a => a.image);
  if (articlesWithImage.length === 0) {
    // topArticles에 이미지 없으면 allArticles에서 찾기
    return allArticles.find(a => a.image)?.image || '';
  }

  // 이미지가 1개뿐이면 그대로 사용
  if (articlesWithImage.length === 1) {
    return articlesWithImage[0].image;
  }

  const kwWords = keyword.split(/\s+/).filter(w => w.length >= 2);
  
  // 각 이미지에 점수 매기기
  const scored = articlesWithImage.map(article => {
    let score = 0;
    const title = (article.title || '').toLowerCase();
    const imgUrl = (article.image || '').toLowerCase();

    // 1. 기사 제목에 키워드 단어가 많이 포함될수록 높은 점수
    for (const w of kwWords) {
      if (title.includes(w.toLowerCase())) score += 3;
    }

    // 2. 이미지 URL에 키워드 관련 단어가 포함되면 가산점
    for (const w of kwWords) {
      if (imgUrl.includes(encodeURIComponent(w)) || imgUrl.includes(w.toLowerCase())) score += 2;
    }

    // 3. 네이버 뉴스 이미지는 일반적으로 품질 좋음
    if (article.image.includes('imgnews.pstatic.net')) score += 1;

    // 4. 기사 제목이 키워드로 시작하면 가산점 (가장 직접적)
    if (title.startsWith(keyword.toLowerCase()) || title.startsWith(kwWords[0]?.toLowerCase())) score += 2;

    return { image: article.image, score, title: article.title };
  });

  // 점수 높은 순으로 정렬
  scored.sort((a, b) => b.score - a.score);

  logger.debug(`[이미지] 대표 이미지 선정 - 키워드: "${keyword}"`);
  scored.forEach(s => logger.debug(`  점수 ${s.score}: ${s.title?.substring(0, 40)}...`));

  return scored[0].image;
}

// ========== 이미지 검색 (다중 소스 fallback) ==========
async function searchImageForKeyword(keyword) {
  // 방법 1: 네이버 이미지 검색 API (API 키가 이미지 검색 권한 있을 때)
  const img1 = await tryNaverImageAPI(keyword);
  if (img1) return img1;

  // 방법 2: Bing 이미지 검색 크롤링 (미국 서버에서도 잘 동작)
  const img2 = await tryBingImageSearch(keyword);
  if (img2) return img2;

  // 방법 3: DuckDuckGo 이미지 검색 (차단 거의 없음)
  const img3 = await tryDuckDuckGoImage(keyword);
  if (img3) return img3;

  // 방법 4: Google 이미지 검색 크롤링
  const img4 = await tryGoogleImageSearch(keyword);
  if (img4) return img4;

  // 방법 5: 네이버 뉴스 페이지 썸네일 (차단될 수 있지만 시도)
  const img5 = await tryNaverNewsThumbnail(keyword);
  if (img5) return img5;

  logger.warn(`[이미지] "${keyword}": 모든 소스에서 이미지를 찾지 못함`);
  return '';
}

// ----- 방법 1: 네이버 이미지 API -----
async function tryNaverImageAPI(keyword) {
  try {
    if (!config.naver.clientId || !config.naver.clientSecret) return '';
    const response = await axios.get('https://openapi.naver.com/v1/search/image', {
      params: { query: keyword, display: 5, sort: 'date', filter: 'large' },
      headers: {
        'X-Naver-Client-Id': config.naver.clientId,
        'X-Naver-Client-Secret': config.naver.clientSecret,
      },
      timeout: 8000,
    });
    const items = response.data?.items || [];
    for (const item of items) {
      const img = item.link || item.thumbnail;
      if (img && img.startsWith('http') && !isJunkImage(img)) {
        logger.info(`[이미지] 네이버API "${keyword}": 확보 ✓`);
        return img;
      }
    }
  } catch (error) {
    logger.debug(`[이미지] 네이버API 실패: ${error.response?.status || error.message}`);
  }
  return '';
}

// ----- 방법 2: Bing 이미지 검색 -----
async function tryBingImageSearch(keyword) {
  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(keyword + ' 뉴스')}&qft=+filterui:photo-photo&first=1`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    // Bing 이미지 결과에서 이미지 URL 추출
    // 방법 A: m 속성 (JSON 데이터)
    const mAttrs = [];
    $('a.iusc').each((i, el) => {
      if (i >= 5) return false;
      const m = $(el).attr('m');
      if (m) mAttrs.push(m);
    });
    for (const m of mAttrs) {
      try {
        const data = JSON.parse(m);
        const img = data.murl || data.turl;
        if (img && img.startsWith('http') && !isJunkImage(img)) {
          logger.info(`[이미지] Bing "${keyword}": 확보 ✓`);
          return img;
        }
      } catch {}
    }

    // 방법 B: img.mimg 태그
    $('img.mimg, img.rms_img').each((i, el) => {
      if (i >= 5) return false;
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && src.startsWith('http') && !isJunkImage(src) && src.length > 50) {
        logger.info(`[이미지] Bing img "${keyword}": 확보 ✓`);
        return src;
      }
    });

    // 방법 C: data-src2 속성
    let found = '';
    $('img[data-src2]').each((i, el) => {
      if (found || i >= 5) return false;
      const src = $(el).attr('data-src2');
      if (src && src.startsWith('http') && !isJunkImage(src)) {
        found = src;
      }
    });
    if (found) {
      logger.info(`[이미지] Bing data-src2 "${keyword}": 확보 ✓`);
      return found;
    }

  } catch (error) {
    logger.debug(`[이미지] Bing 검색 실패: ${error.message}`);
  }
  return '';
}

// ----- 방법 3: DuckDuckGo 이미지 -----
async function tryDuckDuckGoImage(keyword) {
  try {
    // DuckDuckGo vqd 토큰 가져오기
    const tokenRes = await axios.get(`https://duckduckgo.com/?q=${encodeURIComponent(keyword)}&iax=images&ia=images`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 8000,
    });

    const vqdMatch = tokenRes.data.match(/vqd=["']?([^"'&]+)/);
    if (!vqdMatch) {
      // HTML에서 직접 이미지 추출 시도
      const $ = cheerio.load(tokenRes.data);
      let found = '';
      $('img').each((i, el) => {
        if (found || i > 30) return false;
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && src.startsWith('http') && !isJunkImage(src) && src.length > 50) {
          found = src;
        }
      });
      if (found) {
        logger.info(`[이미지] DuckDuckGo HTML "${keyword}": 확보 ✓`);
        return found;
      }
      return '';
    }

    const vqd = vqdMatch[1];
    const imgRes = await axios.get('https://duckduckgo.com/i.js', {
      params: {
        l: 'kr-kr',
        o: 'json',
        q: keyword,
        vqd,
        f: ',,,,,',
        p: '1',
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://duckduckgo.com/',
      },
      timeout: 8000,
    });

    const results = imgRes.data?.results || [];
    for (const r of results.slice(0, 5)) {
      const img = r.image || r.thumbnail;
      if (img && img.startsWith('http') && !isJunkImage(img)) {
        logger.info(`[이미지] DuckDuckGo "${keyword}": 확보 ✓`);
        return img;
      }
    }
  } catch (error) {
    logger.debug(`[이미지] DuckDuckGo 실패: ${error.message}`);
  }
  return '';
}

// ----- 방법 4: Google 이미지 검색 -----
async function tryGoogleImageSearch(keyword) {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&tbm=isch&hl=ko`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      timeout: 10000,
    });

    // Google 이미지 검색 결과에서 이미지 URL 추출 (JSON 데이터 내)
    const imgMatches = response.data.match(/\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)",\d+,\d+\]/gi) || [];
    for (const match of imgMatches.slice(0, 10)) {
      const urlMatch = match.match(/\["(https?:\/\/[^"]+)"/);
      if (urlMatch) {
        const img = urlMatch[1];
        if (!isJunkImage(img) && !img.includes('gstatic.com') && !img.includes('google.com')) {
          logger.info(`[이미지] Google "${keyword}": 확보 ✓`);
          return img;
        }
      }
    }

    // data:image 제외하고 og:image 등 meta에서 추출
    const $ = cheerio.load(response.data);
    let found = '';
    $('img').each((i, el) => {
      if (found || i > 30) return false;
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (!src || src.startsWith('data:') || src.length < 30) return;
      if (src.startsWith('http') && !isJunkImage(src) && !src.includes('gstatic') && !src.includes('google.com/images')) {
        found = src;
      }
    });
    if (found) {
      logger.info(`[이미지] Google img "${keyword}": 확보 ✓`);
      return found;
    }

  } catch (error) {
    logger.debug(`[이미지] Google 이미지 실패: ${error.message}`);
  }
  return '';
}

// ----- 방법 5: 네이버 뉴스 썸네일 -----
async function tryNaverNewsThumbnail(keyword) {
  try {
    const url = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(keyword)}&sort=1`;
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 8000,
    });

    const $ = cheerio.load(response.data);
    let found = '';

    // 네이버 뉴스 검색 결과 모든 이미지
    $('img').each((i, el) => {
      if (found || i > 50) return false;
      const src = $(el).attr('data-lazysrc') || $(el).attr('data-src') || $(el).attr('src');
      if (!src) return;
      let img = src.trim();
      if (img.startsWith('//')) img = 'https:' + img;
      if (img.startsWith('data:') || img.length < 40) return;
      if (isJunkImage(img)) return;
      // 네이버 썸네일 → 고해상도
      if (img.includes('pstatic.net') || img.includes('naver.net')) {
        img = img.replace(/\?type=\w+/, '?type=w800');
        img = img.replace(/type=nf\d+_\d+/, 'type=w800');
        img = img.replace(/type=a\d+/, 'type=w800');
      }
      if (img.startsWith('http')) {
        found = img;
      }
    });

    if (found) {
      logger.info(`[이미지] 네이버뉴스 "${keyword}": 확보 ✓`);
      return found;
    }
  } catch (error) {
    logger.debug(`[이미지] 네이버뉴스 썸네일 실패: ${error.message}`);
  }
  return '';
}

// ========== 정크 이미지 필터 ==========
function isJunkImage(url) {
  if (!url) return true;
  const junk = [
    'logo', 'icon', 'favicon', '1x1', 'pixel', 'blank', 'spacer',
    'btn_', 'button', 'banner_ad', 'sprite', 'arrow', 'search_',
    'sp_', 'transparent', 'loading', 'spinner', 'placeholder',
    'ad_', 'ads_', 'tracking', 'analytics', 'widget',
  ];
  const lower = url.toLowerCase();
  return junk.some(j => lower.includes(j));
}

module.exports = {
  fetchNaverNews,
  fetchGoogleNews,
  fetchNaverSearchNews,
  fetchArticleContent,
  fetchNewsForKeyword,
  searchImageForKeyword,
};
