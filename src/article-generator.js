// ============================================
// article-generator.js - AI 기사 자동 생성 모듈
// ============================================
// 전문 기자 수준의 고품질 한국어 뉴스 기사를
// AI를 활용하여 자동 생성 (DeepSeek / OpenAI 지원)
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

// ========== 키워드 정제 ==========
function cleanKeyword(keyword) {
  if (!keyword) return keyword;
  return keyword
    .replace(/\s+\d+$/, '')     // 뒤에 붙은 숫자 제거 ("캐나다 방송 오류 9" → "캐나다 방송 오류")
    .replace(/^\d+\s+/, '')     // 앞에 붙은 순위 숫자 제거
    .replace(/\s+/g, ' ')       // 다중 공백 정리
    .trim();
}

// ========== 현재 시간 포맷 ==========
function getKoreanDateTime() {
  const now = new Date();
  const options = {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'long', hour: '2-digit', minute: '2-digit',
  };
  return now.toLocaleDateString('ko-KR', options);
}

// ========== 뉴스 컨텍스트 구성 (최대한 풍부하게) ==========
function buildNewsContext(keyword, newsData) {
  const sections = [];

  // 1. 본문이 있는 상세 기사 (최대 2000자씩)
  if (newsData?.topArticlesWithContent?.length > 0) {
    const detailed = newsData.topArticlesWithContent.filter(a => a.fullContent && a.fullContent.length > 50);
    if (detailed.length > 0) {
      sections.push('=== 상세 취재 기사 ===');
      detailed.forEach((a, i) => {
        const content = a.fullContent.substring(0, 2000);
        sections.push(`\n[기사 ${i + 1}] 제목: ${a.title}\n출처: ${a.source || '뉴스'}\n발행: ${a.pubDate || '최근'}\n본문:\n${content}`);
      });
    }
  }

  // 2. 헤드라인 + 요약 기사들
  if (newsData?.articles?.length > 0) {
    sections.push('\n=== 관련 뉴스 헤드라인 ===');
    newsData.articles.slice(0, 8).forEach((a, i) => {
      const desc = a.description ? ` — ${a.description}` : '';
      sections.push(`${i + 1}. [${a.source || '뉴스'}] ${a.title}${desc}`);
    });
  }

  return sections.join('\n');
}

// ========== 시스템 프롬프트 (빠른 이해 + 가독성 중심) ==========
function getSystemPrompt() {
  return `당신은 대한민국 토프 뉴스 편집자입니다.
실시간 검색어를 본 독자가 30초 이내에 핵심을 파악할 수 있도록 작성합니다.

━━━ 작성 원칙 (30초 규칙) ━━━

【구조: 빠른 이해 콜드와 포맷】
1. 핵심 요약 (3줄 이내): 이 이슈가 뭔데를 한 눈에 설명
2. 핵심 포인트 (3~5개): 불릿 포인트로 정리, 각 1~2문장
3. 상세 내용: 배경과 맥락을 2~3문단으로 간결하게
4. 전망/의미: 2~3문장으로 마무리

【문체】
• 간결하고 명쾌한 보도체 ("~한 것으로 나타났다", "~라고 밝혔다")
• 한 문장은 30자 이내 권장 (50자 초과 금지)
• 불필요한 형용사/부사 제거, 압축적 서술
• 블로그체/SNS체 금지 ("~인데요", "~거든요" 금지)
• 낚시성 표현 금지 ("충격", "경악", "발칵" 금지)

【양】
• 전체 600~1000자 (공백 포함)
• 소제목(##) 2~3개, 각 소제목에 구체적 정보 포함
• 핑심 포인트는 불릿(•) 사용, 간결하게

【SEO】
• 제목: 핵심 키워드 앞쪽 배치, 25~40자
• 요약: 60~100자로 핵심 파악 가능
• 첫 문단에 키워드 자연스럽게 포함

【절대 금지】
• "~에 대해 살펴보겠습니다" 같은 비전문적 전환문 ❌
• AI 작성 언급 ❌
• 동어반복 ❌
• 원문 그대로 복사 ❌

결과물 형식:
TITLE: (제목)
SUMMARY: (요약 60~100자)
TAGS: (관련 태그 3~5개, 쉼표 구분)
CONTENT:
(마크다운 본문)`;
}

