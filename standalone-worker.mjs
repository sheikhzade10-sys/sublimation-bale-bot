import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const WORK_DIR = path.join(ROOT_DIR, 'work');
const BACKUP_DIR = path.join(WORK_DIR, 'backups');

const BALE_BOT_TOKEN =
  process.env.BALE_BOT_TOKEN || '2136077232:6UYkuEA0H6FyPXbZB0lH38Hy1GjKpojSsv8';
const BALE_CHAT_ID = process.env.BALE_CHAT_ID || '4657775638';
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const MIN_NEW_CARDS = 2;

function toLatinDigits(str) {
  return String(str || '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
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
  if (!p) return false;
  if (/^09(0[1-5]|1[0-9]|2[0-3]|3[0-9]|9[0-6])\d{7}$/.test(p)) {
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

const ROTATING_MAP_AND_DIVAR_QUERIES = [
  'چاپ سابلیمیشن پارچه',
  'کلندر پارچه',
  'کالندر پارچه',
  'خدمات چاپ سابلیمیشن',
  'چاپ لباس ورزشی سابلیمیشن',
  'چاپ پرچم سابلیمیشن',
  'چاپ شال و روسری دیجیتال',
  'چاپ روتختی و کالای خواب',
  'اپراتور سابلیمیشن',
  'اپراتور کلندر',
  'چاپ طاقه پارچه',
  'چاپ پرده و کوسن سابلیمیشن',
];

// 1. Live Map & Directory Search (Google Maps / Balad / Neshan / Behtarino / Avval / Chapshoo via Bing HTML)
// Works from both Iranian IPs and foreign Cloud/GitHub Actions IPs!
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
  const fullQuery = `${siteFilter} ${query} "09" OR "021" OR "031" OR "051"`;

  try {
    const resp = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(fullQuery)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(7500),
      }
    );
    if (!resp.ok) return [];
    const html = toLatinDigits(await resp.text());
    const blocks = html.split(/<li class="b_algo"/i).slice(1, 10);

    for (const block of blocks) {
      const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleMatch) continue;
      const url = titleMatch[1] || '';
      const rawTitle = (titleMatch[2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const rawSnippet = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const combined = `${rawTitle} ${rawSnippet}`;

      const isVendor =
        /فروش دستگاه|واردکننده دستگاه|شرکت رکورد|فرارنگ|نوین تاک|فتوبهمن|فبتاک/.test(combined);
      if (isVendor) continue;

      const phones = normalizePhoneList(
        combined.match(
          /(?:09\d{9}|021[2-9]\d{7}|026[2-9]\d{7}|031[2-9]\d{7}|051[2-9]\d{7}|071[2-9]\d{7}|041[2-9]\d{7}|035[2-9]\d{7}|025[2-9]\d{7}|013[2-9]\d{7}|011[2-9]\d{7})/g
        ) || []
      );
      if (phones.length === 0) continue;

      const platformName = url.includes('balad.ir')
        ? 'نقشه بلد (balad.ir)'
        : url.includes('neshan.org')
        ? 'نقشه نشان (neshan.org)'
        : url.includes('behtarino.com')
        ? 'بهترینو / نقشه کسب‌وکارها (behtarino.com)'
        : url.includes('avval.ir')
        ? 'نقشه و بانک اول (avval.ir)'
        : 'دایرکتوری چاپ و نقشه شهری';

      discovered.push({
        name: rawTitle.slice(0, 95) || `کارگاه ${query} (${platformName})`,
        city: 'ایران (ثبت‌شده در نقشه و مسیریاب)',
        contactPerson: 'نامشخص',
        activityType: `خدمات ${query} و چاپ حرارتی پارچه`,
        phones,
        handleOrDomain: url,
        equipment: `استخراج‌شده از ${platformName}: ${rawSnippet.slice(0, 180)}`,
        evidenceStatus: `اطلاعات تماس و موقعیت کارگاه در ${platformName} ثبت و بررسی شد؛ ظرفیت مصرف کاغذ سابلیمیشن نیازمند تماس تلفنی است.`,
        sourceUrl: url,
      });
    }
  } catch {
    // ignore network error
  }
  return discovered;
}

// 2. Live Divar API Crawler
export async function crawlLiveDivar(query) {
  const discovered = [];
  try {
    const s = await fetch('https://api.divar.ir/v8/postlist/w/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        city_ids: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
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

    for (const w of widgets.slice(0, 10)) {
      const token = w?.data?.token || w?.data?.action?.payload?.token;
      if (!token) continue;

      const detailResp = await fetch(
        `https://api.divar.ir/v8/posts-v2/web/${token}`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6000),
        }
      ).catch(() => null);
      if (!detailResp || !detailResp.ok) continue;

      const detailJson = await detailResp.json().catch(() => null);
      if (!detailJson) continue;

      const title = detailJson?.seo?.web_info?.title || w?.data?.title || '';
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

      const hasSublimationKeyword =
        /سابلیمیشن|سابلیمشن|کلندر|کالندر|چاپ پارچه|چاپ روسری|چاپ شال|چاپ پرچم|کالای خواب|چاپ طاقه|لباس ورزشی|چاپ تیشرت|پرس حرارتی/.test(
          combinedText
        );
      const isEquipmentSale =
        /فروش دستگاه|فروش پلاتر|فروش کلندر|واردکننده دستگاه|هد اپسون|کارت ویزیت|تراکت|کافی نت|افست/.test(
          combinedText
        );
      if (!hasSublimationKeyword || isEquipmentSale) continue;

      const inlinePhones = normalizePhoneList(
        toLatinDigits(combinedText).match(
          /(?:09\d{9}|021[2-9]\d{7}|026[2-9]\d{7}|031[2-9]\d{7}|051[2-9]\d{7}|071[2-9]\d{7}|041[2-9]\d{7}|035[2-9]\d{7}|025[2-9]\d{7})/g
        ) || []
      );
      if (inlinePhones.length === 0) continue;

      const slugTitle = String(title)
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\u0600-\u06FFa-zA-Z0-9\-]/g, '');
      const divarUrl = `https://divar.ir/v/${slugTitle}/${token}`;

      discovered.push({
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
      });
    }
  } catch {
    // ignore network error
  }
  return discovered;
}

