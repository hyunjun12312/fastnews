const axios = require('axios');
const cheerio = require('cheerio');
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

async function test() {
  // 1. Nate - get proper keywords with found selectors
  console.log('=== NATE (fixed selectors) ===');
  try {
    const r = await axios.get('https://www.nate.com/', { headers: H, timeout: 10000 });
    const ch = cheerio.load(r.data);
    
    // Method 1: span.txt_rank
    const kws1 = [];
    ch('span.txt_rank').each((i, el) => {
      kws1.push(ch(el).text().trim());
    });
    console.log('span.txt_rank:', kws1);
    
    // Method 2: ol.isKeywordList li
    const kws2 = [];
    ch('ol.isKeywordList li').each((i, el) => {
      // Get all text, strip rank number
      let text = ch(el).text().trim().replace(/^\d+\s*/, '').replace(/\s*(동일|new|상승|하락)\s*$/i, '').trim();
      kws2.push(text);
    });
    console.log('ol.isKeywordList li:', kws2);
    
    // Method 3: div.isKeyword - try a elements
    const kws3 = [];
    ch('.isKeyword a, .isKeywordList a').each((i, el) => {
      const text = ch(el).text().trim().replace(/^\d+\s*/, '').replace(/\s*(동일|new|상승|하락)\s*$/i, '').trim();
      if (text.length > 1 && text.length < 30) kws3.push(text);
    });
    console.log('.isKeyword a:', kws3);
  } catch (e) { console.log('FAIL:', e.message); }

  // 2. Try various Naver APIs
  console.log('\n=== NAVER ALTERNATIVES ===');
  
  // Naver real-time rising search
  const naverUrls = [
    ['Naver DataLab Trending', 'https://datalab.naver.com/keyword/realtimeList.naver?age=20s'],
    ['Naver Search Ranking', 'https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=%EC%8B%A4%EC%8B%9C%EA%B0%84+%EA%B2%80%EC%83%89%EC%96%B4'],
    ['Naver Mobile Trending', 'https://m.naver.com/'],
  ];

  for (const [name, url] of naverUrls) {
    try {
      const r = await axios.get(url, { headers: { ...H, Referer: 'https://www.naver.com/' }, timeout: 10000 });
      console.log(name + ':', r.status, 'len=' + String(r.data).length);
      if (name.includes('Mobile')) {
        const ch = cheerio.load(r.data);
        // Look for trending/keyword related elements
        const found = new Set();
        ch('[class]').each((i, el) => {
          const cls = ch(el).attr('class') || '';
          if (/rank|keyword|search|trend|hot|popular|rising/i.test(cls)) {
            const key = el.tagName + '.' + cls;
            if (!found.has(key) && found.size < 10) {
              found.add(key);
              const text = ch(el).text().trim().replace(/\s+/g, ' ').substring(0, 100);
              console.log('  Found:', key, '=>', text);
            }
          }
        });
      }
    } catch (e) {
      console.log(name + ': FAIL', e.response?.status || e.message);
    }
  }

  // 3. Try signal.bz API
  console.log('\n=== SIGNAL.BZ API ===');
  const signalUrls = [
    'https://signal.bz/api/news',
    'https://signal.bz/api/trend',
    'https://signal.bz/api/keyword',
    'https://api.signal.bz/news',
  ];
  for (const url of signalUrls) {
    try {
      const r = await axios.get(url, { headers: H, timeout: 5000 });
      console.log(url + ': ' + r.status + ' len=' + String(r.data).length);
      console.log('  Preview:', JSON.stringify(r.data).substring(0, 200));
    } catch (e) {
      console.log(url + ': FAIL ' + (e.response?.status || e.message));
    }
  }

  // 4. Try other Korean trending sources
  console.log('\n=== OTHER SOURCES ===');
  
  // Daum/Kakao real-time 
  try {
    const r = await axios.get('https://www.daum.net/', { headers: H, timeout: 10000 });
    const ch = cheerio.load(r.data);
    console.log('Daum: 200, len=' + r.data.length);
    const found = new Set();
    ch('[class]').each((i, el) => {
      const cls = ch(el).attr('class') || '';
      if (/rank|keyword|search|trend|hot|issue|realtime/i.test(cls)) {
        const key = el.tagName + '.' + cls;
        if (!found.has(key) && found.size < 15) {
          found.add(key);
          const text = ch(el).text().trim().replace(/\s+/g, ' ').substring(0, 120);
          console.log('  Found:', key, '=>', text);
        }
      }
    });
  } catch (e) { console.log('Daum: FAIL', e.message); }

  // MBC/SBS 연예 트렌드 등
  try {
    const r = await axios.get('https://www.google.com/trends/hottrends/atom/feed?pn=p23', { headers: H, timeout: 10000 });
    console.log('Google Atom Feed:', r.status, 'len=' + String(r.data).length);
  } catch (e) { console.log('Google Atom Feed: FAIL', e.response?.status || e.message); }
}

test().catch(console.error);
