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
const socialShare = require('./social-share');
const dashboard = require('./dashboard');

// 로그 디렉토리 생성
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// 시간당 기사 생성 카운터
let articlesThisHour = 0;
let lastHourReset = Date.now();

// ========== DB에서 최근 트렌드 키워드 가져오기 ==========
function getRecentTrendKeywords() {
  try {
    const recent = db.getRecentKeywords(12); // 최근 12시간
    const seen = new Set();
    const keywords = [];
    for (const r of recent) {
      const kw = r.keyword;
      if (!seen.has(kw) && crawler.isGoodKeyword(kw)) {
        seen.add(kw);
        keywords.push(kw);
      }
      if (keywords.length >= 35) break;
    }
    return keywords;
  } catch (e) {
    return [];
  }
}

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
      // 키워드 한번 더 정제
      kw.keyword = cleanKeywordText(kw.keyword);
      if (!kw.keyword || kw.keyword.length < 2) continue;

      // 키워드 품질 2차 검증 (크롤러에서 누락된 쓰레기 차단)
      if (kw.keyword.length > 15) continue;
      if (/['\"''""」]/.test(kw.keyword)) continue;
      if (/(?:까지|에서|으로|에게|부터|라는|라고|하는|되는|있는|없는)$/.test(kw.keyword)) continue;

      // 최근 40분 내에 이미 있는 키워드는 스킵 (실검은 빠르게 변함)
      if (!db.isKeywordRecent(kw.keyword, 40)) {
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
      
      // 인덱스 페이지는 항상 갱신 (트렌드 키워드 포함)
      const publishedArticles = db.getArticles({ status: 'published', limit: 50 });
      const trendKeywords = keywords.map(k => k.keyword);
      publisher.updateIndex(publishedArticles, trendKeywords);
      
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
          image: article.image || '',
        });

        if (status === 'published') {
          const savedArticle = db.getArticleById(result.lastInsertRowid);
          const trendKws = keywords.map(k => k.keyword);
          const allPublished = db.getArticles({ status: 'published', limit: 20 });
          publisher.publishArticle(savedArticle, trendKws, allPublished);

          dashboard.emitEvent('newArticle', {
            id: result.lastInsertRowid,
            title: article.title,
            slug: article.slug,
            keyword: kw.keyword,
          });

          // 소셜 미디어 자동 공유
          try {
            await socialShare.shareArticle(savedArticle);
          } catch (e) {
            logger.debug(`[소셜] 공유 실패: ${e.message}`);
          }

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
    const allTrendKeywords = keywords.map(k => k.keyword);
    publisher.updateIndex(publishedArticles, allTrendKeywords);

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

// ========== 이미지 백필 (기존 기사에 이미지 추가) ==========
// 비활성화: Bing/Google 이미지 검색은 무관한 이미지(클릭베이트)를 가져오므로 사용하지 않음
// 뉴스 기사 크롤링 시 og:image가 없으면 이미지 없이 발행하는 것이 낫다
async function backfillArticleImages() {
  logger.info('[이미지 백필] 비활성화됨 (이미지 검색은 무관한 이미지를 가져와 품질 저하)');
  return;
  const articlesWithoutImage = db.getArticlesWithoutImage(20);
  if (articlesWithoutImage.length === 0) {
    logger.info('[이미지 백필] 이미지 없는 기사 없음');
    return;
  }

  logger.info(`[이미지 백필] 이미지 없는 기사 ${articlesWithoutImage.length}개 발견, 이미지 수집 시작...`);
  dashboard.emitEvent('log', `🖼️ 이미지 없는 기사 ${articlesWithoutImage.length}개 이미지 수집 중...`);

  let fixed = 0;
  for (const article of articlesWithoutImage) {
    try {
      const image = await newsFetcher.searchImageForKeyword(article.keyword);
      if (image) {
        db.updateArticleImage(article.id, image);
        fixed++;
        logger.info(`[이미지 백필] "${article.keyword}" 이미지 확보 완료`);
      } else {
        logger.debug(`[이미지 백필] "${article.keyword}" 이미지 못 찾음`);
      }
      await sleep(1000); // 요청 간격
    } catch (e) {
      logger.debug(`[이미지 백필] "${article.keyword}" 실패: ${e.message}`);
    }
  }

  if (fixed > 0) {
    // 인덱스 페이지 재생성 (이미지 반영)
    const publishedArticles = db.getArticles({ status: 'published', limit: 50 });
    publisher.updateIndex(publishedArticles, getRecentTrendKeywords());
    logger.info(`[이미지 백필] ${fixed}/${articlesWithoutImage.length}개 기사 이미지 업데이트 완료`);
    dashboard.emitEvent('log', `🖼️ ${fixed}개 기사 이미지 업데이트 완료`);
  }
}

// ========== 유틸리티 ==========
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 키워드 정제 함수
function cleanKeywordText(kw) {
  return kw.trim()
    .replace(/\s+\d+$/, '')       // 끝에 " 숫자" 제거
    .replace(/^\d+\s+/, '')       // 앞에 "숫자 " 제거
    .replace(/\s+/g, ' ')
    .trim();
}

// ========== 저품질 기사 재생성 ==========
async function regenerateLowQualityArticles() {
  const lowQuality = db.getLowQualityArticles(50);
  if (lowQuality.length === 0) {
    logger.info('[재생성] 저품질 기사 없음');
    return;
  }

  logger.info(`[재생성] 저품질 기사 ${lowQuality.length}개 발견, 재생성 시작...`);
  dashboard.emitEvent('log', `🔄 저품질 기사 ${lowQuality.length}개 재생성 중...`);

  let regenerated = 0;
  for (const article of lowQuality) {
    try {
      // 키워드 정제
      const cleanedKeyword = cleanKeywordText(article.keyword);
      if (cleanedKeyword !== article.keyword) {
        db.updateArticleKeyword(article.id, cleanedKeyword);
        logger.info(`[재생성] 키워드 정제: "${article.keyword}" → "${cleanedKeyword}"`);
      }

      // 뉴스 재수집
      logger.info(`[재생성] "${cleanedKeyword}" 뉴스 재수집...`);
      const newsData = await newsFetcher.fetchNewsForKeyword(cleanedKeyword);

      // AI 기사 재생성
      logger.info(`[재생성] "${cleanedKeyword}" 기사 재생성...`);
      const newArticle = await articleGenerator.generateArticle(cleanedKeyword, newsData);

      if (!newArticle) {
        logger.warn(`[재생성] "${cleanedKeyword}" 재생성 실패`);
        continue;
      }

      // DB 업데이트
      db.updateArticle(article.id, {
        title: newArticle.title,
        content: newArticle.content,
        summary: newArticle.summary,
        image: newArticle.image || article.image || '',
        slug: newArticle.slug,
      });

      // 키워드도 정제된 것으로 업데이트
      if (cleanedKeyword !== article.keyword) {
        db.updateArticleKeyword(article.id, cleanedKeyword);
      }

      // HTML 파일 재생성
      const updatedArticle = db.getArticleById(article.id);
      publisher.publishArticle(updatedArticle, []);

      regenerated++;
      logger.info(`✅ [재생성] "${cleanedKeyword}" → "${newArticle.title}" 재생성 완료!`);
      dashboard.emitEvent('log', `🔄 "${newArticle.title}" 재생성 완료!`);

      await sleep(3000); // API 간격
    } catch (err) {
      logger.error(`[재생성] "${article.keyword}" 실패: ${err.message}`);
    }
  }

  if (regenerated > 0) {
    // 인덱스 페이지 갱신
    const publishedArticles = db.getArticles({ status: 'published', limit: 50 });
    publisher.updateIndex(publishedArticles, getRecentTrendKeywords());
    logger.info(`[재생성] ${regenerated}/${lowQuality.length}개 기사 재생성 완료`);
    dashboard.emitEvent('log', `🔄 ${regenerated}개 기사 재생성 완료`);
  }
}

// ========== 기존 기사 키워드 정제 ==========
function cleanExistingKeywords() {
  const articles = db.getArticles({ status: 'published', limit: 200 });
  let cleaned = 0;
  for (const article of articles) {
    const original = article.keyword;
    const clean = cleanKeywordText(original);
    if (clean !== original && clean.length > 1) {
      db.updateArticleKeyword(article.id, clean);
      // 제목에도 숫자가 포함되어 있으면 정제
      if (article.title.includes(original) && original !== clean) {
        const newTitle = article.title.replace(original, clean);
        db.updateArticle(article.id, { title: newTitle });
      }
      cleaned++;
      logger.info(`[키워드 정제] "${original}" → "${clean}"`);
    }
  }
  if (cleaned > 0) {
    logger.info(`[키워드 정제] ${cleaned}개 기사 키워드 정제 완료`);
  }
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
  logger.info(`AI Provider: ${config.ai.provider}`);
  logger.info(`시간당 최대 기사: ${config.article.maxPerHour}개`);
  logger.info(`자동 발행: ${config.article.autoPublish ? 'ON' : 'OFF'}`);
  logger.info(`AI API: ${config.ai.apiKey ? '설정됨 ✓' : '미설정 (폴백 모드)'}`);
  logger.info(`네이버 API: ${config.naver.clientId ? '설정됨 ✓' : '미설정 (Google만 사용)'}`);

  // 1. 대시보드 시작
  dashboard.startDashboard();

  // 1.5 기본 인덱스 페이지 즉시 생성 (서버 시작 직후 404 방지)
  try {
    const existingArticles = db.getArticles({ status: 'published', limit: 50 });
    publisher.updateIndex(existingArticles, getRecentTrendKeywords());
    logger.info(`[시작] 기본 인덱스 생성 완료 (기존 기사 ${existingArticles.length}개)`);
  } catch (e) {
    logger.warn(`[시작] 기본 인덱스 생성 실패: ${e.message}`);
  }

  // 1.6 기존 키워드 숫자 정제
  try {
    cleanExistingKeywords();
  } catch (e) {
    logger.warn(`[시작] 키워드 정제 실패: ${e.message}`);
  }

  // 1.61 키워드 테이블에서 쓰레기 키워드 삭제 (티커 정리)
  try {
    const kwDeleted = db.deleteGarbageKeywords(crawler.isGoodKeyword);
    if (kwDeleted > 0) {
      logger.info(`[시작] 키워드 테이블 쓰레기 ${kwDeleted}개 삭제`);
    }
  } catch (e) {
    logger.warn(`[시작] 키워드 테이블 정리 실패: ${e.message}`);
  }

  // 1.65 헤드라인이 키워드로 들어간 쓰레기 기사 삭제
  try {
    const deleted = db.deleteArticlesWithLongKeywords(15);
    if (deleted.changes > 0) {
      logger.info(`[시작] 키워드 길이 15자 초과 기사 ${deleted.changes}개 삭제`);
    }
  } catch (e) {
    logger.warn(`[시작] 쓰레기 기사 삭제 실패: ${e.message}`);
  }

  // 1.66 일반 명사/숫자 등 쓰레기 키워드 기사 삭제
  try {
    const deleted = db.deleteArticlesWithGarbageKeywords();
    if (deleted.changes > 0) {
      logger.info(`[시작] 쓰레기 키워드 기사 ${deleted.changes}개 삭제`);
    }
  } catch (e) {
    logger.warn(`[시작] 쓰레기 키워드 삭제 실패: ${e.message}`);
  }

  // 1.67 isGoodKeyword 기반 포괄적 쓰레기 정리 (기존 SQL 매칭 실패 보완)
  try {
    const allArticles = db.getArticles({ status: 'published', limit: 500 });
    let comprehensiveDeleted = 0;
    for (const article of allArticles) {
      if (!crawler.isGoodKeyword(article.keyword)) {
        // 정적 HTML 파일도 삭제
        try {
          if (article.slug) {
            const htmlPath = path.join(
              process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'public') : path.join(__dirname, '..', 'public'),
              'articles', `${article.slug}.html`
            );
            if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
          }
        } catch (fe) { /* 파일 삭제 실패 무시 */ }
        db.deleteArticle(article.id);
        comprehensiveDeleted++;
        logger.info(`[쓰레기 정리] 삭제: "${article.keyword}"`);
      }
    }
    if (comprehensiveDeleted > 0) {
      logger.info(`[시작] isGoodKeyword 기반 쓰레기 기사 ${comprehensiveDeleted}개 추가 삭제`);
    }
  } catch (e) {
    logger.warn(`[시작] 포괄적 쓰레기 정리 실패: ${e.message}`);
  }

  // 1.68 모든 정리 후 인덱스 재생성
  try {
    const cleanArticles = db.getArticles({ status: 'published', limit: 50 });
    publisher.updateIndex(cleanArticles, getRecentTrendKeywords());
    logger.info(`[시작] 정리 후 인덱스 재생성 완료 (${cleanArticles.length}개 기사)`);
  } catch (e) {
    logger.warn(`[시작] 정리 후 인덱스 재생성 실패: ${e.message}`);
  }

  // 1.7 이미지 없는 기존 기사에 이미지 채우기 (백필)
  try {
    await backfillArticleImages();
  } catch (e) {
    logger.warn(`[시작] 이미지 백필 실패: ${e.message}`);
  }

  // 1.8 저품질 기사 재생성 (시작 시에는 건너뛰고 30분 후 비동기 실행)
  // → 시작 시 재생성하면 cron이 10분+ 블로킹됨
  setTimeout(async () => {
    try {
      await regenerateLowQualityArticles();
    } catch (e) {
      logger.warn(`[지연 재생성] 저품질 기사 재생성 실패: ${e.message}`);
    }
  }, 30 * 60 * 1000); // 30분 후 실행
  logger.info('[시작] 저품질 기사 재생성은 30분 후 실행 예정');

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
