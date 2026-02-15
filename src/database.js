// ============================================
// database.js - SQLite 데이터베이스 관리 (sql.js)
// ============================================
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

// Railway Volume 지원: DATA_DIR 환경변수 설정 시 영구 저장소 사용
const DATA_DIR = process.env.DATA_DIR || '';
const DB_DIR = DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'trending.db');

// data 폴더 생성
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let db = null;
let saveInterval = null;

function saveToDisk() {
  if (db) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      // 조용히 무시
    }
  }
}

// DB 초기화 (비동기)
const dbReady = (async () => {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      source TEXT NOT NULL,
      rank INTEGER,
      detected_at TEXT DEFAULT (datetime('now', 'localtime')),
      processed INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER,
      keyword TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      source_urls TEXT,
      slug TEXT UNIQUE,
      status TEXT DEFAULT 'draft',
      views INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      published_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS crawl_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      keywords_found INTEGER DEFAULT 0,
      new_keywords INTEGER DEFAULT 0,
      crawled_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  try { db.run(`CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword)`); } catch(e) {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_keywords_detected ON keywords(detected_at)`); } catch(e) {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug)`); } catch(e) {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status)`); } catch(e) {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at)`); } catch(e) {}

  // 이미지 칼럼 추가 (기존 DB 마이그레이션)
  try { db.run(`ALTER TABLE articles ADD COLUMN image TEXT DEFAULT ''`); } catch(e) {}

  saveInterval = setInterval(saveToDisk, 30000);
  process.on('exit', saveToDisk);
  process.on('SIGINT', () => { saveToDisk(); process.exit(0); });

  logger.info('데이터베이스 초기화 완료 (sql.js)');
  return db;
})();

async function getDb() {
  await dbReady;
  return db;
}

// 쿼리 헬퍼
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  const changes = db.getRowsModified();
  const lastId = queryOne('SELECT last_insert_rowid() as id');
  return { changes, lastInsertRowid: lastId ? lastId.id : 0 };
}

// ========== 키워드 ==========
function insertKeyword(keyword, source, rank) {
  try {
    return runSql(
      `INSERT INTO keywords (keyword, source, rank, detected_at) VALUES (?, ?, ?, datetime('now', 'localtime'))`,
      [keyword, source, rank]
    );
  } catch (e) {
    return { changes: 0, lastInsertRowid: 0 };
  }
}

function getUnprocessedKeywords(limit = 10) {
  return queryAll('SELECT * FROM keywords WHERE processed = 0 ORDER BY detected_at DESC LIMIT ?', [limit]);
}

function markKeywordProcessed(id) {
  return runSql('UPDATE keywords SET processed = 1 WHERE id = ?', [id]);
}

function getRecentKeywords(hours = 24) {
  return queryAll(
    `SELECT keyword, source, rank, detected_at FROM keywords WHERE detected_at >= datetime('now', '-${hours} hours', 'localtime') ORDER BY detected_at DESC`
  );
}

function isKeywordRecent(keyword, hours = 6) {
  const row = queryOne(
    `SELECT COUNT(*) as cnt FROM keywords WHERE keyword = ? AND detected_at >= datetime('now', '-${hours} hours', 'localtime')`,
    [keyword]
  );
  return row && row.cnt > 0;
}

