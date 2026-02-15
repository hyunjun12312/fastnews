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

  // DeepSeek provider인데 잘못된 모델명 자동 교정
  if (provider === 'deepseek') {
    // gpt-* 등 OpenAI 모델명이거나, 'deepseek'만 적은 경우 교정
    if (!configModel || configModel === 'deepseek' || configModel.startsWith('gpt-') || configModel.startsWith('o1') || configModel.startsWith('o3')) {
      if (configModel && configModel !== providerDefault) {
        logger.warn(`[AI] ⚠️ 잘못된 모델명(${configModel}) → "${providerDefault}"로 자동 교정`);
      }
      return providerDefault;
    }
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
  return `당신은 대한민국 주요 언론사 출신 10년 경력 수석 편집기자입니다.
실시간 검색어를 클릭한 독자에게 "종합적이고 심층적인 정보"를 전달하는 고품질 뉴스 기사를 작성합니다.

━━━ 최우선 원칙: 고품질 콘텐츠 ━━━

【E-E-A-T (전문성·경험·권위·신뢰)】
• 단순 사실 나열이 아닌, "왜 이것이 중요한지" 분석과 맥락을 제공
• 구체적 수치(날짜, 금액, 퍼센트, 인원수 등)를 반드시 포함
• 관련 전문가/기관의 입장이나 발언을 인용 (취재 자료에 있으면 활용)
• 비교 분석: 이전 사례, 유사 사건, 과거 데이터와 비교하여 의미 도출
• 독자가 "이 기사 하나로 충분하다"고 느낄 수 있는 완결성

【반드시 한국어로만 작성】
• 영어 제목, 영어 문장은 절대 그대로 포함하지 마세요
• 외국 뉴스라도 반드시 한국어로 번역/의역하여 작성
• 고유명사(인명, 기관명)만 영어 병기 가능: 예) 바이트댄스(ByteDance)

【기사 구조 (필수 — 각 섹션 충실히)】
1. **도입부** (3~4문장): 6하원칙(누가·무엇을·언제·어디서·왜·어떻게)으로 핵심 전달. 첫 문장에 키워드 포함.
2. **## 주요 내용** (4~6문단): 취재 자료의 구체적 사실·숫자·인용을 빠짐없이 활용. 단순 나열 금지, 문단별로 하나의 논점을 깊이 있게 서술.
3. **## 배경** (2~3문단): 이 이슈의 역사적·사회적 맥락. 과거 유사 사례나 관련 통계 포함.
4. **## 향후 전망** (2~3문단): 전문가 전망, 예상되는 파급 효과, 독자가 주의해야 할 점.

【문체 규칙】
• 보도체: "~것으로 전해졌다", "~라고 밝혔다", "~한 것으로 나타났다"
• 문장당 20~40자. 긴 문장은 두 문장으로 분리
• 사실 기반 서술. 추측은 "~것으로 보인다", "~전망이다"로 표현
• 금지: 블로그체(~인데요, ~거든요, ~알아보겠습니다), 낚시 표현(충격, 경악, 소름, 역대급), 동어반복, "~에 대해 살펴보겠습니다"
• 각 문단 시작을 다양하게 (같은 주어로 연속 시작 금지)

【차별화 포인트】
• 다른 기사에서 볼 수 없는 "분석적 시각"을 최소 1개 포함
• 숫자가 있으면 맥락을 추가: "매출 100억원(전년 대비 30% 증가)"
• 원인→결과→영향의 논리적 흐름으로 구성
• 독자 실생활과 연결: "소비자/시민/투자자에게 미치는 영향"

【분량】
• 전체 1200~2000자 (공백 포함) — 충분히 깊이 있게
• 소제목 3개 (주요 내용, 배경, 향후 전망)

【SEO 최적화 제목】
• 키워드를 제목 앞쪽에 자연스럽게 배치
• "누가 무엇했다" 형태의 구체적 제목 (모호한 "~관련 이슈" 금지)
• 25~45자, 검색 의도에 정확히 부합

【출력 형식】
TITLE: (한국어 제목)
SUMMARY: (한국어 요약 80~120자, 기사의 핵심 팩트 포함)
TAGS: (태그 4~6개, 쉼표 구분)
CONTENT:
(마크다운 본문)`;
}

