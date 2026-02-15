// ============================================
// publisher.js - 프로페셔널 뉴스 포털 디자인 + SEO
// ============================================
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const axios = require('axios');
const logger = require('./logger');
const config = require('./config');

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

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr || '';
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dateStr || ''; }
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
<style>
  @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css');

  :root {
    --primary: #1e3a5f;
    --primary-light: #2c5282;
    --accent: #c0392b;
    --bg: #f4f4f4;
    --card: #fff;
    --text: #222;
    --text-sub: #555;
    --text-muted: #999;
    --border: #e0e0e0;
    --border-light: #efefef;
    --max-width: 1140px;
  }

  * { margin:0; padding:0; box-sizing:border-box; }

  body {
    font-family: 'Pretendard Variable', -apple-system, BlinkMacSystemFont, system-ui, 'Malgun Gothic', sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    word-break: keep-all;
  }

  a { color: inherit; text-decoration: none; }
  img { max-width: 100%; }

  .site-header {
    background: #fff;
    border-bottom: 2px solid var(--primary);
  }
  .header-inner {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 0 20px;
  }
  .header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
  }
  .logo { display: flex; align-items: baseline; gap: 8px; }
  .logo-text {
    font-size: 1.55rem;
    font-weight: 900;
    color: var(--primary);
    letter-spacing: -1px;
  }
  .header-date {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .nav-bar { background: var(--primary); }
  .nav-inner {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 0 20px;
    display: flex;
    align-items: center;
    overflow-x: auto;
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .nav-inner::-webkit-scrollbar { display:none; }
  .nav-link {
    display: block;
    padding: 9px 16px;
    font-size: 0.84rem;
    font-weight: 600;
    color: rgba(255,255,255,0.8);
    white-space: nowrap;
    transition: color .15s, background .15s;
  }
  .nav-link:hover, .nav-link.active {
    color: #fff;
    background: rgba(255,255,255,0.08);
  }

  .trend-ticker {
    background: #fff;
    border-bottom: 1px solid var(--border);
  }
  .ticker-inner {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 0 20px;
    display: flex;
    align-items: center;
    height: 36px;
    gap: 12px;
  }
  .ticker-label {
    font-size: 0.73rem;
    font-weight: 700;
    color: var(--accent);
    white-space: nowrap;
    flex-shrink: 0;
    padding-right: 12px;
    border-right: 1px solid var(--border);
  }
  .ticker-scroll { flex:1; overflow:hidden; position:relative; }
  .ticker-track {
    display: flex;
    gap: 0;
    animation: tickScroll 40s linear infinite;
    will-change: transform;
  }
  .ticker-track:hover { animation-play-state: paused; }
  @keyframes tickScroll {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  .ticker-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    padding: 2px 10px;
    font-size: 0.77rem;
    color: var(--text-sub);
    transition: color .12s;
    flex-shrink: 0;
  }
  .ticker-item:hover { color: var(--primary); }
  .ticker-rank {
    font-weight: 800;
    font-size: 0.7rem;
    color: var(--text-muted);
    min-width: 12px;
  }
  .ticker-rank.top { color: var(--accent); }
  .ticker-kw { font-weight: 500; }
  .ticker-sep {
    color: #ddd;
    font-size: 0.55rem;
    margin: 0 2px;
    flex-shrink: 0;
  }

  .container {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 18px 20px;
  }
  .main-grid {
    display: grid;
    grid-template-columns: 1fr 280px;
    gap: 22px;
  }
  @media (max-width: 840px) {
    .main-grid { grid-template-columns: 1fr; }
    .sidebar { order: -1; }
  }

  .section-title {
    font-size: 0.95rem;
    font-weight: 800;
    color: var(--text);
    padding-bottom: 9px;
    margin-bottom: 14px;
    border-bottom: 2px solid var(--primary);
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .section-title .bar {
    display: inline-block;
    width: 3px;
    height: 14px;
    background: var(--accent);
  }

  .hero {
    background: var(--card);
    border: 1px solid var(--border-light);
    margin-bottom: 2px;
    overflow: hidden;
  }
  .hero a { display:block; }
  .hero-img-wrap {
    position: relative;
    width: 100%;
    height: 300px;
    overflow: hidden;
    background: #e8e8e8;
  }
  .hero-img-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform .3s;
  }
  .hero:hover img { transform: scale(1.02); }
  .hero-overlay {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 50px 20px 18px;
    background: linear-gradient(transparent, rgba(0,0,0,0.65));
  }
  .hero-overlay .label {
    display: inline-block;
    font-size: 0.68rem;
    font-weight: 700;
    color: #fff;
    background: var(--accent);
    padding: 2px 7px;
    margin-bottom: 6px;
  }
  .hero-overlay h1 {
    font-size: 1.4rem;
    font-weight: 800;
    color: #fff;
    line-height: 1.35;
    letter-spacing: -0.3px;
    text-shadow: 0 1px 3px rgba(0,0,0,0.25);
  }
  .hero-no-img {
    width: 100%; height: 160px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #eee;
    color: #ccc;
  }
  .hero-body { padding: 14px 18px 18px; }
  .hero-kw {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--primary);
    margin-bottom: 5px;
  }
  .hero-title-text {
    font-size: 1.3rem;
    font-weight: 800;
    color: var(--text);
    line-height: 1.35;
    margin-bottom: 7px;
    letter-spacing: -0.3px;
  }
  .hero-desc {
    font-size: 0.88rem;
    color: var(--text-sub);
    line-height: 1.65;
    margin-bottom: 8px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .hero-meta {
    font-size: 0.73rem;
    color: var(--text-muted);
  }

  .article-list { margin-top: 0; }
  .article-item {
    display: flex;
    gap: 14px;
    padding: 13px 0;
    border-bottom: 1px solid var(--border-light);
    transition: background .12s;
  }
  .article-item:hover { background: #fafafa; }
  .article-item:last-child { border-bottom: none; }
  .article-thumb {
    width: 115px; min-width: 115px; height: 76px;
    border-radius: 2px;
    object-fit: cover;
    background: #e8e8e8;
    flex-shrink: 0;
  }
  .article-thumb-empty {
    width: 115px; min-width: 115px; height: 76px;
    border-radius: 2px;
    background: #f0f0f0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #d0d0d0;
    flex-shrink: 0;
  }
  .article-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .article-kw {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--primary);
    margin-bottom: 2px;
  }
  .article-title {
    font-size: 0.93rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1.4;
    margin-bottom: 3px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    letter-spacing: -0.2px;
  }
  .article-desc {
    font-size: 0.78rem;
    color: var(--text-sub);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .article-time {
    font-size: 0.7rem;
    color: var(--text-muted);
    margin-top: 3px;
  }

  .sidebar-box {
    background: var(--card);
    border: 1px solid var(--border-light);
    margin-bottom: 14px;
  }
  .sidebar-header {
    padding: 11px 15px;
    font-weight: 800;
    font-size: 0.83rem;
    border-bottom: 2px solid var(--primary);
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sidebar-header small {
    font-weight: 400;
    font-size: 0.68rem;
    color: var(--text-muted);
  }
  .sidebar-body { padding: 0; }

  .rank-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 15px;
    border-bottom: 1px solid var(--border-light);
    transition: background .1s;
    font-size: 0.82rem;
  }
  .rank-item:last-child { border-bottom: none; }
  .rank-item:hover { background: #f8f8f8; }
  .rank-num {
    font-size: 0.8rem;
    font-weight: 800;
    min-width: 18px;
    text-align: center;
    color: var(--text-muted);
  }
  .rank-num.top { color: var(--accent); }
  .rank-text {
    flex: 1;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rank-badge {
    font-size: 0.58rem;
    padding: 1px 5px;
    border-radius: 2px;
    font-weight: 700;
    background: #fff0f0;
    color: var(--accent);
  }

  .article-page {
    max-width: 680px;
    margin: 0 auto;
    padding: 24px 20px;
  }
  .article-page-header { margin-bottom: 22px; }
  .article-page-kw {
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--primary);
    margin-bottom: 8px;
  }
  .article-page-title {
    font-size: 1.65rem;
    font-weight: 900;
    line-height: 1.32;
    letter-spacing: -0.5px;
    margin-bottom: 12px;
    color: var(--text);
  }
  .article-page-hero-img {
    width: 100%;
    max-height: 400px;
    object-fit: cover;
    margin-bottom: 18px;
    display: block;
  }
  .article-page-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 0.8rem;
    color: var(--text-muted);
    padding: 12px 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .article-page-body {
    font-size: 1rem;
    line-height: 1.85;
    color: #333;
    margin-top: 22px;
  }
  .article-page-body h2 {
    font-size: 1.18rem;
    font-weight: 800;
    margin: 30px 0 10px;
    padding: 0 0 7px;
    border-bottom: 1px solid var(--border-light);
    color: var(--text);
  }
  .article-page-body h3 {
    font-size: 1.03rem;
    font-weight: 700;
    margin: 22px 0 7px;
    color: var(--text);
  }
  .article-page-body p { margin: 10px 0; }
  .article-page-body ul,
  .article-page-body ol { padding-left: 20px; margin: 8px 0; }
  .article-page-body li { margin: 3px 0; }
  .article-page-body blockquote {
    border-left: 3px solid var(--primary);
    padding: 8px 14px;
    background: #f9f9f9;
    margin: 12px 0;
    color: var(--text-sub);
    font-size: 0.94rem;
  }
  .article-page-body strong { color: var(--text); }
  .article-page-body img { max-width:100%; height:auto; margin:14px 0; }

  .article-sources {
    margin-top: 28px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .article-sources strong { color: var(--text-sub); font-size: 0.82rem; }
  .article-sources a { color: var(--primary-light); word-break: break-all; }
  .article-sources a:hover { text-decoration: underline; }

  .article-share {
    margin-top: 20px;
    padding: 14px 0;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .article-share-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-sub);
    margin-right: 4px;
  }
  .share-btn {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 2px;
    font-size: 0.73rem;
    color: #fff;
    text-decoration: none;
    font-weight: 600;
    border: none;
    cursor: pointer;
  }
  .share-tw { background: #1DA1F2; }
  .share-fb { background: #1877F2; }
  .share-cp { background: #777; }

  .breadcrumb {
    font-size: 0.76rem;
    color: var(--text-muted);
    margin-bottom: 14px;
  }
  .breadcrumb a { color: var(--text-sub); }
  .breadcrumb a:hover { text-decoration: underline; }
  .breadcrumb .sep { margin: 0 4px; }

  .site-footer {
    background: var(--primary);
    color: rgba(255,255,255,0.65);
    margin-top: 28px;
  }
  .footer-inner {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 24px 20px;
  }
  .footer-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    margin-bottom: 10px;
  }
  .footer-brand {
    font-size: 1rem;
    font-weight: 800;
    color: #fff;
    margin-bottom: 3px;
  }
  .footer-desc {
    font-size: 0.72rem;
    color: rgba(255,255,255,0.4);
    line-height: 1.5;
  }
  .footer-links { display: flex; gap: 12px; flex-wrap: wrap; }
  .footer-links a {
    font-size: 0.76rem;
    color: rgba(255,255,255,0.55);
    transition: color .12s;
  }
  .footer-links a:hover { color: #fff; }
  .footer-copy {
    font-size: 0.7rem;
    color: rgba(255,255,255,0.3);
  }

  @media (max-width: 600px) {
    .header-top { padding: 8px 0; }
    .logo-text { font-size: 1.25rem; }
    .hero-img-wrap { height: 200px; }
    .hero-overlay h1 { font-size: 1.1rem; }
    .hero-body { padding: 10px 12px 14px; }
    .hero-title-text { font-size: 1.05rem; }
    .article-thumb, .article-thumb-empty { width: 86px; min-width: 86px; height: 58px; }
    .article-title { font-size: 0.86rem; }
    .article-page-title { font-size: 1.3rem; }
    .article-page-body { font-size: 0.94rem; }
    .nav-link { padding: 7px 11px; font-size: 0.78rem; }
    .rank-item { padding: 7px 12px; }
  }
</style>
`;

// ========== SVG placeholders ==========
const THUMB_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
const HERO_SVG = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

// ========== 실시간 검색어 티커 ==========
function trendTickerHTML(trendKeywords, articles) {
  if (!trendKeywords || trendKeywords.length === 0) return '';

  const articleMap = {};
  if (articles) articles.forEach(a => { if (a.keyword) articleMap[a.keyword] = a.slug; });

  const kwList = [...trendKeywords, ...trendKeywords];
  const items = kwList.map((kw, i) => {
    const rank = (i % trendKeywords.length) + 1;
    const keyword = typeof kw === 'string' ? kw : kw.keyword;
    const slug = articleMap[keyword];
    const href = slug ? `/articles/${slug}.html` : `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
    const target = slug ? '' : ' target="_blank" rel="noopener"';
    const cls = rank <= 3 ? 'top' : '';
    return `<a class="ticker-item" href="${href}"${target}><span class="ticker-rank ${cls}">${rank}</span><span class="ticker-kw">${escapeHtml(keyword)}</span></a><span class="ticker-sep">|</span>`;
  }).join('');

  return `
  <div class="trend-ticker">
    <div class="ticker-inner">
      <span class="ticker-label">실시간 검색어</span>
      <div class="ticker-scroll">
        <div class="ticker-track">${items}</div>
      </div>
    </div>
  </div>`;
}

// ========== 헤더 ==========
function headerHTML() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  return `
  <header class="site-header">
    <div class="header-inner">
      <div class="header-top">
        <a href="/" class="logo">
          <span class="logo-text">${escapeHtml(config.site.title)}</span>
        </a>
        <div class="header-date">${dateStr}</div>
      </div>
    </div>
  </header>
  <nav class="nav-bar">
    <div class="nav-inner">
      <a class="nav-link active" href="/">홈</a>
      <a class="nav-link" href="https://search.naver.com/search.naver?where=news&query=%EC%86%8D%EB%B3%B4&sort=1" target="_blank" rel="noopener">속보</a>
      <a class="nav-link" href="https://search.naver.com/search.naver?where=news&query=%EC%82%AC%ED%9A%8C&sort=1" target="_blank" rel="noopener">사회</a>
      <a class="nav-link" href="https://search.naver.com/search.naver?where=news&query=%EA%B2%BD%EC%A0%9C&sort=1" target="_blank" rel="noopener">경제</a>
      <a class="nav-link" href="https://search.naver.com/search.naver?where=news&query=%EC%97%B0%EC%98%88&sort=1" target="_blank" rel="noopener">연예</a>
      <a class="nav-link" href="https://search.naver.com/search.naver?where=news&query=%EC%8A%A4%ED%8F%AC%EC%B8%A0&sort=1" target="_blank" rel="noopener">스포츠</a>
      <a class="nav-link" href="https://search.naver.com/search.naver?where=news&query=IT%C2%B7%EA%B3%BC%ED%95%99&sort=1" target="_blank" rel="noopener">IT·과학</a>
    </div>
  </nav>`;
}

// ========== 푸터 ==========
function footerHTML() {
  return `
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-top">
        <div>
          <div class="footer-brand">${escapeHtml(config.site.title)}</div>
          <div class="footer-desc">빠르고 정확한 뉴스를 전합니다.</div>
        </div>
        <div class="footer-links">
          <a href="/">홈</a>
          <a href="/rss.xml">RSS</a>
          <a href="/sitemap.xml">사이트맵</a>
        </div>
      </div>
      <div class="footer-copy">&copy; ${new Date().getFullYear()} ${escapeHtml(config.site.title)}. All rights reserved.</div>
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
  <title>${escapeHtml(article.title)} - ${config.site.title}</title>
  <meta name="description" content="${escapeHtml(article.summary || '')}">
  <meta name="keywords" content="${escapeHtml(article.keyword || '')}, 뉴스, ${escapeHtml(article.keyword || '')} 최신">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="author" content="${config.site.title}">
  <link rel="canonical" href="${config.site.url}${pageUrl}">
  <link rel="alternate" type="application/rss+xml" title="${config.site.title} RSS" href="${config.site.url}/rss.xml">
  ${config.site.naverVerification ? `<meta name="naver-site-verification" content="${config.site.naverVerification}">` : ''}
  ${config.site.googleVerification ? `<meta name="google-site-verification" content="${config.site.googleVerification}">` : ''}

  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(article.title)}">
  <meta property="og:description" content="${escapeHtml(article.summary || '')}">
  <meta property="og:url" content="${config.site.url}${pageUrl}">
  <meta property="og:site_name" content="${config.site.title}">
  <meta property="og:locale" content="ko_KR">
  ${articleImage ? `<meta property="og:image" content="${escapeHtml(articleImage)}">` : ''}
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="article:published_time" content="${publishDate}">
  <meta property="article:modified_time" content="${publishDate}">
  <meta property="article:section" content="뉴스">
  <meta property="article:tag" content="${escapeHtml(article.keyword || '')}">

  <meta name="twitter:card" content="${articleImage ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeHtml(article.title)}">
  <meta name="twitter:description" content="${escapeHtml(article.summary || '')}">
  ${articleImage ? `<meta name="twitter:image" content="${escapeHtml(articleImage)}">` : ''}

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
      "logo": { "@type": "ImageObject", "url": "/logo.png" }
    },
    "mainEntityOfPage": { "@type": "WebPage", "@id": "${config.site.url}${pageUrl}" },
    ${articleImage ? `"image": "${escapeHtml(articleImage)}",` : ''}
    "keywords": "${escapeHtml(article.keyword || '')}",
    "articleSection": "뉴스"
  }
  </script>

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
  ${headerHTML()}
  ${trendTickerHTML(trendKeywords)}

  <div class="container">
    <nav class="breadcrumb">
      <a href="/">홈</a><span class="sep">›</span><span>${escapeHtml(article.keyword || '')}</span>
    </nav>

    <article class="article-page">
      <header class="article-page-header">
        <div class="article-page-kw">${escapeHtml(article.keyword || '')}</div>
        <h1 class="article-page-title">${escapeHtml(article.title)}</h1>
        ${articleImage ? `<img class="article-page-hero-img" src="${escapeHtml(articleImage)}" alt="${escapeHtml(article.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
        <div class="article-page-meta">
          <span>${config.site.title}</span>
          <span>|</span>
          <span>${formatDate(publishDate)}</span>
        </div>
      </header>

      <div class="article-page-body">
        ${htmlContent}
      </div>

      ${sourceUrls.length > 0 ? `
      <div class="article-sources">
        <strong>참고 자료</strong>
        ${sourceUrls.slice(0, 5).map(url => `<div style="margin-top:4px;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(url.substring(0, 80))}${url.length > 80 ? '...' : ''}</a></div>`).join('')}
      </div>` : ''}

      <div class="article-share">
        <span class="article-share-label">공유</span>
        <a class="share-btn share-tw" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(article.title)}&url=${encodeURIComponent(config.site.url + pageUrl)}" target="_blank" rel="noopener">Twitter</a>
        <a class="share-btn share-fb" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(config.site.url + pageUrl)}" target="_blank" rel="noopener">Facebook</a>
        <button class="share-btn share-cp" onclick="navigator.clipboard.writeText(location.href);this.textContent='복사됨';">링크복사</button>
      </div>
    </article>
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

  function imgFallbackScript() {
    return `
  <script>
    function imgFail(el, isHero) {
      if (isHero) {
        el.parentElement.innerHTML = '<div class="hero-no-img">${HERO_SVG.replace(/'/g, "\\'")}</div>';
      } else {
        el.outerHTML = '<div class="article-thumb-empty">${THUMB_SVG.replace(/'/g, "\\'")}</div>';
      }
    }
  </script>`;
  }

  var heroHTML = '';
  if (heroArticle) {
    if (heroArticle.image) {
      heroHTML = `
    <div class="hero">
      <a href="/articles/${heroArticle.slug}.html">
        <div class="hero-img-wrap">
          <img src="${escapeHtml(heroArticle.image)}" alt="${escapeHtml(heroArticle.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="imgFail(this, true)">
          <div class="hero-overlay">
            <span class="label">${escapeHtml(heroArticle.keyword || '뉴스')}</span>
            <h1>${escapeHtml(heroArticle.title)}</h1>
          </div>
        </div>
        <div class="hero-body">
          <p class="hero-desc">${escapeHtml(heroArticle.summary || '').substring(0, 160)}</p>
          <div class="hero-meta">${timeAgo(heroArticle.published_at || heroArticle.created_at)}</div>
        </div>
      </a>
    </div>`;
    } else {
      heroHTML = `
    <div class="hero">
      <a href="/articles/${heroArticle.slug}.html">
        <div class="hero-body">
          <div class="hero-kw">${escapeHtml(heroArticle.keyword || '')}</div>
          <h1 class="hero-title-text">${escapeHtml(heroArticle.title)}</h1>
          <p class="hero-desc">${escapeHtml(heroArticle.summary || '').substring(0, 200)}</p>
          <div class="hero-meta">${timeAgo(heroArticle.published_at || heroArticle.created_at)}</div>
        </div>
      </a>
    </div>`;
    }
  }

  const articleCards = restArticles.map(article => `
    <a class="article-item" href="/articles/${article.slug}.html">
      ${article.image
        ? `<img class="article-thumb" src="${escapeHtml(article.image)}" alt="${escapeHtml(article.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="imgFail(this, false)">`
        : `<div class="article-thumb-empty">${THUMB_SVG}</div>`}
      <div class="article-info">
        <div class="article-kw">${escapeHtml(article.keyword || '')}</div>
        <h2 class="article-title">${escapeHtml(article.title)}</h2>
        <p class="article-desc">${escapeHtml(article.summary || '').substring(0, 80)}</p>
        <div class="article-time">${timeAgo(article.published_at || article.created_at)}</div>
      </div>
    </a>`).join('\n');

  const articleMap = {};
  articles.forEach(a => { if (a.keyword) articleMap[a.keyword] = a.slug; });

  const now = new Date();
  const updateTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ' 기준';

  const rankingHTML = topKeywords.slice(0, 20).map((kw, i) => {
    const keyword = typeof kw === 'string' ? kw : kw.keyword;
    const numClass = i < 3 ? 'top' : '';
    const badge = i < 5 ? '<span class="rank-badge">NEW</span>' : '';
    const slug = articleMap[keyword];
    const href = slug ? `/articles/${slug}.html` : `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
    const target = slug ? '' : ' target="_blank" rel="noopener"';
    return `
      <a class="rank-item" href="${href}"${target}>
        <span class="rank-num ${numClass}">${i + 1}</span>
        <span class="rank-text">${escapeHtml(keyword)}</span>
        ${badge}
      </a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.site.title} - ${config.site.description}</title>
  <meta name="description" content="${config.site.description}">
  <meta name="keywords" content="실시간 뉴스, 트렌드 뉴스, 실시간 검색어, 인기 검색어, 최신 뉴스">
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
    "url": "${config.site.url}/"
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
  ${headerHTML()}
  ${trendTickerHTML(topKeywords, articles)}

  <div class="container">
    <div class="main-grid">
      <main class="articles-section">
        <div class="section-title"><span class="bar"></span> 최신 뉴스</div>
        ${heroHTML}
        <div class="article-list">
          ${articleCards || '<p style="text-align:center;color:var(--text-muted);padding:36px 0;font-size:0.88rem;">기사를 준비하고 있습니다.</p>'}
        </div>
      </main>

      <aside class="sidebar">
        <div class="sidebar-box">
          <div class="sidebar-header">
            <span>실시간 검색어</span>
            <small>${updateTime}</small>
          </div>
          <div class="sidebar-body">
            ${rankingHTML || '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:0.8rem;">잠시 후 업데이트됩니다.</div>'}
          </div>
        </div>
      </aside>
    </div>
  </div>

  ${footerHTML()}

  <script>setTimeout(function(){ location.reload(); }, 5*60*1000);</script>
</body>
</html>`;
}

