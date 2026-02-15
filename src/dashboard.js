// ============================================
// dashboard.js - 실시간 관리 대시보드 + API 서버
// ============================================
// 시스템 상태 모니터링, 기사 관리, 실시간 로그 확인
// Socket.IO로 실시간 업데이트 제공
// ============================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const db = require('./database');
const publisher = require('./publisher');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// XML 파일 Content-Type 명시 (검색엔진 호환성)
app.use((req, res, next) => {
  if (req.path.endsWith('.xml')) {
    res.type('application/xml; charset=utf-8');
    // 사이트맵/RSS는 자주 변경되므로 짧은 캐시
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  } else if (req.path.endsWith('.html') && req.path.startsWith('/articles/')) {
    // 기사 페이지는 한번 발행되면 잘 안 바뀜 → 1시간 캐시
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=7200');
  } else if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?)$/i.test(req.path)) {
    // 정적 에셋 → 7일 캐시
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
  // SEO 관련 HTTP 헤더
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'origin-when-cross-origin');
  next();
});

// Railway Volume 지원: DATA_DIR이 설정되면 해당 경로를 우선 서빙
const DATA_DIR = process.env.DATA_DIR || '';
if (DATA_DIR) {
  app.use(express.static(DATA_DIR));
  logger.info(`[대시보드] 영구 저장소 서빙: ${DATA_DIR}`);
}
app.use(express.static(path.join(__dirname, '..', 'public')));

// ========== 대시보드 페이지 ==========
app.get('/dashboard', (req, res) => {
  const stats = db.getStats();
  const recentKeywords = db.getRecentKeywords(24);
  const articles = db.getArticles({ limit: 50 });

  res.send(dashboardHTML(stats, recentKeywords, articles));
});

// ========== API 엔드포인트 ==========

// 통계
app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

// 최근 키워드
app.get('/api/keywords', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  res.json(db.getRecentKeywords(hours));
});

// 기사 목록
app.get('/api/articles', (req, res) => {
  const { status, limit, offset } = req.query;
  res.json(db.getArticles({
    status,
    limit: parseInt(limit) || 20,
    offset: parseInt(offset) || 0,
  }));
});

// 단일 기사
app.get('/api/articles/:id', (req, res) => {
  const article = db.getArticleById(parseInt(req.params.id));
  if (!article) return res.status(404).json({ error: 'Not found' });
  res.json(article);
});

// 기사 조회 (슬러그)
app.get('/articles/:slug', (req, res) => {
  const slug = decodeURIComponent(req.params.slug).replace('.html', '');
  const article = db.getArticleBySlug(slug);
  if (article) {
    db.incrementViews(article.id);
  }
  const filePath = path.join(publisher.ARTICLES_DIR, `${slug}.html`);
  const fs = require('fs');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>404 - 페이지를 찾을 수 없습니다</title><meta name="robots" content="noindex"></head><body style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h1>404</h1><p>요청하신 페이지를 찾을 수 없습니다.</p><a href="/" style="color:#1e3a5f;">홈으로 돌아가기</a></body></html>`);
  }
});

// ========== 아카이브(기사 목록) 페이지 - 구글 크롤링용 내부 링크 ==========
app.get('/archive', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 50;
  const offset = (page - 1) * perPage;
  const articles = db.getArticles({ status: 'published', limit: perPage + 1, offset });
  const hasNext = articles.length > perPage;
  const displayArticles = articles.slice(0, perPage);
  const siteUrl = config.site.url;
  
  const articleLinks = displayArticles.map(a => 
    `<li style="margin:8px 0;"><a href="/articles/${encodeURIComponent(a.slug)}.html" style="color:#1e3a5f;">${escapeHtml(a.title)}</a> <small style="color:#999;">${new Date(a.published_at || a.created_at).toLocaleDateString('ko-KR')}</small></li>`
  ).join('');

  const pagination = [];
  if (page > 1) pagination.push(`<a href="/archive?page=${page - 1}" style="margin:0 8px;">← 이전</a>`);
  pagination.push(`<span style="color:#555;">페이지 ${page}</span>`);
  if (hasNext) pagination.push(`<a href="/archive?page=${page + 1}" style="margin:0 8px;">다음 →</a>`);

  res.send(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>기사 아카이브 - ${config.site.title}</title>
<meta name="description" content="${config.site.title} 전체 기사 목록 - 페이지 ${page}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${siteUrl}/archive${page > 1 ? '?page=' + page : ''}">
${page > 1 ? `<link rel="prev" href="${siteUrl}/archive${page > 2 ? '?page=' + (page - 1) : ''}">` : ''}
${hasNext ? `<link rel="next" href="${siteUrl}/archive?page=${page + 1}">` : ''}
</head><body style="font-family:'Pretendard',sans-serif;max-width:800px;margin:0 auto;padding:20px;">
<h1 style="color:#1e3a5f;border-bottom:2px solid #1e3a5f;padding-bottom:10px;"><a href="/" style="color:#1e3a5f;text-decoration:none;">${escapeHtml(config.site.title)}</a> - 기사 아카이브</h1>
<ul style="list-style:none;padding:0;">${articleLinks}</ul>
<div style="text-align:center;padding:20px 0;">${pagination.join('')}</div>
<footer style="text-align:center;color:#999;font-size:0.8rem;padding:20px 0;border-top:1px solid #eee;">
<a href="/" style="color:#1e3a5f;">홈</a> | <a href="/sitemap.xml" style="color:#1e3a5f;">사이트맵</a> | <a href="/rss.xml" style="color:#1e3a5f;">RSS</a>
</footer></body></html>`);
});

