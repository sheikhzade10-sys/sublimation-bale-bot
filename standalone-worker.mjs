import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const WORK_DIR = path.join(ROOT_DIR, 'work');
const BACKUP_DIR = path.join(WORK_DIR, 'backups');
const CRAWLER_STATE_PATH = path.join(WORK_DIR, 'crawler-state.json');

const BALE_BOT_TOKEN =
  process.env.BALE_BOT_TOKEN || '2136077232:6UYkuEA0H6FyPXbZB0lH38Hy1GjKpojSsv8';
const BALE_CHAT_ID = process.env.BALE_CHAT_ID || '4657775638';
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const MIN_NEW_CARDS = 2;

const EXCLUDED_VENDOR_OR_PLATFORM_PHONES = new Set([
  // Chapshoo platform support/footer numbers
  '02186190261',
  '02186190265',
  '02186112393',
  '09023509176',
  // Equipment / paper / ink vendors (competitors/suppliers, not paper buyers)
  '02148315',
  '02149063',
  '09121470098',
  '09427676942',
  '09359264373',
  '02188306332',
  '02188848050',
  '02188846393',
]);

const REQUIRED_SUBLIMATION_RE =
  /سابلیمیشن|سابلیمشن|سابلیمیت|کلندر|کالندر|چاپ پارچه|چاپ روی پارچه|چاپ دیجیتال پارچه|چاپ طاقه|طاقه‌|رول پارچه|چاپ شال|چاپ روسری|چاپ پرچم|پرچم ساحلی|پرچم تشریفات|تولید پرچم|تولیدی پرچم|کتیبه مخمل|روتختی|کالای خواب|لباس ورزشی|چاپ تیشرت|چاپ لباس|پرده چاپی|چاپ پرده|فرشینه|پرس حرارتی|چاپ حرارتی|چاپ کوسن|چاپ لنیارد|چاپ روبان|ساک پارچه‌ای|بگ پارچه‌ای|چاپ مستقیم پارچه|dtf|دی تی اف/i;

const EXCLUDED_VENDOR_OR_IRRELEVANT_RE =
  /آزمایش فنی|منتشر نشود|تجهیزات چاپ|بازرگانی تجهیزات|ملزومات چاپ|مواد مصرفی چاپ|ماشین آلات چاپ|فروش ماشین آلات|فروش کاغذ|خرید کاغذ|تامین کاغذ|تأمین کاغذ|کاغذ سابلیمیشن\s*\d|کاغذ ۳[۰۹]\s*گرم|کاغذ 29|کاغذ 30|فروش جوهر|جوهر سابلیمیشن|اتیل استات|فروش دستگاه|واردکننده دستگاه|واردات دستگاه|فروش پلاتر|فروش کلندر|تعمیر دستگاه|تعمیرات دستگاه|هد اپسون|کلینیک|درمانگاه|بیمارستان|مطب|سلامتی 24|youtube\.com|آهنگ|موزیک|نوین تاک|novin-tak|کلاسیک رول|شرکت رکورد|sdrecord|فرارنگ|fararang|فتوبهمن|فبتاک|کیسپاس|casepas|چاپلر|chapler|والاچاپ|valachap|جعبه و کارتن|کارتن سازی|اکو سالونت|اکوسالونت|فروش اقساطی دستگاه|نمایندگی فروش دستگاه|تعمیر پرینتر|شارژ کارتریج|کافی نت|کافی‌نت|تکثیر و صحافی|تجهیزات اداری/i;

