// ============================================
// social-share.js - 소셜 미디어 자동 공유
// ============================================
// 기사 발행 시 자동으로 소셜 채널에 공유
// 지원: Telegram Bot, Twitter/X API (선택)
// ============================================

const axios = require('axios');
const logger = require('./logger');
const config = require('./config');

// ========== Telegram Bot 공유 ==========
async function shareToTelegram(article) {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!botToken || !chatId) {
    logger.debug('[소셜] Telegram 설정 없음 (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)');
    return false;
  }

  try {
    const articleUrl = `${config.site.url}/articles/${article.slug}.html`;
    const keyword = article.keyword || '';
    const title = article.title || '';
    const summary = article.summary || '';

    const message = `🔥 *실시간 트렌드*

*${escapeMarkdown(title)}*

${escapeMarkdown(summary)}

🔑 키워드: #${escapeMarkdown(keyword.replace(/\s+/g, '_'))}
🔗 [기사 읽기](${articleUrl})

_${config.site.title}_`;

    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    }, { timeout: 10000 });

    logger.info(`[소셜] Telegram 공유 완료: "${title}"`);
    return true;
  } catch (error) {
    logger.error(`[소셜] Telegram 공유 실패: ${error.message}`);
    return false;
  }
}

// ========== Twitter/X 공유 (웹 인텐트 URL 생성) ==========
function getTwitterShareUrl(article) {
  const articleUrl = `${config.site.url}/articles/${article.slug}.html`;
  const text = `${article.title} #${(article.keyword || '').replace(/\s+/g, '')} #트렌드뉴스`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(articleUrl)}`;
}

// ========== 모든 채널에 공유 ==========
async function shareArticle(article) {
  if (!article || !article.slug) return;

  const results = await Promise.allSettled([
    shareToTelegram(article),
  ]);

  const success = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
  if (success > 0) {
    logger.info(`[소셜] "${article.title}" ${success}개 채널 공유 완료`);
  }
}

// Telegram MarkdownV1 escape
function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

module.exports = {
  shareArticle,
  shareToTelegram,
  getTwitterShareUrl,
};