// ========== 사이트맵 ==========
function generateSitemap(articles, baseUrl) {
  if (!baseUrl) baseUrl = config.site.url;
  const urls = articles.map(a => `
  <url>
    <loc>${baseUrl}/articles/${a.slug}.html</loc>
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
function generateNewsSitemap(articles, baseUrl) {
  if (!baseUrl) baseUrl = config.site.url;
  const recentArticles = articles.filter(a => {
    const d = new Date(a.published_at || a.created_at);
    return (Date.now() - d.getTime()) < 48 * 3600000;
  });

  const urls = recentArticles.map(a => `
  <url>
    <loc>${baseUrl}/articles/${a.slug}.html</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeHtml(config.site.title)}</news:name>
        <news:language>ko</news:language>
      </news:publication>
      <news:publication_date>${new Date(a.published_at || a.created_at || Date.now()).toISOString()}</news:publication_date>
      <news:title>${escapeHtml(a.title)}</news:title>
      <news:keywords>${escapeHtml(a.keyword || '')}</news:keywords>
    </news:news>
  </url>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>`;
}

// ========== RSS ==========
function generateRSS(articles, baseUrl) {
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
function generateRobotsTxt(baseUrl) {
  if (!baseUrl) baseUrl = config.site.url;
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
Sitemap: ${baseUrl}/news-sitemap.xml

User-agent: Googlebot-News
Allow: /articles/
`;
}