// ========== 사용자 프롬프트 ==========
function getUserPrompt(keyword, newsContext) {
  const dateTime = getKoreanDateTime();

  return `현재 시각: ${dateTime}
실시간 트렌딩 키워드: "${keyword}"

아래는 이 키워드 관련 취재 자료입니다. 모든 자료를 꼼꼼히 읽고, 핵심 팩트를 빠짐없이 반영하세요.
자료에 영어가 있으면 반드시 한국어로 번역하여 작성하세요.

━━━ 취재 자료 ━━━
${newsContext || '(관련 뉴스 자료 없음. 키워드와 일반 상식을 바탕으로 작성하세요.)'}
━━━━━━━━━━━━━━

위 자료를 종합하여 **심층 분석 기사**를 작성하세요.

⚠️ 필수 체크리스트:
1. 취재 자료의 구체적 수치·날짜·인명을 기사에 반영했는가?
2. 단순 나열이 아닌 원인→결과→영향 흐름으로 서술했는가?
3. "배경" 섹션에서 과거 맥락이나 비교 분석을 했는가?
4. "향후 전망"에서 실질적 전망과 독자 영향을 서술했는가?
5. 1200자 이상 작성했는가?
6. 모든 내용이 한국어인가?

⚠️ 금지사항:
- 취재 자료의 문장을 그대로 복사 (반드시 재구성)
- 출처명(Vietnam.vn, kmjournal 등) 본문 삽입
- "~에 대해 알아보겠습니다" 등 블로그 표현
- 동일한 내용 반복 서술

형식:
TITLE: (제목 — 키워드를 앞에 배치, 구체적)
SUMMARY: (80~120자 요약 — 핵심 팩트 포함)
TAGS: (태그 4~6개)
CONTENT:
(본문 — 1200자 이상, 소제목 3개)`;
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

// ========== 기사 품질 검증 (강화) ==========
function validateArticleQuality(content, title, summary) {
  const issues = [];
  let score = 100;

  // === 1. 기본 길이 검사 ===
  if (content.length < 600) {
    issues.push(`본문 너무 짧음 (${content.length}자, 최소 600자)`);
    score -= 30;
  } else if (content.length < 1000) {
    issues.push(`본문 부족 (${content.length}자, 권장 1200자 이상)`);
    score -= 15;
  }

  // === 2. 구조 검사 ===
  const headingCount = (content.match(/^##\s/gm) || []).length;
  if (headingCount < 2) {
    issues.push(`소제목 부족 (${headingCount}개, 최소 3개 필수)`);
    score -= 20;
  }

  // 필수 섹션 체크
  const hasMainContent = /##\s*(주요\s*내용|핵심|상세)/m.test(content);
  const hasBackground = /##\s*(배경|맥락|경위)/m.test(content);
  const hasOutlook = /##\s*(향후\s*전망|전망|앞으로|시사점)/m.test(content);
  
  if (!hasMainContent) { issues.push('\"주요 내용\" 섹션 누락'); score -= 10; }
  if (!hasBackground) { issues.push('\"배경\" 섹션 누락'); score -= 10; }
  if (!hasOutlook) { issues.push('\"향후 전망\" 섹션 누락'); score -= 10; }

  // 문단 수 검사
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 30 && !p.trim().startsWith('#'));
  if (paragraphs.length < 4) {
    issues.push(`문단 부족 (${paragraphs.length}개, 최소 5개 권장)`);
    score -= 10;
  }

  // === 3. 콘텐츠 깊이 검사 ===
  // 구체적 숫자/데이터 포함 여부
  const numberPattern = /\d+[%만억원조개명건호]/g;
  const numberCount = (content.match(numberPattern) || []).length;
  if (numberCount < 2) {
    issues.push(`구체적 수치 부족 (${numberCount}개, 최소 2개 권장)`);
    score -= 10;
  }

  // 인용/발언 포함 여부
  const quotePatterns = /["""](.*?)["""]|~라고\s+(밝혔|말했|전했|설명했|강조했)|~라며|~입장을\s*밝혔/g;
  const quoteCount = (content.match(quotePatterns) || []).length;
  if (quoteCount === 0) {
    score -= 5; // 인용 없으면 소폭 감점
  }

  // === 4. 문체 검사 ===
  const blogPatterns = [
    /인데요/g, /거든요/g, /했어요/g, /알아보겠/g, /살펴보겠/g,
    /알아볼까요/g, /하셨나요/g, /드리겠/g, /해볼게요/g, /할게요/g,
    /살펴보도록/g, /알아보도록/g,
  ];
  const blogHits = blogPatterns.reduce((sum, p) => sum + (content.match(p) || []).length, 0);
  if (blogHits > 0) {
    issues.push(`비보도체 표현 ${blogHits}건 감지`);
    score -= blogHits * 5;
  }

  // 낚시성 표현 감지
  const clickbaitPatterns = /충격|경악|소름|대박|역대급|ㅋ|ㅎ|ㅠ|!!!/g;
  const clickbaitHits = (content.match(clickbaitPatterns) || []).length;
  if (clickbaitHits > 0) {
    issues.push(`낚시성 표현 ${clickbaitHits}건 감지`);
    score -= clickbaitHits * 5;
  }

  // === 5. 중복 문장 검사 ===
  const sentences = content.split(/[.다]\s/).filter(s => s.length > 15);
  const sentenceSet = new Set();
  let dupeCount = 0;
  for (const s of sentences) {
    const normalized = s.replace(/\s+/g, '').substring(0, 30);
    if (sentenceSet.has(normalized)) dupeCount++;
    sentenceSet.add(normalized);
  }
  if (dupeCount > 1) {
    issues.push(`중복 문장 ${dupeCount}건`);
    score -= dupeCount * 10;
  }

  // === 6. 영어 비율 검사 ===
  const englishRatio = (content.match(/[a-zA-Z]/g) || []).length / Math.max(content.length, 1);
  if (englishRatio > 0.15) {
    issues.push(`영어 비율 과다 (${(englishRatio * 100).toFixed(1)}%)`);
    score -= 15;
  }

  // === 7. 제목/요약 품질 ===
  if (title) {
    if (title.length < 15) { issues.push('제목 너무 짧음'); score -= 5; }
    if (/관련\s*(최신\s*)?동향|이슈\s*총정리|실시간\s*트렌드/i.test(title)) {
      issues.push('제목이 뻔함 (구체적 제목 필요)');
      score -= 10;
    }
  }
  if (summary && summary.length < 40) {
    issues.push('요약 너무 짧음');
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));

  return {
    passed: score >= 60,
    issues,
    score,
    grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D',
  };
}

// ========== 기사 후처리 (품질 강화) ==========
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
    [/살펴보겠습니다[.!]?/g, '살펴본다.'],
    [/알아보겠습니다[.!]?/g, '알아본다.'],
  ];

  replacements.forEach(([pattern, replacement]) => {
    processed = processed.replace(pattern, replacement);
  });

  // "이 기사는 AI가..." 등 자기 언급 제거
  processed = processed.replace(/\n.*이 (기사|글|콘텐츠)는.*(AI|인공지능|자동).*생성.*\n?/g, '\n');

  // 출처 URL/사이트명 제거 (본문에 노출되면 안됨)
  processed = processed.replace(/\([a-zA-Z0-9]+\.(com|net|org|kr|vn|co\.kr)\)/g, '');
  processed = processed.replace(/\(출처:?\s*[^)]+\)/g, '');

  // 잘린 영어 문장 제거 (예: "Seedance 2." 같은 것)
  processed = processed.replace(/[A-Za-z]{2,}[^가-힣\n]{0,5}\.\s*$/gm, '');

  // "~에 대해 살펴보겠습니다" 류의 블로그 마무리 제거
  processed = processed.replace(/지금부터\s*(자세히|하나씩|본격적으로)\s*(살펴|알아|분석).*\n?/g, '');
  processed = processed.replace(/이번\s*(기사|글)에서는.*살펴.*\n?/g, '');
  
  // 동어반복 축약 (같은 문장이 비슷하게 반복되는 경우)
  const lines = processed.split('\n');
  const deduped = [];
  const seenPhrases = new Set();
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, '').substring(0, 40);
    if (normalized.length > 20 && seenPhrases.has(normalized)) continue;
    if (normalized.length > 20) seenPhrases.add(normalized);
    deduped.push(line);
  }
  processed = deduped.join('\n');

  // 불필요한 빈 줄 정리
  processed = processed.replace(/\n{4,}/g, '\n\n\n');

  // 마크다운 제목에 불필요한 볼드 제거
  processed = processed.replace(/^(#{1,3})\s*\*\*(.+?)\*\*/gm, '$1 $2');

  // 빈 불릿 항목 제거
  processed = processed.replace(/^[•\-\*]\s*\*?\*?\s*\*?\*?\s*$/gm, '');

  // 선두 빈줄 제거
  processed = processed.replace(/^\n+/, '');

  return processed.trim();
}

// ========== 제목 개선 (뻔한 제목 감지 시) ==========
async function improveTitle(aiClient, keyword, content, currentTitle) {
  try {
    const response = await aiClient.chat.completions.create({
      model: getModel(),
      messages: [
        { role: 'system', content: '뉴스 편집자입니다. 구체적이고 클릭하고 싶은 한국어 뉴스 제목 1개만 출력하세요. 25~45자. 키워드를 앞쪽에 배치하세요. 설명 없이 제목만 출력.' },
        { role: 'user', content: `키워드: "${keyword}"\n기사 본문 요약:\n${content.substring(0, 500)}\n\n현재 제목(너무 뻔함): "${currentTitle}"\n\n더 구체적이고 흥미로운 제목을 1개만 출력:` },
      ],
      temperature: 0.5,
      max_tokens: 100,
    });
    const newTitle = (response.choices[0]?.message?.content || '').trim().replace(/^["'#]+|["']+$/g, '');
    if (newTitle.length >= 15 && newTitle.length <= 50) {
      logger.info(`[AI] 제목 개선: "${currentTitle}" → "${newTitle}"`);
      return newTitle;
    }
  } catch (e) {
    logger.debug(`[AI] 제목 개선 실패: ${e.message}`);
  }
  return currentTitle;
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
    logger.info(`[AI] "${keyword}" 고품질 기사 생성 시작...`);

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
      temperature: 0.35, // 팩트 중심, 살짝 더 보수적
      max_tokens: 4096,
      top_p: 0.85,
      frequency_penalty: 0.4,  // 동어반복 강하게 억제
      presence_penalty: 0.3,   // 새로운 주제/표현 유도
    });

    const rawOutput = response.choices[0]?.message?.content || '';
    logger.debug(`[AI] 원본 출력 길이: ${rawOutput.length}자`);

    // 파싱
    let { title, summary, tags, content: parsedContent } = parseArticleOutput(rawOutput, keyword);

    // 후처리
    let content = postProcessContent(parsedContent);

    // 1차 품질 검증
    let quality = validateArticleQuality(content, title, summary);
    logger.info(`[AI] 1차 품질: ${quality.grade} (${quality.score}점) ${quality.issues.length > 0 ? '이슈: ' + quality.issues.join(', ') : ''}`);

    // 품질 미달(D등급) + 본문 짧을 때 보강 시도
    if (quality.score < 60 && content.length < 800) {
      logger.info(`[AI] 품질 미달 → 기사 보강 시도 중...`);
      const enhanced = await enhanceArticle(aiClient, keyword, content, newsContext);
      if (enhanced && enhanced.length > content.length) {
        content = postProcessContent(enhanced);
        quality = validateArticleQuality(content, title, summary);
        logger.info(`[AI] 보강 후 품질: ${quality.grade} (${quality.score}점)`);
      }
    }

    // 제목이 뻔하면 개선 시도
    if (/관련\s*(최신\s*)?동향|이슈\s*총정리|실시간\s*트렌드/i.test(title)) {
      title = await improveTitle(aiClient, keyword, content, title);
    }

    const slug = generateSlug(title);
    const sourceUrls = (newsData?.articles?.map(a => a.link).filter(Boolean) || []).filter(u => !u.includes('news.google.com/rss'));
    const image = newsData?.representativeImage || '';

    logger.info(`[AI] "${keyword}" 기사 생성 완료: "${title}" (${content.length}자, 품질: ${quality.grade}/${quality.score}점, 이미지: ${image ? 'O' : 'X'})`);

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

// ========== 기사 보강 (2차 호출 — 품질 미달 시) ==========
async function enhanceArticle(aiClient, keyword, shortContent, newsContext) {
  try {
    const response = await aiClient.chat.completions.create({
      model: getModel(),
      messages: [
        {
          role: 'system',
          content: `당신은 경력 10년차 뉴스 편집자입니다. 아래 기사 초안을 전면 보강해야 합니다.

보강 방향:
1. 분량을 1500자 이상으로 확대
2. "## 주요 내용" (4~6문단), "## 배경" (2문단), "## 향후 전망" (2문단) 구조 충실
3. 구체적 수치, 날짜, 인명 등 팩트를 취재 자료에서 최대한 반영
4. 원인→결과→파급효과 흐름으로 논리적 서술
5. 보도체 유지 ("~것으로 전해졌다", "~것으로 나타났다")
6. 반드시 한국어로만 작성

결과는 마크다운 본문만 출력하세요. TITLE/SUMMARY/TAGS 없이 본문만.`,
        },
        {
          role: 'user',
          content: `키워드: "${keyword}"\n\n참고 뉴스 자료:\n${newsContext}\n\n기사 초안 (보강 필요):\n${shortContent}\n\n위 초안을 1500자 이상, 3개 소제목을 갖춘 완성된 뉴스 기사로 보강해주세요.`,
        },
      ],
      temperature: 0.35,
      max_tokens: 4096,
      frequency_penalty: 0.4,
      presence_penalty: 0.3,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    logger.error(`[AI] 기사 보강 실패: ${error.message}`);
    return null;
  }
}

// ========== 뉴스 기사 관련성 체크 ==========
function isArticleRelevant(article, keyword) {
  if (!article || !keyword) return false;
  const kw = keyword.toLowerCase().trim();
  const title = (article.title || '').toLowerCase();
  const desc = (article.description || '').toLowerCase();
  const content = (article.fullContent || '').toLowerCase();
  
  // 키워드가 제목/설명/본문에 포함되면 관련
  if (title.includes(kw) || desc.includes(kw) || content.includes(kw)) return true;
  
  // 키워드가 2단어 이상이면 각 단어로 분리해서 체크 (2개 이상 포함시 관련)
  const kwParts = kw.split(/\s+/).filter(p => p.length >= 2);
  if (kwParts.length >= 2) {
    const matchCount = kwParts.filter(part => title.includes(part) || desc.includes(part)).length;
    if (matchCount >= Math.ceil(kwParts.length * 0.5)) return true;
  }
  
  // 키워드의 한글 음절 2글자 이상이 제목에 포함되면 관련 (부분 매칭)
  const koreanChars = kw.match(/[가-힣]{2,}/g) || [];
  for (const chunk of koreanChars) {
    if (chunk.length >= 2 && (title.includes(chunk) || desc.includes(chunk))) return true;
  }
  
  return false;
}

// ========== 폴백: API 없이 수집 데이터로 기사 구성 ==========
function generateFallbackArticle(keyword, newsData) {
  keyword = cleanKeyword(keyword);
  logger.info(`[AI] "${keyword}" 폴백 기사 생성 중...`);

  const now = new Date();
  const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  const articles = newsData?.articles || [];
  const articlesWithContent = (newsData?.topArticlesWithContent || []).filter(a => a.fullContent && a.fullContent.length > 50);

  // ===== 관련성 필터링: 키워드와 관련 있는 기사만 사용 =====
  const relevantArticles = articles.filter(a => isArticleRelevant(a, keyword));
  const relevantWithContent = articlesWithContent.filter(a => isArticleRelevant(a, keyword));
  
  logger.info(`[폴백] "${keyword}" 기사 필터: 전체 ${articles.length}개 → 관련 ${relevantArticles.length}개, 본문 ${articlesWithContent.length}개 → 관련 ${relevantWithContent.length}개`);

  // ===== 한국어 기사 필터링 =====
  const koreanArticles = relevantArticles.filter(a => {
    const title = a.title || '';
    const koreanChars = (title.match(/[가-힣]/g) || []).length;
    return koreanChars > title.length * 0.15;
  });
  const useArticles = koreanArticles.length >= 2 ? koreanArticles : relevantArticles;

  // ===== 중복 제거된 팩트 추출 =====
  const facts = [];
  const seenKeys = new Set();
  for (const article of useArticles) {
    let title = cleanNewsText(article.title);
    if (!title || title.length < 5) continue;

    const key = title.replace(/[^가-힣a-zA-Z]/g, '').substring(0, 15);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    let desc = cleanNewsText(article.description || '');
    // description이 title과 거의 같으면 제거
    if (desc && desc.substring(0, 20) === title.substring(0, 20)) desc = '';
    
    facts.push({ title, desc });
  }

  // ===== 본문 있는 기사에서 핵심 단락 추출 =====
  const bodyExcerpts = [];
  for (const article of relevantWithContent) {
    let body = cleanNewsText(article.fullContent);
    // 한국어 비율 체크
    const koreanRatio = (body.match(/[가-힣]/g) || []).length / Math.max(body.length, 1);
    if (koreanRatio < 0.2) continue;
    
    // 첫 500자에서 의미있는 문장 추출
    const sentences = body.substring(0, 800).split(/(?<=다\.)\s|(?<=했다\.)\s|(?<=있다\.)\s|(?<=됐다\.)\s/);
    const goodSentences = sentences
      .filter(s => s.length > 15 && s.length < 200)
      .filter(s => !s.includes('기자') && !s.includes('저작권') && !s.includes('무단'))
      .slice(0, 4);
    
    if (goodSentences.length > 0) {
      bodyExcerpts.push(goodSentences.join(' '));
    }
  }

  // ===== 제목 생성 =====
  let title;
  if (facts.length > 0) {
    const bestFact = facts[0].title;
    // 한국어 제목이 좋으면 활용, 아니면 키워드 기반
    const isKoreanTitle = (bestFact.match(/[가-힣]/g) || []).length > bestFact.length * 0.3;
    if (isKoreanTitle && bestFact.length >= 10 && bestFact.length <= 50) {
      title = bestFact;
    } else {
      title = `'${keyword}' 실시간 검색어 급상승, 무슨 일?`;
    }
  } else {
    title = `'${keyword}' 실시간 검색어 급상승, 무슨 일?`;
  }
  if (title.length > 50) title = title.substring(0, 47) + '...';

  // ===== 요약 생성 =====
  let summary = '';
  if (facts.length > 0 && facts[0].desc && facts[0].desc.length > 20) {
    const desc = facts[0].desc;
    const endIdx = desc.indexOf('다.', 20);
    summary = endIdx > 0 ? desc.substring(0, endIdx + 2) : desc.substring(0, 90);
  }
  if (!summary || summary.length < 20) {
    summary = `'${keyword}'이(가) 포털 실시간 검색어에 급상승하며 화제가 되고 있다.`;
  }
  // 요약에서 영어만 있는 경우 대체
  if ((summary.match(/[가-힣]/g) || []).length < 5) {
    summary = `'${keyword}'이(가) 포털 실시간 검색어에 급상승하며 화제가 되고 있다.`;
  }

  // ===== 본문 구성 =====
  let content = '';

  // 관련 데이터가 아예 없는 경우 → 깔끔한 키워드 중심 기사
  if (facts.length === 0 && bodyExcerpts.length === 0) {
    content += `${dateStr}, '${keyword}'이(가) 주요 포털 실시간 검색어에 오르며 네티즌들의 관심이 집중되고 있다.\n\n`;
    content += `## 주요 내용\n\n`;
    content += `'${keyword}'에 대한 관심이 급격히 높아지면서 관련 검색량이 폭증하고 있는 것으로 나타났다. `;
    content += `해당 키워드는 포털 사이트 실시간 검색어 상위권에 올라 화제를 모으고 있다.\n\n`;
    content += `현재 온라인 커뮤니티와 SNS를 중심으로 '${keyword}' 관련 게시물이 빠르게 확산되고 있으며, `;
    content += `이에 따른 후속 보도도 잇따르고 있는 상황이다.\n\n`;
    content += `## 배경\n\n`;
    content += `'${keyword}'이(가) 실시간 검색어에 오른 정확한 배경에 대해서는 추가 취재가 필요한 상황이다. `;
    content += `다만 관련 키워드의 검색량이 급증한 점으로 미루어 사회적 관심이 높은 이슈인 것으로 보인다.\n\n`;
    content += `## 향후 전망\n\n`;
    content += `'${keyword}' 관련 후속 보도와 추가 정보가 이어질 것으로 보인다. `;
    content += `업계와 대중의 관심이 지속되는 만큼 향후 전개 상황이 주목된다.`;
  } else {
    // 1. 도입부
  if (bodyExcerpts.length > 0) {
    // 크롤링된 본문에서 도입부 구성
    const intro = bodyExcerpts[0].substring(0, 200);
    const lastEnd = Math.max(intro.lastIndexOf('다.'), intro.lastIndexOf('했다.'), intro.lastIndexOf('있다.'));
    content += lastEnd > 50 ? intro.substring(0, lastEnd + 2) : intro;
    content += '\n\n';
  } else if (facts.length > 0) {
    content += `${dateStr}, "${keyword}" 관련 뉴스가 잇따라 보도되며 실시간 검색어에 올랐다. `;
    if (facts[0].desc && facts[0].desc.length > 20) {
      const firstDesc = facts[0].desc;
      const endIdx = firstDesc.indexOf('다.', 15);
      content += endIdx > 0 ? firstDesc.substring(0, endIdx + 2) : `${facts[0].title}에 관심이 집중되고 있다.`;
    } else {
      content += `${facts[0].title}에 대한 관심이 집중되고 있다.`;
    }
    content += '\n\n';
  } else {
    content += `${dateStr}, "${keyword}"이(가) 실시간 검색어에 오르며 대중의 관심이 집중되고 있다.\n\n`;
  }

  // 2. 주요 내용
  content += `## 주요 내용\n\n`;

  if (bodyExcerpts.length > 0) {
    // 크롤링 본문으로 주요 내용 서술
    bodyExcerpts.slice(0, 2).forEach(excerpt => {
      const trimmed = excerpt.substring(0, 400);
      const lastEnd = trimmed.lastIndexOf('다.');
      content += (lastEnd > 100 ? trimmed.substring(0, lastEnd + 2) : trimmed) + '\n\n';
    });
  } else if (facts.length >= 2) {
    // 팩트 기반 요약 서술 (불릿이 아닌 문단 형태)
    const factSentences = facts.slice(0, 4).map(f => {
      if (f.desc && f.desc.length > 20) {
        const desc = f.desc;
        const endIdx = desc.indexOf('다.', 15);
        return endIdx > 0 ? desc.substring(0, endIdx + 2) : f.title + '(으)로 전해졌다.';
      }
      return f.title + '(으)로 전해졌다.';
    });
    
    // 2개씩 묶어서 문단 구성
    for (let i = 0; i < factSentences.length; i += 2) {
      const para = factSentences.slice(i, i + 2).join(' ');
      content += para + '\n\n';
    }
  } else {
    content += `"${keyword}" 관련 다수의 보도가 이어지고 있다. 관련 검색량이 급증하며 주요 포털 실시간 검색어에 올랐다.\n\n`;
  }

  // 3. 배경/맥락
  if (facts.length > 2 || bodyExcerpts.length > 1) {
    content += `## 배경\n\n`;
    
    if (bodyExcerpts.length > 1) {
      const bgExcerpt = bodyExcerpts[bodyExcerpts.length - 1].substring(0, 300);
      const lastEnd = bgExcerpt.lastIndexOf('다.');
      content += (lastEnd > 50 ? bgExcerpt.substring(0, lastEnd + 2) : bgExcerpt) + '\n\n';
    } else {
      // 남은 팩트로 배경 구성
      const bgFacts = facts.slice(2, 5);
      if (bgFacts.length > 0) {
        const bgText = bgFacts.map(f => f.title).join(', ');
        content += `이 밖에도 ${bgText} 등 관련 보도가 잇따르고 있다.\n\n`;
      }
    }
  }

  // 4. 향후 전망
  content += `## 향후 전망\n\n`;
  content += `"${keyword}" 관련 후속 보도와 추가 정보가 이어질 것으로 보인다. `;
  content += `업계와 대중의 관심이 지속되는 만큼 향후 전개 상황이 주목된다.`;
  } // end of else (has relevant facts)

  // 최종 정제
  content = content
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\(\s*\)/g, '')        // 빈 괄호 제거  
    .replace(/\(undefined\)/g, '')  // undefined 제거
    .trim();

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
