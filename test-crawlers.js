const axios = require('axios');
const cheerio = require('cheerio');
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

async function test() {
  // 1. Google Trends RSS new
  console.log('=== GOOGLE TRENDS RSS (new URL) ===');
  try {
    const r = await axios.get('https://trends.google.com/trending/rss?geo=KR', { headers: H, timeout: 10000 });
    const ch = cheerio.load(r.data, { xmlMode: true });
    const items = [];
    ch('item').each((i, el) => { items.push(ch(el).find('title').text().trim()); });
    console.log('Items:', items.length, items.slice(0, 10));
  } catch (e) { console.log('FAIL:', e.message); }

  // 2. Signal.bz content  
  console.log('\n=== SIGNAL.BZ ===');
  try {
    const r = await axios.get('https://signal.bz/news', { headers: H, timeout: 10000 });
    const ch = cheerio.load(r.data);
    console.log('HTML length:', r.data.length);
    console.log('ol li a:', ch('ol li a').length);
    console.log('.list-group-item:', ch('.list-group-item').length);
    console.log('a count:', ch('a').length);
    // Try to find any text content
    const bodyText = ch('body').text().trim().replace(/\s+/g, ' ');
    console.log('Body text (300):', bodyText.substring(0, 300));
  } catch (e) { console.log('FAIL:', e.message); }

  // Try signal.bz main page
  console.log('\n=== SIGNAL.BZ main ===');
  try {
    const r = await axios.get('https://signal.bz/', { headers: H, timeout: 10000 });
    const ch = cheerio.load(r.data);
    console.log('HTML length:', r.data.length);
    const bodyText = ch('body').text().trim().replace(/\s+/g, ' ');
    console.log('Body text (500):', bodyText.substring(0, 500));
    // Check for keyword elements
    ch('a').each((i, el) => {
      const text = ch(el).text().trim();
      if (text.length > 1 && text.length < 20 && i < 30) {
        console.log('  a[' + i + ']:', text);
      }
    });
  } catch (e) { console.log('FAIL:', e.message); }

  // 3. Nate selectors
  console.log('\n=== NATE ===');
  try {
    const r = await axios.get('https://www.nate.com/', { headers: H, timeout: 10000 });
    const ch = cheerio.load(r.data);
    const selectors = ['.kwd_list li a', '.keyword_area li a', '.realtime_list li a', '[class*=rank] li a', '.lst_keyword a'];
    for (const sel of selectors) {
      const count = ch(sel).length;
      if (count > 0) {
        const texts = [];
        ch(sel).each((i, el) => texts.push(ch(el).text().trim()));
        console.log(sel + ':', count, texts.slice(0, 5));
      }
    }
    
    // Find elements with rank/keyword/search in class name
    const found = new Set();
    ch('[class]').each((i, el) => {
      const cls = ch(el).attr('class') || '';
      if (/rank|keyword|search|trend|hot|popular|realtime/i.test(cls)) {
        const tag = el.tagName;
        const key = tag + '.' + cls;
        if (!found.has(key)) {
          found.add(key);
          const text = ch(el).text().trim().replace(/\s+/g, ' ').substring(0, 80);
          console.log('  Found:', tag + '.' + cls, '=>', text);
        }
      }
    });
  } catch (e) { console.log('FAIL:', e.message); }

  // 4. Try Naver DataLab
  console.log('\n=== NAVER DATALAB ===');
  try {
    const r = await axios.get('https://datalab.naver.com/keyword/realtimeList.naver', {
      headers: { ...H, Referer: 'https://datalab.naver.com/' },
      timeout: 10000,
    });
    console.log('Status:', r.status, 'len:', String(r.data).length);
    const preview = typeof r.data === 'string' ? r.data.substring(0, 300) : JSON.stringify(r.data).substring(0, 300);
    console.log('Preview:', preview);
  } catch (e) { console.log('FAIL:', e.response?.status || e.message); }

  // 5. Try Google Trends daily (new domain)
  console.log('\n=== GOOGLE TRENDS API (new domain) ===');
  const apiUrls = [
    'https://trends.google.com/trends/api/dailytrends?hl=ko&tz=-540&geo=KR&ns=15',
    'https://trends.google.com/trends/api/dailytrends?hl=ko&tz=-540&geo=KR',
    'https://trends.google.com/api/daily-trends?geo=KR&hl=ko',
  ];
  for (const url of apiUrls) {
    try {
      const r = await axios.get(url, { headers: H, timeout: 10000 });
      console.log(url.split('?')[0] + ': ' + r.status + ' len=' + String(r.data).length);
    } catch (e) {
      console.log(url.split('?')[0] + ': FAIL ' + (e.response?.status || e.message));
    }
  }

  // 6. Try Naver shopping trending
  console.log('\n=== NAVER SHOPPING TRENDING ===');
  try {
    const r = await axios.get('https://shopping.naver.com/api/modules/gnb/auto-complete/keyword-trending', {
      headers: { ...H, Referer: 'https://shopping.naver.com/' },
      timeout: 10000,
    });
    console.log('Status:', r.status);
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    console.log('Preview:', JSON.stringify(data).substring(0, 400));
  } catch (e) { console.log('FAIL:', e.response?.status || e.message); }
}

test().catch(console.error);