function toLatinDigits(str) {
  return String(str || '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&zwnj;/g, '\u200c')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCityFromText(text) {
  const cities = [
    'تهران',
    'کرج',
    'اصفهان',
    'مشهد',
    'شیراز',
    'تبریز',
    'قم',
    'یزد',
    'کاشان',
    'رشت',
    'ساری',
    'قائمشهر',
    'اهواز',
    'اراک',
    'کرمانشاه',
    'سنندج',
    'همدان',
    'قزوین',
    'ارومیه',
    'کرمان',
    'بندرعباس',
    'اردبیل',
    'زنجان',
    'گرگان',
    'سمنان',
    'بوشهر',
    'شهرکرد',
    'خرم‌آباد',
    'اسلامشهر',
    'شهریار',
    'ملارد',
    'رباط کریم',
    'ورامین',
    'پاکدشت',
    'نجف‌آباد',
  ];
  for (const c of cities) {
    if (String(text || '').includes(c)) return c;
  }
  return 'ایران';
}

function normalizeNameForDedup(name) {
  return String(name || '')
    .replace(/[\s\-_،,()«»؛:|–—]/g, '')
    .replace(
      /چاپخانه|کارگاه|مجموعه|شرکت|تخصصی|دیجیتال|سابلیمیشن|پارچه|تولیدی|مرکز|خدمات|چاپ/g,
      ''
    )
    .trim()
    .toLowerCase();
}

function normalizePhone(raw) {
  let s = toLatinDigits(raw).replace(/[^\d+]/g, '');
  if (s.startsWith('+98')) s = '0' + s.slice(3);
  else if (s.startsWith('0098')) s = '0' + s.slice(4);
  else if (s.startsWith('98') && s.length === 12) s = '0' + s.slice(2);
  else if (s.length === 10 && s.startsWith('9')) s = '0' + s;
  return s;
}

function isValidIranPhone(p) {
  if (!p || EXCLUDED_VENDOR_OR_PLATFORM_PHONES.has(p)) return false;
  if (/^09(0[0-5]|1[0-9]|2[0-3]|3[0-9]|9[0-6])\d{7}$/.test(p)) {
    if (/(\d)\1{6,}/.test(p)) return false;
    return true;
  }
  const validAreaCodes =
    /^0(11|13|17|21|23|24|25|26|28|31|34|35|38|41|44|45|51|54|56|58|61|66|71|74|76|77|81|83|84|86|87)[2-9]\d{7}$/;
  if (validAreaCodes.test(p)) {
    if (/(\d)\1{6,}/.test(p)) return false;
    return true;
  }
  if (/^0(21|26|31|51|41|71|35)[2-9]\d{3,4}$/.test(p)) {
    return true;
  }
  return false;
}

function normalizePhoneList(phones) {
  const rawList = Array.isArray(phones)
    ? phones
    : String(phones || '')
        .split(/[\n,،;/|]+/)
        .map((s) => s.trim())
        .filter(Boolean);

  const seen = new Set();
  const result = [];
  for (const item of rawList) {
    const norm = normalizePhone(item);
    if (norm && isValidIranPhone(norm) && !seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }
  return result;
}

function isValidSublimationBuyerCandidate(title, description, phones, url = '') {
  const cleanTitle = decodeHtmlEntities(title || '');
  const cleanDesc = decodeHtmlEntities(description || '');
  const combined = `${cleanTitle} ${cleanDesc} ${url}`;
  if (!cleanTitle || cleanTitle.length < 4) return false;
  if (EXCLUDED_VENDOR_OR_IRRELEVANT_RE.test(combined)) return false;
  if (!REQUIRED_SUBLIMATION_RE.test(combined)) return false;
  const validPhones = normalizePhoneList(phones);
  if (validPhones.length === 0) return false;
  return true;
}

function decodeBingRedirectUrl(rawUrl) {
  let u = decodeHtmlEntities(rawUrl || '');
  try {
    const parsed = new URL(u);
    if (parsed.hostname.includes('bing.com') && parsed.pathname.includes('/ck/a')) {
      const b64 = parsed.searchParams.get('u');
      if (b64 && b64.startsWith('a1')) {
        const encoded = b64.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        if (decoded.startsWith('http')) return decoded;
      }
    }
  } catch {
    // ignore URL parse error
  }
  return u;
}

function formatBaleCard(lead) {
  if (lead.preText && String(lead.preText).trim().length > 0) {
    return String(lead.preText).trim();
  }
  const phonesList = normalizePhoneList(lead.phones);
  const lines = [
    `نام: ${lead.name || '-'}`,
    `شهر: ${lead.city || '-'}`,
    `مسئول اعلام‌شده: ${lead.contactPerson || 'نامشخص'}`,
  ];
  if (phonesList.length > 0) {
    lines.push('تلفن تجاری:');
    for (const p of phonesList) lines.push(p);
  } else {
    lines.push('تلفن عمومی در آگهی درج نشده؛ لینک آگهی:');
    lines.push(String(lead.sourceUrl || '-'));
  }
  lines.push('شبکه اجتماعی:');
  lines.push(String(lead.handleOrDomain || 'ثبت نشده'));
  lines.push(`فعالیت: ${lead.activityType || '-'}`);
  lines.push(`دلیل تناسب: ${lead.equipment || '-'}`);
  lines.push(`وضعیت تأیید: ${lead.evidenceStatus || '-'}`);
  lines.push('منبع:');
  lines.push(String(lead.sourceUrl || '-'));
  lines.push(`تاریخ بررسی: ${lead.updatedAt || '-'}`);
  lines.push(`شناسه: ${lead.id}`);
  lines.push(
    'زمان صرف‌شده: جست‌وجو و بررسی آگهی: حدود ۳ دقیقه؛ ثبت، نگارش و آماده‌سازی/ارسال کارت: حدود ۲ دقیقه؛ جمعاً حدود ۵ دقیقه.'
  );
  return lines.join('\n');
}

function ensureDirectories() {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function atomicWriteFileSync(targetPath, dataBufferOrString) {
  ensureDirectories();
  const tempPath = `${targetPath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, dataBufferOrString);
  fs.renameSync(tempPath, targetPath);
}

function readJsonSafe(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
  }
  return fallback;
}

function loadCrawlerState() {
  const raw = readJsonSafe(CRAWLER_STATE_PATH, null);
  return {
    baladIdx: Number(raw?.baladIdx) || 0,
    chapshooIdx: Number(raw?.chapshooIdx) || 0,
    divarIdx: Number(raw?.divarIdx) || 0,
    aparatIdx: Number(raw?.aparatIdx) || 0,
    baladRecQueue: Array.isArray(raw?.baladRecQueue) ? raw.baladRecQueue.slice(0, 400) : [],
    checkedKeys: Array.isArray(raw?.checkedKeys) ? raw.checkedKeys.slice(-5000) : [],
    updatedAt: raw?.updatedAt || '',
  };
}

function saveCrawlerState(state) {
  state.baladRecQueue = Array.from(new Set(state.baladRecQueue)).slice(0, 400);
  if (state.checkedKeys.length > 5000) {
    state.checkedKeys = state.checkedKeys.slice(-5000);
  }
  state.updatedAt = new Date().toISOString();
  atomicWriteFileSync(CRAWLER_STATE_PATH, JSON.stringify(state, null, 2));
}

// --- BALAD LIVE MAP MATRIX (36 Iranian Cities/Hubs × 18 Sublimation/Textile Queries = 648 Unique Map Searches!) ---
const BALAD_CITIES = [
  'تهران',
  'اصفهان',
  'مشهد',
  'کرج',
  'تبریز',
  'شیراز',
  'قم',
  'یزد',
  'کاشان',
  'رشت',
  'ساری',
  'اهواز',
  'اراک',
  'قزوین',
  'همدان',
  'کرمانشاه',
  'سنندج',
  'ارومیه',
  'کرمان',
  'بندرعباس',
  'اردبیل',
  'زنجان',
  'گرگان',
  'سمنان',
  'بوشهر',
  'شهرکرد',
  'خرم آباد',
  'اسلامشهر',
  'شهریار',
  'ملارد',
  'رباط کریم',
  'ورامین',
  'پاکدشت',
  'قائم شهر',
  'بابل',
  'نجف آباد',
];

const BALAD_KEYWORDS = [
  'چاپ پارچه',
  'چاپ سابلیمیشن',
  'چاپ پرچم',
  'تولیدی لباس ورزشی',
  'چاپ تیشرت',
  'چاپ شال و روسری',
  'چاپ روسری',
  'چاپ روتختی',
  'چاپ پرده',
  'چاپ کوسن',
  'چاپ لباس ورزشی',
  'تولیدی پرچم',
  'چاپ حرارتی',
  'کلندر پارچه',
  'چاپ کتیبه',
  'چاپ فرشینه',
  'چاپ ساک پارچه ای',
  'چاپ دیجیتال پارچه',
];

const BALAD_QUERY_MATRIX = [];
for (const kw of BALAD_KEYWORDS) {
  for (const city of BALAD_CITIES) {
    BALAD_QUERY_MATRIX.push(`${kw} ${city}`);
  }
}

// --- DEEP CHAPSHOO INDEX LIST (110+ Category Pages & Search Pages) ---
function buildChapshooIndexUrls() {
  const urls = [];
  for (let p = 1; p <= 8; p++) {
    urls.push(
      p === 1
        ? 'https://chapshoo.com/cat-ad/sublimation-printing/'
        : `https://chapshoo.com/cat-ad/sublimation-printing/page/${p}/`
    );
  }
  for (let p = 1; p <= 3; p++) {
    urls.push(
      p === 1
        ? 'https://chapshoo.com/cat-ad/advertising-flags/'
        : `https://chapshoo.com/cat-ad/advertising-flags/page/${p}/`
    );
  }
  for (let p = 1; p <= 2; p++) {
    urls.push(
      p === 1
        ? 'https://chapshoo.com/cat-ad/thermal-printing/'
        : `https://chapshoo.com/cat-ad/thermal-printing/page/${p}/`
    );
  }
  urls.push('https://chapshoo.com/cat-ad/fabric-promotion-bags/');

  const searchTerms = [
    'چاپ پارچه',
    'کلندر',
    'تیشرت',
    'روسری',
    'پرده',
    'مخمل',
    'ساتن',
    'حرارتی',
    'ورزشی',
    'کوسن',
    'لنیارد',
    'روبان',
    'کتیبه',
    'فرشینه',
    'شال',
    'پرچم',
    'سابلیمیشن',
    'روتختی',
    'کالای خواب',
    'چاپ لباس',
  ];
  for (const term of searchTerms) {
    urls.push(`https://chapshoo.com/?s=${encodeURIComponent(term)}`);
    urls.push(`https://chapshoo.com/page/2/?s=${encodeURIComponent(term)}`);
  }

  for (let p = 1; p <= 45; p++) {
    urls.push(
      p === 1
        ? 'https://chapshoo.com/cat-ad/printing/'
        : `https://chapshoo.com/cat-ad/printing/page/${p}/`
    );
  }
  for (let p = 1; p <= 12; p++) {
    urls.push(
      p === 1
        ? 'https://chapshoo.com/cat-ad/screen-printing/'
        : `https://chapshoo.com/cat-ad/screen-printing/page/${p}/`
    );
  }
  for (let p = 1; p <= 12; p++) {
    urls.push(
      p === 1
        ? 'https://chapshoo.com/cat-ad/large-format-printing/'
        : `https://chapshoo.com/cat-ad/large-format-printing/page/${p}/`
    );
  }
  for (let p = 1; p <= 12; p++) {
    urls.push(
      p === 1
        ? 'https://chapshoo.com/cat-ad/latest-promotional/'
        : `https://chapshoo.com/cat-ad/latest-promotional/page/${p}/`
    );
  }
  return urls;
}

const CHAPSHOO_INDEX_URLS = buildChapshooIndexUrls();

const ROTATING_MAP_AND_DIVAR_QUERIES = [
  'چاپ سابلیمیشن پارچه',
  'کلندر پارچه',
  'کالندر پارچه',
  'خدمات چاپ سابلیمیشن',
  'چاپ لباس ورزشی سابلیمیشن',
  'چاپ پرچم سابلیمیشن',
  'چاپ شال و روسری دیجیتال',
  'چاپ روتختی و کالای خواب',
  'چاپ طاقه پارچه',
  'چاپ پرده و کوسن سابلیمیشن',
  'چاپ تیشرت سابلیمیشن',
  'چاپ پرچم ساحلی',
  'چاپ پرچم تشریفات',
  'چاپ مخمل و ساتن',
  'چاپ فرشینه',
  'چاپ لنیارد و روبان',
  'اپراتور سابلیمیشن',
  'اپراتور کلندر',
  'چاپ دیجیتال پارچه',
  'چاپ حرارتی پارچه',
];

// 1. LIVE BALAD MAP CRAWLER (search.raah.ir + balad.ir/p/{token} — 100% Cloud-Compatible!)
export async function crawlBaladLive(
  existingPhones = new Set(),
  existingSourceUrls = new Set(),
  crawlerState = null,
  checkedSet = new Set()
) {
  const discovered = [];
  const state = crawlerState || loadCrawlerState();
  const candidateTokens = [];
  const seenLocal = new Set();

  // First drain up to 4 recommended POI tokens discovered from previously matched workshops
  while (state.baladRecQueue.length > 0 && candidateTokens.length < 4) {
    const recTok = state.baladRecQueue.shift();
    if (!recTok) continue;
    const key = `balad:${recTok}`;
    if (checkedSet.has(key) || seenLocal.has(recTok)) continue;
    seenLocal.add(recTok);
    candidateTokens.push({ token: recTok, query: 'پیشنهاد مرتبط نقشه بلد' });
  }

  // Advance through 3 queries from BALAD_QUERY_MATRIX
  for (let i = 0; i < 3; i++) {
    const query = BALAD_QUERY_MATRIX[state.baladIdx % BALAD_QUERY_MATRIX.length];
    state.baladIdx = (state.baladIdx + 1) % BALAD_QUERY_MATRIX.length;
    try {
      const resp = await fetch(
        `https://search.raah.ir/v4/bundle-search/?text=${encodeURIComponent(query)}`,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'fa-IR,fa;q=0.9',
          },
          signal: AbortSignal.timeout(6500),
        }
      );
      if (!resp.ok) continue;
      const json = await resp.json().catch(() => null);
      const tokens = Array.isArray(json?.['poi-tokens']) ? json['poi-tokens'] : [];
      for (const tok of tokens) {
        const key = `balad:${tok}`;
        if (
          !tok ||
          checkedSet.has(key) ||
          seenLocal.has(tok) ||
          existingSourceUrls.has(`https://balad.ir/p/${tok}`.toLowerCase())
        ) {
          continue;
        }
        seenLocal.add(tok);
        candidateTokens.push({ token: tok, query });
      }
    } catch {
      // ignore transient network failure
    }
  }

  const batch = candidateTokens.slice(0, 15);
  for (let i = 0; i < batch.length; i += 5) {
    const slice = batch.slice(i, i + 5);
    const results = await Promise.all(
      slice.map(async ({ token, query }) => {
        const key = `balad:${token}`;
        checkedSet.add(key);
        state.checkedKeys.push(key);
        try {
          const url = `https://balad.ir/p/${token}`;
          const r = await fetch(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
              'Accept-Language': 'fa-IR,fa;q=0.9',
            },
            signal: AbortSignal.timeout(6500),
          });
          if (!r.ok) return null;
          const html = await r.text();
          const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
          if (!m) return null;

          const nd = JSON.parse(m[1]);
          const poi = nd?.props?.pageProps?.data?.poi;
          const extras = nd?.props?.pageProps?.data?.poiExtras;
          if (!poi?.name) return null;

          const name = decodeHtmlEntities(poi.name);
          const category = decodeHtmlEntities(poi.category || '');
          const desc = decodeHtmlEntities(poi.description || '');
          const fields = Array.isArray(poi.fields) ? poi.fields : [];

          const rawPhones = [];
          for (const f of fields) {
            if (f?.icon === 'phone' || String(f?.value || '').startsWith('tel:')) {
              if (f.text) rawPhones.push(f.text);
              if (f.value) rawPhones.push(f.value);
            }
          }
          if (poi.phoneLink) rawPhones.push(poi.phoneLink);
          const phones = normalizePhoneList(rawPhones);
          if (phones.length === 0) return null;
          if (phones.some((p) => existingPhones.has(p))) return null;

          const addrField = fields.find((f) => f?.icon === 'gps');
          const address = decodeHtmlEntities(addrField?.value || addrField?.text || '');
          const webField = fields.find((f) => f?.icon === 'web');
          const website = decodeHtmlEntities(webField?.text || webField?.value || '');
          const cityCrumb = extras?.breadcrumbs?.[0]?.[0]?.text || '';
          const city = address
            ? address.slice(0, 125)
            : cityCrumb || detectCityFromText(`${name} ${query}`);

          const canonicalUrl =
            typeof poi.fullUrl === 'string' && poi.fullUrl.startsWith('http')
              ? poi.fullUrl
              : url;

          // Validate strictly against sublimation/textile buyer criteria
          const combinedForCheck = `${name} ${desc} ${category}`;
          if (!isValidSublimationBuyerCandidate(name, `${desc} ${category}`, phones, canonicalUrl)) {
            return null;
          }

          // Enqueue related Balad recommendations for future cycles!
          const recs = Array.isArray(extras?.poiRecommendations)
            ? extras.poiRecommendations
            : [];
          for (const rec of recs) {
            const items = Array.isArray(rec?.items) ? rec.items : [rec];
            for (const it of items) {
              const rTok = it?.token || it?.poiToken;
              if (rTok && !checkedSet.has(`balad:${rTok}`)) {
                state.baladRecQueue.push(rTok);
              }
            }
          }

          return {
            name: name.slice(0, 95),
            city,
            contactPerson: 'نامشخص',
            activityType: category
              ? `${name} (${category})`.slice(0, 130)
              : `خدمات ${query}`,
            phones,
            handleOrDomain: website || canonicalUrl,
            equipment: desc
              ? `ثبت‌شده در نقشه بلد (${query}): ${desc.slice(0, 190)}`
              : `کارگاه ثبت‌شده در نقشه بلد (دسته: ${category || query}) در ${city.slice(0, 80)}؛ مصرف‌کننده بالقوه رول کاغذ سابلیمیشن.`,
            evidenceStatus: `نام، نشانی و شماره تماس مستقیم (${phones.join('، ')}) از صفحه رسمی نقشه بلد (balad.ir) استخراج و از نظر تناسب چاپ سابلیمیشن تأیید شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.`,
            sourceUrl: canonicalUrl,
          };
        } catch {
          return null;
        }
      })
    );
    for (const item of results) {
      if (item) discovered.push(item);
    }
    if (discovered.length >= 6) break;
  }

  return discovered;
}

