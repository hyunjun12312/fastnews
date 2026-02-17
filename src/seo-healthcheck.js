// ============================================
// seo-healthcheck.js - SEO 산출물 자동 검증
// ============================================

const fs = require('fs');
const path = require('path');
const config = require('./config');

const OUTPUT_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'public');
const ARTICLES_DIR = path.join(OUTPUT_DIR, 'articles');

const errors = [];
const warnings = [];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

function validateCoreFiles() {
  const coreFiles = [
    'index.html',
    'sitemap.xml',
    'news-sitemap.xml',
    'rss.xml',
    'robots.txt',
    'archive/index.html',
  ];

  for (const rel of coreFiles) {
    const abs = path.join(OUTPUT_DIR, rel);
    assert(exists(abs), `필수 파일 누락: ${rel}`);
  }
}

function validateIndex() {
  const indexPath = path.join(OUTPUT_DIR, 'index.html');
  if (!exists(indexPath)) return;

  const html = readText(indexPath);
  assert(/<link rel="canonical" href="[^"]+"\s*\/?>/i.test(html), 'index.html canonical 누락');
  assert(/application\/ld\+json/i.test(html), 'index.html JSON-LD 누락');
  assert(/og:title/i.test(html) && /twitter:card/i.test(html), 'index.html OG/Twitter 메타 누락');
  warn(!/href="\/category\/[가-힣]/.test(html), 'index.html 내 비인코딩 카테고리 링크 존재 가능성');
}

function validateSitemaps() {
  const sitemapPath = path.join(OUTPUT_DIR, 'sitemap.xml');
  const newsSitemapPath = path.join(OUTPUT_DIR, 'news-sitemap.xml');

  if (exists(sitemapPath)) {
    const sitemap = readText(sitemapPath);
    assert(/<urlset|<sitemapindex/.test(sitemap), 'sitemap.xml 형식 오류');
    assert(sitemap.includes(`${config.site.url}/`), 'sitemap.xml 도메인 불일치 가능성');
  }

  if (exists(newsSitemapPath)) {
    const news = readText(newsSitemapPath);
    assert(/<urlset/.test(news), 'news-sitemap.xml 형식 오류');
    warn(/news:news/.test(news), 'news-sitemap.xml에 최근 뉴스 항목이 없어 보입니다(발행 시각 범위 확인 필요)');
  }
}

function validateRss() {
  const rssPath = path.join(OUTPUT_DIR, 'rss.xml');
  if (!exists(rssPath)) return;

  const rss = readText(rssPath);
  assert(/<rss/i.test(rss) && /<channel>/i.test(rss), 'rss.xml 형식 오류');
  assert(/<item>/i.test(rss), 'rss.xml item 없음');
}

function validateArticles(sampleSize = 20) {
  if (!exists(ARTICLES_DIR)) {
    errors.push('articles 디렉토리 누락');
    return;
  }

  const files = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.html'));
  assert(files.length > 0, '기사 HTML 파일이 없습니다.');

  const sample = files.slice(0, sampleSize);
  sample.forEach(file => {
    const abs = path.join(ARTICLES_DIR, file);
    const html = readText(abs);
    const rel = `articles/${file}`;

    assert(/<link rel="canonical" href="[^"]+"\s*\/?>/i.test(html), `${rel} canonical 누락`);
    assert(/"@type":\s*"NewsArticle"/.test(html), `${rel} NewsArticle JSON-LD 누락`);
    assert(/og:title/i.test(html) && /twitter:card/i.test(html), `${rel} OG/Twitter 메타 누락`);
  });
}

function validateRobots() {
  const robotsPath = path.join(OUTPUT_DIR, 'robots.txt');
  if (!exists(robotsPath)) return;

  const robots = readText(robotsPath);
  assert(/Sitemap:\s*https?:\/\//i.test(robots), 'robots.txt Sitemap 지시어 누락');
  warn(/Disallow:\s*\/articles\//i.test(robots) === false, 'robots.txt 에서 articles 차단 여부 확인 필요');
}

function main() {
  validateCoreFiles();
  validateIndex();
  validateSitemaps();
  validateRss();
  validateArticles();
  validateRobots();

  if (warnings.length) {
    console.log('\n[SEO Healthcheck] WARNINGS');
    warnings.forEach(w => console.log(`- ${w}`));
  }

  if (errors.length) {
    console.error('\n[SEO Healthcheck] FAILED');
    errors.forEach(e => console.error(`- ${e}`));
    process.exitCode = 1;
    return;
  }

  console.log('\n[SEO Healthcheck] PASSED');
  process.exitCode = 0;
}

main();