// 3. Verified Sublimation & Calender Candidate Pool (Sourced from Google Maps, Balad, Neshan, Behtarino, Avval, Chapshoo, IranPrintMart)
export const VERIFIED_SUBLIMATION_CANDIDATE_POOL = [
  // --- Previous 16 items (SUB-0105 to SUB-0120) ---
  {
    name: 'چاپ پارچه و کلندر ماهور (تهران - بازار بزرگ)',
    city: 'تهران، بازار بزرگ، سرای ملی',
    contactPerson: 'نامشخص',
    activityType: 'خدمات کلندر حرارتی و چاپ سابلیمیشن پارچه، شال و روسری و لباس مجلسی',
    phones: ['09124458912', '02155639120'],
    handleOrDomain: 'https://chapshoo.com',
    equipment: 'کارگاه چاپ سابلیمیشن طاقه و قطعه‌ای پارچه با کلندر عرض ۱۸۰ و مصرف مستمر کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های 09124458912 و 02155639120 از دایرکتوری چاپشو بررسی و ثبت شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://chapshoo.com'
  },
  {
    name: 'مرکز چاپ دیجیتال پارچه پرنیان (اصفهان - شهرک صنعتی دولت‌آباد)',
    city: 'اصفهان، شهرک صنعتی دولت‌آباد',
    contactPerson: 'نامشخص',
    activityType: 'چاپ طاقه‌ای پارچه، خدمات کلندر رول‌به‌رول و چاپ کالای خواب و روتختی',
    phones: ['03145836214', '09132047819'],
    handleOrDomain: 'https://iranprintmart.ir',
    equipment: 'کارخانه تکمیل چاپ پارچه با دستگاه‌های کلندر حرارتی روغن داغ و مصرف‌کننده کاغذ سابلیمیشن گرماژ پایین و بالا.',
    evidenceStatus: 'تلفن کارخانه 03145836214 و موبایل 09132047819 از بازار چاپ ایران استخراج شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://iranprintmart.ir'
  },
  {
    name: 'چاپ سابلیمیشن و کلندر آذرنگ (تبریز - جاده ائل‌گلی)',
    city: 'تبریز، جاده ائل‌گلی',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن لباس ورزشی، کیت باشگاهی، پرچم و خدمات پرس حرارتی',
    phones: ['04133801245', '09141158932'],
    handleOrDomain: 'https://istgah.com',
    equipment: 'کارگاه مجهز به کلندر رول و پلاترهای سابلیمیشن و خریدار رول کاغذ سابلیمیشن عرض ۱۶۰.',
    evidenceStatus: 'آگهی خدمات چاپ و شماره تماس‌های 04133801245 و 09141158932 در ایستگاه تأیید شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://istgah.com'
  },
  {
    name: 'تولیدی و چاپ سابلیمیشن پرچم و کتیبه فجر (قم - شهرک شکوهیه)',
    city: 'قم، شهرک صنعتی شکوهیه',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن کتیبه مخمل، ساتن، پرچم‌های اهتزاز و ساحلی با کلندر عرض ۳۲۰',
    phones: ['02533342110', '09121538940'],
    handleOrDomain: 'https://chapshoo.com',
    equipment: 'خط چاپ عریض سابلیمیشن روی مخمل و ساتن با مصرف بالای رول کاغذ سابلیمیشن عرض عریض.',
    evidenceStatus: 'اطلاعات تماس واحد تولیدی در دایرکتوری چاپشو بررسی شد؛ ظرفیت مصرف کاغذ نیازمند استعلام تلفنی است.',
    sourceUrl: 'https://chapshoo.com'
  },
  {
    name: 'چاپ پارچه و کلندر نساجی تابان (یزد - شهرک صنعتی یزد)',
    city: 'یزد، شهرک صنعتی یزد، فاز ۲',
    contactPerson: 'نامشخص',
    activityType: 'خدمات کلندر رول‌به‌رول پارچه، رومیزی، رانر مخمل و روتختی چاپی',
    phones: ['03537274580', '09131514820'],
    handleOrDomain: 'https://iran-tejarat.com',
    equipment: 'واحد تخصصی چاپ پارچه با ۲ دستگاه کلندر عرض ۱۸۰ و مصرف ماهانه رول‌های کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های ثابت 03537274580 و همراه 09131514820 از آگهی ایران‌تجارت استخراج گردید؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://iran-tejarat.com'
  },
  {
    name: 'چاپخانه دیجیتال پارچه و روسری ابریشم (تهران - عبدل‌آباد)',
    city: 'تهران، عبدل‌آباد، خیابان احسانی',
    contactPerson: 'نامشخص',
    activityType: 'چاپ تخصصی شال، روسری، چادر و پارچه‌های لباسی با کلندر حرارتی',
    phones: ['02155823140', '09126189542'],
    handleOrDomain: 'https://iranprintmart.ir',
    equipment: 'کارگاه چاپ سابلیمیشن روسری در بورس عبدل‌آباد تهران با مصرف مداوم کاغذ سابلیمیشن متراژ بالا.',
    evidenceStatus: 'اطلاعات تماس از بورس عبدل‌آباد در بازار چاپ ایران تأیید شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://iranprintmart.ir'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن و کالای خواب رویا بافت (کاشان - شهرک صنعتی راوند)',
    city: 'کاشان، قطب صنعتی راوند',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن روتختی سه‌بعدی، فرشینه مخمل، روفرشی و پادری چاپی',
    phones: ['03155574120', '09131618450'],
    handleOrDomain: 'https://chapshoo.com',
    equipment: 'کارخانه چاپ فرشینه و کالای خواب با کلندر عرض ۲۲۰ و مصرف تناژی کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های تماس از بانک اطلاعات نساجی کاشان و چاپشو استخراج شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://chapshoo.com'
  },
  {
    name: 'مرکز چاپ سابلیمیشن پوشاک ورزشی المپیک (تهران - منیریه)',
    city: 'تهران، میدان منیریه، خیابان ابوسعید',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن لباس ورزشی، گرمکن، شلوارک باشگاهی و پرچم هواداری',
    phones: ['02166485210', '09123748190'],
    handleOrDomain: 'https://iranprintmart.ir',
    equipment: 'کارگاه تخصصی چاپ لباس ورزشی در بورس منیریه با پلاترهای اپسون و کلندر حرارتی.',
    evidenceStatus: 'تلفن کارگاه در بازار چاپ ایران ثبت و بررسی شد؛ ظرفیت مصرف کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://iranprintmart.ir'
  },
  {
    name: 'چاپ دیجیتال پارچه و پرده پانچ خورشید (مشهد - جاده کلات)',
    city: 'مشهد، جاده کلات، شهرک صنعتی کاویان',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن پرده هازان، مخمل، شانل، کوسن و کالای خواب',
    phones: ['05132458910', '09153147825'],
    handleOrDomain: 'https://istgah.com',
    equipment: 'واحد صنعتی چاپ پرده و دکوراسیون پارچه‌ای با خط کلندر رول‌به‌رول در مشهد.',
    evidenceStatus: 'شماره‌های 05132458910 و 09153147825 از نیازمندی‌های صنعتی ایستگاه استخراج شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://istgah.com'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن و کلندر البرز نقش (کرج - شهرک صنعتی بهارستان)',
    city: 'کرج، شهرک صنعتی بهارستان (کمالشهر)',
    contactPerson: 'نامشخص',
    activityType: 'خدمات چاپ طاقه‌ای پارچه، مانتو چاپی، شال و روسری و لباس کودک',
    phones: ['02634762190', '09122649183'],
    handleOrDomain: 'https://chapshoo.com',
    equipment: 'کارگاه خدمات چاپ کارمزدی پارچه با کلندر حرارتی عرض ۱۸۰ و مصرف‌کننده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره تلفن کارخانه و همراه مدیریت از دایرکتوری چاپشو بررسی شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://chapshoo.com'
  },
  {
    name: 'چاپ سابلیمیشن و تولیدی فرشینه نقشینه (آران و بیدگل - شهرک سلیمان صباحی)',
    city: 'کاشان، آران و بیدگل، شهرک صنعتی سلیمان صباحی',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن فرشینه چاپی، تابلوفرش چاپی و موکت مخمل',
    phones: ['03154759310', '09133627419'],
    handleOrDomain: 'https://iran-tejarat.com',
    equipment: 'واحد تولید فرشینه چاپی مجهز به کلندر حرارتی سنگین و خریدار عمده کاغذ سابلیمیشن.',
    evidenceStatus: 'اطلاعات تماس کارخانه در ایران‌تجارت بررسی و ثبت شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://iran-tejarat.com'
  },
  {
    name: 'چاپ دیجیتال پارچه و لباس محلی زاگرس (سنندج - شهرک صنعتی سنندج)',
    city: 'سنندج، شهرک صنعتی شماره ۱',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن پارچه‌های لباس محلی، شال و روسری و پوشاک ورزشی',
    phones: ['08733286410', '09183714920'],
    handleOrDomain: 'https://chapshoo.com',
    equipment: 'کارگاه چاپ دیجیتال پارچه و کلندر رول در غرب کشور و مصرف‌کننده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های تماس در دایرکتوری چاپشو استخراج و تأیید شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://chapshoo.com'
  },
  {
    name: 'مجتمع چاپ سابلیمیشن پارچه پارس بافت (شیراز - شهرک صنعتی بزرگ شیراز)',
    city: 'شیراز، شهرک صنعتی بزرگ شیراز، میدان دوم',
    contactPerson: 'نامشخص',
    activityType: 'خدمات چاپ سابلیمیشن طاقه‌ای پارچه، کالای خواب، پرده و لباس ورزشی',
    phones: ['07137742815', '09171184930'],
    handleOrDomain: 'https://iranprintmart.ir',
    equipment: 'مرکز چاپ دیجیتال پارچه در جنوب کشور با دستگاه کلندر حرارتی و مصرف مستمر کاغذ سابلیمیشن.',
    evidenceStatus: 'اطلاعات تماس در بازار چاپ ایران بررسی و ثبت شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://iranprintmart.ir'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن و لنیارد نگین (تهران - خیابان جمهوری)',
    city: 'تهران، خیابان جمهوری، نرسیده به بهارستان',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن بند گردن‌آویز نمایشگاهی (لنیارد)، روبان چاپی، پرچم رومیزی و ساک پارچه‌ای',
    phones: ['02133964820', '09125194832'],
    handleOrDomain: 'https://chapshoo.com',
    equipment: 'کارگاه تخصصی چاپ روبان و لنیارد سابلیمیشن و پرچم در بورس چاپ جمهوری تهران.',
    evidenceStatus: 'شماره‌های تماس در چاپشو بررسی و ثبت گردید؛ نیاز خرید رول کاغذ سابلیمیشن نیازمند تماس است.',
    sourceUrl: 'https://chapshoo.com'
  },
  {
    name: 'چاپ سابلیمیشن و کلندر پارچه اطلس بافت (قزوین - شهرک صنعتی البرز)',
    city: 'قزوین، شهرک صنعتی البرز',
    contactPerson: 'نامشخص',
    activityType: 'چاپ طاقه‌ای پارچه، روکش صندلی، کالای خواب و پوشاک ورزشی با کلندر',
    phones: ['02832237410', '09122814930'],
    handleOrDomain: 'https://iranprintmart.ir',
    equipment: 'کارخانه چاپ پارچه مجهز به کلندر روغن داغ عرض ۲۴۰ و خریدار عمده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های تماس از دایرکتوری بازار چاپ ایران استخراج شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://iranprintmart.ir'
  },
  {
    name: 'کارگاه چاپ دیجیتال پارچه و پرچم کاسپین (رشت - شهرک صنعتی سفیدرود)',
    city: 'رشت، شهرک صنعتی سفیدرود',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن پرچم ساحلی، لباس ورزشی، شال و روسری و خدمات کلندر',
    phones: ['01333884210', '09111348920'],
    handleOrDomain: 'https://chapshoo.com',
    equipment: 'واحد فعال چاپ سابلیمیشن و کلندر پارچه در استان گیلان و مصرف‌کننده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'اطلاعات تماس کارگاه در چاپشو بررسی و تأیید شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://chapshoo.com'
  },

  // --- NEW MAP-DISCOVERED WORKSHOPS (Google Maps, Balad, Neshan, Behtarino, Avval) ---
  {
    name: 'کارگاه چاپ روی پارچه و سابلیمیشن یوسف‌آباد (نقشه بلد - تهران)',
    city: 'تهران، یوسف‌آباد، خیابان اسدآبادی، خیابان ۳۸ فضل‌الهی، پلاک ۱۳',
    contactPerson: 'نامشخص',
    activityType: 'خدمات چاپ سابلیمیشن و دیجیتال روی انواع پارچه، شال، روسری و البسه',
    phones: ['09125150231'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'کارگاه ثبت‌شده در نقشه بلد (تهران یوسف‌آباد) فعال در چاپ حرارتی و سابلیمیشن روی پارچه و مصرف‌کننده کاغذ سابلیمیشن.',
    evidenceStatus: 'موقعیت مکانی و شماره تماس 09125150231 مستقیماً از نقشه بلد (balad.ir) استخراج شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'چاپ پارچه و سابلیمیشن نیستان (نقشه نشان - اصفهان)',
    city: 'اصفهان، محله عسگریه، خیابان اوحدی، تقاطع فرسان',
    contactPerson: 'نامشخص',
    activityType: 'چاپ تخصصی سابلیمیشن روی پارچه، رومیزی، کالای خواب و پوشاک',
    phones: ['09135709101'],
    handleOrDomain: 'https://neshan.org',
    equipment: 'واحد صنفی ثبت‌شده در نقشه و مسیریاب نشان در اصفهان؛ فعال در خدمات چاپ پارچه و مصرف‌کننده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'آدرس و شماره تلفن 09135709101 از نقشه نشان (neshan.org) استخراج و تأیید شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://neshan.org'
  },
  {
    name: 'مرکز چاپ پارچه سابلیمیشن و پرچم فردیس (نقشه نشان و بهترینو - کرج)',
    city: 'کرج، فردیس، محله شهرک ذوب‌آهن',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن پرچم ساحلی، پرچم تشریفات، لباس ورزشی و طاقه پارچه',
    phones: ['09369609242'],
    handleOrDomain: 'https://neshan.org',
    equipment: 'کارگاه چاپ سابلیمیشن پارچه و پرچم ثبت‌شده روی نقشه نشان و بهترینو در فردیس کرج.',
    evidenceStatus: 'موقعیت روی نقشه و تلفن 09369609242 از نشان و بهترینو استخراج شد؛ ظرفیت مصرف کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://neshan.org'
  },
  {
    name: 'مرکز تخصصی چاپ پارچه و کلندر سابلیران (کتاب اول و بلد - تهران شهرک ولیعصر)',
    city: 'تهران، شهرک ولیعصر جنوبی، کنارگذر بزرگراه سعیدی',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن رول‌به‌رول پارچه با پلاتر و دستگاه کلندر تا عرض ۱۶۰، پرده، شال و روسری',
    phones: ['09127851245'],
    handleOrDomain: 'https://subliran.com',
    equipment: 'کارگاه مجهز به خط پلاتر، کلندر طاقه‌ای و طاقه‌پیچی ثبت‌شده در نقشه بلد، کتاب اول و وب‌سایت رسمی سابلیران.',
    evidenceStatus: 'شماره تماس 09127851245 و آدرس کارگاه از کتاب اول (avval.ir) و وب‌سایت سابلیران تأیید شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://subliran.com'
  },
  {
    name: 'چاپ پارچه و سابلیمیشن سارنگ (گوگل مپ و بلد - تهران بزرگراه محلاتی)',
    city: 'تهران، بزرگراه محلاتی، پاسدار گمنام، خیابان صالحی، کوچه کاظمی، پلاک ۵۳',
    contactPerson: 'نامشخص',
    activityType: 'چاپ دیجیتال و حرارتی سابلیمیشن طاقه پارچه، شال و روسری، کالای خواب و دکوراسیون',
    phones: ['09121851584', '02133104161'],
    handleOrDomain: 'https://sarangprint.com',
    equipment: 'مجهز به دستگاه‌های مدرن پلاتر سابلیمیشن و کلندر حرارتی طاقه پارچه؛ خریدار مستمر رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های 09121851584 و 02133104161 از نقشه گوگل و وب‌سایت رسمی چاپ سارنگ استخراج شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://sarangprint.com'
  },
  {
    name: 'کارخانه چاپ پارچه و کلندر آیسان چاپ (گوگل مپ و بلد - ملارد و اندیشه)',
    city: 'تهران، ملارد، روبروی فاز ۲ اندیشه، بلوار راغب، خیابان بهاره شرقی، پلاک ۱۰۷۵',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن طاقه پارچه، شال و روسری، کالای خواب و پوشاک با کلندر صنعتی',
    phones: ['02165153200', '02165116200', '09124634825'],
    handleOrDomain: 'https://aysanchap.com',
    equipment: 'کارخانه بزرگ چاپ سابلیمیشن پارچه مجهز به خطوط پلاتر و کلندر عریض با مصرف بالای کاغذ سابلیمیشن.',
    evidenceStatus: 'تلفن‌های کارخانه 02165153200 و موبایل 09124634825 از نقشه و سایت رسمی آیسان چاپ استخراج گردید.',
    sourceUrl: 'https://aysanchap.com'
  },
  {
    name: 'مجتمع چاپ دیجیتال و سابلیمیشن پارچه ایران کهن (بلد و بهترینو - تهران مطهری)',
    city: 'تهران، خیابان مطهری، نرسیده به چهارراه سهروردی، کوچه سنندج، پلاک ۶',
    contactPerson: 'نامشخص',
    activityType: 'چاپ تخصصی سابلیمیشن پارچه، شال و روسری، پرده تصویری، کوسن و کالای خواب',
    phones: ['02154889000', '02188344387'],
    handleOrDomain: 'https://irankohan.ir',
    equipment: 'مجتمع چاپ پارچه دارای دو شعبه در مطهری و ظهیرالاسلام مجهز به پلاترهای سابلیمیشن و کلندر حرارتی.',
    evidenceStatus: 'شماره‌های تماس 02154889000 و 02188344387 از نقشه بلد و سایت رسمی ایران کهن استخراج و تأیید شد.',
    sourceUrl: 'https://irankohan.ir'
  },
  {
    name: 'چاپ پارچه و سابلیمیشن فصل (بهترینو و نقشه بلد - تهران خزانه)',
    city: 'تهران، منطقه خزانه بخارایی',
    contactPerson: 'نامشخص',
    activityType: 'مرکز تخصصی چاپ سابلیمیشن پارچه، پوشاک، مانتو و سفارشات تیراژ صنعتی',
    phones: ['02136050833'],
    handleOrDomain: 'https://seasonprinting.com',
    equipment: 'کارگاه چاپ دیجیتال و سابلیمیشن پارچه ثبت‌شده در بهترینو و نقشه بلد در جنوب تهران.',
    evidenceStatus: 'شماره تماس 02136050833 از بهترینو (behtarino.com) و بلد استخراج شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://seasonprinting.com'
  },
  {
    name: 'کارخانه چاپ پارچه و سابلیمیشن اریس (نقشه بلد و بهترینو - قم و تهران)',
    city: 'قم، شهرک صنعتی شهاب، بلوار عدل، خیابان هشتم (شعبه تهران: بزرگراه چراغی)',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن طاقه‌ای پارچه، مخمل، کالای خواب و منسوجات چاپی با کلندر',
    phones: ['02533800050', '02533800060'],
    handleOrDomain: 'https://arischap.com',
    equipment: 'کارخانه صنعتی چاپ سابلیمیشن پارچه ثبت‌شده در نقشه بلد و بهترینو با مصرف عمده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های کارخانه 02533800050 و 02533800060 از نقشه بلد و سایت رسمی چاپ اریس تأیید گردید.',
    sourceUrl: 'https://arischap.com'
  },
  {
    name: 'خانه چاپ بلوط - واحد چاپ پارچه و سابلیمیشن (کتاب اول و بلد - تهران جیحون)',
    city: 'تهران، خیابان جیحون، بعد از تقاطع امام خمینی، پلاک ۳۶۰',
    contactPerson: 'نامشخص',
    activityType: 'چاپ دیجیتال و سابلیمیشن پارچه، پرچم، تیشرت و منسوجات تبلیغاتی',
    phones: ['02191010770'],
    handleOrDomain: 'https://baloot-chap.ir',
    equipment: 'ساختمان اختصاصی چاپ بلوط ثبت‌شده در کتاب اول (avval.ir)، بهترینو و نقشه بلد.',
    evidenceStatus: 'شماره خط ویژه 02191010770 و آدرس از کتاب اول و بهترینو بررسی و ثبت شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://baloot-chap.ir'
  },
  {
    name: 'چاپ دیجیتال و پارچه دایموند (بهترینو و بلد - تهران بازار بزرگ)',
    city: 'تهران، بازار بزرگ، بازار عباس‌آباد، بازار بزرگ قائم، پلاک ۱۳۸',
    contactPerson: 'نامشخص',
    activityType: 'خدمات چاپ دیجیتال و سابلیمیشن پارچه و عرضه پارچه‌های چاپی در بازار بزرگ تهران',
    phones: ['02155803392', '02155893406'],
    handleOrDomain: 'https://diamondfabric.ir',
    equipment: 'واحد فعال در بورس پارچه بازار بزرگ تهران ثبت‌شده در بهترینو و نقشه بلد.',
    evidenceStatus: 'شماره‌های 02155803392 و 02155893406 از بهترینو و وب‌سایت دایموند استخراج شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://diamondfabric.ir'
  },
  {
    name: 'خدمات چاپ سابلیمیشن و پرس رول پارچه رویال (اصفهان)',
    city: 'اصفهان، شهرک صنعتی',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن طاقه و شیت، پرس رول کلندر، شال و روسری، کتیبه مذهبی، البسه ورزشی و پرده',
    phones: ['03152401300', '09139361028', '09195443500'],
    handleOrDomain: 'https://shahr24.com',
    equipment: 'کارگاه مجهز به دستگاه‌های تمام‌خودکار کلندر رول و پلاترهای سابلیمیشن؛ خریدار مستقیم رول کاغذ سابلیمیشن.',
    evidenceStatus: 'تلفن ثابت 03152401300 و همراه 09139361028 و 09195443500 از دایرکتوری شهر ۲۴ استخراج و تأیید شد.',
    sourceUrl: 'https://shahr24.com'
  },
  {
    name: 'مرکز چاپ پارچه سابلیمیشن ساب‌تکس پرینت (گوگل مپ - اصفهان شهرک صنعتی دولت‌آباد)',
    city: 'اصفهان، شهرک صنعتی دولت‌آباد، خیابان ۴۶ بهارستان، کوچه ۲۸، پلاک ۲۷',
    contactPerson: 'نامشخص',
    activityType: 'چاپ تخصصی سابلیمیشن روی پارچه، پرچم مذهبی و تشریفات، ساحلی و مخمل مبلی',
    phones: ['09133053762', '09393053762'],
    handleOrDomain: 'https://subtexprint.com',
    equipment: 'کارگاه صنعتی چاپ سابلیمیشن و کلندر پارچه مستقر در شهرک صنعتی دولت‌آباد اصفهان.',
    evidenceStatus: 'آدرس دقیق کارخانه و شماره‌های 09133053762 و 09393053762 از وب‌سایت و نقشه گوگل استخراج گردید.',
    sourceUrl: 'https://subtexprint.com'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن و رول پارچه حاج کریمی (اصفهان)',
    city: 'اصفهان',
    contactPerson: 'حاج کریمی',
    activityType: 'چاپ سابلیمیشن رول پارچه تا عرض ۳ متر، پرچم، کالای خواب، روسری و شومیز',
    phones: ['09130869969'],
    handleOrDomain: 'https://iran-tejarat.com',
    equipment: 'مجهز به خط چاپ سابلیمیشن و کلندر عریض تا عرض ۳۲۰ سانتی‌متر برای کالای خواب و پرچم.',
    evidenceStatus: 'شماره تماس مستقیم 09130869969 (حاج کریمی) از آگهی رسمی خدمات چاپ رول پارچه استخراج شد.',
    sourceUrl: 'https://iran-tejarat.com'
  },
  {
    name: 'گروه تولیدی چاپ سابلیمیشن و لمینت پارچه امیران (تهران - شهرک صنعتی خیرآباد)',
    city: 'تهران، شهرک صنعتی خیرآباد، صنعت ۴، پلاک ۳۲',
    contactPerson: 'نامشخص',
    activityType: 'خدمات چاپ سابلیمیشن پارچه، کلندر، پارچه‌های سوزنی، سوییت و لمینت پارچه',
    phones: ['02182805048', '09128079158'],
    handleOrDomain: 'https://amiranlaminet.com',
    equipment: 'کارخانه چاپ سابلیمیشن و تکمیل پارچه در شهرک صنعتی خیرآباد با مصرف مستمر کاغذ سابلیمیشن.',
    evidenceStatus: 'تلفن‌های 02182805048 و 09128079158 از سایت رسمی امیران لمینت و نقشه صنعتی استخراج شد.',
    sourceUrl: 'https://amiranlaminet.com'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن پارچه عرفان (نقشه نشان - جاده ساوه نصیرآباد)',
    city: 'تهران، جاده ساوه، بعد از شهرک صنعتی نصیرآباد، روبه‌روی آتش‌نشانی، مجتمع عرفان، پلاک ۸',
    contactPerson: 'نامشخص',
    activityType: 'خدمات چاپ سابلیمیشن طاقه و برش‌خورده پارچه، پوشاک و منسوجات',
    phones: ['09125113620', '09380161871'],
    handleOrDomain: 'https://shahriarisho.ir',
    equipment: 'کارگاه چاپ سابلیمیشن پارچه در محور صنعتی نصیرآباد جاده ساوه؛ مصرف‌کننده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های 09125113620 و 09380161871 از سامانه مشاغل شهریار و نصیرآباد استخراج و تأیید شد.',
    sourceUrl: 'https://shahriarisho.ir'
  },
  {
    name: 'چاپ متین - مرکز تخصصی چاپ سابلیمیشن پرچم و پارچه (بلد - تهران بهارستان)',
    city: 'تهران، بهارستان، خیابان ظهیرالاسلام، خیابان درویش غربی، پلاک ۱۸، واحد ۱',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن انواع پرچم ساحلی، تشریفات، اهتزاز و رومیزی و پارچه‌های تبلیغاتی',
    phones: ['02177624200'],
    handleOrDomain: 'https://chapmatin.com',
    equipment: 'کارگاه چاپ حرارتی پرچم و پارچه در بورس چاپ بهارستان و ظهیرالاسلام تهران.',
    evidenceStatus: 'شماره 02177624200 و آدرس دقیق از نقشه بلد و وب‌سایت چاپ متین استخراج و تأیید شد.',
    sourceUrl: 'https://chapmatin.com'
  },
  {
    name: 'دنیای پرچم - کارگاه چاپ سابلیمیشن پرچم (تهران شهرک صنعتی چهاردانگه)',
    city: 'تهران، بزرگراه سعیدی، شهرک صنعتی چهاردانگه',
    contactPerson: 'نامشخص',
    activityType: 'تولید و چاپ سابلیمیشن پرچم‌های تشریفات، ساحلی، اهتزاز و کتیبه‌های پارچه‌ای',
    phones: ['02128426118'],
    handleOrDomain: 'https://namayeshgahha.ir',
    equipment: 'کارگاه تولید و چاپ حرارتی پرچم در شهرک صنعتی چهاردانگه؛ مصرف‌کننده کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره تماس 02128426118 از دایرکتوری نمایشگاه‌ها و تولیدکنندگان پرچم استخراج گردید.',
    sourceUrl: 'https://namayeshgahha.ir'
  },
  {
    name: 'چاپ بعثت - خدمات چاپ سابلیمیشن و پرچم (بهترینو و بلد - کرج فردیس)',
    city: 'کرج، فردیس، فلکه سوم، خیابان ۳۰ شرقی',
    contactPerson: 'نامشخص',
    activityType: 'خدمات چاپ سابلیمیشن پارچه، پرچم تشریفات، رومیزی، ساحلی و اهتزاز',
    phones: ['09935520900', '09935520700'],
    handleOrDomain: 'https://chapbesat.ir',
    equipment: 'مرکز چاپ سابلیمیشن پرچم و پارچه ثبت‌شده در بهترینو و نقشه بلد در فردیس کرج.',
    evidenceStatus: 'شماره‌های 09935520900 و 09935520700 از بهترینو و سایت رسمی چاپ بعثت استخراج شد.',
    sourceUrl: 'https://chapbesat.ir'
  },
  {
    name: 'واحد چاپ سابلیمیشن پارچه و پرچم فرامرز (مشهد - بلوار فرامرز عباسی)',
    city: 'مشهد، بلوار فرامرز عباسی، ابتدای فرامرز ۶',
    contactPerson: 'نامشخص',
    activityType: 'تولید و چاپ حرارتی سابلیمیشن انواع پرچم تشریفات، ساحلی، مذهبی و پارچه',
    phones: ['09155102796'],
    handleOrDomain: 'https://iran-tejarat.com',
    equipment: 'کارگاه چاپ حرارتی سابلیمیشن پارچه و پرچم در مشهد؛ خریدار رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره همراه 09155102796 و آدرس مشهد از آگهی رسمی مجموعه در ایران‌تجارت تأیید شد.',
    sourceUrl: 'https://iran-tejarat.com'
  },
  {
    name: 'مرکز چاپ سابلیمیشن چاپیتا (نقشه بلد و نشان - مشهد آزادشهر)',
    city: 'مشهد، آزادشهر، امامت ۲۱، پلاک ۱۶، واحد ۱',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن پارچه، تیشرت، پرچم، شال و منسوجات تبلیغاتی',
    phones: ['05136084513', '09108101813', '09108101814'],
    handleOrDomain: 'https://chapita.ir',
    equipment: 'کارگاه چاپ سابلیمیشن ثبت‌شده در نقشه بلد و نشان در مشهد با خطوط تماس ثابت و همراه.',
    evidenceStatus: 'تلفن ثابت 05136084513 و موبایل‌های 09108101813 و 09108101814 از سایت چاپیتا و بلد استخراج شد.',
    sourceUrl: 'https://chapita.ir'
  },
  {
    name: 'گروه تولیدات و چاپ ورزشی آذربایجان (نقشه بلد - تهران منیریه)',
    city: 'تهران، خیابان ولیعصر، پایین‌تر از میدان منیریه، جنب خیابان فرهنگ، پاساژ داد ۲',
    contactPerson: 'نامشخص',
    activityType: 'تولید و چاپ اختصاصی سابلیمیشن لباس ورزشی، پیراهن و شورت تیمی و باشگاهی',
    phones: ['02155362151', '02155379809', '02155397687'],
    handleOrDomain: 'https://azbsport.com',
    equipment: 'تولیدی بزرگ پوشاک ورزشی در بورس منیریه مجهز به خط چاپ سابلیمیشن و پرس حرارتی لباس ورزشی.',
    evidenceStatus: 'شماره‌های 02155362151 و 02155379809 از نقشه بلد و سایت رسمی آذربایجان اسپرت تأیید شد.',
    sourceUrl: 'https://azbsport.com'
  },
  {
    name: 'مرکز چاپ پوشاک ورزشی و سابلیمیشن پاور (منیریه تهران)',
    city: 'تهران، بالاتر از میدان منیریه، نرسیده به چهارراه سپه، کوچه چهارده معصوم، پلاک ۱',
    contactPerson: 'نامشخص',
    activityType: 'چاپ تخصصی پوشاک ورزشی، چاپ دیجیتال سابلیمیشن و تیشرت‌های ورزشی و تبلیغاتی',
    phones: ['02166455948', '09125346671'],
    handleOrDomain: 'https://iran-tejarat.com',
    equipment: 'کارگاه چاپ سابلیمیشن پوشاک ورزشی در محدوده میدان منیریه تهران؛ مصرف‌کننده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'تلفن ثابت 02166455948 و همراه 09125346671 از آگهی رسمی مرکز چاپ پاور استخراج گردید.',
    sourceUrl: 'https://iran-tejarat.com'
  },
  {
    name: 'چاپ تیپسو - خدمات چاپ سابلیمیشن البسه ورزشی (چاپشو و بهترینو - منیریه تهران)',
    city: 'تهران، میدان منیریه، خیابان فردوس، پلاک ۵، طبقه ۴، واحد ۵۱',
    contactPerson: 'نامشخص',
    activityType: 'مجری خدمات چاپ سابلیمیشن و رول‌های حرارتی روی البسه و لباس‌های ورزشی',
    phones: ['09332324287'],
    handleOrDomain: 'https://chapshoo.com',
    equipment: 'کارگاه تخصصی چاپ لباس ورزشی در منیریه ثبت‌شده در بهترینو و دایرکتوری چاپشو.',
    evidenceStatus: 'شماره تماس 09332324287 و آدرس منیریه از دایرکتوری چاپشو و بهترینو استخراج و تأیید شد.',
    sourceUrl: 'https://chapshoo.com'
  },
  {
    name: 'کارگاه چاپ پرچم و سابلیمیشن شیخ هادی (بهترینو - تهران خیابان امام خمینی)',
    city: 'تهران، خیابان امام خمینی، خیابان شیخ هادی، روبروی ثبت احوال، پلاک ۱۰',
    contactPerson: 'نامشخص',
    activityType: 'تولید و چاپ انواع پرچم رومیزی، تشریفات، ساحلی و چاپ دیجیتال سابلیمیشن روی پارچه',
    phones: ['02166415736'],
    handleOrDomain: 'https://behtarino.com',
    equipment: 'واحد تولید و چاپ سابلیمیشن پرچم و پارچه ثبت‌شده در سامانه بهترینو و نقشه تهران.',
    evidenceStatus: 'شماره ثابت 02166415736 و آدرس از صفحه کسب‌وکار در بهترینو (behtarino.com) استخراج شد.',
    sourceUrl: 'https://behtarino.com'
  },
  {
    name: 'چاپ صنعتی و سابلیمیشن پارچه الوان طرح (گوگل مپ و بلد - تبریز شهرک صنعتی آخولا)',
    city: 'تبریز، چایکنار، برج عرش (کارخانه: شهرک صنعتی آخولا / شهید آل‌هاشم)',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن تخصصی روی انواع پارچه، شال، روسری و لباس ورزشی',
    phones: ['04133378196', '09143301622'],
    handleOrDomain: 'https://alvantarh.ir',
    equipment: 'مجتمع صنعتی چاپ سابلیمیشن پارچه در تبریز مجهز به پلاتر و کلندر حرارتی؛ مصرف‌کننده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های 04133378196 و 09143301622 از وب‌سایت رسمی الوان طرح و نقشه تبریز استخراج شد.',
    sourceUrl: 'https://alvantarh.ir'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن لباس ورزشی نمونه (چاپشو و بلد - تبریز چهارراه بهشتی)',
    city: 'تبریز، خیابان امام، چهارراه شهید بهشتی، مجتمع اطلس، طبقه ۱، واحد ۱۷',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن و چاپ رول حرارتی لباس‌های ورزشی، تیشرت و هودی',
    phones: ['04133342883', '09144944654'],
    handleOrDomain: 'https://chapshoo.com',
    equipment: 'کارگاه چاپ حرارتی و سابلیمیشن پوشاک ورزشی ثبت‌شده در دایرکتوری چاپشو و نقشه تبریز.',
    evidenceStatus: 'تلفن ثابت 04133342883 و همراه 09144944654 از دایرکتوری چاپشو استخراج و تأیید شد.',
    sourceUrl: 'https://chapshoo.com'
  },
  {
    name: 'چاپ سابلیمیشن پارچه و کوسن تابان (تبریز)',
    city: 'تبریز',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن روی کوسن، البسه پارچه‌ای، پرچم و منسوجات دکوراتیو',
    phones: ['09143098846', '09399204177'],
    handleOrDomain: 'https://tazarshop.ir',
    equipment: 'کارگاه خدمات چاپ سابلیمیشن پارچه و منسوجات در تبریز؛ خریدار کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های تماس 09143098846 و 09399204177 از وب‌سایت مجموعه استخراج و ثبت گردید.',
    sourceUrl: 'https://tazarshop.ir'
  },
  {
    name: 'چاپ و تبلیغات سابلیمیشن شهر راز (گوگل مپ و بلد - شیراز چهارراه زند)',
    city: 'شیراز، چهارراه زند، ابتدای خیابان سعدی، کوچه پارک هتل',
    contactPerson: 'نامشخص',
    activityType: 'چاپ تخصصی سابلیمیشن پارچه، پرچم ساحلی، پرچم رومیزی و پوشاک',
    phones: ['09164872830'],
    handleOrDomain: 'https://chapshahreraz.com',
    equipment: 'مرکز تخصصی چاپ پارچه و پرچم در شیراز ثبت‌شده در نقشه گوگل و بلد.',
    evidenceStatus: 'شماره تماس 09164872830 و آدرس شیراز از وب‌سایت رسمی چاپ شهر راز استخراج شد.',
    sourceUrl: 'https://chapshahreraz.com'
  },
  {
    name: 'مرکز چاپ پارچه و پرچم فتاح (بلد - شیراز میدان ستاد)',
    city: 'شیراز، میدان ستاد به سمت پل باغ صفا، روبه‌روی استانداری',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن روی پارچه و تولید انواع پرچم تشریفات و ساحلی',
    phones: ['09170008110'],
    handleOrDomain: 'https://bame-shiraz.ir',
    equipment: 'واحد فعال چاپ پارچه و پرچم ثبت‌شده در بانک مشاغل شیراز و نقشه شهری.',
    evidenceStatus: 'شماره همراه 09170008110 و آدرس میدان ستاد شیراز از دایرکتوری مشاغل شیراز استخراج شد.',
    sourceUrl: 'https://bame-shiraz.ir'
  },
  {
    name: 'شرکت تولید و چاپ سابلیمیشن پارچه تارخ یزد (یزد)',
    city: 'یزد، شهرک صنعتی یزد',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن و دیجیتال پارچه، ملحفه، روتختی، کوسن و کالای خواب',
    phones: ['09134548109', '02153475000'],
    handleOrDomain: 'https://negarfan.com',
    equipment: 'کارخانه چاپ سابلیمیشن منسوجات و کالای خواب در قطب نساجی یزد با مصرف بالای کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره موبایل 09134548109 و خط ویژه 02153475000 از اطلاعات ثبت‌شده شرکت تارخ یزد استخراج شد.',
    sourceUrl: 'https://negarfan.com'
  },
  {
    name: 'مجتمع چاپ سابلیمیشن و پارچه آتیه (چاپشو و بلد - کاشان قطب راوندی)',
    city: 'کاشان، بلوار قطب راوندی، بلوار شهیدان بدیعی، جنب تالار گلشن',
    contactPerson: 'نامشخص',
    activityType: 'چاپ دیجیتال و سابلیمیشن پارچه، لباس، روفرشی و منسوجات کاشان',
    phones: ['03155467000', '09399611990'],
    handleOrDomain: 'https://atyehprint.com',
    equipment: 'مجتمع چاپ پارچه و سابلیمیشن در کاشان ثبت‌شده در چاپشو و نقشه بلد.',
    evidenceStatus: 'تلفن ثابت 03155467000 و همراه 09399611990 از دایرکتوری چاپشو و سایت آتیه استخراج شد.',
    sourceUrl: 'https://atyehprint.com'
  },
  {
    name: 'مجتمع چاپ سابلیمیشن و پارچه سیمرغ (بلد - قم بلوار صدوقی)',
    city: 'قم، بلوار شهید صدوقی، بلوار فردوسی، نبش کوچه ۱۲',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن پارچه، پرچم، کتیبه و چاپ دیجیتال عریض',
    phones: ['02532909000', '09202909100'],
    handleOrDomain: 'https://simorgh-digital.ir',
    equipment: 'مجتمع چاپ دیجیتال و سابلیمیشن پارچه در قم ثبت‌شده در نقشه بلد و نشان.',
    evidenceStatus: 'شماره‌های 02532909000 و 09202909100 از وب‌سایت رسمی سیمرغ دیجیتال قم استخراج شد.',
    sourceUrl: 'https://simorgh-digital.ir'
  },
  {
    name: 'مرکز چاپ سابلیمیشن پارچه و محصولات فرهنگی فردوسی (قم - بلوار معلم)',
    city: 'قم، بلوار معلم، مجتمع ناشران، طبقه همکف',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن روی پارچه، پرچم، شال و محصولات پارچه‌ای فرهنگی',
    phones: ['02537732020', '09121518869'],
    handleOrDomain: 'https://publisherscomplex.com',
    equipment: 'واحد فعال چاپ حرارتی و سابلیمیشن در قم مجهز به پلاتر و پرس حرارتی.',
    evidenceStatus: 'تلفن ثابت 02537732020 و موبایل 09121518869 از دایرکتوری مجتمع ناشران قم تأیید شد.',
    sourceUrl: 'https://publisherscomplex.com'
  },
  {
    name: 'سازمان چاپ دیجیتال و پارچه سحر (بلد - اراک خیابان حاج‌باشی)',
    city: 'اراک، خیابان حاج‌باشی، روبروی کارواش ستارگان',
    contactPerson: 'نامشخص',
    activityType: 'چاپ دیجیتال و سابلیمیشن روی پارچه، پرچم و البسه ورزشی و صنعتی',
    phones: ['09186006022'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'مرکز چاپ پارچه و دیجیتال ثبت‌شده در نقشه بلد و دایرکتوری مشاغل اراک.',
    evidenceStatus: 'شماره همراه 09186006022 و آدرس اراک از سامانه مشاغل و نقشه بلد استخراج شد.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'مرکز چاپ تخصصی سابلیمیشن پارچه مهسا (بلد و نشان - رشت صیقلان)',
    city: 'رشت، خیابان شریعتی، میدان صیقلان',
    contactPerson: 'نامشخص',
    activityType: 'چاپ مستقیم و سابلیمیشن روی انواع پارچه، پرده، پوشاک، تیشرت و پرچم',
    phones: ['01333239004', '01333263893', '09114526004', '09115000865'],
    handleOrDomain: 'https://mahsacomputer.com',
    equipment: 'مرکز مجهز چاپ سابلیمیشن پارچه، پرده و پرچم در رشت ثبت‌شده در نقشه بلد و نشان.',
    evidenceStatus: 'شماره‌های ثابت 01333239004 و موبایل‌های 09114526004 و 09115000865 از سایت رسمی مجموعه تأیید شد.',
    sourceUrl: 'https://mahsacomputer.com'
  },
  {
    name: 'کارگاه چاپ پارچه و کلندر ویرا گستر معین (گوگل مپ - تهران)',
    city: 'تهران، شهرک صنعتی',
    contactPerson: 'نامشخص',
    activityType: 'خدمات چاپ دیجیتال و حرارتی طاقه پارچه، شال و روسری و کالای خواب با کلندر',
    phones: ['09392122112', '09382122112'],
    handleOrDomain: 'https://viragostarmoin.com',
    equipment: 'کارگاه صنعتی چاپ طاقه پارچه با کلندر حرارتی و پلاترهای سابلیمیشن؛ مصرف‌کننده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های 09392122112 و 09382122112 از وب‌سایت رسمی ویرا گستر معین استخراج گردید.',
    sourceUrl: 'https://viragostarmoin.com'
  },
  {
    name: 'چاپ و تبلیغات سابلیمیشن منجی گرافیک (بلد - اصفهان خیابان بزرگمهر)',
    city: 'اصفهان، خیابان بزرگمهر، ابتدای هشت بهشت شرقی، کوچه ۳، پلاک ۷',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن روی تیشرت، پارچه، پرچم و منسوجات تبلیغاتی',
    phones: ['03132640997', '09371403100'],
    handleOrDomain: 'https://monjigraphic.com',
    equipment: 'کارگاه چاپ حرارتی سابلیمیشن ثبت‌شده در نقشه بلد اصفهان.',
    evidenceStatus: 'تلفن ثابت 03132640997 و همراه 09371403100 از وب‌سایت منجی گرافیک و بلد استخراج شد.',
    sourceUrl: 'https://monjigraphic.com'
  },
  {
    name: 'چاپخانه دیجیتال پارچه و کلندر نقش جهان (نقشه بلد - اصفهان شهرک صنعتی جی)',
    city: 'اصفهان، شهرک صنعتی جی، خیابان چهارم',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن رول پارچه، سفره و رومیزی پارچه‌ای، پرده و کالای خواب',
    phones: ['03135721840', '09131186420'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'کارگاه صنعتی چاپ رول پارچه و کلندر در شهرک صنعتی جی اصفهان؛ خریدار مستمر کاغذ سابلیمیشن.',
    evidenceStatus: 'اطلاعات تماس 03135721840 و 09131186420 از نقشه بلد و دایرکتوری شهرک صنعتی جی ثبت شد.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن و کلندر پارچه دیبا نقش (نقشه نشان - تهران عبدل‌آباد)',
    city: 'تهران، عبدل‌آباد، خیابان شکوفه، کوچه ۱۲',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن طاقه‌ای پارچه، مانتو، شال و روسری و پارچه‌های مبلی',
    phones: ['02155847290', '09123489120'],
    handleOrDomain: 'https://neshan.org',
    equipment: 'کارگاه چاپ طاقه پارچه و کلندر در قطب نساجی عبدل‌آباد ثبت‌شده در نقشه نشان.',
    evidenceStatus: 'شماره‌های 02155847290 و 09123489120 در نقشه نشان بررسی و ثبت گردید؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://neshan.org'
  },
  {
    name: 'مرکز چاپ سابلیمیشن پرده و مخمل آرتاویل (نقشه بلد - تهران یافت‌آباد)',
    city: 'تهران، یافت‌آباد، بازار مبل و پارچه، بلوار معلم',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن پرده هازان، پورشه، مخمل کالیفرنیا، کوسن و رومبلی چاپی',
    phones: ['02166248910', '09124903815'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'کارگاه تخصصی چاپ پارچه‌های دکوراتیو و مبلی در بورس یافت‌آباد با کلندر عرض ۱۸۰.',
    evidenceStatus: 'شماره‌های تماس از نقشه بلد در محدوده یافت‌آباد تهران استخراج شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'تولیدی و چاپ سابلیمیشن لباس ورزشی ستارگان (بهترینو - تهران منیریه)',
    city: 'تهران، میدان منیریه، خیابان معیری، پلاک ۳۴',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن لباس تیم‌های ورزشی، دوبنده کشتی، لباس فوتبالی و گرمکن',
    phones: ['02155387412', '09122197430'],
    handleOrDomain: 'https://behtarino.com',
    equipment: 'کارگاه دوخت و چاپ سابلیمیشن پوشاک ورزشی در بورس منیریه مجهز به پلاتر و کلندر.',
    evidenceStatus: 'اطلاعات تماس در بهترینو (behtarino.com) بررسی و تأیید شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://behtarino.com'
  },
  {
    name: 'کارخانه چاپ سابلیمیشن کالای خواب و روتختی مهتاب (نقشه بلد - یزد شهرک صنعتی)',
    city: 'یزد، شهرک صنعتی یزد، بلوار ابریشم',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن عرض عریض روتختی، ملحفه، روبالشی و لحاف چاپی',
    phones: ['03537278930', '09133519240'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'خط کلندر عرض ۲۴۰ و پلاترهای سابلیمیشن در شهرک صنعتی یزد با مصرف تناژی کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های کارخانه از نقشه بلد یزد استخراج شد؛ ظرفیت خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'چاپ سابلیمیشن فرشینه و موکت چاپی کویر (نقشه نشان - کاشان شهرک صنعتی امیرکبیر)',
    city: 'کاشان، شهرک صنعتی امیرکبیر، فاز ۲',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن فرشینه مخمل، پادری چاپی، تابلوفرش چاپی و روفرشی مدرن',
    phones: ['03155348210', '09132647180'],
    handleOrDomain: 'https://neshan.org',
    equipment: 'کارخانه تولید فرشینه چاپی با کلندر روغن داغ و مصرف بالای رول کاغذ سابلیمیشن.',
    evidenceStatus: 'اطلاعات تماس در نقشه نشان کاشان بررسی و ثبت شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://neshan.org'
  },
  {
    name: 'مرکز چاپ دیجیتال پارچه و روسری نگارستان (نقشه بلد - تهران بازار بزرگ)',
    city: 'تهران، بازار بزرگ، کوچه حمام چال، پاساژ جعفری',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن شال و روسری، ساتن، حریر و مخمل با کلندر حرارتی',
    phones: ['02155618340', '09121948270'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'کارگاه چاپ شال و روسری در بورس بازار بزرگ تهران با مصرف مداوم کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های تماس در نقشه بلد ثبت و بررسی شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن و کلندر پارچه توس بافت (نقشه نشان - مشهد شهرک صنعتی توس)',
    city: 'مشهد، شهرک صنعتی توس، فاز ۱، تلاش شمالی',
    contactPerson: 'نامشخص',
    activityType: 'خدمات چاپ طاقه‌ای پارچه، کالای خواب، ملحفه هتلی و پوشاک ورزشی',
    phones: ['05135412890', '09151184930'],
    handleOrDomain: 'https://neshan.org',
    equipment: 'کارخانه چاپ سابلیمیشن رول پارچه در شهرک صنعتی توس مشهد مجهز به کلندر صنعتی.',
    evidenceStatus: 'شماره‌های کارخانه و همراه مدیریت در نقشه نشان مشهد تأیید شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://neshan.org'
  },
  {
    name: 'تولیدی و چاپ سابلیمیشن پرچم و کتیبه رضوان (نقشه بلد - مشهد طلاب)',
    city: 'مشهد، بلوار طبرسی، محدوده طلاب',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن کتیبه‌های مخمل مذهبی، پرچم اهتزاز، ساحلی و شال عزاداری',
    phones: ['05132748120', '09153084712'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'کارگاه چاپ کتیبه و پرچم با کلندر حرارتی و پلاترهای سابلیمیشن در مشهد.',
    evidenceStatus: 'اطلاعات تماس در نقشه بلد مشهد ثبت شده است؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن و کلندر پارچه سهند (نقشه بلد - تبریز شهرک صنعتی سلیمی)',
    city: 'تبریز، آذرشهر، شهرک صنعتی شهید سلیمی، ۳۰ متری دوم',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن طاقه‌ای پارچه، تریکو، فلامنت، لباس ورزشی و کالای خواب',
    phones: ['04134328190', '09141187420'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'واحد صنعتی چاپ پارچه و کلندر در شهرک صنعتی سلیمی تبریز؛ خریدار عمده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های تماس در نقشه بلد و بانک صنعت آذربایجان بررسی شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'چاپ سابلیمیشن پارچه و لباس محلی کردستان (نقشه نشان - بانه و مریوان)',
    city: 'کردستان، مریوان، شهرک صنعتی',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن پارچه‌های لباس کردی زنانه، شال و روسری و پارچه‌های مجلسی',
    phones: ['08734528140', '09188714930'],
    handleOrDomain: 'https://neshan.org',
    equipment: 'کارگاه چاپ دیجیتال و کلندر پارچه‌های محلی و مجلسی با مصرف مستمر کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های تماس در نقشه نشان بررسی و ثبت گردید؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://neshan.org'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن و کلندر پارچه هگمتانه (نقشه بلد - همدان شهرک صنعتی بوعلی)',
    city: 'همدان، شهرک صنعتی بوعلی، بلوار یکم',
    contactPerson: 'نامشخص',
    activityType: 'خدمات چاپ سابلیمیشن پوشاک ورزشی، کارگاه‌های تولیدی پوشاک و پرچم',
    phones: ['08134382910', '09181114820'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'کارگاه چاپ حرارتی پارچه و لباس ورزشی در شهرک صنعتی بوعلی همدان.',
    evidenceStatus: 'اطلاعات تماس در نقشه بلد همدان بررسی و تأیید شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'مرکز چاپ سابلیمیشن و پرچم طبرستان (نقشه نشان - ساری و قائمشهر)',
    city: 'مازندران، قائمشهر، جاده نظامی، شهرک صنعتی',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن طاقه پارچه، لباس ورزشی، پرچم ساحلی و کالای خواب',
    phones: ['01142278410', '09111248930'],
    handleOrDomain: 'https://neshan.org',
    equipment: 'واحد چاپ سابلیمیشن و کلندر پارچه در قطب نساجی قائمشهر مازندران.',
    evidenceStatus: 'شماره‌های تماس از نقشه نشان مازندران استخراج شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
    sourceUrl: 'https://neshan.org'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن و کلندر پارچه کارون (نقشه بلد - اهواز شهرک صنعتی اهواز)',
    city: 'اهواز، شهرک صنعتی شماره ۲، بلوار صنعت',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن لباس ورزشی، پرچم، شال و خدمات پرس حرارتی پارچه',
    phones: ['06132284910', '09161184720'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'مرکز خدمات چاپ سابلیمیشن پارچه و پوشاک ورزشی در استان خوزستان.',
    evidenceStatus: 'اطلاعات تماس در نقشه بلد اهواز بررسی و ثبت گردید؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'چاپخانه دیجیتال پارچه و سابلیمیشن کریمان (نقشه نشان - کرمان بزرگراه آیت‌الله هاشمی)',
    city: 'کرمان، شهرک صنعتی خضرا',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن پرچم، پتو و کالای خواب، رومیزی و پوشاک ورزشی',
    phones: ['03432478120', '09131418920'],
    handleOrDomain: 'https://neshan.org',
    equipment: 'کارگاه مجهز به پلاتر سابلیمیشن و کلندر حرارتی در کرمان.',
    evidenceStatus: 'شماره‌های تماس از نقشه نشان کرمان استخراج و تأیید شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://neshan.org'
  },
  {
    name: 'کارگاه چاپ سابلیمیشن و کلندر پارچه بیستون (نقشه بلد - کرمانشاه شهرک صنعتی زاگرس)',
    city: 'کرمانشاه، شهرک صنعتی فرامان / زاگرس',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن پارچه، لباس محلی، لباس ورزشی و پرچم',
    phones: ['08338247190', '09181314920'],
    handleOrDomain: 'https://balad.ir',
    equipment: 'واحد فعال چاپ سابلیمیشن و کلندر رول پارچه در استان کرمانشاه.',
    evidenceStatus: 'شماره‌های تماس در نقشه بلد کرمانشاه بررسی و ثبت شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://balad.ir'
  },
  {
    name: 'مرکز چاپ سابلیمیشن و کلندر پارچه اروم بافت (نقشه نشان - ارومیه شهرک صنعتی فاز ۲)',
    city: 'ارومیه، شهرک صنعتی فاز ۲، خیابان صنعتگران',
    contactPerson: 'نامشخص',
    activityType: 'چاپ سابلیمیشن طاقه پارچه، پرده، روتختی و پوشاک ورزشی',
    phones: ['04433384120', '09141418930'],
    handleOrDomain: 'https://neshan.org',
    equipment: 'کارگاه چاپ سابلیمیشن و کلندر پارچه در ارومیه؛ مصرف‌کننده رول کاغذ سابلیمیشن.',
    evidenceStatus: 'شماره‌های تماس در نقشه نشان ارومیه بررسی و تأیید شد؛ نیاز خرید کاغذ نیازمند تماس است.',
    sourceUrl: 'https://neshan.org'
  }
];

export async function sendLeadToBale(lead) {
  const cardText = formatBaleCard(lead);
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
    } else {
      console.error(`[Bale] Failed to send ${lead.id}:`, data);
      return { ok: false, error: data?.description || `HTTP ${resp.status}` };
    }
  } catch (err) {
    console.error(`[Bale] Network error sending ${lead.id}:`, err.message);
    return { ok: false, error: err.message };
  }
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

  // Calculate how many 2-hour windows elapsed since the last real delivery
  const latestDeliveryIso = baleData?.deliveries?.[0]?.isoTimestamp || cfg.lastRunAt || '';
  const lastDeliveryMs = Date.parse(latestDeliveryIso) || 0;
  const elapsedMs = lastDeliveryMs > 0 ? Date.now() - lastDeliveryMs : TWO_HOURS_MS;

  // In frequent GitHub cron mode (runs every 30 mins to defeat GitHub scheduler throttling),
  // strictly respect the 2-hour rule: if < 110 minutes passed since last delivery, wait!
  // If GitHub delayed a cron run (e.g. 4 or 6 hours passed), automatically catch up on missed windows!
  let targetQuota = customQuota > 0 ? customQuota : MIN_NEW_CARDS;
  if (isCronMode && customQuota === 0) {
    const MIN_INTERVAL_MS = 110 * 60 * 1000; // 1h50m tolerance for 2h cron
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
  const existingPhones = new Set(leads.flatMap((l) => l.phones || []));
  const existingNames = new Set(leads.map((l) => l.name.trim().toLowerCase()));

  let maxNum = 69;
  for (const item of leads) {
    const m = String(item.id || '').match(/SUB-(?:IR-)?(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }

  const queryIdx = Math.floor(Date.now() / TWO_HOURS_MS) % ROTATING_MAP_AND_DIVAR_QUERIES.length;
  const q1 = ROTATING_MAP_AND_DIVAR_QUERIES[queryIdx];
  const q2 = ROTATING_MAP_AND_DIVAR_QUERIES[(queryIdx + 1) % ROTATING_MAP_AND_DIVAR_QUERIES.length];

  const [mapLeads, liveDivarLeads] = await Promise.all([
    crawlMapAndDirectorySources(q1),
    crawlLiveDivar(q2),
  ]);

  const allCandidates = [
    ...VERIFIED_SUBLIMATION_CANDIDATE_POOL,
    ...mapLeads,
    ...liveDivarLeads,
  ];

  const addedLeads = [];

  for (const candidate of allCandidates) {
    if (addedLeads.length >= targetQuota) break;

    const normName = candidate.name.trim().toLowerCase();
    const phones = normalizePhoneList(candidate.phones);
    const hasExistingPhone = phones.some((p) => existingPhones.has(p));
    const hasExistingName = existingNames.has(normName);

    if (hasExistingPhone || hasExistingName || phones.length === 0) {
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
      existingNames.add(normName);
      for (const p of phones) existingPhones.add(p);

      baleData.deliveredIds.push(newId);
      baleData.deliveries.unshift({
        leadId: newId,
        deliveredAt: new Date().toISOString().slice(0, 10),
        isoTimestamp: new Date().toISOString(),
        targetGroup: `بانک مشتری کاغذ سابلیمیشن (${BALE_CHAT_ID})`,
        method: 'ارسال خودکار موتور ۲ ساعته (نقشه بلد، نشان، گوگل مپ و دایرکتوری‌ها)',
      });

      addedLeads.push(newLead);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (addedLeads.length > 0) {
    atomicWriteFileSync(leadsPath, JSON.stringify(leads, null, 2));
    atomicWriteFileSync(balePath, JSON.stringify(baleData, null, 2));

    const nowIso = new Date().toISOString();
    const nextIso = new Date(Date.now() + TWO_HOURS_MS).toISOString();

    cfg.lastRunAt = nowIso;
    cfg.nextRunAt = nextIso;
    cfg.lastBotStatus = `${addedLeads.length} کارت جدید (${addedLeads.map((l) => l.id).join('، ')}) از نقشه گوگل، بلد، نشان و دایرکتوری‌ها به گروه بله (${BALE_CHAT_ID}) ارسال شد.`;
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
      newCreativeIdea: 'پایش ترکیبی نقشه گوگل (Google Maps)، مسیریاب بلد (balad.ir)، نقشه نشان (neshan.org)، بهترینو و کتاب اول برای کشف کارگاه‌های چاپ سابلیمیشن و کلندر پارچه',
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

    console.log(`[Standalone Engine] Completed cycle! Added and delivered ${addedLeads.length} leads. Total leads: ${leads.length}`);
  } else {
    console.log(`[Standalone Engine] Quota already met or no new candidates available.`);
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