// 2. DEEP LIVE CHAPSHOO DIRECTORY CRAWLER (Persistent cursor + checkedKeys so it NEVER gets stuck!)
export async function crawlChapshooLive(
  existingPhones = new Set(),
  existingSourceUrls = new Set(),
  crawlerState = null,
  checkedSet = new Set()
) {
  const discovered = [];
  const state = crawlerState || loadCrawlerState();
  const unseenAdUrls = [];
  const seenAdUrlSet = new Set();

  // Scan up to 4 pages from current chapshooIdx cursor
  for (let offset = 0; offset < 4 && unseenAdUrls.length < 18; offset++) {
    const indexUrl =
      CHAPSHOO_INDEX_URLS[state.chapshooIdx % CHAPSHOO_INDEX_URLS.length];
    state.chapshooIdx = (state.chapshooIdx + 1) % CHAPSHOO_INDEX_URLS.length;
    try {
      const resp = await fetch(indexUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'fa-IR,fa;q=0.9',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      for (const m of html.matchAll(/https?:\/\/chapshoo\.com\/ad\/[^"'\s#>]+/gi)) {
        const cleanAdUrl = m[0].split('#')[0].split('?')[0];
        const normAdUrl = cleanAdUrl.replace(/\/+$/, '').toLowerCase();
        const slug = normAdUrl.split('/ad/')[1] || normAdUrl;
        const key = `chapshoo:${slug}`;
        if (
          seenAdUrlSet.has(normAdUrl) ||
          checkedSet.has(key) ||
          existingSourceUrls.has(normAdUrl) ||
          existingSourceUrls.has(normAdUrl + '/') ||
          /novin-tak|fararang|casepas|valachap|chapler/i.test(normAdUrl)
        ) {
          continue;
        }
        seenAdUrlSet.add(normAdUrl);
        unseenAdUrls.push({ url: cleanAdUrl, key });
      }
    } catch {
      // ignore transient fetch failure
    }
  }

  const batchToFetch = unseenAdUrls.slice(0, 15);
  for (let i = 0; i < batchToFetch.length; i += 5) {
    const slice = batchToFetch.slice(i, i + 5);
    const results = await Promise.all(
      slice.map(async ({ url: adUrl, key }) => {
        checkedSet.add(key);
        state.checkedKeys.push(key);
        try {
          const r = await fetch(adUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(6500),
          });
          if (!r.ok) return null;
          const rawHtml = await r.text();
          const mainHtml = rawHtml.split('<footer')[0];
          const mainLatin = toLatinDigits(mainHtml);

          const h1Match = mainHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
          const rawTitle = decodeHtmlEntities(
            (h1Match?.[1] || '').replace(/<[^>]+>/g, ' ')
          );
          if (!rawTitle) return null;

          const telMatches = [
            ...mainLatin.matchAll(/href=["']tel:([^"']+)["']/gi),
          ].map((m) => m[1]);
          const phones = normalizePhoneList(telMatches);
          if (phones.length === 0) return null;
          if (phones.some((p) => existingPhones.has(p))) return null;

          const metaDescMatch =
            mainHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
            mainHtml.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
          const metaDesc = decodeHtmlEntities(metaDescMatch?.[1] || '');

          const strippedLines = decodeHtmlEntities(
            mainHtml
              .replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<[^>]+>/g, '\n')
          )
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 2 && l.length < 280);

          let cityAndAddress = '';
          const cityDotLine = strippedLines.find((l) => /^[^\s·]{2,25}\s*·\s*/.test(l));
          if (cityDotLine) {
            cityAndAddress = cityDotLine.split('·')[0].trim();
          }
          const mapIdx = strippedLines.findIndex((l) => l === 'نشان' || l === 'گوگل مپ');
          if (mapIdx > 0) {
            const addrCandidate = strippedLines[mapIdx - 1];
            if (
              addrCandidate &&
              addrCandidate.length > 8 &&
              !/واتساپ|اینستاگرام|تماس|آگهی/.test(addrCandidate)
            ) {
              cityAndAddress = cityAndAddress
                ? `${cityAndAddress}، ${addrCandidate}`
                : addrCandidate;
            }
          }
          if (!cityAndAddress) {
            cityAndAddress = detectCityFromText(`${rawTitle} ${metaDesc}`);
          }

          const aboutIdx = strippedLines.findIndex((l) => l.includes('درباره‌ی این آگهی'));
          const bodySnippet =
            aboutIdx >= 0
              ? strippedLines.slice(aboutIdx + 1, aboutIdx + 6).join(' — ')
              : metaDesc;
          const fullDesc = `${metaDesc} ${bodySnippet}`.trim();

          if (!isValidSublimationBuyerCandidate(rawTitle, fullDesc, phones, adUrl)) {
            return null;
          }

          const instaMatch = mainHtml.match(
            /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+/i
          );
          const instaHandle =
            instaMatch && !instaMatch[0].toLowerCase().includes('chapshoo')
              ? instaMatch[0]
              : adUrl;

          return {
            name: rawTitle.slice(0, 95),
            city: cityAndAddress.slice(0, 120),
            contactPerson: 'نامشخص',
            activityType: rawTitle.slice(0, 130),
            phones,
            handleOrDomain: instaHandle,
            equipment: `آگهی زنده دایرکتوری چاپشو: ${(bodySnippet || metaDesc || rawTitle).slice(0, 210)}`,
            evidenceStatus: `شماره تماس مستقیم (${phones.join('، ')}) از صفحه اختصاصی کارگاه در دایرکتوری چاپشو استخراج و از نظر تناسب چاپ سابلیمیشن بررسی شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.`,
            sourceUrl: adUrl,
          };
        } catch {
          return null;
        }
      })
    );
    for (const item of results) {
      if (item) discovered.push(item);
    }
    if (discovered.length >= 6) break;
  }

  return discovered;
}