// ========== 기사 ==========
function insertArticle({ keywordId, keyword, title, content, summary, sourceUrls, slug, status, image }) {
  const publishedAt = status === 'published' ? new Date().toISOString() : null;
  return runSql(
    `INSERT INTO articles (keyword_id, keyword, title, content, summary, source_urls, slug, status, published_at, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [keywordId, keyword, title, content, summary, JSON.stringify(sourceUrls || []), slug, status || 'draft', publishedAt, image || '']
  );
}

function getArticles({ status, limit = 20, offset = 0 } = {}) {
  if (status) {
    return queryAll('SELECT * FROM articles WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [status, limit, offset]);
  }
  return queryAll('SELECT * FROM articles ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
}

function getArticleBySlug(slug) {
  return queryOne('SELECT * FROM articles WHERE slug = ?', [slug]);
}

function getArticleById(id) {
  return queryOne('SELECT * FROM articles WHERE id = ?', [id]);
}

function incrementViews(id) {
  return runSql('UPDATE articles SET views = views + 1 WHERE id = ?', [id]);
}

function getArticleCount() {
  return (queryOne('SELECT COUNT(*) as count FROM articles') || {}).count || 0;
}

function getTodayArticleCount() {
  return (queryOne(`SELECT COUNT(*) as count FROM articles WHERE created_at >= datetime('now', 'start of day', 'localtime')`) || {}).count || 0;
}

function hasArticleForKeyword(keyword) {
  const row = queryOne('SELECT COUNT(*) as cnt FROM articles WHERE keyword = ?', [keyword]);
  return row && row.cnt > 0;
}

// 저품질 기사 감지 (리젠 대상)
function getLowQualityArticles(limit = 10) {
  return queryAll(
    `SELECT * FROM articles WHERE status = 'published' AND (
      title LIKE '%주요 쟁점과 핵심 내용 정리%'
      OR title LIKE '%현재 주요 이슈 총정리%'
      OR title LIKE '%실시간 트렌드 총정리%'
      OR title LIKE '%실시간 검색어 등극%'
      OR content LIKE '%주요 보도 내용 종합%'
      OR content LIKE '%(Vietnam.vn)%'
      OR content LIKE '%(kmjournal%'
      OR content LIKE '%핵심 포인트%• **%— %• **%— %'
      OR content LIKE '%관련 뉴스가 잇따라 보도되며 실시간 검색어에 올랐다%'
      OR content LIKE '%으)로 전해졌다.%으)로 전해졌다.%'
      OR length(content) < 200
      OR length(keyword) > 15
    ) ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

// 기사 내용 업데이트 (재생성용)
function updateArticle(id, { title, content, summary, image, slug }) {
  const fields = [];
  const params = [];
  if (title !== undefined) { fields.push('title = ?'); params.push(title); }
  if (content !== undefined) { fields.push('content = ?'); params.push(content); }
  if (summary !== undefined) { fields.push('summary = ?'); params.push(summary); }
  if (image !== undefined) { fields.push('image = ?'); params.push(image); }
  if (slug !== undefined) { fields.push('slug = ?'); params.push(slug); }
  if (fields.length === 0) return { changes: 0 };
  params.push(id);
  return runSql(`UPDATE articles SET ${fields.join(', ')} WHERE id = ?`, params);
}

// 키워드가 너무 긴 기사 삭제 (헤드라인이 키워드로 들어간 쓰레기)
function deleteArticlesWithLongKeywords(maxLen = 15) {
  return runSql('DELETE FROM articles WHERE length(keyword) > ?', [maxLen]);
}

// 키워드 정제된 값으로 업데이트
function updateArticleKeyword(id, keyword) {
  return runSql('UPDATE articles SET keyword = ? WHERE id = ?', [keyword, id]);
}

function updateArticleImage(id, image) {
  return runSql('UPDATE articles SET image = ? WHERE id = ?', [image, id]);
}

function getArticlesWithoutImage(limit = 20) {
  return queryAll("SELECT * FROM articles WHERE (image IS NULL OR image = '') AND status = 'published' ORDER BY created_at DESC LIMIT ?", [limit]);
}

// ========== 로그 ==========
function logCrawl(source, keywordsFound, newKeywords) {
  return runSql('INSERT INTO crawl_logs (source, keywords_found, new_keywords) VALUES (?, ?, ?)', [source, keywordsFound, newKeywords]);
}

function getStats() {
  const totalKeywords = (queryOne('SELECT COUNT(*) as count FROM keywords') || {}).count || 0;
  const totalArticles = (queryOne('SELECT COUNT(*) as count FROM articles') || {}).count || 0;
  const publishedArticles = (queryOne("SELECT COUNT(*) as count FROM articles WHERE status = 'published'") || {}).count || 0;
  const todayArticles = getTodayArticleCount();
  const totalViews = (queryOne('SELECT COALESCE(SUM(views), 0) as total FROM articles') || {}).total || 0;
  const recentCrawls = queryAll('SELECT * FROM crawl_logs ORDER BY crawled_at DESC LIMIT 10');

  return { totalKeywords, totalArticles, publishedArticles, todayArticles, totalViews, recentCrawls };
}

module.exports = {
  getDb, dbReady, insertKeyword, getUnprocessedKeywords, markKeywordProcessed,
  getRecentKeywords, isKeywordRecent, insertArticle, getArticles, getArticleBySlug,
  getArticleById, incrementViews, getArticleCount, getTodayArticleCount,
  hasArticleForKeyword, updateArticleImage, getArticlesWithoutImage,
  getLowQualityArticles, updateArticle, updateArticleKeyword, deleteArticlesWithLongKeywords,
  logCrawl, getStats, saveToDisk,
};
