// ============================================
// config.js - 전역 설정 관리
// ============================================
require('dotenv').config();

module.exports = {
  // AI (OpenAI / DeepSeek)
  ai: {
    provider: (process.env.AI_PROVIDER || 'deepseek').trim(),
    apiKey: (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim(),
    model: (process.env.AI_MODEL || '').trim(),
    baseUrl: (process.env.AI_BASE_URL || '').trim(),
  },

  // 네이버 API
  naver: {
    clientId: (process.env.NAVER_CLIENT_ID || '').trim(),
    clientSecret: (process.env.NAVER_CLIENT_SECRET || '').trim(),
  },

  // 서버
  server: {
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
  },

  // 크롤링
  crawl: {
    intervalMinutes: parseInt(process.env.CRAWL_INTERVAL_MINUTES) || 3,
  },

  // 기사 생성
  article: {
    maxPerHour: parseInt(process.env.MAX_ARTICLES_PER_HOUR) || 20,
    autoPublish: process.env.AUTO_PUBLISH !== 'false',
  },

  // 사이트
  site: {
    title: process.env.SITE_TITLE || '트렌드 뉴스',
    description: process.env.SITE_DESCRIPTION || '실시간 트렌드 뉴스 자동 발행',
    url: (process.env.SITE_URL || 'https://fastnews-production.up.railway.app').trim().replace(/\/$/, ''),
    naverVerification: (process.env.NAVER_SITE_VERIFICATION || '').trim(),
    googleVerification: (process.env.GOOGLE_SITE_VERIFICATION || '').trim(),
  },

  // 영구 저장소 (Railway Volume)
  dataDir: process.env.DATA_DIR || '',  // 비어있으면 기본 경로 사용

  // 로그
  logLevel: process.env.LOG_LEVEL || 'info',
};