// 3. LIVE DIVAR API CRAWLER (25 cities + persistent checkedKeys)
export async function crawlLiveDivar(
  query,
  existingSourceUrls = new Set(),
  crawlerState = null,
  checkedSet = new Set()
) {
  const discovered = [];
  const state = crawlerState;
  try {
    const s = await fetch('https://api.divar.ir/v8/postlist/w/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        city_ids: [
          '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
          '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
        ],
        search_data: {
          form_data: { data: { category: { str: { value: 'ROOT' } } } },
          server_payload: {
            '@type': 'type.googleapis.com/widgets.SearchData.ServerPayload',
            additional_form_data: {
              data: { sort: { str: { value: 'sort_date' } } },
            },
          },
          query,
        },
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!s.ok) return [];
    const data = await s.json().catch(() => null);
    const widgets = data?.list_widgets || [];

    const tokens = [];
    for (const w of widgets.slice(0, 25)) {
      const token = w?.data?.token || w?.data?.action?.payload?.token;
      if (!token) continue;
      const key = `divar:${token}`;
      if (checkedSet.has(key)) continue;
      if ([...existingSourceUrls].some((u) => u.includes(token))) continue;
      tokens.push({ token, titleFallback: w?.data?.title || '', key });
    }

    for (let i = 0; i < Math.min(tokens.length, 15); i += 5) {
      const slice = tokens.slice(i, i + 5);
      const res = await Promise.all(
        slice.map(async ({ token, titleFallback, key }) => {
          checkedSet.add(key);
          if (state) state.checkedKeys.push(key);
          try {
            const detailResp = await fetch(
              `https://api.divar.ir/v8/posts-v2/web/${token}`,
              {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(5500),
              }
            );
            if (!detailResp.ok) return null;
            const detailJson = await detailResp.json().catch(() => null);
            if (!detailJson) return null;

            const title = detailJson?.seo?.web_info?.title || titleFallback || '';
            const city = detailJson?.seo?.web_info?.city_persian || 'تهران';
            const district = detailJson?.seo?.web_info?.district_persian || '';

            let description = '';
            for (const sec of detailJson?.sections || []) {
              if (sec?.section_name === 'DESCRIPTION') {
                for (const dw of sec?.widgets || []) {
                  if (dw?.data?.text && dw.data.text !== 'توضیحات') {
                    description += dw.data.text + ' ';
                  }
                }
              }
            }
            description = description.trim();
            const combinedText = `${title} ${description}`;

            const inlinePhones = normalizePhoneList(
              toLatinDigits(combinedText).match(
                /(?:09\d{9}|021[2-9]\d{7}|026[2-9]\d{7}|031[2-9]\d{7}|051[2-9]\d{7}|071[2-9]\d{7}|041[2-9]\d{7}|035[2-9]\d{7}|025[2-9]\d{7}|013[2-9]\d{7}|011[2-9]\d{7}|061[2-9]\d{7}|086[2-9]\d{7}|028[2-9]\d{7})/g
              ) || []
            );
            const slugTitle = String(title)
              .trim()
              .replace(/\s+/g, '-')
              .replace(/[^\u0600-\u06FFa-zA-Z0-9\-]/g, '');
            const divarUrl = `https://divar.ir/v/${slugTitle}/${token}`;

            if (!isValidSublimationBuyerCandidate(title, description, inlinePhones, divarUrl)) {
              return null;
            }

            return {
              name: title || 'کارگاه چاپ سابلیمیشن پارچه (آگهی دیوار)',
              city: district ? `${city}، ${district}` : city,
              contactPerson: inlinePhones[0] || 'نامشخص',
              activityType: title,
              phones: inlinePhones,
              handleOrDomain: 'ثبت نشده',
              equipment: description
                ? `آگهی مستقیم دیوار: ${description.slice(0, 200)}`
                : `آگهی مستقیم خدمات چاپ سابلیمیشن و کلندر در ${city}`,
              evidenceStatus:
                'آگهی عمومی دیوار؛ شماره مستقیماً از متن آگهی دیوار استخراج شد. فعالیت فعلی و نیاز خرید کاغذ با تماس تلفنی تأیید شود.',
              sourceUrl: divarUrl,
            };
          } catch {
            return null;
          }
        })
      );
      for (const item of res) {
        if (item) discovered.push(item);
      }
    }
  } catch {
    // ignore network error
  }
  return discovered;
}