// ========== 사용자 프롬프트 ==========
function getUserPrompt(keyword, newsContext) {
  const dateTime = getKoreanDateTime();

  return `현재 시각: ${dateTime}
실시간 트렌딩 키워드: "${keyword}"

━━━ 참고 뉴스 취재 자료 ━━━
${newsContext || '(관련 뉴스 자료가 부족합니다. 일반적 사실을 바탕으로 작성해주세요.)'}
━━━━━━━━━━━━━━━━━━━━━━━━

위 뉴스 자료를 종합하여 **빠르게 읽히는** 기사를 작성해주세요.

작성 포맷:
1. 핵심 요약 3줄: "이 이슈가 뭔데?"에 대한 즉시 답변
2. 핵심 포인트 3~5개: 불릿(•)으로 팩트 정리, 각 1~2문장
3. 상세 배경 2~3문단: 맥락과 의미를 간결하게
4. 전망 2~3문장: 앞으로의 전개

형식:
TITLE: (제목)
SUMMARY: (요약)
TAGS: (태그1, 태그2, 태그3)
CONTENT:
(마크다운 본문)`;
}

// ========== 기사 출력 파싱 ==========
function parseArticleOutput(output, keyword) {
  // TITLE 파싱
  const titleMatch = output.match(/TITLE:\s*(.+?)(?:\n|$)/);
  let title = titleMatch ? titleMatch[1].trim() : '';

  // SUMMARY 파싱
  const summaryMatch = output.match(/SUMMARY:\s*(.+?)(?:\n|$)/);
  let summary = summaryMatch ? summaryMatch[1].trim() : '';

  // TAGS 파싱
  const tagsMatch = output.match(/TAGS:\s*(.+?)(?:\n|$)/);
  const tags = tagsMatch
    ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
    : [keyword];

  // CONTENT 파싱
  const contentMatch = output.match(/CONTENT:\s*([\s\S]+)/);
  let content = contentMatch ? contentMatch[1].trim() : '';

  // 파싱 실패 시 전체 출력을 본문으로 사용
  if (!content && output.length > 100) {
    // TITLE/SUMMARY/TAGS 줄 제거 후 나머지를 본문으로
    content = output
      .replace(/^TITLE:.*$/m, '')
      .replace(/^SUMMARY:.*$/m, '')
      .replace(/^TAGS:.*$/m, '')
      .replace(/^CONTENT:\s*/m, '')
      .trim();
  }

  // 제목 후처리
  if (!title) title = `${keyword} 관련 최신 동향 심층 분석`;
  title = title.replace(/^["'#]+|["']+$/g, '').trim(); // 따옴표, # 제거
  if (title.length > 60) title = title.substring(0, 57) + '...';

  // 요약 후처리
  if (!summary) summary = `${keyword} 관련 최신 소식과 심층 분석, 향후 전망을 종합 정리했습니다.`;
  summary = summary.replace(/^["']+|["']+$/g, '').trim();

  return { title, summary, tags, content };
}

// ========== 기사 품질 검증 ==========
function validateArticleQuality(content) {
  const issues = [];

  // 본문 길이 검사 (축약형: 300자 이상)
  if (content.length < 300) {
    issues.push(`본문 너무 짧음 (${content.length}자, 최소 300자)`);
  }

  // 소제목 개수 검사
  const headingCount = (content.match(/^##\s/gm) || []).length;
  if (headingCount < 2) {
    issues.push(`소제목 부족 (${headingCount}개, 최소 2개 권장)`);
  }

  // 문단 개수 검사
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 20);
  if (paragraphs.length < 3) {
    issues.push(`문단 부족 (${paragraphs.length}개, 최소 3개 권장)`);
  }

  // 블로그체 감지
  const blogPatterns = [
    /인데요/g, /거든요/g, /했어요/g, /알아보겠/g, /살펴보겠/g,
    /알아볼까요/g, /하셨나요/g, /드리겠/g,
  ];
  const blogHits = blogPatterns.reduce((sum, p) => sum + (content.match(p) || []).length, 0);
  if (blogHits > 0) {
    issues.push(`비보도체 표현 ${blogHits}건 감지`);
  }

  return {
    passed: issues.length === 0,
    issues,
    score: Math.max(0, 100 - issues.length * 20),
  };
}

// ========== 기사 후처리 (블로그체 → 보도체 변환) ==========
function postProcessContent(content) {
  let processed = content;

  // 블로그체 → 보도체 치환
  const replacements = [
    [/~인데요[.!]?/g, '~이다.'],
    [/~거든요[.!]?/g, '~기 때문이다.'],
    [/~했어요[.!]?/g, '~했다.'],
    [/~할게요[.!]?/g, '~할 예정이다.'],
    [/~볼까요[?]?/g, '~보자.'],
    [/~하셨나요[?]?/g, '~한 바 있다.'],
    [/에 대해 알아보겠습니다[.!]?/g, '에 대해 짚어본다.'],
    [/살펴보도록 하겠습니다[.!]?/g, '살펴본다.'],
    [/알아보도록 하겠습니다[.!]?/g, '알아본다.'],
  ];

  replacements.forEach(([pattern, replacement]) => {
    processed = processed.replace(pattern, replacement);
  });

  // "이 기사는 AI가..." 등 자기 언급 제거
  processed = processed.replace(/\n.*이 (기사|글|콘텐츠)는.*(AI|인공지능|자동).*생성.*\n?/g, '\n');

  // 불필요한 빈 줄 정리
  processed = processed.replace(/\n{4,}/g, '\n\n\n');

  // 마크다운 제목에 불필요한 볼드 제거
  processed = processed.replace(/^(#{1,3})\s*\*\*(.+?)\*\*/gm, '$1 $2');

  return processed.trim();
}

// ========== SEO 최적화 기사 생성 (메인) ==========
async function generateArticle(keyword, newsData) {
  // 키워드 정제 (댓글수/순위 등 불필요 숫자 제거)
  keyword = cleanKeyword(keyword);

  const aiClient = getClient();

  if (!aiClient) {
    logger.warn('[AI] API 키 미설정, 폴백 기사 생성으로 대체');
    return generateFallbackArticle(keyword, newsData);
  }

  try {
    logger.info(`[AI] "${keyword}" 전문 기사 생성 시작...`);

    // 풍부한 뉴스 컨텍스트 구성
    const newsContext = buildNewsContext(keyword, newsData);
    const systemPrompt = getSystemPrompt();
    const userPrompt = getUserPrompt(keyword, newsContext);

    // 1차 생성
    const response = await aiClient.chat.completions.create({
      model: getModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,  // 팩트 중심, 보도체에 적합한 낮은 온도
      max_tokens: 4096,
      top_p: 0.9,
      frequency_penalty: 0.3,  // 동어반복 방지
      presence_penalty: 0.2,   // 다양한 표현 유도
    });

    const rawOutput = response.choices[0]?.message?.content || '';
    logger.debug(`[AI] 원본 출력 길이: ${rawOutput.length}자`);

    // 파싱
    const { title, summary, tags, content: parsedContent } = parseArticleOutput(rawOutput, keyword);

    // 후처리
    const content = postProcessContent(parsedContent);

    // 품질 검증
    const quality = validateArticleQuality(content);
    if (!quality.passed) {
      logger.warn(`[AI] 품질 검증 이슈: ${quality.issues.join(', ')} (점수: ${quality.score})`);
    }

    const slug = generateSlug(title);
    const sourceUrls = newsData?.articles?.map(a => a.link).filter(Boolean) || [];
    const image = newsData?.representativeImage || '';

    logger.info(`[AI] "${keyword}" 기사 생성 완료: "${title}" (${content.length}자, 품질: ${quality.score}점, 이미지: ${image ? 'O' : 'X'})`);

    return {
      title,
      summary,
      tags,
      content,
      slug,
      sourceUrls,
      keyword,
      image,
    };
  } catch (error) {
    logger.error(`[AI] 기사 생성 실패 [${keyword}]: ${error.message}`);
    return generateFallbackArticle(keyword, newsData);
  }
}

// ========== 기사 보강 (2차 호출) ==========
async function enhanceArticle(aiClient, keyword, shortContent, newsContext) {
  try {
    const response = await aiClient.chat.completions.create({
      model: getModel(),
      messages: [
        {
          role: 'system',
          content: `당신은 뉴스 편집자입니다. 아래 기사 초안이 너무 짧습니다. 
동일한 톤과 문체를 유지하면서 내용을 1500자 이상으로 보강해주세요.
추가할 내용: 배경 설명, 전문가 분석, 수치/데이터, 향후 전망 등.
결과는 마크다운 본문만 출력하세요.`,
        },
        {
          role: 'user',
          content: `키워드: "${keyword}"\n\n참고 뉴스 자료:\n${newsContext}\n\n기사 초안:\n${shortContent}\n\n위 초안을 1500자 이상의 완성된 뉴스 기사로 보강해주세요.`,
        },
      ],
      temperature: 0.4,
      max_tokens: 4096,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    logger.error(`[AI] 기사 보강 실패: ${error.message}`);
    return null;
  }
}

// ========== 폴백: API 없이 기사 구성 (고품질) ==========
function generateFallbackArticle(keyword, newsData) {
  // 키워드 정제
  keyword = cleanKeyword(keyword);
  logger.info(`[AI] "${keyword}" 폴백 기사 생성 중...`);

  const now = new Date();
  const dateStr = now.toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('ko-KR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul',
  });

  const title = `${keyword}, ${dateStr} 현재 주요 이슈 총정리`;
  const summary = `${keyword} 관련 최신 동향과 주요 뉴스를 종합 분석했습니다. 핵심 사안과 향후 전망을 짚어봅니다.`;

  let content = '';

  // 리드 문단
  content += `${dateStr} ${timeStr} 현재, "${keyword}"이(가) 실시간 검색어에 오르며 `;
  content += `뜨거운 관심을 받고 있다. `;

  if (newsData?.articles?.length > 0) {
    content += `현재까지 파악된 관련 뉴스만 ${newsData.articles.length}건에 달하며, `;
    content += `각 언론사가 일제히 관련 보도를 쏟아내고 있는 상황이다.\n\n`;
  } else {
    content += `온라인 커뮤니티와 SNS를 중심으로 빠르게 확산되고 있다.\n\n`;
  }

  // 주요 뉴스 종합
  if (newsData?.articles?.length > 0) {
    content += `## 주요 보도 내용 종합\n\n`;

    const articles = newsData.articles.slice(0, 6);
    articles.forEach((article, i) => {
      const source = article.source === 'naver_news' ? '네이버 뉴스' :
                     article.source === 'google_news' ? '구글 뉴스' : '언론 보도';
      content += `**${article.title}** (${source})\n\n`;
      if (article.description) {
        content += `${article.description}\n\n`;
      }
    });
  }

  // 상세 분석 (본문이 있는 경우)
  if (newsData?.topArticlesWithContent?.length > 0) {
    const detailedArticles = newsData.topArticlesWithContent.filter(a => a.fullContent && a.fullContent.length > 100);
    if (detailedArticles.length > 0) {
      content += `## 심층 분석\n\n`;
      detailedArticles.forEach(article => {
        // 본문에서 핵심 문장 추출 (처음 800자)
        const body = article.fullContent.substring(0, 800);
        // 마지막 완전한 문장까지만 사용
        const lastPeriod = body.lastIndexOf('다.');
        const cleanBody = lastPeriod > 100 ? body.substring(0, lastPeriod + 2) : body;
        content += `${cleanBody}\n\n`;
      });
    }
  }

  // 배경 섹션
  content += `## 이슈 배경 및 맥락\n\n`;
  content += `"${keyword}" 관련 이슈는 최근 사회적 관심이 집중되면서 `;
  content += `실시간 검색어 상위에 오르게 됐다. `;
  content += `해당 키워드는 다수의 언론사와 온라인 매체에서 집중 보도되고 있으며, `;
  content += `관련 검색량이 급증하고 있는 것으로 나타났다.\n\n`;

  // 전망
  content += `## 향후 전망\n\n`;
  content += `업계 관계자들은 "${keyword}" 관련 이슈가 당분간 지속될 것으로 전망하고 있다. `;
  content += `추가 보도와 공식 발표가 이어질 것으로 예상되며, `;
  content += `관련 동향에 대한 지속적인 모니터링이 필요한 시점이다. `;
  content += `본 매체는 해당 이슈에 대한 후속 보도를 이어갈 예정이다.`;

  const slug = generateSlug(title);
  const sourceUrls = newsData?.articles?.map(a => a.link).filter(Boolean) || [];
  const tags = [keyword, '실시간', '이슈', '뉴스'];
  const image = newsData?.representativeImage || '';

  return {
    title,
    summary,
    tags,
    content,
    slug,
    sourceUrls,
    keyword,
    image,
  };
}

module.exports = {
  generateArticle,
  generateFallbackArticle,
  generateSlug,
};
