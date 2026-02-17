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

const NAV_CATEGORIES = ['연예', '스포츠', '경제', '사회', 'IT·과학', '정치'];

function normalizeSlug(slug) {
  return String(slug || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(segment => segment.replace(/\.\./g, '-'))
    .join('-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// URL 내 한글 등 비-ASCII 문자를 퍼센트 인코딩 (사이트맵/RSS 표준 준수)
function encodeSlugForUrl(slug) {
  const safeSlug = normalizeSlug(slug);
  return safeSlug.split('/').map(s => encodeURIComponent(s)).join('/');
}

function articlePathFromSlug(slug) {
  return `/articles/${encodeSlugForUrl(slug)}.html`;
}

function categoryPath(category) {
  return `/category/${encodeURIComponent(category)}`;
}

function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function cleanupSplitSitemaps(keepPages = 0) {
  if (!fs.existsSync(SITEMAP_DIR)) return;
  const files = fs.readdirSync(SITEMAP_DIR);
  files
    .filter(name => /^sitemap-\d+\.xml$/.test(name))
    .forEach(name => {
      const page = Number(name.match(/\d+/)?.[0] || 0);
      if (page > keepPages || keepPages === 0) {
        fs.unlinkSync(path.join(SITEMAP_DIR, name));
      }
    });
}

function stripMarkdown(text) {
  if (!text) return '';
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_~\-]{1,3}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMetaDescription(summary, content, keyword) {
  const base = stripMarkdown(summary) || stripMarkdown(content) || `${keyword || '뉴스'} 관련 최신 소식`;
  const clipped = base.length > 155 ? `${base.substring(0, 152)}...` : base;
  return clipped || `${keyword || '뉴스'} 관련 최신 소식`;
}

function wrapCdata(text) {
  return `<![CDATA[${String(text || '').replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

function categorySeoLabel(category) {
  return category === '뉴스' ? '최신 뉴스' : `${category} 뉴스`;
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// JSON-LD용 이스케이프 (HTML 엔티티가 아닌 JSON 표준 이스케이프)
function escapeJson(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
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
// ========== 공통 HEAD 메타 (favicon, theme-color, font preload) ==========
function commonHeadMeta(currentPath) {
  const pageUrl = currentPath ? `${config.site.url}${currentPath}` : `${config.site.url}/`;
  return `
  <link rel="icon" href="${config.site.url}/favicon.ico" type="image/x-icon">
  <link rel="icon" type="image/png" sizes="32x32" href="${config.site.url}/favicon-32x32.png">
  <meta name="theme-color" content="#1e3a5f">
  <link rel="alternate" hreflang="ko" href="${pageUrl}">
  <link rel="alternate" hreflang="x-default" href="${pageUrl}">
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="preload" as="style" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"></noscript>`;
}

const COMMON_CSS = `
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

  const limitedKw = trendKeywords.slice(0, 20);
  const kwList = [...limitedKw, ...limitedKw];
  const items = kwList.map((kw, i) => {
    const rank = (i % limitedKw.length) + 1;
    const keyword = typeof kw === 'string' ? kw : kw.keyword;
    const slug = articleMap[keyword];
    const href = slug ? articlePathFromSlug(slug) : `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
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
  const navLinks = NAV_CATEGORIES.map(category => `<a class="nav-link" href="${categoryPath(category)}">${escapeHtml(category)}</a>`).join('\n      ');
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
      ${navLinks}
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
          <a href="/archive">전체기사</a>
          <a href="/rss.xml">RSS</a>
          <a href="/sitemap.xml">사이트맵</a>
        </div>
      </div>
      <div class="footer-copy">&copy; ${new Date().getFullYear()} ${escapeHtml(config.site.title)}. All rights reserved.</div>
    </div>
  </footer>`;
}

// ========== 카테고리 분류 ==========
const CATEGORY_MAP = {
  '연예': ['아이돌', '드라마', '배우', '가수', '연예인', '예능', '방송', '뮤직', '콘서트', '아이브', '방탄', 'BTS', 'K-pop', '뮤직어워즈', '레드카펫', '열애', '결혼', '이혼', '스타', '팬', '엔터', '음원', '앨범', '컴백', '데뷔'],
  '스포츠': ['야구', '축구', '농구', '배구', '골프', '올림픽', '월드컵', 'KBO', 'EPL', 'LCK', '선수', '감독', '경기', '우승', '승리', '패배', '리그', '대회', 'e스포츠', '쇼트트랙', '스케이팅', '피겨'],
  '경제': ['주식', '코스피', '코스닥', '부동산', '금리', '환율', '투자', '경제', '기업', '매출', '수출', '물가', '임금', '취업', 'GDP', '은행'],
  '사회': ['사건', '사고', '재판', '검찰', '경찰', '법원', '교육', '환경', '의료', '복지', '인구', '저출생', '고령화'],
  'IT·과학': ['AI', '인공지능', '반도체', '삼성', '애플', '구글', '네이버', '카카오', '테슬라', '자율주행', '로봇', '우주', '과학', 'IT', '앱', '게임'],
  '정치': ['대통령', '국회', '정당', '선거', '여당', '야당', '정치', '외교', '안보', '장관', '총리'],
};

function categorizeArticle(keyword, title, tags) {
  const text = `${keyword} ${title} ${(tags || []).join(' ')}`.toLowerCase();
  let bestCategory = '뉴스';
  let bestScore = 0;
  for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
    const score = keywords.filter(k => text.includes(k.toLowerCase())).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }
  return bestCategory;
}

// ========== 관련 기사 매칭 (키워드/태그 기반) ==========
function getRelatedArticles(currentArticle, allArticles, maxCount = 6) {
  if (!allArticles || allArticles.length === 0) return [];
  
  const currentTags = new Set(
    (typeof currentArticle.tags === 'string' ? currentArticle.tags.split(',') : (currentArticle.tags || []))
      .map(t => t.trim().toLowerCase())
  );
  const currentKeyword = (currentArticle.keyword || '').toLowerCase();
  const currentCategory = categorizeArticle(currentArticle.keyword, currentArticle.title, currentArticle.tags);

  const scored = allArticles
    .filter(a => a.slug !== currentArticle.slug && a.title !== currentArticle.title)
    .map(a => {
      let score = 0;
      const aKeyword = (a.keyword || '').toLowerCase();
      const aTags = (typeof a.tags === 'string' ? a.tags.split(',') : (a.tags || []))
        .map(t => t.trim().toLowerCase());
      const aCategory = categorizeArticle(a.keyword, a.title, a.tags);

      // 같은 키워드: 최고 점수
      if (aKeyword === currentKeyword) score += 10;
      // 키워드가 상대방 태그에 포함
      if (aTags.includes(currentKeyword)) score += 5;
      if (currentTags.has(aKeyword)) score += 5;
      // 태그 겹침
      const tagOverlap = aTags.filter(t => currentTags.has(t)).length;
      score += tagOverlap * 3;
      // 같은 카테고리
      if (aCategory === currentCategory) score += 2;
      // 최신 기사 가산점
      const ageHours = (Date.now() - new Date(a.published_at || a.created_at).getTime()) / 3600000;
      if (ageHours < 6) score += 2;
      else if (ageHours < 24) score += 1;

      return { article: a, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // 점수 있는 기사로 채우고, 부족하면 최신 기사로 보충
  const results = scored.slice(0, maxCount).map(s => s.article);
  if (results.length < maxCount) {
    const usedSlugs = new Set(results.map(r => r.slug));
    usedSlugs.add(currentArticle.slug);
    const recent = allArticles
      .filter(a => !usedSlugs.has(a.slug))
      .slice(0, maxCount - results.length);
    results.push(...recent);
  }
  return results;
}

// ========== 읽기 시간 계산 ==========
function estimateReadingTime(content) {
  if (!content) return 1;
  // 한국어: 분당 약 500자
  const charCount = content.replace(/[#*\-\n\s]/g, '').length;
  return Math.max(1, Math.ceil(charCount / 500));
}

// ========== 글자 수 계산 ==========
function countWords(content) {
  if (!content) return 0;
  return content.replace(/[#*\-\n\s]/g, '').length;
}

// ========== FAQ 스키마 생성 (검색 의도 기반) ==========
function generateFAQSchema(keyword, content) {
  const faqs = [];
  const kw = escapeJson(keyword);
  
  // 콘텐츠에서 자연스럽게 FAQ 추출 (## 섹션 기반)
  const sections = content.split(/##\s+/);
  sections.forEach(section => {
    const lines = section.trim().split('\n').filter(l => l.trim());
    if (lines.length >= 2) {
      const heading = lines[0].trim().replace(/[#*]/g, '');
      const body = lines.slice(1, 3).join(' ').replace(/[#*]/g, '').trim();
      if (heading.length > 5 && body.length > 20) {
        faqs.push({
          q: `${keyword} ${heading}은(는) 무엇인가요?`,
          a: body.substring(0, 200)
        });
      }
    }
  });

  // 기본 FAQ 추가
  faqs.push({
    q: `${keyword} 관련 최신 소식은?`,
    a: `${keyword} 관련 최신 뉴스와 심층 분석을 확인하세요.`
  });

  if (faqs.length === 0) return '';

  return `
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      ${faqs.slice(0, 5).map(faq => `{
        "@type": "Question",
        "name": "${escapeJson(faq.q)}",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "${escapeJson(faq.a)}"
        }
      }`).join(',\n      ')}
    ]
  }
  </script>`;
}

// ========== 기사 상세 페이지 ==========
function articleTemplate(article, trendKeywords, relatedArticles) {
  const htmlContent = marked(article.content || '');
  const publishDateRaw = article.published_at || article.created_at || new Date().toISOString();
  const parsedDate = new Date(publishDateRaw);
  const publishDate = isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
  const sourceUrls = typeof article.source_urls === 'string'
    ? JSON.parse(article.source_urls || '[]') : (article.source_urls || []);
  const pageUrl = articlePathFromSlug(article.slug);
  const articleImage = article.image || '';
  const category = categorizeArticle(article.keyword, article.title, article.tags);
  const readingTime = estimateReadingTime(article.content);
  const wordCount = countWords(article.content);
  const tags = typeof article.tags === 'string' ? article.tags.split(',').map(t => t.trim()).filter(Boolean) : (article.tags || [article.keyword]);
  const allKeywords = [...new Set([article.keyword, ...tags, category, '뉴스', `${article.keyword} 최신`])].filter(Boolean);
  const defaultImage = `${config.site.url}/logo.png`;
  const metaDescription = buildMetaDescription(article.summary, article.content, article.keyword);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(article.title)} - ${config.site.title}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <meta name="keywords" content="${escapeHtml(allKeywords.join(', '))}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="author" content="${config.site.title}">
  <meta name="news_keywords" content="${escapeHtml(allKeywords.slice(0, 10).join(', '))}">
  <link rel="canonical" href="${config.site.url}${pageUrl}">
  <link rel="alternate" type="application/rss+xml" title="${config.site.title} RSS" href="${config.site.url}/rss.xml">
  ${config.site.naverVerification ? `<meta name="naver-site-verification" content="${config.site.naverVerification}">` : ''}
  ${config.site.googleVerification ? `<meta name="google-site-verification" content="${config.site.googleVerification}">` : ''}

  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(article.title)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:url" content="${config.site.url}${pageUrl}">
  <meta property="og:site_name" content="${config.site.title}">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:image" content="${escapeHtml(articleImage || defaultImage)}">
  <meta property="og:image:alt" content="${escapeHtml(article.title)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="article:published_time" content="${publishDate}">
  <meta property="article:modified_time" content="${publishDate}">
  <meta property="article:section" content="${escapeHtml(category)}">
  ${tags.map(tag => `<meta property="article:tag" content="${escapeHtml(tag)}">`).join('\n  ')}

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(article.title)}">
  <meta name="twitter:description" content="${escapeHtml(metaDescription)}">
  <meta name="twitter:image" content="${escapeHtml(articleImage || defaultImage)}">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": "${escapeJson(article.title)}",
    "description": "${escapeJson(metaDescription)}",
    "datePublished": "${publishDate}",
    "dateModified": "${publishDate}",
    "author": { "@type": "Organization", "name": "${escapeJson(config.site.title)}", "url": "${config.site.url}" },
    "publisher": {
      "@type": "Organization",
      "name": "${escapeJson(config.site.title)}",
      "logo": { "@type": "ImageObject", "url": "${config.site.url}/logo.png" }
    },
    "mainEntityOfPage": { "@type": "WebPage", "@id": "${config.site.url}${pageUrl}" },
    "image": "${escapeJson(articleImage || defaultImage)}",
    "keywords": ${JSON.stringify(allKeywords)},
    "articleSection": "${escapeJson(category)}",
    "genre": "${escapeJson(category)}",
    "isAccessibleForFree": true,
    "wordCount": ${wordCount},
    "inLanguage": "ko"
  }
  </script>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "홈", "item": "${config.site.url}/" },
      { "@type": "ListItem", "position": 2, "name": "${escapeJson(category)}", "item": "${config.site.url}/category/${encodeURIComponent(category)}" },
      { "@type": "ListItem", "position": 3, "name": "${escapeJson(article.title)}", "item": "${config.site.url}${pageUrl}" }
    ]
  }
  </script>

  ${generateFAQSchema(article.keyword, article.content || '')}

  ${commonHeadMeta(pageUrl)}
  ${COMMON_CSS}
</head>
<body>
  ${headerHTML()}
  ${trendTickerHTML(trendKeywords)}

  <div class="container">
    <nav class="breadcrumb" aria-label="브레드크럼">
      <a href="/">홈</a><span class="sep">›</span><a href="${categoryPath(category)}">${escapeHtml(category)}</a><span class="sep">›</span><span>${escapeHtml(article.keyword || '')}</span>
    </nav>

    <article class="article-page" itemscope itemtype="https://schema.org/NewsArticle">
      <header class="article-page-header">
        <div class="article-page-kw"><a href="${categoryPath(category)}" style="color:inherit;">${escapeHtml(category)}</a> · ${escapeHtml(article.keyword || '')}</div>
        <h1 class="article-page-title" itemprop="headline">${escapeHtml(article.title)}</h1>
        ${articleImage ? `<img class="article-page-hero-img" src="${escapeHtml(articleImage)}" alt="${escapeHtml(article.keyword + ' - ' + article.title)}" loading="eager" fetchpriority="high" referrerpolicy="no-referrer" onerror="this.style.display='none'" itemprop="image">` : ''}
        <div class="article-page-meta">
          <span itemprop="publisher" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">${config.site.title}</span></span>
          <span>|</span>
          <time datetime="${publishDate}" itemprop="datePublished">${formatDate(publishDate)}</time>
          <span>|</span>
          <span>읽기 ${readingTime}분</span>
        </div>
      </header>

      <div class="article-page-body" itemprop="articleBody">
        ${htmlContent}
      </div>

      <div class="article-tags" style="max-width:680px;margin:16px auto;padding:0 20px;display:flex;flex-wrap:wrap;gap:8px;">
        ${tags.map(tag => `<a href="${categoryPath(categorizeArticle(tag, '', []))}" class="tag-link" style="display:inline-block;padding:4px 12px;background:#f0f0f0;border-radius:16px;font-size:0.82rem;color:#555;">#${escapeHtml(tag)}</a>`).join('\n        ')}
      </div>

      ${sourceUrls.filter(u => !u.includes('news.google.com/rss')).length > 0 ? `
      <div class="article-sources">
        <strong>참고 자료</strong>
        ${sourceUrls.filter(u => !u.includes('news.google.com/rss')).slice(0, 5).map(url => {
          let displayUrl;
          try { displayUrl = new URL(url).hostname + new URL(url).pathname.substring(0, 40); } catch { displayUrl = url.substring(0, 60); }
          return `<div style="margin-top:4px;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(displayUrl)}...</a></div>`;
        }).join('')}
      </div>` : ''}

      <div class="article-share">
        <span class="article-share-label">공유</span>
        <a class="share-btn share-tw" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(article.title)}&url=${encodeURIComponent(config.site.url + pageUrl)}" target="_blank" rel="noopener">Twitter</a>
        <a class="share-btn share-fb" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(config.site.url + pageUrl)}" target="_blank" rel="noopener">Facebook</a>
        <button class="share-btn share-cp" onclick="navigator.clipboard.writeText(location.href);this.textContent='복사됨';">링크복사</button>
      </div>
    </article>

    ${(relatedArticles && relatedArticles.length > 0) ? `
    <div style="max-width:680px;margin:20px auto 0;padding:0 20px;">
      <div class="section-title"><span class="bar"></span> 관련 기사</div>
      <div class="article-list">
        ${relatedArticles.slice(0, 6).map(ra => `
        <a class="article-item" href="${articlePathFromSlug(ra.slug)}">
          ${ra.image
            ? `<img class="article-thumb" src="${escapeHtml(ra.image)}" alt="${escapeHtml(ra.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=\\'article-thumb-empty\\'>${THUMB_SVG}</div>'">`
            : `<div class="article-thumb-empty">${THUMB_SVG}</div>`}
          <div class="article-info">
            <div class="article-kw">${escapeHtml(ra.keyword || '')}</div>
            <h3 class="article-title">${escapeHtml(ra.title)}</h3>
            <div class="article-time">${timeAgo(ra.published_at || ra.created_at)}</div>
          </div>
        </a>`).join('\n')}
      </div>
    </div>` : ''}
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
      <a href="${articlePathFromSlug(heroArticle.slug)}">
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
      <a href="${articlePathFromSlug(heroArticle.slug)}">
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
    <a class="article-item" href="${articlePathFromSlug(article.slug)}">
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
    const href = slug ? articlePathFromSlug(slug) : `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
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
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
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
  <meta property="og:image" content="${config.site.url}/logo.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${config.site.title}">
  <meta name="twitter:description" content="${config.site.description}">
  <meta name="twitter:image" content="${config.site.url}/logo.png">

  ${commonHeadMeta('/')}

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "${config.site.title}",
    "description": "${config.site.description}",
    "url": "${config.site.url}/",
    "potentialAction": {
      "@type": "SearchAction",
      "target": "https://www.google.com/search?q=site:${new URL(config.site.url).hostname}+{search_term_string}",
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
        "url": "${config.site.url}/articles/${encodeSlugForUrl(a.slug)}.html",
        "name": "${escapeJson(a.title)}"
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

  <script>
  // 새로고침 대신 fetch로 업데이트 체크 (CLS 방지)
  setTimeout(function(){
    fetch(location.href).then(function(r){return r.text()}).then(function(html){
      var parser = new DOMParser();
      var doc = parser.parseFromString(html,'text/html');
      var newMain = doc.querySelector('.main-grid');
      var oldMain = document.querySelector('.main-grid');
      if(newMain && oldMain) oldMain.innerHTML = newMain.innerHTML;
    }).catch(function(){});
  }, 5*60*1000);
  </script>
</body>
</html>`;
}

// ========== 사이트맵 (자동 분할 + 인덱스 지원) ==========
const SITEMAP_MAX_URLS = 5000; // Google 권장: 50,000이지만 성능 위해 5,000 단위 분할

function generateSitemapIndex(articles, baseUrl) {
  if (!baseUrl) baseUrl = config.site.url;
  const totalPages = Math.ceil(articles.length / SITEMAP_MAX_URLS);
  if (totalPages <= 1) return null; // 분할 불필요하면 null

  const sitemaps = [];
  for (let i = 0; i < totalPages; i++) {
    const pageArticles = articles.slice(i * SITEMAP_MAX_URLS, (i + 1) * SITEMAP_MAX_URLS);
    const latestDate = pageArticles.reduce((max, a) => {
      const d = new Date(a.published_at || a.created_at || 0);
      return d > max ? d : max;
    }, new Date(0));
    sitemaps.push(`
  <sitemap>
    <loc>${baseUrl}/sitemap/sitemap-${i + 1}.xml</loc>
    <lastmod>${latestDate.toISOString()}</lastmod>
  </sitemap>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.join('')}