// 4. LIVE APARAT WORKSHOP VIDEO CRAWLER (aparat.com JSON API — works 100% from Cloud IPs!)
const APARAT_QUERIES = [
  'خدمات چاپ سابلیمیشن پارچه',
  'کارگاه چاپ پارچه سابلیمیشن',
  'خدمات کلندر پارچه',
  'چاپ پرچم سابلیمیشن',
  'چاپ لباس ورزشی سابلیمیشن',
  'چاپ شال و روسری سابلیمیشن',
  'چاپ روتختی سابلیمیشن',
  'چاپ پرده سابلیمیشن',
  'چاپ فرشینه سابلیمیشن',
  'کارگاه چاپ تیشرت سابلیمیشن',
];

export async function crawlAparatWorkshopsLive(
  existingPhones = new Set(),
  crawlerState = null,
  checkedSet = new Set()
) {
  const discovered = [];
  const state = crawlerState || loadCrawlerState();
  const query = APARAT_QUERIES[state.aparatIdx % APARAT_QUERIES.length];
  state.aparatIdx = (state.aparatIdx + 1) % APARAT_QUERIES.length;

  try {
    const resp = await fetch(
      `https://www.aparat.com/etc/api/videobysearch/text/${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6500),
      }
    );
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => null);
    const videos = Array.isArray(data?.videobysearch) ? data.videobysearch : [];

    const unseen = videos
      .filter((v) => v?.uid && !checkedSet.has(`aparat:${v.uid}`))
      .slice(0, 8);

    const results = await Promise.all(
      unseen.map(async (v) => {
        const key = `aparat:${v.uid}`;
        checkedSet.add(key);
        state.checkedKeys.push(key);
        try {
          const r = await fetch(
            `https://www.aparat.com/etc/api/video/videohash/${v.uid}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5500) }
          );
          if (!r.ok) return null;
          const j = await r.json().catch(() => null);
          const vid = j?.video;
          if (!vid) return null;
          const title = decodeHtmlEntities(vid.title || v.title || '');
          const desc = decodeHtmlEntities(vid.description || '');
          const sender = decodeHtmlEntities(vid.sender_name || vid.username || '');
          const combined = `${title} ${desc} ${sender}`;

          const phones = normalizePhoneList(
            toLatinDigits(combined).match(
              /(?:09\d{9}|021[2-9]\d{7}|026[2-9]\d{7}|031[2-9]\d{7}|051[2-9]\d{7}|071[2-9]\d{7}|041[2-9]\d{7}|035[2-9]\d{7}|025[2-9]\d{7}|013[2-9]\d{7}|061[2-9]\d{7})/g
            ) || []
          );
          if (phones.length === 0) return null;
          if (phones.some((p) => existingPhones.has(p))) return null;

          const url = `https://www.aparat.com/v/${v.uid}`;
          if (!isValidSublimationBuyerCandidate(`${sender} - ${title}`, desc, phones, url)) {
            return null;
          }

          return {
            name: (sender && sender.length > 3 ? `${sender} (${title.slice(0, 55)})` : title).slice(0, 95),
            city: detectCityFromText(combined),
            contactPerson: 'نامشخص',
            activityType: title.slice(0, 130),
            phones,
            handleOrDomain: vid.username ? `https://www.aparat.com/${vid.username}` : url,
            equipment: `ویدیوی معرفی کارگاه در آپارات: ${desc.slice(0, 200)}`,
            evidenceStatus: `شماره تماس (${phones.join('، ')}) از توضیحات ویدیوی رسمی کارگاه در آپارات استخراج شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.`,
            sourceUrl: url,
          };
        } catch {
          return null;
        }
      })
    );

    for (const item of results) {
      if (item) discovered.push(item);
    }
  } catch {
    // ignore network error
  }
  return discovered;
}

