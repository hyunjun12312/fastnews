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

// ========== 시스템 프롬프트 (전문 기자 수준) ==========
function getSystemPrompt() {
  return `당신은 "연합뉴스" 수준의 대한민국 최고 뉴스통신사 소속 수석 기자이자 편집국장입니다.
10년 이상의 경력으로 사회, 경제, 정치, IT, 문화, 스포츠 등 전 분야를 커버하며,
독자에게 깊이 있는 정보를 전달하는 전문 저널리스트입니다.

━━━ 기사 작성 원칙 (반드시 준수) ━━━

【문체와 톤】
• 권위 있고 객관적인 보도체 사용 (예: "~한 것으로 나타났다", "~한 것으로 알려졌다", "~라고 밝혔다")
• 구어체, 블로그체, SNS체 절대 금지 ("~했어요", "~인데요", "~거든요" 금지)
• 감탄사, 이모지, 느낌표 남발 금지
• "충격", "경악", "발칵", "난리" 등 자극적/낚시성 표현 금지
• 추측성 표현 최소화, 사실 관계 중심 서술
• "~에 대해 알아보겠습니다" 같은 블로그식 전환 표현 금지

【기사 구조 (역피라미드 + 심층분석)】
1. 리드(Lead): 핵심 사실을 첫 2문장에 압축 (누가/언제/어디서/무엇을/왜/어떻게)
2. 핵심 내용: 리드 확장, 구체적 수치·인용·팩트 중심
3. 배경 설명: 왜 이 이슈가 중요한지 맥락 제공
4. 전문가 분석/영향: 이 사안이 미치는 영향과 의미
5. 향후 전망: 앞으로의 예상 전개와 주요 변수

【품질 기준】
• 최소 1500자, 최대 3500자 (공백 포함)
• 소제목(##)은 3~5개 사용하되 구체적이고 정보를 담을 것 (예: "## 삼성전자, 4분기 영업이익 12조원 전망" ← 좋음 / "## 관련 소식" ← 나쁨)
• 수치, 날짜, 고유명사를 적극 활용하여 구체성 확보
• 각 문단은 2~4문장으로 구성, 한 문단이 너무 길어지지 않도록
• 마지막 문단에서 전망이나 시사점으로 마무리
• "한편", "이에 따라", "이와 관련해", "또한" 등 접속부사로 문단 연결

【SEO 최적화】
• 제목: 핵심 키워드를 앞쪽에 배치, 30~45자 이내
• 제목에 숫자나 구체적 정보 포함 권장 (예: "2026년", "30%", "1위")
• 첫 문단(리드)에 핵심 키워드 자연스럽게 포함
• 소제목에도 키워드 또는 연관어 자연스럽게 배치
• 메타 설명(요약)은 80~120자로 기사 핵심을 함축

【절대 하지 말 것】
• 출처 없는 인용문 날조 ❌
• "이 기사는 AI가 작성했습니다" 같은 안내 ❌
• 뉴스 원문을 그대로 복사/붙여넣기 ❌
• 같은 문장 반복 또는 동어반복 ❌
• "~에 대해 살펴보도록 하겠습니다" 같은 비전문적 전환문 ❌

결과물은 반드시 아래 형식으로 출력하세요:
TITLE: (제목)
SUMMARY: (요약 80~120자)
TAGS: (관련 태그 3~5개, 쉼표 구분)
CONTENT:
(마크다운 본문)`;
}

// ========== 사용자 프롬프트 ==========
function getUserPrompt(keyword, newsContext) {
  const dateTime = getKoreanDateTime();

  return `현재 시각: ${dateTime}
실시간 트렌딩 키워드: "${keyword}"

━━━ 참고할 뉴스 취재 자료 ━━━
${newsContext || '(관련 뉴스 자료가 부족합니다. 해당 키워드에 대해 알려진 일반적인 사실과 배경 정보를 바탕으로 심층 분석 기사를 작성해주세요.)'}
━━━━━━━━━━━━━━━━━━━━━━━━

위 취재 자료를 종합 분석하여 전문 뉴스 기사를 작성해주세요.

작성 요구사항:
1. 여러 뉴스 소스를 교차 검증하고 종합하여 하나의 완성된 기사로 재구성
2. 단순 나열이 아닌, 맥락과 인과관계를 연결하는 스토리텔링
3. 핵심 수치, 인물, 일정 등 구체적 팩트를 중심으로 서술
4. "${keyword}"을(를) 자연스럽게 제목과 본문에 녹여낼 것
5. 독자가 이 기사 하나만 읽어도 이슈 전체를 파악할 수 있도록

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

  // 본문 길이 검사
  if (content.length < 500) {
    issues.push(`본문 너무 짧음 (${content.length}자, 최소 500자)`);
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

    // 본문이 너무 짧으면 보강 요청
    if (content.length < 800 && aiClient) {
      logger.info(`[AI] 본문 부족 (${content.length}자), 보강 생성 시도...`);
      const enhanced = await enhanceArticle(aiClient, keyword, content, newsContext);
      if (enhanced && enhanced.length > content.length) {
        const slug = generateSlug(title);
        const sourceUrls = newsData?.articles?.map(a => a.link).filter(Boolean) || [];

        logger.info(`[AI] "${keyword}" 보강 기사 완료: "${title}" (${enhanced.length}자, 품질: ${quality.score}점)`);

        return {
          title,
          summary,
          tags,
          content: postProcessContent(enhanced),
          slug,
          sourceUrls,
          keyword,
        };
      }
    }

    const slug = generateSlug(title);
    const sourceUrls = newsData?.articles?.map(a => a.link).filter(Boolean) || [];

    logger.info(`[AI] "${keyword}" 기사 생성 완료: "${title}" (${content.length}자, 품질: ${quality.score}점)`);

    return {
      title,
      summary,
      tags,
      content,
      slug,
      sourceUrls,
      keyword,
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

  return {
    title,
    summary,
    tags,
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
