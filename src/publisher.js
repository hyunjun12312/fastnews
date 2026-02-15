// ============================================
// publisher.js - 자동 퍼블리싱 + 프로 디자인 + SEO
// ============================================
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const axios = require('axios');
const logger = require('./logger');
const config = require('./config');

// Railway Volume 지원: DATA_DIR 환경변수 설정 시 영구 저장소 사용
const DATA_DIR = process.env.DATA_DIR || '';
const OUTPUT_DIR = DATA_DIR ? DATA_DIR : path.join(__dirname, '..', 'public');
const ARTICLES_DIR = path.join(OUTPUT_DIR, 'articles');
const SITEMAP_DIR = path.join(OUTPUT_DIR, 'sitemap');

[OUTPUT_DIR, ARTICLES_DIR, SITEMAP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

logger.info(`[퍼블리셔] 출력 디렉토리: ${OUTPUT_DIR} ${DATA_DIR ? '(Railway Volume)' : '(로컬)'}`);

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ========== 키워드 기반 그라디언트 배경 생성 ==========
function keywordGradient(keyword) {
  let hash = 0;
  const str = keyword || 'trend';
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const gradients = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
    'linear-gradient(135deg, #fad0c4 0%, #ffd1ff 100%)',
    'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
    'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
    'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
    'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
  ];
  return gradients[Math.abs(hash) % gradients.length];
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr || '';
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dateStr || ''; }
}