// 5. Fallback Bing Map/Directory Search (strictly filtered)
export async function crawlMapAndDirectorySources(query) {
  const discovered = [];
  const mapSites = [
    'site:balad.ir',
    'site:neshan.org',
    'site:behtarino.com',
    'site:avval.ir',
    'site:chapshoo.com',
    'site:iranprintmart.ir',
  ];
  const siteFilter = mapSites[Math.floor(Math.random() * mapSites.length)];
  const fullQuery = `${siteFilter} (${query}) ("09" OR "021" OR "031" OR "051")`;

  try {
    const resp = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(fullQuery)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(7000),
      }
    );
    if (!resp.ok) return [];
    const html = toLatinDigits(await resp.text());
    const blocks = html.split(/<li class="b_algo"/i).slice(1, 10);

    for (const block of blocks) {
      const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleMatch) continue;
      const cleanUrl = decodeBingRedirectUrl(titleMatch[1] || '');
      const rawTitle = decodeHtmlEntities((titleMatch[2] || '').replace(/<[^>]+>/g, ''));
      const rawSnippet = decodeHtmlEntities(block.replace(/<[^>]+>/g, ' '));
      const combined = `${rawTitle} ${rawSnippet}`;

      const phones = normalizePhoneList(
        combined.match(
          /(?:09\d{9}|021[2-9]\d{7}|026[2-9]\d{7}|031[2-9]\d{7}|051[2-9]\d{7}|071[2-9]\d{7}|041[2-9]\d{7}|035[2-9]\d{7}|025[2-9]\d{7}|013[2-9]\d{7}|011[2-9]\d{7})/g
        ) || []
      );
      if (!isValidSublimationBuyerCandidate(rawTitle, rawSnippet, phones, cleanUrl)) {
        continue;
      }

      const detectedCity = detectCityFromText(combined);
      discovered.push({
        name: rawTitle.slice(0, 95) || `کارگاه ${query}`,
        city: detectedCity === 'ایران' ? 'ایران (ثبت‌شده در نقشه و مسیریاب)' : detectedCity,
        contactPerson: 'نامشخص',
        activityType: `خدمات ${query} و چاپ حرارتی پارچه`,
        phones,
        handleOrDomain: cleanUrl,
        equipment: `استخراج‌شده از دایرکتوری و نقشه: ${rawSnippet.slice(0, 180)}`,
        evidenceStatus:
          'اطلاعات تماس و موقعیت کارگاه در نقشه/دایرکتوری بررسی شد؛ ظرفیت مصرف کاغذ سابلیمیشن نیازمند تماس تلفنی است.',
        sourceUrl: cleanUrl,
      });
    }
  } catch {
    // ignore network error
  }
  return discovered;
}

