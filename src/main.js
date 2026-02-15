// ============================================
// main.js - 메인 오케스트레이터
// ============================================
// 전체 시스템을 조율하는 핵심 엔진
// 크롤링 → 뉴스 수집 → 기사 생성 → 퍼블리싱
// 모든 과정을 자동으로 스케줄링
// ============================================

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const db = require('./database');
const crawler = require('./trend-crawler');
const newsFetcher = require('./news-fetcher');
const articleGenerator = require('./article-generator');
const publisher = require('./publisher');
const dashboard = require('./dashboard');

// 로그 디렉토리 생성
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// 시간당 기사 생성 카운터
let articlesThisHour = 0;
let lastHourReset = Date.now();

// ========== 메인 파이프라인 ==========
async function runPipeline() {
  try {
    // 시간당 제한 체크
    if (Date.now() - lastHourReset > 3600000) {
      articlesThisHour = 0;
      lastHourReset = Date.now();
    }

    logger.info('========================================');
    logger.info('🚀 자동 파이프라인 실행 시작');
    logger.info('========================================');

    dashboard.emitEvent('log', '🚀 파이프라인 실행 시작');

    // ===== STEP 1: 실시간 검색어 크롤링 =====
    logger.info('[STEP 1] 실시간 검색어 크롤링...');
    dashboard.emitEvent('log', '[STEP 1] 실시간 검색어 크롤링 중...');

    const keywords = await crawler.crawlAll();

    if (keywords.length === 0) {
      logger.warn('[STEP 1] 수집된 키워드가 없습니다.');
      dashboard.emitEvent('log', '⚠️ 수집된 키워드 없음');
      return;
    }

    // DB에 키워드 저장 (새로운 것만)
    let newKeywordsCount = 0;
    for (const kw of keywords) {
      // 최근 6시간 내에 이미 있는 키워드는 스킵
      if (!db.isKeywordRecent(kw.keyword, 6)) {
        const result = db.insertKeyword(kw.keyword, kw.source, kw.rank);
        if (result.changes > 0) {
          newKeywordsCount++;
          dashboard.emitEvent('newKeyword', kw);
        }
      }
    }

    // 크롤링 로그 기록
    db.logCrawl('all', keywords.length, newKeywordsCount);
    logger.info(`[STEP 1] 완료: 전체 ${keywords.length}개 / 신규 ${newKeywordsCount}개`);
    dashboard.emitEvent('log', `✅ STEP 1 완료: ${keywords.length}개 키워드 (신규 ${newKeywordsCount}개)`);

    if (newKeywordsCount === 0) {
      logger.info('[STEP 1] 새로운 키워드가 없습니다. 파이프라인 종료.');
      dashboard.emitEvent('log', 'ℹ️ 새 키워드 없음, 대기 중...');
      
      // 인덱스 페이지는 항상 갱신
      const publishedArticles = db.getArticles({ status: 'published', limit: 50 });
      publisher.updateIndex(publishedArticles);
      
      dashboard.emitEvent('stats', db.getStats());
      return;
    }

    // ===== STEP 2: 미처리 키워드 처리 =====
    const unprocessed = db.getUnprocessedKeywords(config.article.maxPerHour - articlesThisHour);

    if (unprocessed.length === 0) {
      logger.info('[STEP 2] 처리할 키워드가 없습니다.');
      return;
    }

    logger.info(`[STEP 2] ${unprocessed.length}개 키워드 처리 시작...`);
    dashboard.emitEvent('log', `[STEP 2] ${unprocessed.length}개 키워드 기사 생성 시작...`);

    for (const kw of unprocessed) {
      // 시간당 제한 체크
      if (articlesThisHour >= config.article.maxPerHour) {
        logger.warn(`[제한] 시간당 기사 생성 한도 도달 (${config.article.maxPerHour}개)`);
        dashboard.emitEvent('log', `⚠️ 시간당 기사 한도 도달 (${config.article.maxPerHour}개)`);
        break;
      }

      // 이미 해당 키워드로 기사가 있으면 스킵
      if (db.hasArticleForKeyword(kw.keyword)) {
        logger.info(`[STEP 2] "${kw.keyword}" - 이미 기사 존재, 스킵`);
        db.markKeywordProcessed(kw.id);
        continue;
      }

      try {
        // ===== STEP 3: 뉴스 수집 =====
        logger.info(`[STEP 3] "${kw.keyword}" 뉴스 수집...`);
        dashboard.emitEvent('log', `[STEP 3] "${kw.keyword}" 뉴스 수집 중...`);

        const newsData = await newsFetcher.fetchNewsForKeyword(kw.keyword);

        // ===== STEP 4: AI 기사 생성 =====
        logger.info(`[STEP 4] "${kw.keyword}" 기사 생성...`);
        dashboard.emitEvent('log', `[STEP 4] "${kw.keyword}" AI 기사 생성 중...`);

        const article = await articleGenerator.generateArticle(kw.keyword, newsData);

        if (!article) {
          logger.warn(`[STEP 4] "${kw.keyword}" 기사 생성 실패`);
          db.markKeywordProcessed(kw.id);
          continue;
        }

        // ===== STEP 5: DB 저장 + 퍼블리싱 =====
        const status = config.article.autoPublish ? 'published' : 'draft';

        const result = db.insertArticle({
          keywordId: kw.id,
          keyword: kw.keyword,
          title: article.title,
          content: article.content,
          summary: article.summary,
          sourceUrls: article.sourceUrls,
          slug: article.slug,
          status,
        });

        if (status === 'published') {
          const savedArticle = db.getArticleById(result.lastInsertRowid);
          publisher.publishArticle(savedArticle);

          dashboard.emitEvent('newArticle', {
            id: result.lastInsertRowid,
            title: article.title,
            slug: article.slug,
            keyword: kw.keyword,
          });

          logger.info(`✅ "${kw.keyword}" → "${article.title}" 발행 완료!`);
          dashboard.emitEvent('log', `✅ "${article.title}" 발행 완료!`);
        }

        db.markKeywordProcessed(kw.id);
        articlesThisHour++;

        // API 과부하 방지 딜레이
        await sleep(2000);

      } catch (err) {
        logger.error(`[파이프라인] "${kw.keyword}" 처리 중 오류: ${err.message}`);
        dashboard.emitEvent('log', `❌ "${kw.keyword}" 오류: ${err.message}`);
        db.markKeywordProcessed(kw.id);
      }
    }

    // ===== STEP 6: 인덱스 페이지 갱신 =====
    logger.info('[STEP 6] 인덱스 페이지 갱신...');
    const publishedArticles = db.getArticles({ status: 'published', limit: 50 });
    publisher.updateIndex(publishedArticles);

    // 통계 갱신
    dashboard.emitEvent('stats', db.getStats());

    logger.info('========================================');
    logger.info('🏁 파이프라인 실행 완료');
    logger.info('========================================');
    dashboard.emitEvent('log', '🏁 파이프라인 실행 완료');

  } catch (error) {
    logger.error(`[파이프라인] 치명적 오류: ${error.message}`);
    logger.error(error.stack);
    dashboard.emitEvent('log', `❌ 치명적 오류: ${error.message}`);
  }
}