function formatDateShort(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function timeAgo(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '방금 전';
    if (mins < 60) return `${mins}분 전`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}시간 전`;
    const days = Math.floor(hrs / 24);
    return `${days}일 전`;
  } catch { return ''; }
}

// ========== 공통 CSS ==========
const COMMON_CSS = `
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="dns-prefetch" href="https://cdn.jsdelivr.net">
<style>
  @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css');
  
  :root {
    --primary: #1a73e8;
    --primary-dark: #1557b0;
    --bg: #f8f9fa;
    --card: #ffffff;
    --text: #202124;
    --text-secondary: #5f6368;
    --text-muted: #80868b;
    --border: #dadce0;
    --accent-red: #ea4335;
    --accent-blue: #1a73e8;
    --accent-green: #34a853;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1);
    --shadow-md: 0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06);
    --shadow-lg: 0 10px 25px rgba(0,0,0,0.08), 0 6px 12px rgba(0,0,0,0.05);
    --radius: 12px;
    --max-width: 1200px;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  body {
    font-family: 'Pretendard Variable', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }

  /* ===== 상단 네비게이션 ===== */
  .top-nav {
    background: #fff; border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 1000;
    box-shadow: var(--shadow-sm);
  }
  .top-nav-inner {
    max-width: var(--max-width); margin: 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px; height: 56px;
  }
  .logo { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); }
  .logo-icon { font-size: 1.6rem; }
  .logo-text { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.5px; }
  .logo-sub { font-size: 0.7rem; color: var(--text-muted); font-weight: 400; margin-left: 2px; }
  .nav-time { font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
  .nav-live { display: inline-flex; align-items: center; gap: 4px; background: var(--accent-red); color: #fff; font-size: 0.65rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; letter-spacing: 0.5px; }
  .nav-live::before { content: ''; width: 6px; height: 6px; background: #fff; border-radius: 50%; animation: livePulse 1.5s infinite; }
  @keyframes livePulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

  /* ===== 실시간 검색어 바 ===== */
  .trend-bar {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: #fff; overflow: hidden; position: relative;
  }
  .trend-bar-inner {
    max-width: var(--max-width); margin: 0 auto; padding: 0 24px;
    display: flex; align-items: center; height: 44px; gap: 16px;
  }
  .trend-label {
    font-size: 0.75rem; font-weight: 700; white-space: nowrap;
    background: rgba(255,255,255,0.15); padding: 4px 12px; border-radius: 20px;
    display: flex; align-items: center; gap: 6px; flex-shrink: 0;
  }
  .trend-label .fire { font-size: 0.9rem; }
  .trend-scroll-wrap { flex: 1; overflow: hidden; position: relative; }
  .trend-scroll {
    display: flex; gap: 8px; animation: scrollTrend 30s linear infinite;
    will-change: transform;
  }
  .trend-scroll:hover { animation-play-state: paused; }
  @keyframes scrollTrend { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
  .trend-item {
    display: inline-flex; align-items: center; gap: 6px;
    white-space: nowrap; padding: 4px 14px; border-radius: 20px;
    font-size: 0.82rem; cursor: pointer; transition: all 0.2s;
    background: rgba(255,255,255,0.08); flex-shrink: 0;
  }
  .trend-item:hover { background: rgba(255,255,255,0.2); transform: scale(1.03); }
  .trend-rank {
    font-weight: 800; font-size: 0.7rem; min-width: 18px; height: 18px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 4px;
  }
  .trend-rank.top3 { background: var(--accent-red); }
  .trend-rank.rest { background: rgba(255,255,255,0.2); }
  .trend-name { font-weight: 500; }

  /* ===== 메인 레이아웃 ===== */
  .container { max-width: var(--max-width); margin: 0 auto; padding: 24px; }
  
  .main-grid {
    display: grid; grid-template-columns: 1fr 340px; gap: 24px;
  }
  @media (max-width: 900px) {
    .main-grid { grid-template-columns: 1fr; }
    .sidebar { order: -1; }
  }

  /* ===== 기사 카드 ===== */
  .articles-section h2 {
    font-size: 1.1rem; font-weight: 700; color: var(--text);
    margin-bottom: 16px; display: flex; align-items: center; gap: 8px;
    padding-bottom: 12px; border-bottom: 2px solid var(--text);
  }
  
  .hero-card {
    background: var(--card); border-radius: var(--radius); overflow: hidden;
    box-shadow: var(--shadow-md); margin-bottom: 20px;
    transition: box-shadow 0.3s, transform 0.2s;
  }
  .hero-card:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px); }
  .hero-card a { text-decoration: none; color: inherit; display: block; }
  .hero-img {
    width: 100%; height: 280px; object-fit: cover; display: block;
  }
  .hero-img-placeholder {
    width: 100%; height: 200px;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.9); font-size: 1.6rem; font-weight: 700;
    letter-spacing: 1px; text-shadow: 0 2px 8px rgba(0,0,0,0.15);
    position: relative;
  }
  .hero-img-placeholder::after {
    content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.05); pointer-events: none;
  }
  .hero-content { padding: 24px 28px; }
  .hero-badge {
    display: inline-block; font-size: 0.7rem; font-weight: 700;
    padding: 3px 10px; border-radius: 4px; margin-bottom: 12px;
    background: var(--accent-red); color: #fff; letter-spacing: 0.5px;
  }
  .hero-title {
    font-size: 1.5rem; font-weight: 800; line-height: 1.4;
    margin-bottom: 10px; letter-spacing: -0.3px; color: var(--text);
  }
  .hero-summary { font-size: 0.95rem; color: var(--text-secondary); line-height: 1.7; margin-bottom: 14px; }
  .hero-meta { display: flex; gap: 12px; font-size: 0.8rem; color: var(--text-muted); align-items: center; }
  .hero-meta .dot { width: 3px; height: 3px; background: var(--text-muted); border-radius: 50%; }

  .article-card {
    background: var(--card); border-radius: var(--radius); overflow: hidden;
    box-shadow: var(--shadow-sm); margin-bottom: 12px;
    transition: box-shadow 0.3s, transform 0.15s;
  }
  .article-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  .article-card a {
    display: flex; padding: 16px 20px; text-decoration: none; color: inherit;
    gap: 14px; align-items: stretch;
  }
  .article-thumb {
    width: 120px; min-width: 120px; height: 80px; border-radius: 8px;
    object-fit: cover; background: #f1f3f4;
  }
  .article-thumb-placeholder {
    width: 120px; min-width: 120px; height: 80px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.85); font-size: 0.75rem; font-weight: 600;
    flex-shrink: 0; letter-spacing: 0.5px;
    text-shadow: 0 1px 4px rgba(0,0,0,0.1);
  }
  .article-num {
    font-size: 1.4rem; font-weight: 800; color: var(--accent-blue);
    min-width: 28px; line-height: 1;  padding-top: 2px;
  }
  .article-info { flex: 1; min-width: 0; }
  .article-tag {
    font-size: 0.68rem; font-weight: 600; color: var(--accent-blue);
    background: #e8f0fe; padding: 2px 8px; border-radius: 4px;
    display: inline-block; margin-bottom: 6px;
  }
  .article-title {
    font-size: 1rem; font-weight: 700; line-height: 1.5;
    margin-bottom: 6px; color: var(--text); letter-spacing: -0.2px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .article-desc {
    font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .article-meta {
    display: flex; gap: 10px; margin-top: 8px;
    font-size: 0.75rem; color: var(--text-muted); align-items: center;
  }

  /* ===== 사이드바 ===== */
  .sidebar-box {
    background: var(--card); border-radius: var(--radius);
    box-shadow: var(--shadow-sm); margin-bottom: 20px; overflow: hidden;
  }
  .sidebar-header {
    padding: 16px 20px; font-weight: 700; font-size: 0.9rem;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 8px;
  }
  .sidebar-body { padding: 8px 0; }

  .ranking-item {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px; transition: background 0.15s; cursor: pointer;
  }
  .ranking-item:hover { background: #f1f3f4; }
  .ranking-num {
    font-size: 0.9rem; font-weight: 800; min-width: 24px;
    text-align: center;
  }
  .ranking-num.r1 { color: var(--accent-red); }
  .ranking-num.r2 { color: var(--accent-red); }
  .ranking-num.r3 { color: var(--accent-red); }
  .ranking-text { font-size: 0.88rem; font-weight: 500; flex: 1; }
  .ranking-badge {
    font-size: 0.6rem; padding: 1px 6px; border-radius: 3px;
    font-weight: 600;
  }
  .badge-new { background: #fce8e6; color: var(--accent-red); }
  .badge-up { background: #e6f4ea; color: var(--accent-green); }

  /* ===== 광고 슬롯 ===== */
  .ad-slot {
    background: var(--card); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 24px; text-align: center;
    margin-bottom: 20px; min-height: 100px;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-muted); font-size: 0.8rem;
  }

  /* ===== 푸터 ===== */
  .footer {
    background: #fff; border-top: 1px solid var(--border);
    padding: 32px 24px; margin-top: 40px;
  }
  .footer-inner {
    max-width: var(--max-width); margin: 0 auto;
    display: flex; justify-content: space-between; align-items: center;
    flex-wrap: wrap; gap: 12px;
  }
  .footer-copy { font-size: 0.8rem; color: var(--text-muted); }
  .footer-links { display: flex; gap: 16px; }
  .footer-links a { font-size: 0.8rem; color: var(--text-secondary); text-decoration: none; }
  .footer-links a:hover { color: var(--primary); }

  /* ===== 기사 상세 페이지 ===== */
  .article-page { max-width: 720px; margin: 0 auto; padding: 32px 20px; }
  .article-page-header { margin-bottom: 32px; }
  .article-page-keyword {
    display: inline-block; font-size: 0.75rem; font-weight: 700;
    color: var(--accent-blue); background: #e8f0fe;
    padding: 4px 12px; border-radius: 6px; margin-bottom: 14px;
  }
  .article-page-title {
    font-size: 1.8rem; font-weight: 800; line-height: 1.4;
    letter-spacing: -0.5px; margin-bottom: 16px;
  }
  .article-page-hero-img {
    width: 100%; max-height: 420px; object-fit: cover; border-radius: var(--radius);
    margin-bottom: 24px; box-shadow: var(--shadow-sm);
  }
  .article-page-meta {
    display: flex; gap: 16px; font-size: 0.85rem;
    color: var(--text-muted); padding-bottom: 20px;
    border-bottom: 1px solid var(--border); flex-wrap: wrap;
  }
  .article-page-body {
    font-size: 1.05rem; line-height: 1.9;
  }
  .article-page-body h2 {
    font-size: 1.3rem; font-weight: 700; margin: 36px 0 14px;
    padding-left: 14px; border-left: 4px solid var(--accent-blue);
    color: var(--text);
  }
  .article-page-body h3 { font-size: 1.1rem; font-weight: 600; margin: 28px 0 10px; }
  .article-page-body p { margin: 14px 0; color: #333; }
  .article-page-body ul, .article-page-body ol { padding-left: 24px; margin: 12px 0; }
  .article-page-body li { margin: 6px 0; }
  .article-page-body blockquote {
    border-left: 4px solid var(--border); padding: 12px 20px;
    background: #f8f9fa; margin: 16px 0; border-radius: 0 8px 8px 0;
    color: var(--text-secondary); font-style: italic;
  }
  .article-page-body strong { color: var(--text); }
  .article-sources {
    margin-top: 36px; padding-top: 20px; border-top: 1px solid var(--border);
    font-size: 0.85rem; color: var(--text-muted);
  }
  .article-sources a { color: var(--accent-blue); text-decoration: none; word-break: break-all; }
  .article-sources a:hover { text-decoration: underline; }
  .article-share {
    margin-top: 24px; padding: 20px; background: #f8f9fa;
    border-radius: var(--radius); text-align: center;
  }
  .article-share-title { font-size: 0.85rem; font-weight: 600; margin-bottom: 10px; }
  .share-btn {
    display: inline-block; padding: 8px 16px; border-radius: 8px;
    font-size: 0.8rem; color: #fff; text-decoration: none; margin: 4px;
    font-weight: 600;
  }
  .share-kakao { background: #FEE500; color: #000; }
  .share-twitter { background: #1DA1F2; }
  .share-facebook { background: #1877F2; }
  .share-copy { background: #5f6368; cursor: pointer; border: none; }
</style>
`;

// ========== 실시간 트렌드 바 HTML 생성 ==========
function trendBarHTML(trendKeywords, articles) {
  if (!trendKeywords || trendKeywords.length === 0) return '';
  
  // 키워드→기사 매핑
  const articleMap = {};
  if (articles) articles.forEach(a => { if (a.keyword) articleMap[a.keyword] = a.slug; });

  // 무한 스크롤을 위해 2배로 복제
  const items = [...trendKeywords, ...trendKeywords].map((kw, i) => {
    const rank = (i % trendKeywords.length) + 1;
    const rankClass = rank <= 3 ? 'top3' : 'rest';
    const keyword = typeof kw === 'string' ? kw : kw.keyword;
    const slug = articleMap[keyword];
    const href = slug ? `/articles/${slug}.html` : `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
    const target = slug ? '' : ' target="_blank" rel="noopener"';
    return `<a class="trend-item" href="${href}"${target} style="text-decoration:none;color:inherit;"><span class="trend-rank ${rankClass}">${rank}</span><span class="trend-name">${escapeHtml(keyword)}</span></a>`;
  }).join('');

  return `
  <div class="trend-bar">
    <div class="trend-bar-inner">
      <div class="trend-label"><span class="fire">🔥</span> 실시간 검색어</div>
      <div class="trend-scroll-wrap">
        <div class="trend-scroll">${items}</div>
      </div>
    </div>
  </div>`;
}

// ========== 상단 네비게이션 ==========
function navHTML() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  return `
  <nav class="top-nav">
    <div class="top-nav-inner">
      <a href="/" class="logo">
        <span class="logo-icon">⚡</span>
        <span>
          <span class="logo-text">${escapeHtml(config.site.title)}</span>
          <span class="logo-sub">TREND NEWS</span>
        </span>
      </a>
      <div class="nav-time">
        <span class="nav-live">LIVE</span>
        <span>${dateStr}</span>
      </div>
    </div>
  </nav>`;
}

// ========== 푸터 ==========
function footerHTML() {
  return `
  <footer class="footer">
    <div class="footer-inner">
      <div class="footer-copy">&copy; ${new Date().getFullYear()} ${escapeHtml(config.site.title)}. 실시간 트렌드 기반 뉴스 서비스.</div>
      <div class="footer-links">
        <a href="/">홈</a>
        <a href="/rss.xml">RSS</a>
        <a href="/sitemap.xml">사이트맵</a>
      </div>
    </div>
  </footer>`;
}

// ========== 기사 상세 페이지 ==========
function articleTemplate(article, trendKeywords) {
  const htmlContent = marked(article.content || '');
  const publishDateRaw = article.published_at || article.created_at || new Date().toISOString();
  const parsedDate = new Date(publishDateRaw);
  const publishDate = isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
  const sourceUrls = typeof article.source_urls === 'string'
    ? JSON.parse(article.source_urls || '[]') : (article.source_urls || []);
  const pageUrl = `/articles/${article.slug}.html`;
  const articleImage = article.image || '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(article.title)} | ${config.site.title}</title>
  <meta name="description" content="${escapeHtml(article.summary || '')}">
  <meta name="keywords" content="${escapeHtml(article.keyword || '')}, 실시간 뉴스, 트렌드, ${escapeHtml(article.keyword || '')} 뉴스">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="author" content="${config.site.title}">
  <link rel="canonical" href="${config.site.url}${pageUrl}">
  <link rel="alternate" type="application/rss+xml" title="${config.site.title} RSS" href="${config.site.url}/rss.xml">
  ${config.site.naverVerification ? `<meta name="naver-site-verification" content="${config.site.naverVerification}">` : ''}
  ${config.site.googleVerification ? `<meta name="google-site-verification" content="${config.site.googleVerification}">` : ''}

  <!-- Open Graph -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(article.title)}">
  <meta property="og:description" content="${escapeHtml(article.summary || '')}">
  <meta property="og:url" content="${config.site.url}${pageUrl}">
  <meta property="og:site_name" content="${config.site.title}">
  <meta property="og:locale" content="ko_KR">
  ${articleImage ? `<meta property="og:image" content="${escapeHtml(articleImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">` : ''}
  <meta property="article:published_time" content="${publishDate}">
  <meta property="article:modified_time" content="${publishDate}">
  <meta property="article:section" content="트렌드">
  <meta property="article:tag" content="${escapeHtml(article.keyword || '')}">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="${articleImage ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeHtml(article.title)}">
  <meta name="twitter:description" content="${escapeHtml(article.summary || '')}">
  ${articleImage ? `<meta name="twitter:image" content="${escapeHtml(articleImage)}">` : ''}

  <!-- 구조화 데이터 (Google Rich Results) -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": "${escapeHtml(article.title)}",
    "description": "${escapeHtml(article.summary || '')}",
    "datePublished": "${publishDate}",
    "dateModified": "${publishDate}",
    "author": { "@type": "Organization", "name": "${config.site.title}" },
    "publisher": {
      "@type": "Organization",
      "name": "${config.site.title}",
      "logo": { "@type": "ImageObject", "url": "${config.site.url}/logo.png" }
    },
    "mainEntityOfPage": { "@type": "WebPage", "@id": "${config.site.url}${pageUrl}" },
    ${articleImage ? `"image": "${escapeHtml(articleImage)}",` : ''}
    "keywords": "${escapeHtml(article.keyword || '')}",
    "articleSection": "트렌드"
  }
  </script>

  <!-- BreadcrumbList -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "홈", "item": "${config.site.url}/" },
      { "@type": "ListItem", "position": 2, "name": "${escapeHtml(article.keyword || '')}", "item": "${config.site.url}${pageUrl}" }
    ]
  }
  </script>

  ${COMMON_CSS}
</head>
<body>
  ${navHTML()}
  ${trendBarHTML(trendKeywords)}

  <div class="container">
    <!-- 빵부스러기 -->
    <nav style="font-size:0.8rem;color:var(--text-muted);margin-bottom:20px;">
      <a href="/" style="color:var(--accent-blue);text-decoration:none;">홈</a>
      <span style="margin:0 6px;">›</span>
      <span>${escapeHtml(article.keyword || '')}</span>
    </nav>

    <div class="ad-slot"><!-- AdSense 상단 광고 --></div>

    <article class="article-page">
      <header class="article-page-header">
        <div class="article-page-keyword"># ${escapeHtml(article.keyword || '')}</div>
        <h1 class="article-page-title">${escapeHtml(article.title)}</h1>
        ${articleImage ? `<img class="article-page-hero-img" src="${escapeHtml(articleImage)}" alt="${escapeHtml(article.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
        <div class="article-page-meta">
          <span>${config.site.title} 편집팀</span>
          <span>${formatDate(publishDate)}</span>
          <span>조회 ${article.views || 0}</span>
        </div>
      </header>

      <div class="article-page-body">
        ${htmlContent}
      </div>

      ${sourceUrls.length > 0 ? `
      <div class="article-sources">
        <strong>📎 참고 자료</strong>
        ${sourceUrls.slice(0, 5).map(url => `<div style="margin-top:6px;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(url.substring(0, 80))}${url.length > 80 ? '...' : ''}</a></div>`).join('')}
      </div>` : ''}

      <div class="article-share">
        <div class="article-share-title">이 기사 공유하기</div>
        <a class="share-btn share-twitter" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(article.title)}&url=${encodeURIComponent(config.site.url + pageUrl)}" target="_blank" rel="noopener">Twitter</a>
        <a class="share-btn share-facebook" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(config.site.url + pageUrl)}" target="_blank" rel="noopener">Facebook</a>
        <button class="share-btn share-copy" onclick="navigator.clipboard.writeText(location.href);this.textContent='복사됨!';">링크 복사</button>
      </div>
    </article>

    <div class="ad-slot"><!-- AdSense 하단 광고 --></div>
  </div>

  ${footerHTML()}
</body>
</html>`;
}

// ========== 메인 인덱스 페이지 ==========
function indexTemplate(articles, trendKeywords) {
  const heroArticle = articles[0];
  const restArticles = articles.slice(1);
  const topKeywords = trendKeywords || [];

  // 이미지 로드 실패 시 fallback 함수 (인라인 JS)
  function imgFallbackScript() {
    return `
  <script>
    function imgFail(el, keyword, isHero) {
      var gradients = [
        'linear-gradient(135deg,#667eea,#764ba2)',
        'linear-gradient(135deg,#f093fb,#f5576c)',
        'linear-gradient(135deg,#4facfe,#00f2fe)',
        'linear-gradient(135deg,#43e97b,#38f9d7)',
        'linear-gradient(135deg,#fa709a,#fee140)',
        'linear-gradient(135deg,#a18cd1,#fbc2eb)',
        'linear-gradient(135deg,#84fab0,#8fd3f4)',
        'linear-gradient(135deg,#fbc2eb,#a6c1ee)',
        'linear-gradient(135deg,#a1c4fd,#c2e9fb)',
        'linear-gradient(135deg,#ffecd2,#fcb69f)'
      ];
      var h = 0;
      for (var i = 0; i < keyword.length; i++) h = keyword.charCodeAt(i) + ((h << 5) - h);
      var bg = gradients[Math.abs(h) % gradients.length];
      var cls = isHero ? 'hero-img-placeholder' : 'article-thumb-placeholder';
      var label = isHero ? keyword : keyword.substring(0, 6);
      el.outerHTML = '<div class="' + cls + '" style="background:' + bg + '"># ' + label + '</div>';
    }
  </script>`;
  }

  const heroHTML = heroArticle ? `
    <div class="hero-card">
      <a href="/articles/${heroArticle.slug}.html">
        ${heroArticle.image
          ? `<img class="hero-img" src="${escapeHtml(heroArticle.image)}" alt="${escapeHtml(heroArticle.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="imgFail(this,'${escapeHtml(heroArticle.keyword || '트렌드').replace(/'/g, '')}',true)">`
          : `<div class="hero-img-placeholder" style="background:${keywordGradient(heroArticle.keyword)}"># ${escapeHtml(heroArticle.keyword || '트렌드')}</div>`}
        <div class="hero-content">
          <span class="hero-badge">최신 트렌드</span>
          <h1 class="hero-title">${escapeHtml(heroArticle.title)}</h1>
          <p class="hero-summary">${escapeHtml(heroArticle.summary || '').substring(0, 160)}</p>
          <div class="hero-meta">
            <span># ${escapeHtml(heroArticle.keyword || '')}</span>
            <span class="dot"></span>
            <span>${timeAgo(heroArticle.published_at || heroArticle.created_at)}</span>
            <span class="dot"></span>
            <span>조회 ${heroArticle.views || 0}</span>
          </div>
        </div>
      </a>
    </div>` : '';

  const articleCards = restArticles.map((article, i) => `
    <div class="article-card">
      <a href="/articles/${article.slug}.html">
        ${article.image
          ? `<img class="article-thumb" src="${escapeHtml(article.image)}" alt="${escapeHtml(article.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="imgFail(this,'${escapeHtml(article.keyword || '뉴스').replace(/'/g, '')}',false)">`
          : `<div class="article-thumb-placeholder" style="background:${keywordGradient(article.keyword)}"># ${escapeHtml(article.keyword || '뉴스').substring(0, 6)}</div>`}
        <div class="article-info">
          <span class="article-tag"># ${escapeHtml(article.keyword || '')}</span>
          <h2 class="article-title">${escapeHtml(article.title)}</h2>
          <p class="article-desc">${escapeHtml(article.summary || '').substring(0, 100)}</p>
          <div class="article-meta">
            <span>${timeAgo(article.published_at || article.created_at)}</span>
            <span>·</span>
            <span>조회 ${article.views || 0}</span>
          </div>
        </div>
      </a>
    </div>`).join('\n');

  // 사이드바 실시간 검색어 순위 (클릭 시 기사 또는 검색 연결)
  const articleMap = {};
  articles.forEach(a => { if (a.keyword) articleMap[a.keyword] = a.slug; });

  const rankingHTML = topKeywords.slice(0, 20).map((kw, i) => {
    const keyword = typeof kw === 'string' ? kw : kw.keyword;
    const numClass = i < 3 ? `r${i + 1}` : '';
    const badge = i < 5 ? '<span class="ranking-badge badge-new">NEW</span>' : '';
    const slug = articleMap[keyword];
    const href = slug ? `/articles/${slug}.html` : `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
    const target = slug ? '' : ' target="_blank" rel="noopener"';
    return `
      <a class="ranking-item" href="${href}"${target} style="text-decoration:none;color:inherit;">
        <span class="ranking-num ${numClass}">${i + 1}</span>
        <span class="ranking-text">${escapeHtml(keyword)}</span>
        ${badge}
      </a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.site.title} - ${config.site.description}</title>
  <meta name="description" content="${config.site.description} 실시간 트렌딩 키워드 기반 최신 뉴스를 빠르게 전달합니다.">
  <meta name="keywords" content="실시간 뉴스, 트렌드 뉴스, 실시간 검색어, 인기 검색어, 최신 뉴스, 한국 뉴스">
  <meta name="robots" content="index, follow">
  <meta name="author" content="${config.site.title}">
  <link rel="canonical" href="${config.site.url}/">
  <link rel="alternate" type="application/rss+xml" title="${config.site.title} RSS" href="${config.site.url}/rss.xml">
  ${config.site.naverVerification ? `<meta name="naver-site-verification" content="${config.site.naverVerification}">` : ''}
  ${config.site.googleVerification ? `<meta name="google-site-verification" content="${config.site.googleVerification}">` : ''}

  <meta property="og:type" content="website">
  <meta property="og:title" content="${config.site.title}">
  <meta property="og:description" content="${config.site.description}">
  <meta property="og:url" content="${config.site.url}/">
  <meta property="og:site_name" content="${config.site.title}">
  <meta property="og:locale" content="ko_KR">

  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${config.site.title}">
  <meta name="twitter:description" content="${config.site.description}">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "${config.site.title}",
    "description": "${config.site.description}",
    "url": "${config.site.url}/",
    "potentialAction": {
      "@type": "SearchAction",
      "target": "${config.site.url}/?q={search_term_string}",
      "query-input": "required name=search_term_string"
    }
  }
  </script>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "itemListElement": [
      ${articles.slice(0, 10).map((a, i) => `{
        "@type": "ListItem",
        "position": ${i + 1},
        "url": "${config.site.url}/articles/${a.slug}.html",
        "name": "${escapeHtml(a.title)}"
      }`).join(',\n      ')}
    ]
  }
  </script>

  ${COMMON_CSS}
</head>
<body>
  ${imgFallbackScript()}
  ${navHTML()}
  ${trendBarHTML(topKeywords, articles)}

  <div class="container">
    <div class="main-grid">
      <main class="articles-section">
        <h2><span style="color:var(--accent-red);">●</span> 최신 트렌드 뉴스</h2>
        ${heroHTML}
        <div class="ad-slot"><!-- AdSense 피드 중간 광고 --></div>
        ${articleCards || '<p style="text-align:center;color:var(--text-muted);padding:40px;">시스템이 가동 중입니다. 곧 기사가 자동 생성됩니다.</p>'}
      </main>

      <aside class="sidebar">
        <div class="sidebar-box">
          <div class="sidebar-header">🔥 실시간 검색어 TOP 20</div>
          <div class="sidebar-body">
            ${rankingHTML || '<div style="padding:20px;text-align:center;color:var(--text-muted);">데이터 수집 중...</div>'}
          </div>
        </div>

        <div class="ad-slot"><!-- AdSense 사이드바 광고 --></div>

        <div class="sidebar-box">
          <div class="sidebar-header">ℹ️ 서비스 안내</div>
          <div class="sidebar-body" style="padding:16px 20px;font-size:0.85rem;color:var(--text-secondary);line-height:1.7;">
            실시간 트렌딩 키워드를 자동 감지하고, AI가 관련 뉴스를 분석하여 기사를 생성합니다. 
            3분마다 자동 업데이트됩니다.
          </div>
        </div>
      </aside>
    </div>
  </div>

  ${footerHTML()}

  <script>
    // 5분마다 자동 새로고침
    setTimeout(() => location.reload(), 5 * 60 * 1000);
  </script>
</body>
</html>`;
}

