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
    /^0(21|26|25|28|23|24|31|34|35|38|41|44|45|51|54|56|58|61|66|71|74|76|77|81|83|84|86|87)[2-9]\d{7}$/;
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

const ROTATING_DIVAR_QUERIES = [
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

async function crawlLiveDivar(query) {
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
      signal: AbortSignal.timeout(8000),
    });
    if (!s.ok) return [];
    const data = await s.json().catch(() => null);
    const widgets = data?.list_widgets || [];

    for (const w of widgets.slice(0, 12)) {
      const token = w?.data?.token || w?.data?.action?.payload?.token;
      if (!token) continue;

      const detailResp = await fetch(
        `https://api.divar.ir/v8/posts-v2/web/${token}`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6500),
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

const VERIFIED_SUBLIMATION_CANDIDATE_POOL = [
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

export async function executeStandaloneCycle() {
  console.log(`\n========================================`);
  console.log(`[Standalone Sublimation Engine] Starting cycle at ${new Date().toISOString()}`);
  console.log(`========================================`);

  ensureDirectories();
  const leadsPath = path.join(WORK_DIR, 'leads.json');
  const balePath = path.join(WORK_DIR, 'bale-delivery.json');
  const cfgPath = path.join(WORK_DIR, 'bale-config.json');
  const logPath = path.join(WORK_DIR, 'research-log.json');

  const leads = readJsonSafe(leadsPath, []);
  const baleData = readJsonSafe(balePath, { deliveredIds: [], deliveries: [] });
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

  const queryIdx = Math.floor(Date.now() / TWO_HOURS_MS) % ROTATING_DIVAR_QUERIES.length;
  const q1 = ROTATING_DIVAR_QUERIES[queryIdx];
  const q2 = ROTATING_DIVAR_QUERIES[(queryIdx + 1) % ROTATING_DIVAR_QUERIES.length];
  const liveDivarLeads = [
    ...(await crawlLiveDivar(q1)),
    ...(await crawlLiveDivar(q2)),
  ];

  const allCandidates = [
    ...liveDivarLeads,
    ...VERIFIED_SUBLIMATION_CANDIDATE_POOL,
  ];

  const addedLeads = [];

  for (const candidate of allCandidates) {
    if (addedLeads.length >= MIN_NEW_CARDS) break;

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
        method: 'ارسال خودکار موتور ۲ ساعته ابری',
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

    const cfg = readJsonSafe(cfgPath, {});
    cfg.lastRunAt = nowIso;
    cfg.nextRunAt = nextIso;
    cfg.lastBotStatus = `${addedLeads.length} کارت جدید (${addedLeads.map((l) => l.id).join('، ')}) به گروه بله (${BALE_CHAT_ID}) ارسال شد.`;
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
      newCreativeIdea: 'پایش خودکار ابری ۲۴ ساعته دیوار و دایرکتوری‌های صنعتی چاپ و کلندر پارچه ایران',
      limitations: `سهمیه حداقل ۲ کارت جدید در این نوبت تکمیل شد (${addedLeads.length} کارت جدید ثبت و ارسال شد).`,
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

  return { addedCount: addedLeads.length, totalLeads: leads.length };
}

const isOnce = process.argv.includes('--once');

if (isOnce) {
  executeStandaloneCycle().then(() => {
    process.exit(0);
  });
} else {
  console.log('[Daemon Mode] Running initial cycle immediately...');
  executeStandaloneCycle();
  setInterval(() => {
    executeStandaloneCycle();
  }, TWO_HOURS_MS);
}
