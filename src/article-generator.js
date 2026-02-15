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
  const configModel = config.ai.model || '';
  const providerDefault = (PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.deepseek).defaultModel;

  // DeepSeek provider인데 OpenAI 모델명이 설정된 경우 자동 교정
  if (provider === 'deepseek' && configModel && (configModel.startsWith('gpt-') || configModel.startsWith('o1') || configModel.startsWith('o3'))) {
    logger.warn(`[AI] ⚠️ DeepSeek provider에 OpenAI 모델(${configModel}) 감지 → "${providerDefault}"로 자동 교정`);
    return providerDefault;
  }

  return configModel || providerDefault;
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

  // 1. 본문이 있는 상세 기사 (최대 2000자씩) — 한국어 우선
  if (newsData?.topArticlesWithContent?.length > 0) {
    const detailed = newsData.topArticlesWithContent
      .filter(a => a.fullContent && a.fullContent.length > 50)
      .sort((a, b) => {
        // 한국어 비율이 높은 기사 우선
        const koreanRatioA = (a.fullContent.match(/[가-힣]/g) || []).length / a.fullContent.length;
        const koreanRatioB = (b.fullContent.match(/[가-힣]/g) || []).length / b.fullContent.length;
        return koreanRatioB - koreanRatioA;
      });
    if (detailed.length > 0) {
      sections.push('=== 상세 취재 기사 ===');
      detailed.slice(0, 3).forEach((a, i) => {
        const content = cleanNewsText(a.fullContent).substring(0, 2000);
        if (content.length > 50) {
          sections.push(`\n[기사 ${i + 1}] 제목: ${cleanNewsText(a.title)}\n본문:\n${content}`);
        }
      });
    }
  }

  // 2. 헤드라인 + 요약 기사들 (한국어 기사 우선)
  if (newsData?.articles?.length > 0) {
    const koreanArticles = newsData.articles.filter(a => {
      const title = a.title || '';
      return (title.match(/[가-힣]/g) || []).length > title.length * 0.2;
    });
    const articlesToUse = koreanArticles.length >= 3 ? koreanArticles : newsData.articles;
    
    sections.push('\n=== 관련 뉴스 헤드라인 ===');
    articlesToUse.slice(0, 8).forEach((a, i) => {
      const cleanTitle = cleanNewsText(a.title);
      const cleanDesc = a.description ? cleanNewsText(a.description) : '';
      const desc = cleanDesc ? ` — ${cleanDesc}` : '';
      sections.push(`${i + 1}. ${cleanTitle}${desc}`);
    });
  }

  return sections.join('\n');
}

// ========== 뉴스 텍스트 정제 ==========
function cleanNewsText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')                    // HTML 태그 제거
    .replace(/\s{2,}/g, ' ')                    // 다중 공백
    .replace(/\n{3,}/g, '\n\n')                 // 다중 줄바꿈
    .replace(/\[.*?기자\]/g, '')                 // [OOO 기자] 제거
    .replace(/\(.*?@.*?\)/g, '')                 // (이메일) 제거
    .replace(/Copyright.*$/gim, '')              // 저작권 문구 제거
    .replace(/ⓒ.*$/gim, '')                     // ⓒ 저작권
    .replace(/무단.*전재.*금지/g, '')              // 무단전재 금지
    .replace(/▶.*$/gm, '')                       // ▶ 관련기사 링크
    .trim();
}

// ========== 시스템 프롬프트 ==========
function getSystemPrompt() {
  return `당신은 대한민국 1위 뉴스 포털의 수석 편집기자입니다.
실시간 검색어를 클릭한 독자가 "아, 이게 이런 일이구나"하고 바로 이해할 수 있는 기사를 작성합니다.

━━━ 핵심 원칙 ━━━

【반드시 한국어로만 작성】
• 영어 제목, 영어 문장은 절대 그대로 포함하지 마세요
• 외국 뉴스라도 반드시 한국어로 번역/의역하여 작성
• 고유명사(인명, 기관명)만 영어 병기 가능: 예) 바이트댄스(ByteDance)

【기사 구조 (필수)】
1. **도입부** (2~3문장): 무슨 일인지 핵심을 즉시 전달. "누가, 무엇을, 왜"
2. **## 주요 내용** (3~4문단): 구체적 사실, 숫자, 인용을 포함한 상세 내용
3. **## 배경** (1~2문단): 이 이슈가 왜 중요한지, 맥락 설명  
4. **## 향후 전망** (1~2문단): 앞으로 어떻게 될지

【문체 규칙】
• 보도체: "~것으로 전해졌다", "~라고 밝혔다", "~한 것으로 나타났다"
• 문장당 20~40자, 최대 50자
• 사실 기반 서술. 추측은 "~것으로 보인다", "~전망이다"로 표현
• 금지: 블로그체(~인데요), 낚시제목(충격, 경악), 동어반복

【분량】
• 전체 800~1500자 (공백 포함)
• 소제목 2~3개

【출력 형식】
TITLE: (한국어 제목 25~40자, 핵심 키워드 앞쪽 배치)
SUMMARY: (한국어 요약 60~100자)
TAGS: (태그 3~5개, 쉼표 구분)
CONTENT:
(마크다운 본문)`;
}

