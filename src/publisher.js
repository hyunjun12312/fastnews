// ============================================
// publisher.js - 자동 퍼블리싱 시스템
// ============================================
// 생성된 기사를 자동으로 퍼블리싱하고
// SEO 최적화된 정적 HTML 페이지를 생성
// ============================================

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const logger = require('./logger');
const config = require('./config');

const OUTPUT_DIR = path.join(__dirname, '..', 'public');
const ARTICLES_DIR = path.join(OUTPUT_DIR, 'articles');

// 디렉토리 생성
[OUTPUT_DIR, ARTICLES_DIR, path.join(OUTPUT_DIR, 'sitemap')].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ========== HTML 템플릿 ==========
function articleTemplate(article) {
  const htmlContent = marked(article.content || '');
    const publishDateRaw = article.published_at || article.created_at || new Date().toISOString();
    const parsedDate = new Date(publishDateRaw);
    const publishDate = isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
  const sourceUrls = typeof article.source_urls === 'string'
    ? JSON.parse(article.source_urls || '[]')
    : (article.source_urls || []);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(article.title)} | ${config.site.title}</title>
  <meta name="description" content="${escapeHtml(article.summary || '')}">
  <meta name="keywords" content="${escapeHtml(article.keyword || '')}">
  
  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(article.title)}">
  <meta property="og:description" content="${escapeHtml(article.summary || '')}">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="ko_KR">
  
  <!-- 구조화 데이터 (SEO) -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": "${escapeHtml(article.title)}",
    "description": "${escapeHtml(article.summary || '')}",
    "datePublished": "${publishDate}",
    "dateModified": "${publishDate}",
    "author": {
      "@type": "Organization",
      "name": "${config.site.title}"
    },
    "publisher": {
      "@type": "Organization",
      "name": "${config.site.title}"
    }
  }
  </script>
  
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.8; color: #333; background: #f8f9fa;
    }
    header { 
      background: #1a1a2e; color: white; padding: 1rem 2rem;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    header a { color: white; text-decoration: none; font-size: 1.5rem; font-weight: 700; }
    .container { max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    .article-card {
      background: white; border-radius: 12px; padding: 2.5rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    }
    .article-meta { 
      color: #888; font-size: 0.9rem; margin-bottom: 1.5rem;
      display: flex; gap: 1rem; flex-wrap: wrap;
    }
    .article-meta .keyword {
      background: #e3f2fd; color: #1565c0; padding: 2px 10px;
      border-radius: 12px; font-size: 0.8rem;
    }
    h1 { font-size: 1.8rem; line-height: 1.4; margin-bottom: 1rem; color: #1a1a2e; }
    .article-body h2 { font-size: 1.3rem; margin: 2rem 0 0.5rem; color: #2c3e50; border-left: 4px solid #3498db; padding-left: 12px; }
    .article-body h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; color: #34495e; }
    .article-body p { margin: 0.8rem 0; text-align: justify; }
    .article-body ul, .article-body ol { padding-left: 1.5rem; margin: 0.8rem 0; }
    .article-body blockquote { border-left: 4px solid #ddd; padding-left: 1rem; color: #666; margin: 1rem 0; }
    .sources { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; font-size: 0.85rem; color: #888; }
    .sources a { color: #3498db; }
    .related { margin-top: 2rem; }
    .related a { display: block; padding: 0.5rem 0; color: #3498db; text-decoration: none; }
    footer { text-align: center; padding: 2rem; color: #888; font-size: 0.85rem; }
    
    /* 광고 자리 */
    .ad-slot { 
      background: #f0f0f0; border: 2px dashed #ddd; 
      padding: 2rem; text-align: center; margin: 1.5rem 0;
      border-radius: 8px; color: #999; font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <header>
    <a href="/">${escapeHtml(config.site.title)}</a>
  </header>
  
  <div class="container">
    <!-- 상단 광고 -->
    <div class="ad-slot">
      <!-- 여기에 Google AdSense 코드 삽입 -->
      광고 영역 (AdSense)
    </div>

    <article class="article-card">
      <div class="article-meta">
        <span>📅 ${new Date(publishDate).toLocaleDateString('ko-KR')}</span>
        <span>👁️ ${article.views || 0} views</span>
        <span class="keyword">#${escapeHtml(article.keyword || '')}</span>
      </div>
      
      <h1>${escapeHtml(article.title)}</h1>
      
      <div class="article-body">
        ${htmlContent}
      </div>

      ${sourceUrls.length > 0 ? `
      <div class="sources">
        <strong>참고 자료:</strong>
        ${sourceUrls.slice(0, 3).map(url => `<br><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url.substring(0, 60))}...</a>`).join('')}
      </div>
      ` : ''}
    </article>

    <!-- 하단 광고 -->
    <div class="ad-slot">
      <!-- 여기에 Google AdSense 코드 삽입 -->
      광고 영역 (AdSense)
    </div>
  </div>

  <footer>
    <p>&copy; ${new Date().getFullYear()} ${escapeHtml(config.site.title)}. 실시간 트렌드 기반 자동 뉴스.</p>
  </footer>
</body>
</html>`;
}

// ========== 메인 인덱스 페이지 ==========
function indexTemplate(articles) {
  const articleCards = articles.map(article => {
    const dateStr = article.published_at || article.created_at || new Date().toISOString();
    const date = new Date(dateStr).toLocaleDateString('ko-KR') !== 'Invalid Date' ? new Date(dateStr).toLocaleDateString('ko-KR') : dateStr;
    return `
      <a href="/articles/${article.slug}.html" class="card">
        <div class="card-keyword">#${escapeHtml(article.keyword || '')}</div>
        <h2>${escapeHtml(article.title)}</h2>
        <p>${escapeHtml(article.summary || '').substring(0, 120)}...</p>
        <div class="card-meta">
          <span>📅 ${date}</span>
          <span>👁️ ${article.views || 0}</span>
        </div>
      </a>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.site.title} - ${config.site.description}</title>
  <meta name="description" content="${config.site.description}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f8f9fa; color: #333;
    }
    header { 
      background: linear-gradient(135deg, #1a1a2e, #16213e); 
      color: white; padding: 2rem; text-align: center;
    }
    header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    header p { opacity: 0.8; }
    .live-badge { 
      display: inline-block; background: #e74c3c; color: white;
      padding: 4px 12px; border-radius: 20px; font-size: 0.8rem;
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
    .container { max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    .stats { 
      display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap;
    }
    .stat-card {
      background: white; padding: 1rem 1.5rem; border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.05); flex: 1; min-width: 120px;
      text-align: center;
    }
    .stat-card .number { font-size: 1.8rem; font-weight: 700; color: #3498db; }
    .stat-card .label { font-size: 0.8rem; color: #888; }
    .cards { display: grid; gap: 1rem; }
    .card {
      background: white; padding: 1.5rem; border-radius: 12px;
      box-shadow: 0 2px 15px rgba(0,0,0,0.05);
      text-decoration: none; color: inherit;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(0,0,0,0.1); }
    .card h2 { font-size: 1.1rem; margin: 0.5rem 0; line-height: 1.5; }
    .card p { color: #666; font-size: 0.9rem; line-height: 1.6; }
    .card-keyword { 
      font-size: 0.75rem; color: #3498db; background: #e3f2fd;
      display: inline-block; padding: 2px 8px; border-radius: 10px;
    }
    .card-meta { display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.8rem; color: #aaa; }
    .ad-slot { 
      background: #f0f0f0; border: 2px dashed #ddd;
      padding: 2rem; text-align: center; margin: 1.5rem 0;
      border-radius: 8px; color: #999;
    }
    footer { text-align: center; padding: 2rem; color: #888; font-size: 0.85rem; }
    .auto-refresh { text-align: center; margin: 1rem; color: #888; font-size: 0.8rem; }
  </style>
  <script>
    // 5분마다 자동 새로고침
    setTimeout(() => location.reload(), 5 * 60 * 1000);
  </script>
</head>
<body>
  <header>
    <div class="live-badge">🔴 LIVE</div>
    <h1>${escapeHtml(config.site.title)}</h1>
    <p>${escapeHtml(config.site.description)}</p>
  </header>

  <div class="container">
    <div class="ad-slot">광고 영역 (AdSense)</div>
    
    <div class="cards">
      ${articleCards || '<p style="text-align:center;color:#888;">아직 발행된 기사가 없습니다. 시스템 시작 후 곧 자동 생성됩니다.</p>'}
    </div>

    <div class="ad-slot">광고 영역 (AdSense)</div>
  </div>

  <div class="auto-refresh">페이지는 5분마다 자동으로 업데이트됩니다.</div>

  <footer>
    <p>&copy; ${new Date().getFullYear()} ${escapeHtml(config.site.title)}</p>
  </footer>
</body>
</html>`;
}

// ========== 사이트맵 생성 ==========
function generateSitemap(articles, baseUrl = 'https://yourdomain.com') {
  const urls = articles.map(article => `
  <url>
    <loc>${baseUrl}/articles/${article.slug}.html</loc>
    <lastmod>${new Date(article.published_at || article.created_at).toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>${urls}
</urlset>`;
}

// ========== RSS 피드 생성 ==========
function generateRSS(articles, baseUrl = 'https://yourdomain.com') {
  const items = articles.slice(0, 30).map(article => `
    <item>
      <title><![CDATA[${article.title}]]></title>
      <link>${baseUrl}/articles/${article.slug}.html</link>
      <description><![CDATA[${article.summary || ''}]]></description>
      <pubDate>${new Date(article.published_at || article.created_at).toUTCString()}</pubDate>
      <guid>${baseUrl}/articles/${article.slug}.html</guid>
    </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${config.site.title}</title>
    <link>${baseUrl}</link>
    <description>${config.site.description}</description>
    <language>ko</language>
    ${items}
  </channel>
</rss>`;
}

// ========== 기사 퍼블리시 ==========
function publishArticle(article) {
  try {
    // 기사 HTML 생성
    const html = articleTemplate(article);
    const filePath = path.join(ARTICLES_DIR, `${article.slug}.html`);
    fs.writeFileSync(filePath, html, 'utf8');

    logger.info(`[퍼블리셔] 기사 퍼블리시: ${article.slug}.html`);
    return filePath;
  } catch (error) {
    logger.error(`[퍼블리셔] 기사 퍼블리시 실패: ${error.message}`);
    return null;
  }
}

// ========== 인덱스 페이지 갱신 ==========
function updateIndex(articles) {
  try {
    const html = indexTemplate(articles);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html, 'utf8');

    // 사이트맵 갱신
    const sitemap = generateSitemap(articles);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap.xml'), sitemap, 'utf8');

    // RSS 피드 갱신
    const rss = generateRSS(articles);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'rss.xml'), rss, 'utf8');

    logger.info(`[퍼블리셔] 인덱스 + 사이트맵 + RSS 갱신 완료 (${articles.length}개 기사)`);
  } catch (error) {
    logger.error(`[퍼블리셔] 인덱스 갱신 실패: ${error.message}`);
  }
}

// ========== HTML 이스케이프 ==========
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  publishArticle,
  updateIndex,
  generateSitemap,
  generateRSS,
  articleTemplate,
  indexTemplate,
  OUTPUT_DIR,
  ARTICLES_DIR,
};
