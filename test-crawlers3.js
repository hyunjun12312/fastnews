const axios = require('axios');
const cheerio = require('cheerio');
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

async function test() {
  // 1. Daum real-time issue
  console.log('=== DAUM ===');
  try {
    const r = await axios.get('https://www.daum.net/', { headers: H, timeout: 10000 });
    const ch = cheerio.load(r.data);

    // Find issue/rank/keyword elements more specifically
    const kws = [];

    // Try various approaches
    ch('.rank_cont a, .hotissue_layer a, .realtime_part a, .issue_keyword a').each((i, el) => {
      const text = ch(el).text().trim();
      if (text.length > 1 && text.length < 30) kws.push(text);
    });
    console.log('Daum keywords from known selectors:', kws.slice(0, 10));

    // Search in all links for short text items that look like keywords
    const candidates = [];
    ch('a').each((i, el) => {
      const text = ch(el).text().trim();
      const href = ch(el).attr('href') || '';
      // Likely keyword links go to search
      if (href.includes('search') && text.length > 1 && text.length < 25) {
        candidates.push(text);
      }
    });
    console.log('Daum search-linked texts:', candidates.slice(0, 15));

    // Try finding list items that look like rankings
    ch('ol li, ul li').each((i, el) => {
      const text = ch(el).text().trim().replace(/\s+/g, ' ');
      if (text.length > 2 && text.length < 40 && i < 50) {
        // Check if it has a link child
        const link = ch(el).find('a').first();
        if (link.length) {
          const linkText = link.text().trim();
          const href = link.attr('href') || '';
          if (href.includes('search') || href.includes('issue') || href.includes('keyword')) {
            console.log('  Daum li[' + i + ']:', linkText, '=>', href.substring(0, 60));
          }
        }
      }
    });
  } catch (e) { console.log('FAIL:', e.message); }

  // 2. Daum real-time search API
  console.log('\n=== DAUM ISSUE API ===');
  const daumUrls = [
    'https://www.daum.net/ranking/popular',
    'https://search.daum.net/search?w=tot&q=%EC%8B%A4%EC%8B%9C%EA%B0%84+%EA%B2%80%EC%83%89%EC%96%B4',
    'https://www.daum.net/api/realtimeissue',
  ];
  for (const url of daumUrls) {
    try {
      const r = await axios.get(url, { headers: H, timeout: 10000, maxRedirects: 5 });
      console.log(url.substring(0, 50) + ': ' + r.status + ' len=' + String(r.data).length);
    } catch (e) {
      console.log(url.substring(0, 50) + ': FAIL ' + (e.response?.status || e.message));
    }
  }

  // 3. Check if Google suggests work for trending
  console.log('\n=== GOOGLE SUGGESTIONS (KR) ===');
  try {
    const r = await axios.get('https://suggestqueries.google.com/complete/search', {
      params: { q: '', client: 'firefox', hl: 'ko', gl: 'kr' },
      headers: H,
      timeout: 5000,
    });
    console.log('Google suggestions:', JSON.stringify(r.data).substring(0, 300));
  } catch (e) { console.log('FAIL:', e.message); }

  // 4. Naver shopping ranking
  console.log('\n=== NAVER SHOPPING RANKING ===');
  try {
    const r = await axios.get('https://search.shopping.naver.com/best/home', {
      headers: H,
      timeout: 10000,
    });
    const ch = cheerio.load(r.data);
    const found = new Set();
    ch('[class]').each((i, el) => {
      const cls = ch(el).attr('class') || '';
      if (/rank|keyword|search|trend|hot|popular/i.test(cls)) {
        const key = el.tagName + '.' + cls;
        if (!found.has(key) && found.size < 10) {
          found.add(key);
          const text = ch(el).text().trim().replace(/\s+/g, ' ').substring(0, 100);
          console.log('  Found:', key, '=>', text);
        }
      }
    });
  } catch (e) { console.log('FAIL:', e.response?.status || e.message); }

  // 5. Try Naver real-time search ranking pages
  console.log('\n=== NAVER SEARCH SUGGESTIONS ===');
  try {
    // Naver autocomplete API
    const r = await axios.get('https://mac.search.naver.com/mobile/ac', {
      params: { q: '실시간', con: 1, frm: 'mobile_nv', ans: 2, r_format: 'json', r_enc: 'UTF-8', r_unicode: 0, t_koreng: 1, run: 2 },
      headers: H,
      timeout: 5000,
    });
    console.log('Naver AC:', JSON.stringify(r.data).substring(0, 500));
  } catch (e) { console.log('FAIL:', e.response?.status || e.message); }

  // 6. Naver news trending
  console.log('\n=== NAVER NEWS TRENDING ===');
  try {
    const r = await axios.get('https://news.naver.com/', { headers: H, timeout: 10000 });
    const ch = cheerio.load(r.data);
    const kws = [];
    ch('.cjs_journal_wrap a, .cjs_t, .ca_item a, .rank_lst a, .rankingnews_name, .ofst_list_inner a').each((i, el) => {
      const text = ch(el).text().trim();
      if (text.length > 2 && text.length < 30) kws.push(text);
    });
    console.log('Naver News keywords:', kws.slice(0, 10));
    
    // Find all heading-like elements
    ch('h2, h3, h4, .cjs_t, strong').each((i, el) => {
      const text = ch(el).text().trim().replace(/\s+/g, ' ');
      if (text.length > 2 && text.length < 40 && i < 20) {
        console.log('  Heading:', text);
      }
    });
  } catch (e) { console.log('FAIL:', e.response?.status || e.message); }
}

test().catch(console.error);