// ========== 검색엔진 알림 ==========
async function pingSearchEngines(articleUrl) {
  const sitemapUrl = `${config.site.url}/sitemap.xml`;
  const pings = [];

  pings.push(
    axios.get(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`, { timeout: 10000 })
      .then(() => logger.info('[SEO] Google sitemap ping 완료'))
      .catch(e => logger.debug('[SEO] Google ping 실패: ' + e.message))
  );

  pings.push(
    axios.post('https://api.indexnow.org/IndexNow', {
      host: new URL(config.site.url).hostname,
      key: 'fastnews_indexnow_key',
      keyLocation: `${config.site.url}/fastnews_indexnow_key.txt`,
      urlList: [articleUrl],
    }, { timeout: 10000, headers: { 'Content-Type': 'application/json' } })
      .then(() => logger.info('[SEO] IndexNow ping 완료: ' + articleUrl))
      .catch(e => logger.debug('[SEO] IndexNow ping 실패: ' + e.message))
  );

  await Promise.allSettled(pings);
}

// ========== 퍼블리시 ==========
function publishArticle(article, trendKeywords) {
  try {
    const html = articleTemplate(article, trendKeywords || []);
    const filePath = path.join(ARTICLES_DIR, `${article.slug}.html`);
    fs.writeFileSync(filePath, html, 'utf8');
    logger.info(`[퍼블리셔] 기사 발행: ${article.slug}.html`);

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

    fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap.xml'), generateSitemap(articles), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'news-sitemap.xml'), generateNewsSitemap(articles), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'rss.xml'), generateRSS(articles), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'robots.txt'), generateRobotsTxt(), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'fastnews_indexnow_key.txt'), 'fastnews_indexnow_key', 'utf8');

    if (!fs.existsSync(path.join(OUTPUT_DIR, 'ads.txt'))) {
      fs.writeFileSync(path.join(OUTPUT_DIR, 'ads.txt'), '# Google AdSense\n# google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0\n', 'utf8');
    }

    logger.info(`[퍼블리셔] 전체 갱신 완료 (${articles.length}개 기사)`);
  } catch (error) {
    logger.error(`[퍼블리셔] 인덱스 갱신 실패: ${error.message}`);
  }
}

module.exports = {
  publishArticle, updateIndex, generateSitemap, generateNewsSitemap,
  generateRSS, generateRobotsTxt, articleTemplate, indexTemplate,
  pingSearchEngines, OUTPUT_DIR, ARTICLES_DIR,
};