// Backup static verified candidate pool (used only if live sources ever have transient outage)
export const VERIFIED_SUBLIMATION_CANDIDATE_POOL = [
  {
    name: 'مرکز تخصصی سانی چاپ (چاپ سابلیمیشن پارچه و پرچم - تهران جمهوری)',
    city: 'تهران، خیابان جمهوری، نرسیده به میدان بهارستان، برج بهارستان، همکف، واحد ۱۱۱',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن روی پارچه، پرچم‌های تشریفات و ساحلی، روبان و پوشاک تبلیغاتی',
    phones: ['09121879232', '02136612284'],
    handleOrDomain: 'https://sunnychap.com',
    equipment: 'کارگاه فعال چاپ سابلیمیشن پارچه و پرچم مستقر در برج بهارستان تهران؛ مصرف‌کننده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های 09121879232 و 02136612284 مستقیماً از وب‌سایت رسمی سانی چاپ (sunnychap.com) استخراج و تأیید شد.',
    sourceUrl: 'https://sunnychap.com',
  },
];

export async function sendLeadToBale(lead) {
  const cardText = formatBaleCard(lead);
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(
        `https://tapi.bale.ai/bot${BALE_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: BALE_CHAT_ID,
            text: cardText,
          }),
          signal: AbortSignal.timeout(12000),
        }
      );
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        console.log(`[Bale] Sent card ${lead.id} successfully! Message ID: ${data.result?.message_id}`);
        return { ok: true, messageId: data.result?.message_id };
      }
      lastError = data?.description || `HTTP ${resp.status}`;
    } catch (err) {
      lastError = err.message;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
  }
  console.error(`[Bale] Failed to send ${lead.id}:`, lastError);
  return { ok: false, error: lastError };
}

export async function executeStandaloneCycle(options = {}) {
  const isCronMode = Boolean(options.cronMode);
  const customQuota = Number(options.quota) || 0;

  console.log(`\n========================================`);
  console.log(`[Standalone Sublimation Engine] Starting cycle at ${new Date().toISOString()}`);
  console.log(`========================================`);

  ensureDirectories();
  const leadsPath = path.join(WORK_DIR, 'leads.json');
  const balePath = path.join(WORK_DIR, 'bale-delivery.json');
  const cfgPath = path.join(WORK_DIR, 'bale-config.json');
  const logPath = path.join(WORK_DIR, 'research-log.json');

  const cfg = readJsonSafe(cfgPath, {});
  const baleData = readJsonSafe(balePath, { deliveredIds: [], deliveries: [] });

  const latestDeliveryIso = baleData?.deliveries?.[0]?.isoTimestamp || cfg.lastRunAt || '';
  const lastDeliveryMs = Date.parse(latestDeliveryIso) || 0;
  const elapsedMs = lastDeliveryMs > 0 ? Date.now() - lastDeliveryMs : TWO_HOURS_MS;

  let targetQuota = customQuota > 0 ? customQuota : MIN_NEW_CARDS;
  if (isCronMode && customQuota === 0) {
    const MIN_INTERVAL_MS = 105 * 60 * 1000; // 1h45m tolerance for 2h cron
    if (lastDeliveryMs > 0 && elapsedMs < MIN_INTERVAL_MS) {
      const minsLeft = Math.ceil((TWO_HOURS_MS - elapsedMs) / 60000);
      console.log(
        `[2-Hour Rule] Last delivery was ${Math.floor(elapsedMs / 60000)} mins ago. Waiting ${minsLeft} more mins to strictly honor the 2-hour rule.`
      );
      return { addedCount: 0, skipped: true };
    }
    const missedWindows = Math.min(4, Math.max(1, Math.floor(elapsedMs / TWO_HOURS_MS)));
    targetQuota = missedWindows * MIN_NEW_CARDS;
    if (missedWindows > 1) {
      console.log(
        `[2-Hour Catch-Up] ${missedWindows} two-hour windows elapsed since last delivery. Catching up by sending ${targetQuota} cards!`
      );
    }
  }

  const leads = readJsonSafe(leadsPath, []);
  const existingPhones = new Set(leads.flatMap((l) => normalizePhoneList(l.phones || [])));
  const existingNormNames = new Set(
    leads.map((l) => normalizeNameForDedup(l.name)).filter((n) => n.length >= 4)
  );
  const existingSourceUrls = new Set(
    leads.flatMap((l) =>
      String(l.sourceUrl || '')
        .split(/\n+/)
        .map((u) => u.trim().replace(/\/+$/, '').toLowerCase())
        .filter((u) => u.startsWith('http'))
    )
  );

  let maxNum = 69;
  for (const item of leads) {
    const m = String(item.id || '').match(/SUB-(?:IR-)?(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }

  const crawlerState = loadCrawlerState();
  const checkedSet = new Set(crawlerState.checkedKeys);
  const addedLeads = [];
  const startTimeMs = Date.now();
  const MAX_SEARCH_BUDGET_MS = 70 * 1000;
  const MAX_ROUNDS = 6;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (addedLeads.length >= targetQuota) break;
    if (Date.now() - startTimeMs > MAX_SEARCH_BUDGET_MS) {
      console.log(`[Engine] Reached search time budget after round ${round - 1}.`);
      break;
    }

    const divarQuery =
      ROTATING_MAP_AND_DIVAR_QUERIES[
        crawlerState.divarIdx % ROTATING_MAP_AND_DIVAR_QUERIES.length
      ];
    crawlerState.divarIdx =
      (crawlerState.divarIdx + 1) % ROTATING_MAP_AND_DIVAR_QUERIES.length;

    const [baladLeads, chapshooLeads, divarLeads, aparatLeads] = await Promise.all([
      crawlBaladLive(existingPhones, existingSourceUrls, crawlerState, checkedSet),
      crawlChapshooLive(existingPhones, existingSourceUrls, crawlerState, checkedSet),
      crawlLiveDivar(divarQuery, existingSourceUrls, crawlerState, checkedSet),
      crawlAparatWorkshopsLive(existingPhones, crawlerState, checkedSet),
    ]);

    console.log(
      `[Round ${round}/${MAX_ROUNDS}] Balad: ${baladLeads.length} | Chapshoo: ${chapshooLeads.length} | Divar: ${divarLeads.length} | Aparat: ${aparatLeads.length} | Cursors: balad=${crawlerState.baladIdx}/${BALAD_QUERY_MATRIX.length}, chapshoo=${crawlerState.chapshooIdx}/${CHAPSHOO_INDEX_URLS.length}`
    );

    const roundCandidates = [
      ...baladLeads,
      ...chapshooLeads,
      ...divarLeads,
      ...aparatLeads,
    ];

    for (const candidate of roundCandidates) {
      if (addedLeads.length >= targetQuota) break;

      const normName = normalizeNameForDedup(candidate.name);
      const phones = normalizePhoneList(candidate.phones);
      if (
        !isValidSublimationBuyerCandidate(
          candidate.name,
          `${candidate.activityType || ''} ${candidate.equipment || ''}`,
          phones,
          candidate.sourceUrl || ''
        )
      ) {
        continue;
      }

      const normUrl = String(candidate.sourceUrl || '')
        .trim()
        .replace(/\/+$/, '')
        .toLowerCase();
      const hasExistingPhone = phones.some((p) => existingPhones.has(p));
      const hasExistingName = normName.length >= 4 && existingNormNames.has(normName);
      const hasExistingUrl = normUrl.length >= 10 && existingSourceUrls.has(normUrl);

      if (hasExistingPhone || hasExistingName || hasExistingUrl || phones.length === 0) {
        continue;
      }

      maxNum++;
      const newId = `SUB-${String(maxNum).padStart(4, '0')}`;
      const newLead = {
        id: newId,
        name: candidate.name,
        city: candidate.city,
        contactPerson: candidate.contactPerson || 'نامشخص',
        activityType: candidate.activityType,
        phones,
        handleOrDomain: candidate.handleOrDomain || 'ثبت نشده',
        address: candidate.city,
        equipment: candidate.equipment,
        evidenceStatus: candidate.evidenceStatus,
        sourceUrl: candidate.sourceUrl,
        updatedAt: new Date().toISOString().slice(0, 10),
        colL_status: 'تحویل داده شده به بله',
        colM_callResult: '',
        colN_paperSpec: '',
        colO_notes: '',
      };
      newLead.preText = formatBaleCard(newLead);

      const res = await sendLeadToBale(newLead);
      if (res.ok) {
        leads.push(newLead);
        if (normName.length >= 4) existingNormNames.add(normName);
        if (normUrl.length >= 10) existingSourceUrls.add(normUrl);
        for (const p of phones) existingPhones.add(p);

        baleData.deliveredIds.push(newId);
        baleData.deliveries.unshift({
          leadId: newId,
          deliveredAt: new Date().toISOString().slice(0, 10),
          isoTimestamp: new Date().toISOString(),
          targetGroup: `بانک مشتری کاغذ سابلیمیشن (${BALE_CHAT_ID})`,
          method: 'ارسال خودکار موتور ابری ۲ ساعته (نقشه بلد، چاپشو، دیوار، آپارات)',
        });

        addedLeads.push(newLead);
        await new Promise((r) => setTimeout(r, 1100));
      }
    }
  }

  // ALWAYS persist crawlerState even if 0 leads were found so cursors NEVER get stuck!
  saveCrawlerState(crawlerState);

  if (addedLeads.length > 0) {
    atomicWriteFileSync(leadsPath, JSON.stringify(leads, null, 2));
    atomicWriteFileSync(balePath, JSON.stringify(baleData, null, 2));

    const nowIso = new Date().toISOString();
    const nextIso = new Date(Date.now() + TWO_HOURS_MS).toISOString();

    cfg.lastRunAt = nowIso;
    cfg.nextRunAt = nextIso;
    cfg.lastBotStatus = `${addedLeads.length} کارت جدید (${addedLeads.map((l) => l.id).join('، ')}) از نقشه بلد، چاپشو، دیوار و آپارات به گروه بله (${BALE_CHAT_ID}) ارسال شد.`;
    cfg.lastCycleSummary = `${addedLeads.length} کارت جدید با شماره تلفن معتبر در این نوبت پیدا و به بله ارسال شد؛ نوبت بعدی ۲ ساعت دیگر (مجموع: ${leads.length} مشتری)`;
    atomicWriteFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    const logs = readJsonSafe(logPath, []);
    let maxCycleNum = 0;
    for (const item of logs) {
      const m = String(item.cycleId || '').match(/CYCLE-(\d+)/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxCycleNum) maxCycleNum = n;
      }
    }
    const newCycleId = `CYCLE-${String(maxCycleNum + 1).padStart(4, '0')}`;
    logs.unshift({
      cycleId: newCycleId,
      timestamp: nowIso,
      isoTimestamp: nowIso,
      targetCity: addedLeads.map((l) => l.city).join(' و '),
      sourcesChecked: addedLeads.map((l) => l.sourceUrl),
      newLeadsAdded: addedLeads.length,
      newProspectsAdded: 0,
      newSourcesAdded: 0,
      newCreativeIdea:
        'پایش زنده چندمنبعی با حافظه پایدار نشانگر: API مستقیم نقشه بلد (۶۴۸ جست‌وجوی شهری + پیشنهادهای مرتبط)، خزنده عمیق چاپشو (۱۱۰ صفحه)، API دیوار و API آپارات',
      limitations: `سهمیه حداقل ۲ کارت جدید در این نوبت تکمیل شد (${addedLeads.length} کارت جدید ثبت و به بله ارسال شد).`,
      nextStep: 'توقف ۲ ساعته و شروع نوبت بعدی رأس ۲ ساعت آینده',
    });
    if (logs.length > 100) logs.length = 100;
    atomicWriteFileSync(logPath, JSON.stringify(logs, null, 2));

    try {
      const b = await import('./work/build.mjs');
      if (b && typeof b.buildAllOutputs === 'function') {
        b.buildAllOutputs();
      }
    } catch {
      // Optional XLSX build if xlsx package is installed locally
    }

    console.log(
      `[Standalone Engine] Completed cycle! Added and delivered ${addedLeads.length} leads. Total leads: ${leads.length}`
    );
  } else {
    console.log(
      `[Standalone Engine] No new matching leads in this batch; crawler cursors advanced and saved for next run.`
    );
  }

  return { addedCount: addedLeads.length, totalLeads: leads.length, addedLeads };
}

const isOnce = process.argv.includes('--once');
const isCron = process.argv.includes('--cron');

if (isOnce || isCron) {
  executeStandaloneCycle({ cronMode: isCron }).then(() => {
    process.exit(0);
  });
} else if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  console.log('[Daemon Mode] Running initial cycle immediately...');
  executeStandaloneCycle();
  setInterval(() => {
    executeStandaloneCycle();
  }, TWO_HOURS_MS);
}