</sitemapindex>`;
}

function generateSitemapPage(articles, pageNum, baseUrl) {
  if (!baseUrl) baseUrl = config.site.url;
  const start = (pageNum - 1) * SITEMAP_MAX_URLS;
  const pageArticles = articles.slice(start, start + SITEMAP_MAX_URLS);

  const urls = pageArticles.map(a => `
  <url>
    <loc>${baseUrl}/articles/${encodeSlugForUrl(a.slug)}.html</loc>
    <lastmod>${new Date(a.published_at || a.created_at || Date.now()).toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

function generateSitemap(articles, baseUrl) {
  if (!baseUrl) baseUrl = config.site.url;
  const nowIso = new Date().toISOString();
  const latestArticleIso = articles.length > 0
    ? new Date(Math.max(...articles.map(a => new Date(a.published_at || a.created_at || Date.now()).getTime()))).toISOString()
    : nowIso;

  // 기사 연령에 따른 priority 차등 부여
  const urls = articles.map(a => {
    const ageHours = (Date.now() - new Date(a.published_at || a.created_at || Date.now()).getTime()) / 3600000;
    let priority = '0.8';
    if (ageHours < 6) priority = '0.9';
    else if (ageHours < 24) priority = '0.8';
    else if (ageHours < 72) priority = '0.7';
    else priority = '0.6';

    const imageTag = a.image ? `\n    <image:image>\n      <image:loc>${escapeHtml(a.image)}</image:loc>\n      <image:title>${escapeHtml(a.title)}</image:title>\n    </image:image>` : '';

    return `\n  <url>\n    <loc>${baseUrl}/articles/${encodeSlugForUrl(a.slug)}.html</loc>\n    <lastmod>${new Date(a.published_at || a.created_at || Date.now()).toISOString()}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${priority}</priority>${imageTag}\n  </url>`;
  }).join('');

  // 카테고리 페이지 URL
  const categories = [...new Set(articles.map(a => categorizeArticle(a.keyword, a.title, a.tags)))];
  const categoryUrls = categories.map(cat => {
    const catArticles = articles.filter(a => categorizeArticle(a.keyword, a.title, a.tags) === cat);
    const catLatestIso = catArticles.length > 0
      ? new Date(Math.max(...catArticles.map(a => new Date(a.published_at || a.created_at || Date.now()).getTime()))).toISOString()
      : nowIso;
    return `\n  <url>\n    <loc>${baseUrl}${categoryPath(cat)}</loc>\n    <lastmod>${catLatestIso}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  }).join('');

  const archiveUrl = `\n  <url>\n    <loc>${baseUrl}/archive</loc>\n    <lastmod>${latestArticleIso}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>0.8</priority>\n  </url>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${latestArticleIso}</lastmod>
    <changefreq>always</changefreq>
    <priority>1.0</priority>
  </url>${archiveUrl}${categoryUrls}${urls}
</urlset>`;
}

// ========== Google News 사이트맵 ==========
function generateNewsSitemap(articles, baseUrl) {
  if (!baseUrl) baseUrl = config.site.url;
  const recentArticles = articles.filter(a => {
    const d = new Date(a.published_at || a.created_at);
    return (Date.now() - d.getTime()) < 48 * 3600000;
  }).slice(0, 1000);

  const urls = recentArticles.map(a => {
    const pubDate = new Date(a.published_at || a.created_at || Date.now());
    const isoDate = pubDate.toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const tags = typeof a.tags === 'string' ? a.tags.split(',').map(t => t.trim()).filter(Boolean) : (a.tags || [a.keyword]);
    const newsKeywords = [...new Set([a.keyword, ...tags])].filter(Boolean).slice(0, 10).join(', ');
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
      <news:keywords>${escapeHtml(newsKeywords)}</news:keywords>
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
function generateRSS(articles, baseUrl) {
  if (!baseUrl) baseUrl = config.site.url;
  const items = articles.slice(0, 50).map(a => {
    const tags = typeof a.tags === 'string' ? a.tags.split(',').map(t => t.trim()).filter(Boolean) : (a.tags || [a.keyword]);
    const categories = [...new Set([a.keyword, ...tags])].filter(Boolean).map(t => `      <category>${wrapCdata(t)}</category>`).join('\n');
    const imageTag = a.image ? `\n      <enclosure url="${escapeHtml(a.image)}" type="image/jpeg" />` : '';
    return `
    <item>
      <title>${wrapCdata(a.title)}</title>
      <link>${baseUrl}/articles/${encodeSlugForUrl(a.slug)}.html</link>
      <description>${wrapCdata(buildMetaDescription(a.summary, a.content, a.keyword))}</description>
      <content:encoded>${wrapCdata((a.content || a.summary || '').substring(0, 1200))}</content:encoded>
      <pubDate>${new Date(a.published_at || a.created_at || Date.now()).toUTCString()}</pubDate>
      <guid isPermaLink="true">${baseUrl}/articles/${encodeSlugForUrl(a.slug)}.html</guid>
${categories}${imageTag}
      <dc:creator>${wrapCdata(config.site.title)}</dc:creator>
    </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${config.site.title}</title>
    <link>${baseUrl}</link>
    <description>${config.site.description}</description>
    <language>ko</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${baseUrl}/rss.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>${baseUrl}/logo.png</url>
      <title>${config.site.title}</title>
      <link>${baseUrl}</link>
    </image>
    ${items}
  </channel>
</rss>`;
}

// ========== robots.txt ==========
function generateRobotsTxt(baseUrl) {
  if (!baseUrl) baseUrl = config.site.url;
  return `User-agent: *
Allow: /
Allow: /articles/
Allow: /category/
Allow: /archive/

Sitemap: ${baseUrl}/sitemap.xml
Sitemap: ${baseUrl}/news-sitemap.xml

User-agent: Googlebot-News
Allow: /articles/

User-agent: Yeti
Allow: /articles/
Allow: /category/
`;
}

// ========== 검색엔진 알림 ==========
async function pingSearchEngines(articleUrl) {
  const sitemapUrl = `${config.site.url}/sitemap.xml`;
  const indexNowKey = config.site.url.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) + 'key';
  const pings = [];

  pings.push(
    axios.get(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`, { timeout: 10000 })
      .then(() => logger.info('[SEO] Google sitemap ping 완료'))
      .catch(e => logger.debug('[SEO] Google ping 실패: ' + e.message))
  );

  pings.push(
    axios.post('https://api.indexnow.org/IndexNow', {
      host: new URL(config.site.url).hostname,
      key: indexNowKey,
      keyLocation: `${config.site.url}/${indexNowKey}.txt`,
      urlList: [articleUrl],
    }, { timeout: 10000, headers: { 'Content-Type': 'application/json' } })
      .then(() => logger.info('[SEO] IndexNow ping 완료: ' + articleUrl))
      .catch(e => logger.debug('[SEO] IndexNow ping 실패: ' + e.message))
  );

  await Promise.allSettled(pings);
}

// ========== 퍼블리시 ==========
function publishArticle(article, trendKeywords, allArticles) {
  try {
    // 관련 기사 추출: 키워드/태그 매칭 기반
    const relatedArticles = getRelatedArticles(article, allArticles || [], 6);

    const html = articleTemplate(article, trendKeywords || [], relatedArticles);
    const safeSlug = normalizeSlug(article.slug);
    const filePath = path.join(ARTICLES_DIR, `${safeSlug}.html`);
    writeFileAtomic(filePath, html);
    logger.info(`[퍼블리셔] 기사 발행: ${article.slug}.html (관련기사 ${relatedArticles.length}개, 카테고리: ${categorizeArticle(article.keyword, article.title, article.tags)})`);

    const articleUrl = `${config.site.url}${articlePathFromSlug(article.slug)}`;
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
    writeFileAtomic(path.join(OUTPUT_DIR, 'index.html'), html);

    // 사이트맵 분할: 기사 5,000 초과 시 자동으로 사이트맵 인덱스 사용
    const sitemapIndex = generateSitemapIndex(articles);
    if (sitemapIndex) {
      // 분할된 사이트맵
      writeFileAtomic(path.join(OUTPUT_DIR, 'sitemap.xml'), sitemapIndex);
      const totalPages = Math.ceil(articles.length / SITEMAP_MAX_URLS);
      for (let i = 1; i <= totalPages; i++) {
        writeFileAtomic(path.join(SITEMAP_DIR, `sitemap-${i}.xml`), generateSitemapPage(articles, i));
      }
      cleanupSplitSitemaps(totalPages);
      logger.info(`[SEO] 사이트맵 ${totalPages}개 파일로 분할 완료`);
    } else {
      // 단일 사이트맵
      writeFileAtomic(path.join(OUTPUT_DIR, 'sitemap.xml'), generateSitemap(articles));
      cleanupSplitSitemaps(0);
    }
    writeFileAtomic(path.join(OUTPUT_DIR, 'news-sitemap.xml'), generateNewsSitemap(articles));
    writeFileAtomic(path.join(OUTPUT_DIR, 'rss.xml'), generateRSS(articles));
    writeFileAtomic(path.join(OUTPUT_DIR, 'robots.txt'), generateRobotsTxt());
    const indexNowKey = config.site.url.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) + 'key';
    writeFileAtomic(path.join(OUTPUT_DIR, `${indexNowKey}.txt`), indexNowKey);

    if (!fs.existsSync(path.join(OUTPUT_DIR, 'ads.txt'))) {
      writeFileAtomic(path.join(OUTPUT_DIR, 'ads.txt'), '# Google AdSense\n# google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0\n');
    }

    // 카테고리 페이지 자동 생성
    generateCategoryPages(articles, trendKeywords || []);
    generateArchivePage(articles, trendKeywords || []);

    logger.info(`[퍼블리셔] 전체 갱신 완료 (${articles.length}개 기사)`);
  } catch (error) {
    logger.error(`[퍼블리셔] 인덱스 갱신 실패: ${error.message}`);
  }
}

