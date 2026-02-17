// ============================================
// rebuild-seo.js - 정적 SEO 산출물 재생성 전용 스크립트
// ============================================

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('./database');
const publisher = require('./publisher');
const logger = require('./logger');

function normalizeSlugForFile(slug) {
  return String(slug || '')
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/\.\./g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getTrendKeywords(hours = 12, max = 50) {
  const rows = db.getRecentKeywords(hours);
  const seen = new Set();
  const keywords = [];

  for (const row of rows) {
    const keyword = String(row.keyword || '').trim();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
    if (keywords.length >= max) break;
  }

  return keywords;
}

async function run() {
  await db.dbReady;

  const publishedArticles = db.getArticles({ status: 'published', limit: 5000 });
  const trendKeywords = getTrendKeywords(12, 50);

  logger.info(`[SEO-REBUILD] 시작: 기사 ${publishedArticles.length}개, 키워드 ${trendKeywords.length}개`);

  publisher.updateIndex(publishedArticles, trendKeywords);

  const liveFiles = new Set();
  for (const article of publishedArticles) {
    const related = publisher.getRelatedArticles(article, publishedArticles, 6);
    const html = publisher.articleTemplate(article, trendKeywords, related);
    const fileName = `${normalizeSlugForFile(article.slug)}.html`;
    const filePath = path.join(publisher.ARTICLES_DIR, fileName);
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, html, 'utf8');
    liveFiles.add(fileName);
  }

  const existingArticleFiles = fs.existsSync(publisher.ARTICLES_DIR)
    ? fs.readdirSync(publisher.ARTICLES_DIR).filter(name => name.endsWith('.html'))
    : [];

  let removed = 0;
  for (const name of existingArticleFiles) {
    if (!liveFiles.has(name)) {
      fs.unlinkSync(path.join(publisher.ARTICLES_DIR, name));
      removed += 1;
    }
  }

  logger.info(`[SEO-REBUILD] 완료: index/sitemap/rss/robots/category/archive/기사 재생성 (${publishedArticles.length}개 기사, stale ${removed}개 정리)`);
  console.log(`SEO rebuild completed: ${publishedArticles.length} articles (stale removed: ${removed})`);
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    logger.error(`[SEO-REBUILD] 실패: ${error.message}`);
    console.error(error);
    process.exitCode = 1;
  });