// ========== Socket.IO 실시간 통신 ==========
io.on('connection', (socket) => {
  logger.debug('[대시보드] 클라이언트 연결됨');

  // 초기 데이터 전송
  socket.emit('stats', db.getStats());
  socket.emit('keywords', db.getRecentKeywords(6));
  socket.emit('articles', db.getArticles({ limit: 20 }));

  socket.on('disconnect', () => {
    logger.debug('[대시보드] 클라이언트 연결 해제');
  });
});

// 외부에서 이벤트 발행 용
function emitEvent(event, data) {
  io.emit(event, data);
}

// ========== 대시보드 HTML ==========
function dashboardHTML(stats, keywords, articles) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>관리 대시보드 | ${config.site.title}</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Pretendard', -apple-system, sans-serif; background: #0f0f23; color: #e0e0e0; }
    
    .header { 
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      padding: 1.5rem 2rem; display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid #2a2a4a;
    }
    .header h1 { color: #64b5f6; font-size: 1.3rem; }
    .header .status { display: flex; align-items: center; gap: 8px; }
    .header .dot { width: 10px; height: 10px; background: #4caf50; border-radius: 50%; animation: blink 2s infinite; }
    @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; padding: 1.5rem; }
    .stat-box { 
      background: #1a1a2e; padding: 1.5rem; border-radius: 12px;
      border: 1px solid #2a2a4a; text-align: center;
    }
    .stat-box .num { font-size: 2.5rem; font-weight: 700; color: #64b5f6; }
    .stat-box .label { font-size: 0.8rem; color: #888; margin-top: 4px; }
    
    .content { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; padding: 0 1.5rem 1.5rem; }
    @media (max-width: 900px) { .content { grid-template-columns: 1fr; } }
    
    .panel {
      background: #1a1a2e; border-radius: 12px; border: 1px solid #2a2a4a;
      overflow: hidden;
    }
    .panel-header { 
      background: #16213e; padding: 1rem 1.5rem; font-weight: 600;
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid #2a2a4a;
    }
    .panel-body { padding: 1rem; max-height: 500px; overflow-y: auto; }
    
    .keyword-list { list-style: none; }
    .keyword-item { 
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 12px; border-bottom: 1px solid #1f1f3a;
      transition: background 0.2s;
    }
    .keyword-item:hover { background: #16213e; }
    .keyword-rank { 
      color: #f39c12; font-weight: 700; min-width: 30px;
    }
    .keyword-text { flex: 1; margin: 0 10px; }
    .keyword-source { 
      font-size: 0.7rem; background: #2a2a4a; padding: 2px 8px;
      border-radius: 8px; color: #aaa;
    }
    .keyword-time { font-size: 0.7rem; color: #666; }
    
    .article-item {
      padding: 10px 12px; border-bottom: 1px solid #1f1f3a;
      transition: background 0.2s;
    }
    .article-item:hover { background: #16213e; }
    .article-title { font-size: 0.9rem; margin-bottom: 4px; }
    .article-title a { color: #64b5f6; text-decoration: none; }
    .article-meta { font-size: 0.75rem; color: #666; display: flex; gap: 10px; }
    .article-status { 
      font-size: 0.65rem; padding: 1px 6px; border-radius: 4px;
    }
    .status-published { background: #1b5e20; color: #4caf50; }
    .status-draft { background: #4a3000; color: #ff9800; }
    
    .log-panel { grid-column: 1 / -1; }
    .log-body { font-family: 'Consolas', monospace; font-size: 0.8rem; line-height: 1.6; }
    .log-entry { padding: 2px 8px; border-bottom: 1px solid #1a1a2a; }
    .log-time { color: #666; }
    .log-info { color: #4caf50; }
    .log-warn { color: #ff9800; }
    .log-error { color: #f44336; }
    
    .btn { 
      padding: 6px 16px; border: none; border-radius: 6px; cursor: pointer;
      font-size: 0.8rem; transition: all 0.2s;
    }
    .btn-primary { background: #1565c0; color: white; }
    .btn-primary:hover { background: #1976d2; }
    .btn-danger { background: #c62828; color: white; }
    .btn-danger:hover { background: #d32f2f; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 트렌드 자동 퍼블리셔 대시보드</h1>
    <div class="status">
      <div class="dot"></div>
      <span style="font-size:0.85rem;">시스템 가동 중</span>
      <span id="lastUpdate" style="font-size:0.75rem;color:#666;margin-left:10px;"></span>
    </div>
  </div>

  <div class="grid">
    <div class="stat-box">
      <div class="num" id="statKeywords">${stats.totalKeywords}</div>
      <div class="label">수집된 키워드</div>
    </div>
    <div class="stat-box">
      <div class="num" id="statArticles">${stats.totalArticles}</div>
      <div class="label">생성된 기사</div>
    </div>
    <div class="stat-box">
      <div class="num" id="statPublished">${stats.publishedArticles}</div>
      <div class="label">발행 완료</div>
    </div>
    <div class="stat-box">
      <div class="num" id="statToday">${stats.todayArticles}</div>
      <div class="label">오늘 기사</div>
    </div>
    <div class="stat-box">
      <div class="num" id="statViews">${stats.totalViews}</div>
      <div class="label">총 조회수</div>
    </div>
  </div>

  <div class="content">
    <div class="panel">
      <div class="panel-header">
        🔥 실시간 트렌딩 키워드
        <button class="btn btn-primary" onclick="forceRefresh()">새로고침</button>
      </div>
      <div class="panel-body">
        <ul class="keyword-list" id="keywordList">
          ${keywords.map((k, i) => `
            <li class="keyword-item">
              <span class="keyword-rank">${k.rank || i + 1}</span>
              <span class="keyword-text">${escapeHtml(k.keyword)}</span>
              <span class="keyword-source">${k.source}</span>
              <span class="keyword-time">${new Date(k.detected_at).toLocaleTimeString('ko-KR')}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        📝 최근 생성 기사
      </div>
      <div class="panel-body">
        <div id="articleList">
          ${articles.map(a => `
            <div class="article-item">
              <div class="article-title">
                <a href="/articles/${a.slug}.html" target="_blank">${escapeHtml(a.title)}</a>
              </div>
              <div class="article-meta">
                <span class="article-status ${a.status === 'published' ? 'status-published' : 'status-draft'}">${a.status}</span>
                <span>#${escapeHtml(a.keyword)}</span>
                <span>👁️ ${a.views}</span>
                <span>${new Date(a.created_at).toLocaleString('ko-KR')}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="panel log-panel">
      <div class="panel-header">
        📋 시스템 로그
        <button class="btn btn-danger" onclick="clearLogs()">로그 지우기</button>
      </div>
      <div class="panel-body log-body" id="logPanel">
        <div class="log-entry"><span class="log-info">[시스템]</span> 대시보드가 연결되었습니다.</div>
      </div>
    </div>
  </div>

  <script>
    const socket = io();
    
    socket.on('stats', (stats) => {
      document.getElementById('statKeywords').textContent = stats.totalKeywords;
      document.getElementById('statArticles').textContent = stats.totalArticles;
      document.getElementById('statPublished').textContent = stats.publishedArticles;
      document.getElementById('statToday').textContent = stats.todayArticles;
      document.getElementById('statViews').textContent = stats.totalViews;
    });

    socket.on('log', (msg) => {
      const panel = document.getElementById('logPanel');
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      const levelClass = msg.includes('[ERROR]') ? 'log-error' : msg.includes('[WARN]') ? 'log-warn' : 'log-info';
      entry.innerHTML = '<span class="log-time">' + new Date().toLocaleTimeString('ko-KR') + '</span> <span class="' + levelClass + '">' + msg + '</span>';
      panel.appendChild(entry);
      panel.scrollTop = panel.scrollHeight;
    });

    socket.on('newKeyword', (kw) => {
      const list = document.getElementById('keywordList');
      const li = document.createElement('li');
      li.className = 'keyword-item';
      li.style.background = '#1b3a1b';
      li.innerHTML = '<span class="keyword-rank">NEW</span><span class="keyword-text">' + kw.keyword + '</span><span class="keyword-source">' + kw.source + '</span><span class="keyword-time">방금</span>';
      list.prepend(li);
      setTimeout(() => li.style.background = '', 3000);
    });

    socket.on('newArticle', (article) => {
      const list = document.getElementById('articleList');
      const div = document.createElement('div');
      div.className = 'article-item';
      div.style.background = '#1b3a1b';
      div.innerHTML = '<div class="article-title"><a href="/articles/' + article.slug + '.html" target="_blank">' + article.title + '</a></div><div class="article-meta"><span class="article-status status-published">published</span><span>#' + article.keyword + '</span><span>방금 생성</span></div>';
      list.prepend(div);
      setTimeout(() => div.style.background = '', 3000);
    });

    function updateTime() {
      document.getElementById('lastUpdate').textContent = '마지막 업데이트: ' + new Date().toLocaleTimeString('ko-KR');
    }
    setInterval(updateTime, 1000);
    updateTime();

    function forceRefresh() {
      fetch('/api/keywords?hours=6').then(r => r.json()).then(data => {
        const list = document.getElementById('keywordList');
        list.innerHTML = data.map((k, i) => 
          '<li class="keyword-item"><span class="keyword-rank">' + (k.rank || i+1) + '</span><span class="keyword-text">' + k.keyword + '</span><span class="keyword-source">' + k.source + '</span><span class="keyword-time">' + new Date(k.detected_at).toLocaleTimeString('ko-KR') + '</span></li>'
        ).join('');
      });
    }

    function clearLogs() {
      document.getElementById('logPanel').innerHTML = '';
    }

    // 30초마다 stats 갱신
    setInterval(() => {
      fetch('/api/stats').then(r => r.json()).then(stats => {
        socket.emit('stats', stats);
        document.getElementById('statKeywords').textContent = stats.totalKeywords;
        document.getElementById('statArticles').textContent = stats.totalArticles;
        document.getElementById('statPublished').textContent = stats.publishedArticles;
        document.getElementById('statToday').textContent = stats.todayArticles;
        document.getElementById('statViews').textContent = stats.totalViews;
      });
    }, 30000);
  </script>
</body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function startDashboard() {
  server.listen(config.server.port, config.server.host, () => {
    logger.info(`[대시보드] 서버 시작: http://${config.server.host}:${config.server.port}`);
    logger.info(`[대시보드] 대시보드: http://${config.server.host}:${config.server.port}/dashboard`);
  });
  return { app, server, io, emitEvent };
}

module.exports = { startDashboard, emitEvent, app, server, io };