// ========== 사용자 프롬프트 ==========
function getUserPrompt(keyword, newsContext) {
  const dateTime = getKoreanDateTime();

  return `현재 시각: ${dateTime}
실시간 트렌딩 키워드: "${keyword}"

아래는 이 키워드 관련 취재 자료입니다. 이 자료를 바탕으로 기사를 작성하세요.
자료에 영어가 있으면 반드시 한국어로 번역하여 작성하세요.

━━━ 취재 자료 ━━━
${newsContext || '(관련 뉴스 자료 없음. 키워드와 일반 상식을 바탕으로 작성하세요.)'}
━━━━━━━━━━━━━━

위 자료를 종합하여 독자가 한눈에 상황을 파악할 수 있는 뉴스 기사를 작성하세요.

⚠️ 중요:
- 반드시 한국어로만 작성 (영어 문장 금지)
- 취재 자료의 제목/내용을 그대로 복사하지 말 것 (재구성)
- 도입부에서 "무슨 일인지"를 바로 설명할 것
- 출처명(Vietnam.vn, kmjournal 등)을 본문에 넣지 말 것

형식:
TITLE: (제목)
SUMMARY: (요약)
TAGS: (태그)
CONTENT:
(본문)`;
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
    const errorDetail = {
      message: error.message,
      status: error.status || error.statusCode || 'N/A',
      code: error.code || 'N/A',
      type: error.type || error.constructor?.name || 'N/A',
      provider: config.ai.provider || 'deepseek',
      model: getModel(),
    };
    logger.error(`[AI] 기사 생성 실패 [${keyword}]: ${JSON.stringify(errorDetail)}`);
    
    // API 연결 자체가 되는지 확인용 로그
    if (error.status === 401 || error.status === 403) {
      logger.error(`[AI] ⚠️ API 인증 실패! API_KEY 확인 필요. Provider: ${errorDetail.provider}`);
    } else if (error.status === 429) {
      logger.error(`[AI] ⚠️ API 요청 한도 초과 (Rate Limit). 잠시 후 재시도됩니다.`);
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      logger.error(`[AI] ⚠️ API 서버 연결 불가. BaseURL: ${config.ai.baseUrl || 'default'}`);
    }

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

// ========== 폴백: API 없이 수집 데이터로 고품질 기사 구성 ==========
function generateFallbackArticle(keyword, newsData) {
  keyword = cleanKeyword(keyword);
  logger.info(`[AI] "${keyword}" 폴백 기사 생성 중...`);

  const now = new Date();
  const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  const articles = newsData?.articles || [];
  const articlesWithContent = (newsData?.topArticlesWithContent || []).filter(a => a.fullContent && a.fullContent.length > 50);
  const hasContent = articlesWithContent.length > 0;
  const hasArticles = articles.length > 0;

  // ===== 제목: 뉴스 제목에서 핵심 추출 =====
  let title;
  if (hasArticles) {
    // 첫 번째 가장 유익한 기사 제목 기반
    const bestTitle = articles[0].title;
    // 제목이 충분히 좋으면 그대로, 아니면 키워드 기반
    if (bestTitle.length > 10 && bestTitle.includes(keyword.split(' ')[0])) {
      title = bestTitle.length > 45 ? bestTitle.substring(0, 42) + '...' : bestTitle;
    } else {
      title = `${keyword}, 주요 쟁점과 핵심 내용 정리`;
    }
  } else {
    title = `${keyword}, 실시간 검색어 등극…무슨 일?`;
  }

  // ===== 요약 =====
  let summary;
  if (hasArticles && articles[0].description) {
    // 첫 기사 description에서 요약 생성
    const desc = articles[0].description.substring(0, 90);
    const lastPeriod = desc.lastIndexOf('.');
    summary = lastPeriod > 30 ? desc.substring(0, lastPeriod + 1) : `${keyword} 관련 핵심 내용과 배경을 정리했다.`;
  } else {
    summary = `${keyword}이(가) 실시간 검색어에 오르며 관심이 집중되고 있다. 핵심 내용을 정리했다.`;
  }

  // ===== 뉴스 제목에서 핵심 팩트 추출 =====
  function extractKeyFacts(articles) {
    const facts = [];
    const seenFacts = new Set();

    for (const article of articles) {
      let fact = article.title;
      // 출처 제거 (이미 분리됨)
      fact = fact.replace(/\s*-\s*[^-]+$/, '').trim();
      // 기호 정리
      fact = fact.replace(/[""'']/g, "'").replace(/…/g, '...').trim();

      // 중복 방지
      const key = fact.replace(/\s/g, '').substring(0, 20);
      if (!seenFacts.has(key) && fact.length > 5) {
        seenFacts.add(key);
        facts.push({
          text: fact,
          source: article.sourceName || (article.source === 'naver_news' ? '네이버' : article.source === 'naver_search' ? '네이버' : '언론 보도'),
          description: article.description || '',
        });
      }
    }
    return facts;
  }

  const keyFacts = extractKeyFacts(articles);

  // ===== 본문 구성 =====
  let content = '';

  // 1. 핵심 요약 (리드)
  if (keyFacts.length > 0) {
    const mainFact = keyFacts[0];
    content += `${dateStr} "${keyword}" 관련 소식이 전해지며 실시간 검색어에 올랐다. `;
    if (mainFact.description && mainFact.description.length > 20) {
      // description에서 첫 문장 추출
      const firstSentence = mainFact.description.split(/[.!?]/)[0];
      if (firstSentence.length > 15) {
        content += `${firstSentence.trim()}.\n\n`;
      } else {
        content += `${mainFact.text}으로 알려졌다.\n\n`;
      }
    } else {
      content += `${mainFact.text}에 관심이 집중되고 있다.\n\n`;
    }
  } else {
    content += `${dateStr}, "${keyword}"이(가) 실시간 검색어에 오르며 주목받고 있다.\n\n`;
  }

  // 2. 핵심 포인트 (불릿)
  if (keyFacts.length >= 2) {
    content += `## 핵심 포인트\n\n`;
    keyFacts.slice(0, 5).forEach(fact => {
      content += `• **${fact.text}**`;
      if (fact.description && fact.description.length > 15) {
        const shortDesc = fact.description.substring(0, 80);
        const lastPeriod = shortDesc.lastIndexOf('.');
        const cleanDesc = lastPeriod > 20 ? shortDesc.substring(0, lastPeriod + 1) : shortDesc;
        content += ` — ${cleanDesc}`;
      }
      content += `\n\n`;
    });
  }

  // 3. 상세 내용 (크롤링된 본문 활용)
  if (hasContent) {
    content += `## 상세 내용\n\n`;
    articlesWithContent.slice(0, 2).forEach(article => {
      const body = article.fullContent;
      // 핵심 단락 추출 (처음 600자, 마지막 완전 문장까지)
      let excerpt = body.substring(0, 600);
      const lastPeriod = excerpt.lastIndexOf('다.');
      if (lastPeriod > 100) {
        excerpt = excerpt.substring(0, lastPeriod + 2);
      }
      content += `${excerpt}\n\n`;
    });
  } else if (keyFacts.length > 0) {
    // 본문 없으면 description 모아서 배경 작성
    content += `## 배경\n\n`;
    const descs = keyFacts
      .filter(f => f.description && f.description.length > 30)
      .slice(0, 3);
    if (descs.length > 0) {
      descs.forEach(f => {
        let desc = f.description.substring(0, 150);
        const lastPeriod = desc.lastIndexOf('.');
        if (lastPeriod > 30) desc = desc.substring(0, lastPeriod + 1);
        content += `${desc} (${f.source})\n\n`;
      });
    } else {
      content += `"${keyword}" 관련 이슈가 다수 언론에서 보도되며 대중의 관심이 집중되고 있다. `;
      content += `관련 검색량이 급증했으며, 각 매체가 후속 보도를 내놓고 있는 상황이다.\n\n`;
    }
  }

  // 4. 전망
  content += `## 전망\n\n`;
  content += `"${keyword}" 관련 추가 보도가 이어질 전망이다. `;
  content += `계속 업데이트될 예정이므로 관련 동향에 주목할 필요가 있다.`;

  const slug = generateSlug(title);
  const sourceUrls = articles.map(a => a.link).filter(Boolean).filter(u => !u.includes('news.google.com/rss'));
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