// ========== 사이트맵 ==========
function encodeSlugForUrl(slug) {
  // 한글 등 비-ASCII 문자를 퍼센트 인코딩 (사이트맵 표준 준수)
  return slug.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function generateSitemap(articles, baseUrl = '') {
  if (!baseUrl) baseUrl = config.site.url;
  const urls = articles.map(a => `
  <url>
    <loc>${baseUrl}/articles/${encodeSlugForUrl(a.slug)}.html</loc>
    <lastmod>${new Date(a.published_at || a.created_at || Date.now()).toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>always</changefreq>
    <priority>1.0</priority>
  </url>${urls}
</urlset>`;
}

// ========== Google News 사이트맵 ==========
function generateNewsSitemap(articles, baseUrl = '') {
  if (!baseUrl) baseUrl = config.site.url;
  const recentArticles = articles.filter(a => {
    const d = new Date(a.published_at || a.created_at);
    return (Date.now() - d.getTime()) < 48 * 3600000; // 48시간 이내
  });

  const urls = recentArticles.map(a => {
    const pubDate = new Date(a.published_at || a.created_at || Date.now());
    // Google News는 W3C Datetime (밀리초 없이) 권장
    const isoDate = pubDate.toISOString().replace(/\.\d{3}Z$/, '+00:00');
    return `
  <url>
    <loc>${baseUrl}/articles/${encodeSlugForUrl(a.slug)}.html</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeHtml(config.site.title)}</news:name>
        <news:language>ko</news:language>
      </news:publication>
      <news:publication_date>${isoDate}</news:publication_date>
      <news:title>${escapeHtml(a.title)}</news:title>
    </news:news>
  </url>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>`;
}

// ========== RSS ==========
function generateRSS(articles, baseUrl = '') {
  if (!baseUrl) baseUrl = config.site.url;
  const items = articles.slice(0, 50).map(a => `
    <item>
      <title><![CDATA[${a.title}]]></title>
      <link>${baseUrl}/articles/${a.slug}.html</link>
      <description><![CDATA[${a.summary || ''}]]></description>
      <pubDate>${new Date(a.published_at || a.created_at || Date.now()).toUTCString()}</pubDate>
      <guid isPermaLink="true">${baseUrl}/articles/${a.slug}.html</guid>
      <category>${a.keyword || ''}</category>
    </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${config.site.title}</title>
    <link>${baseUrl}</link>
    <description>${config.site.description}</description>
    <language>ko</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${baseUrl}/rss.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;
}

// ========== robots.txt ==========
function generateRobotsTxt(baseUrl = '') {
  if (!baseUrl) baseUrl = config.site.url;
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
Sitemap: ${baseUrl}/news-sitemap.xml

User-agent: Googlebot-News
Allow: /articles/
`;
}

// ========== 검색엔진 알림 (Ping) ==========
async function pingSearchEngines(articleUrl) {
  const sitemapUrl = `${config.site.url}/sitemap.xml`;
  const pings = [];

  // Google Ping
  pings.push(
    axios.get(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`, { timeout: 10000 })
      .then(() => logger.info(`[SEO] Google 사이트맵 ping 완료`))
      .catch(e => logger.debug(`[SEO] Google ping 실패: ${e.message}`))
  );

  // IndexNow (Bing/Naver/Yandex 동시 알림)
  pings.push(
    axios.post('https://api.indexnow.org/IndexNow', {
      host: new URL(config.site.url).hostname,
      key: 'fastnews_indexnow_key',
      keyLocation: `${config.site.url}/fastnews_indexnow_key.txt`,
      urlList: [articleUrl],
    }, { timeout: 10000, headers: { 'Content-Type': 'application/json' } })
      .then(() => logger.info(`[SEO] IndexNow ping 완료: ${articleUrl}`))
      .catch(e => logger.debug(`[SEO] IndexNow ping 실패: ${e.message}`))
  );

  await Promise.allSettled(pings);
}

// ========== 퍼블리시 함수 ==========
function publishArticle(article, trendKeywords) {
  try {
    const html = articleTemplate(article, trendKeywords || []);
    const filePath = path.join(ARTICLES_DIR, `${article.slug}.html`);
    fs.writeFileSync(filePath, html, 'utf8');
    logger.info(`[퍼블리셔] 기사 발행: ${article.slug}.html`);

    // 검색엔진에 비동기 알림 (실패해도 무시)
    const articleUrl = `${config.site.url}/articles/${article.slug}.html`;
    pingSearchEngines(articleUrl).catch(() => {});

    return filePath;
  } catch (error) {
    logger.error(`[퍼블리셔] 기사 발행 실패: ${error.message}`);
    return null;
  }
}

function updateIndex(articles, trendKeywords) {
  try {
    const html = indexTemplate(articles, trendKeywords || []);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html, 'utf8');

    const sitemap = generateSitemap(articles);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap.xml'), sitemap, 'utf8');

    const newsSitemap = generateNewsSitemap(articles);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'news-sitemap.xml'), newsSitemap, 'utf8');

    const rss = generateRSS(articles);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'rss.xml'), rss, 'utf8');

    const robots = generateRobotsTxt();
    fs.writeFileSync(path.join(OUTPUT_DIR, 'robots.txt'), robots, 'utf8');

    // IndexNow 키 파일 (Bing/Naver 인덱싱용)
    fs.writeFileSync(path.join(OUTPUT_DIR, 'fastnews_indexnow_key.txt'), 'fastnews_indexnow_key', 'utf8');

    // ads.txt (AdSense 준비용)
    if (!fs.existsSync(path.join(OUTPUT_DIR, 'ads.txt'))) {
      fs.writeFileSync(path.join(OUTPUT_DIR, 'ads.txt'), '# Google AdSense\n# google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0\n# 위 pub-ID를 실제 AdSense 게시자 ID로 교체하세요\n', 'utf8');
    }

    logger.info(`[퍼블리셔] 전체 갱신 완료 (${articles.length}개 기사, sitemap, news-sitemap, RSS, robots.txt)`);
  } catch (error) {
    logger.error(`[퍼블리셔] 인덱스 갱신 실패: ${error.message}`);
  }
}

module.exports = {
  publishArticle, updateIndex, generateSitemap, generateNewsSitemap,
  generateRSS, generateRobotsTxt, articleTemplate, indexTemplate,
  pingSearchEngines, OUTPUT_DIR, ARTICLES_DIR,
};
