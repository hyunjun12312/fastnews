// ============================================
// article-generator.js - AI 기사 자동 생성 모듈
// ============================================
// OpenAI GPT API를 사용하여 수집된 뉴스를 바탕으로
// SEO 최적화된 독창적 기사를 자동 생성
// ============================================

const OpenAI = require('openai');
const config = require('./config');
const logger = require('./logger');

let client = null;

// Provider별 설정
const PROVIDER_CONFIG = {
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
};

function getClient() {
  if (!client && config.ai.apiKey) {
    const provider = config.ai.provider || 'deepseek';
    const providerCfg = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.deepseek;
    const baseURL = config.ai.baseUrl || providerCfg.baseURL;

    client = new OpenAI({
      apiKey: config.ai.apiKey,
      baseURL,
    });

    logger.info(`[AI] Provider: ${provider} | Model: ${config.ai.model || providerCfg.defaultModel} | Base: ${baseURL}`);
  }
  return client;
}

function getModel() {
  const provider = config.ai.provider || 'deepseek';
  return config.ai.model || (PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.deepseek).defaultModel;
}

// ========== 슬러그 생성 ==========
function generateSlug(title) {
  const timestamp = Date.now();
  const cleaned = title
    .replace(/[^\w\s가-힣]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
  return `${cleaned}-${timestamp}`;
}

// ========== SEO 최적화 기사 생성 ==========
async function generateArticle(keyword, newsData) {
  const aiClient = getClient();

  if (!aiClient) {
    logger.warn('[AI] API 키 미설정, 간단 기사 생성으로 대체');
    return generateFallbackArticle(keyword, newsData);
  }

  try {
    logger.info(`[AI] "${keyword}" 기사 생성 시작...`);

    // 수집된 뉴스 내용 요약
    let newsContext = '';
    if (newsData && newsData.topArticlesWithContent) {
      newsContext = newsData.topArticlesWithContent
        .map((a, i) => {
          const content = a.fullContent || a.description || '';
          return `[뉴스 ${i + 1}] ${a.title}\n${content.substring(0, 800)}`;
        })
        .join('\n\n---\n\n');
    } else if (newsData && newsData.articles) {
      newsContext = newsData.articles
        .slice(0, 5)
        .map((a, i) => `[뉴스 ${i + 1}] ${a.title}: ${a.description || ''}`)
        .join('\n');
    }

    const systemPrompt = `당신은 한국의 전문 뉴스 편집자이자 SEO 전문가입니다.
실시간 트렌딩 키워드에 대한 정보성 기사를 작성합니다.

규칙:
1. 100% 한국어로 작성
2. SEO 최적화: 키워드를 자연스럽게 제목, 첫 문단, 소제목에 포함
3. 독창적인 관점과 분석 추가
4. 최소 800자, 최대 2000자
5. 가독성을 위해 소제목(##)과 문단 나누기 활용
6. 낚시성 표현 금지, 사실 기반 정보 위주
7. 마지막에 "마무리" 또는 "전망" 섹션 포함
8. HTML이 아닌 Markdown 형식으로 작성`;

    const userPrompt = `실시간 트렌딩 키워드: "${keyword}"

아래는 관련 뉴스 자료입니다:

${newsContext || '(수집된 뉴스 없음 - 일반적인 정보성 글 작성)'}

위 키워드와 뉴스 자료를 바탕으로 다음 형식의 기사를 작성해주세요:

1. 먼저 SEO 최적화된 제목 (한 줄)
2. 1-2줄 요약 (메타 설명용)
3. 본문 (마크다운 형식, 소제목 포함)

형식:
TITLE: (제목)
SUMMARY: (요약)
CONTENT:
(본문 마크다운)`;

    const response = await aiClient.chat.completions.create({
      model: getModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    const output = response.choices[0]?.message?.content || '';

    // 제목, 요약, 본문 파싱
    const titleMatch = output.match(/TITLE:\s*(.+)/);
    const summaryMatch = output.match(/SUMMARY:\s*(.+)/);
    const contentMatch = output.match(/CONTENT:\s*([\s\S]+)/);

    const title = titleMatch ? titleMatch[1].trim() : `${keyword} - 최신 트렌드 분석`;
    const summary = summaryMatch ? summaryMatch[1].trim() : `${keyword} 관련 최신 소식과 분석을 정리했습니다.`;
    const content = contentMatch ? contentMatch[1].trim() : output;

    const slug = generateSlug(title);

    const sourceUrls = newsData?.articles?.map(a => a.link).filter(Boolean) || [];

    logger.info(`[AI] "${keyword}" 기사 생성 완료: "${title}" (${content.length}자)`);

    return {
      title,
      summary,
      content,
      slug,
      sourceUrls,
      keyword,
    };
  } catch (error) {
    logger.error(`[AI] 기사 생성 실패 [${keyword}]: ${error.message}`);

    // API 실패 시 폴백
    return generateFallbackArticle(keyword, newsData);
  }
}

// ========== 폴백: API 없이 기사 구성 ==========
function generateFallbackArticle(keyword, newsData) {
  logger.info(`[AI] "${keyword}" 폴백 기사 생성 중...`);

  const now = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const title = `${keyword} - ${now} 실시간 트렌드 총정리`;
  const summary = `${keyword} 관련 최신 소식과 화제가 되고 있는 이유를 정리했습니다.`;

  let content = `## ${keyword}, 왜 화제인가?\n\n`;
  content += `${now}, "${keyword}"가 실시간 검색어에 등장하며 많은 관심을 받고 있습니다.\n\n`;

  if (newsData?.articles?.length > 0) {
    content += `## 주요 관련 뉴스\n\n`;
    newsData.articles.slice(0, 5).forEach((article, i) => {
      content += `### ${i + 1}. ${article.title}\n\n`;
      if (article.description) {
        content += `${article.description}\n\n`;
      }
    });

    if (newsData.topArticlesWithContent) {
      const detailed = newsData.topArticlesWithContent.find(a => a.fullContent);
      if (detailed) {
        content += `## 상세 분석\n\n`;
        content += `${detailed.fullContent.substring(0, 500)}...\n\n`;
      }
    }
  } else {
    content += `현재 "${keyword}"에 대한 상세 정보를 수집 중입니다. `;
    content += `빠른 시일 내에 업데이트될 예정입니다.\n\n`;
  }

  content += `## 전망\n\n`;
  content += `"${keyword}" 관련 이슈는 당분간 지속될 것으로 보이며, `;
  content += `추가 소식이 발표되는 대로 업데이트하겠습니다.\n\n`;
  content += `---\n\n*이 글은 실시간 트렌드를 기반으로 자동 생성되었습니다.*`;

  const slug = generateSlug(title);
  const sourceUrls = newsData?.articles?.map(a => a.link).filter(Boolean) || [];

  return {
    title,
    summary,
    content,
    slug,
    sourceUrls,
    keyword,
  };
}

module.exports = {
  generateArticle,
  generateFallbackArticle,
  generateSlug,
};