// ========== 유틸리티 ==========
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== 시스템 시작 ==========
async function start() {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║  🇰🇷 한국 실시간 트렌드 자동 퍼블리셔 v1.0      ║
  ║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║
  ║  실시간 검색어 감지 → 뉴스 수집 → AI 기사 생성   ║
  ║  → 자동 퍼블리싱 → SEO 최적화 → 수익화           ║
  ╚══════════════════════════════════════════════════╝
  `);

  // 설정 확인
  logger.info('===== 시스템 설정 =====');
  logger.info(`크롤링 주기: ${config.crawl.intervalMinutes}분`);
  logger.info(`AI 모델: ${config.openai.model}`);
  logger.info(`시간당 최대 기사: ${config.article.maxPerHour}개`);
  logger.info(`자동 발행: ${config.article.autoPublish ? 'ON' : 'OFF'}`);
  logger.info(`OpenAI API: ${config.openai.apiKey ? '설정됨 ✓' : '미설정 (폴백 모드)'}`);
  logger.info(`네이버 API: ${config.naver.clientId ? '설정됨 ✓' : '미설정 (Google만 사용)'}`);

  // 1. 대시보드 시작
  dashboard.startDashboard();

  // 2. 최초 실행
  logger.info('🏁 최초 파이프라인 실행...');
  await runPipeline();

  // 3. 크론 스케줄링 (N분마다 실행)
  const cronExpression = `*/${config.crawl.intervalMinutes} * * * *`;
  cron.schedule(cronExpression, async () => {
    logger.info(`⏰ 스케줄 트리거 (${config.crawl.intervalMinutes}분 주기)`);
    await runPipeline();
  });

  logger.info(`✅ 크론 스케줄러 시작: ${cronExpression} (${config.crawl.intervalMinutes}분마다 실행)`);
  logger.info(`📊 대시보드: http://${config.server.host}:${config.server.port}/dashboard`);
  logger.info(`🌐 사이트: http://${config.server.host}:${config.server.port}/`);
}

// 프로세스 에러 핸들링
process.on('uncaughtException', (err) => {
  logger.error(`[치명적] Uncaught Exception: ${err.message}`);
  logger.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`[치명적] Unhandled Rejection: ${reason}`);
});

// DB 초기화 대기 후 시작
db.dbReady.then(() => {
  start().catch(err => {
    logger.error(`[시작 실패] ${err.message}`);
    process.exit(1);
  });
});