function generateArchivePage(articles, trendKeywords) {
  const ARCHIVE_DIR = path.join(OUTPUT_DIR, 'archive');
  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  const articleCards = articles.slice(0, 300).map(article => `
    <a class="article-item" href="${articlePathFromSlug(article.slug)}">
      ${article.image
        ? `<img class="article-thumb" src="${escapeHtml(article.image)}" alt="${escapeHtml(article.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=\\'article-thumb-empty\\'>${THUMB_SVG}</div>'">`
        : `<div class="article-thumb-empty">${THUMB_SVG}</div>`}
      <div class="article-info">
        <div class="article-kw">${escapeHtml(article.keyword || '')}</div>
        <h2 class="article-title">${escapeHtml(article.title)}</h2>
        <p class="article-desc">${escapeHtml(buildMetaDescription(article.summary, article.content, article.keyword)).substring(0, 100)}</p>
        <div class="article-time">${timeAgo(article.published_at || article.created_at)}</div>
      </div>
    </a>`).join('\n');

  const archiveHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>전체 기사 아카이브 - ${config.site.title}</title>
  <meta name="description" content="${config.site.title} 전체 기사 아카이브입니다. 최신 기사부터 순차적으로 확인할 수 있습니다.">
  <meta name="keywords" content="전체기사, 뉴스 아카이브, 최신 뉴스, ${config.site.title}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="canonical" href="${config.site.url}/archive">
  <link rel="alternate" type="application/rss+xml" title="${config.site.title} RSS" href="${config.site.url}/rss.xml">

  <meta property="og:type" content="website">
  <meta property="og:title" content="전체 기사 아카이브 - ${config.site.title}">
  <meta property="og:description" content="최신 기사부터 확인하는 전체 기사 아카이브">
  <meta property="og:url" content="${config.site.url}/archive">
  <meta property="og:site_name" content="${config.site.title}">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:image" content="${config.site.url}/logo.png">

  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="전체 기사 아카이브 - ${config.site.title}">
  <meta name="twitter:description" content="최신 기사부터 확인하는 전체 기사 아카이브">
  <meta name="twitter:image" content="${config.site.url}/logo.png">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "전체 기사 아카이브",
    "url": "${config.site.url}/archive",
    "isPartOf": { "@type": "WebSite", "name": "${escapeJson(config.site.title)}", "url": "${config.site.url}" },
    "numberOfItems": ${articles.length}
  }
  </script>

  ${commonHeadMeta('/archive')}
  ${COMMON_CSS}
