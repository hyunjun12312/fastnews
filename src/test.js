// ============================================
// test.js - 시스템 테스트 (간단 실행)
// ============================================
// 각 모듈을 개별적으로 테스트할 수 있는 스크립트

require('dotenv').config();
const logger = require('./logger');

async function testCrawler() {
  console.log('\n===== 크롤러 테스트 =====\n');
  const crawler = require('./trend-crawler');
  
  console.log('Google Trends 테스트...');
  const google = await crawler.crawlGoogleTrends();
  console.log(`  → ${google.length}개 키워드`);
  google.slice(0, 5).forEach(k => console.log(`    ${k.rank}. ${k.keyword}`));

  console.log('\nGoogle Trends API 테스트...');
  const googleApi = await crawler.crawlGoogleTrendsApi();
  console.log(`  → ${googleApi.length}개 키워드`);
  googleApi.slice(0, 5).forEach(k => console.log(`    ${k.rank}. ${k.keyword}`));

  console.log('\n전체 크롤링 테스트...');
  const all = await crawler.crawlAll();
  console.log(`  → 총 ${all.length}개 키워드`);
  all.slice(0, 10).forEach(k => console.log(`    [${k.source}] ${k.keyword}`));

  return all;
}

async function testNewsFetcher(keyword) {
  console.log(`\n===== 뉴스 수집 테스트: "${keyword}" =====\n`);
  const fetcher = require('./news-fetcher');

  const news = await fetcher.fetchNewsForKeyword(keyword);
  console.log(`  → ${news.totalCount}개 뉴스 수집`);
  
  news.articles.slice(0, 5).forEach((a, i) => {
    console.log(`  ${i+1}. [${a.source}] ${a.title}`);
  });

  return news;
}

async function testArticleGenerator(keyword, newsData) {
  console.log(`\n===== 기사 생성 테스트: "${keyword}" =====\n`);
  const generator = require('./article-generator');

  const article = await generator.generateArticle(keyword, newsData);
  
  console.log(`  제목: ${article.title}`);
  console.log(`  요약: ${article.summary}`);
  console.log(`  슬러그: ${article.slug}`);
  console.log(`  본문 길이: ${article.content.length}자`);
  console.log(`  본문 미리보기: ${article.content.substring(0, 200)}...`);

  return article;
}

async function testPublisher(article) {
  console.log(`\n===== 퍼블리셔 테스트 =====\n`);
  const pub = require('./publisher');
  
  const filePath = pub.publishArticle(article);
  console.log(`  → HTML 생성: ${filePath}`);

  pub.updateIndex([article]);
  console.log(`  → 인덱스 페이지 갱신 완료`);
}

async function runAllTests() {
  console.log(`
  ╔══════════════════════════════════════╗
  ║  🧪 시스템 통합 테스트               ║
  ╚══════════════════════════════════════╝
  `);

  try {
    // 1. 크롤러 테스트
    const keywords = await testCrawler();
    
    if (keywords.length === 0) {
      console.log('\n⚠️  키워드가 수집되지 않았습니다. 네트워크를 확인하세요.');
      return;
    }

    // 2. 첫 번째 키워드로 뉴스 수집 테스트
    const testKeyword = keywords[0].keyword;
    const newsData = await testNewsFetcher(testKeyword);

    // 3. 기사 생성 테스트
    const article = await testArticleGenerator(testKeyword, newsData);

    // 4. 퍼블리싱 테스트
    await testPublisher(article);

    console.log('\n✅ 모든 테스트 통과!\n');
    console.log('시스템을 시작하려면: npm start');
    console.log('대시보드 접속: http://localhost:3000/dashboard\n');

  } catch (error) {
    console.error(`\n❌ 테스트 실패: ${error.message}`);
    console.error(error.stack);
  }

  process.exit(0);
}

// 실행
const db = require('./database');
db.dbReady.then(() => runAllTests());