</head>
<body>
  ${headerHTML()}
  ${trendTickerHTML(trendKeywords)}

  <div class="container">
    <nav class="breadcrumb" aria-label="브레드크럼">
      <a href="/">홈</a><span class="sep">›</span><span>전체기사</span>
    </nav>

    <main>
      <div class="section-title"><span class="bar"></span> 전체 기사 <small style="color:var(--text-muted);font-weight:400;">(${articles.length}건)</small></div>
      <div class="article-list">
        ${articleCards || '<p style="text-align:center;color:var(--text-muted);padding:36px 0;">기사를 준비하고 있습니다.</p>'}
      </div>
    </main>
  </div>

  ${footerHTML()}
</body>
</html>`;

  writeFileAtomic(path.join(ARCHIVE_DIR, 'index.html'), archiveHtml);
}

// ========== 카테고리 페이지 생성 ==========
function generateCategoryPages(articles, trendKeywords) {
  const CATEGORY_DIR = path.join(OUTPUT_DIR, 'category');
  if (!fs.existsSync(CATEGORY_DIR)) fs.mkdirSync(CATEGORY_DIR, { recursive: true });

  // 카테고리별 기사 분류
  const categoryArticles = {};
  articles.forEach(a => {
    const cat = categorizeArticle(a.keyword, a.title, a.tags);
    if (!categoryArticles[cat]) categoryArticles[cat] = [];
    categoryArticles[cat].push(a);
  });

  for (const [category, catArticles] of Object.entries(categoryArticles)) {
    const catDir = path.join(CATEGORY_DIR, category);
    if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });
    const categoryLabel = categorySeoLabel(category);
    const categoryMetaDesc = category === '뉴스'
      ? '최신 기사와 실시간 트렌드'
      : `${category} 최신 기사와 실시간 트렌드`;

    const articleCards = catArticles.slice(0, 50).map(article => `
    <a class="article-item" href="${articlePathFromSlug(article.slug)}">
      ${article.image
        ? `<img class="article-thumb" src="${escapeHtml(article.image)}" alt="${escapeHtml(article.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=\\'article-thumb-empty\\'>${THUMB_SVG}</div>'">`
        : `<div class="article-thumb-empty">${THUMB_SVG}</div>`}
      <div class="article-info">
        <div class="article-kw">${escapeHtml(article.keyword || '')}</div>
        <h2 class="article-title">${escapeHtml(article.title)}</h2>
        <p class="article-desc">${escapeHtml(article.summary || '').substring(0, 80)}</p>
        <div class="article-time">${timeAgo(article.published_at || article.created_at)}</div>
      </div>
    </a>`).join('\n');

    const catPageHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${categoryLabel} - ${config.site.title}</title>
  <meta name="description" content="${categoryLabel}를 빠르게 확인하세요. ${config.site.title}에서 최신 기사와 핵심 이슈를 제공합니다.">
  <meta name="keywords" content="${category}, ${categoryLabel}, ${category} 최신, 실시간 뉴스">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="canonical" href="${config.site.url}${categoryPath(category)}">
  <link rel="alternate" type="application/rss+xml" title="${config.site.title} RSS" href="${config.site.url}/rss.xml">

  <meta property="og:type" content="website">
  <meta property="og:title" content="${categoryLabel} - ${config.site.title}">
  <meta property="og:description" content="${categoryMetaDesc}">
  <meta property="og:url" content="${config.site.url}${categoryPath(category)}">
  <meta property="og:site_name" content="${config.site.title}">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:image" content="${config.site.url}/logo.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${categoryLabel} - ${config.site.title}">
  <meta name="twitter:description" content="${categoryMetaDesc}">
  <meta name="twitter:image" content="${config.site.url}/logo.png">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "${escapeJson(categoryLabel)}",
    "description": "${escapeJson(categoryMetaDesc)}",
    "url": "${config.site.url}${categoryPath(category)}",
    "isPartOf": { "@type": "WebSite", "name": "${escapeJson(config.site.title)}", "url": "${config.site.url}" },
    "numberOfItems": ${catArticles.length}
  }
  </script>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "홈", "item": "${config.site.url}/" },
      { "@type": "ListItem", "position": 2, "name": "${escapeJson(category)}", "item": "${config.site.url}${categoryPath(category)}" }
    ]
  }
  </script>

  ${commonHeadMeta(categoryPath(category))}
  ${COMMON_CSS}
</head>
<body>
  ${headerHTML()}
  ${trendTickerHTML(trendKeywords)}

  <div class="container">
    <nav class="breadcrumb" aria-label="브레드크럼">
      <a href="/">홈</a><span class="sep">›</span><span>${escapeHtml(category)}</span>
    </nav>

    <main>
      <div class="section-title"><span class="bar"></span> ${escapeHtml(categoryLabel)} <small style="color:var(--text-muted);font-weight:400;">(${catArticles.length}건)</small></div>
      <div class="article-list">
        ${articleCards || '<p style="text-align:center;color:var(--text-muted);padding:36px 0;">기사를 준비하고 있습니다.</p>'}
      </div>
    </main>
  </div>

  ${footerHTML()}
</body>
</html>`;

    writeFileAtomic(path.join(catDir, 'index.html'), catPageHtml);
  }
  logger.info(`[SEO] 카테고리 페이지 ${Object.keys(categoryArticles).length}개 생성 완료`);
}

module.exports = {
  publishArticle, updateIndex, generateSitemap, generateSitemapIndex, generateSitemapPage,
  generateNewsSitemap, generateRSS, generateRobotsTxt, articleTemplate, indexTemplate,
  pingSearchEngines, categorizeArticle, getRelatedArticles, generateCategoryPages, generateArchivePage,
  articlePathFromSlug,
  OUTPUT_DIR, ARTICLES_DIR, SITEMAP_DIR,
};
