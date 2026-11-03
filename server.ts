import express from 'express';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import {
  ensureDirectories,
  atomicWriteFileSync,
  buildAllOutputs,
  normalizePhoneList,
  formatBaleCard,
} from './work/build.mjs';

dns.setDefaultResultOrder('ipv4first');

const PORT = 3000;
const ROOT_DIR = process.cwd();
const WORK_DIR = path.join(ROOT_DIR, 'work');
const OUTPUTS_DIR = path.join(ROOT_DIR, 'outputs');
const BALE_CONFIG_PATH = path.join(WORK_DIR, 'bale-config.json');
const CREATIVE_STRATEGIES_PATH = path.join(WORK_DIR, 'creative-strategies.json');

const TWO_HOURS_SECONDS = 7200;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface CreativeStrategyState {
  totalGenerated: number;
  lastUpdatedAt: string;
  executedHistory: string[];
  divarQueriesQueue: string[];
  activeQueue: string[];
}

const IRAN_INDUSTRIAL_HUBS = [
  'تهران (بازار بزرگ، عبدل‌آباد، یافت‌آباد، منیریه، جمهوری، اتحاد، شادآباد)',
  'شهرک صنعتی چهاردانگه، شهرقدس، شهریار، رباط‌کریم، نصیرآباد و واوان اسلامشهر',
  'شهرک صنعتی شمس‌آباد، خاوران، پاکدشت، ورامین، قرچک و کهریزک',
  'کرج، شهرک صنعتی بهارستان، اشتهارد، صفادشت، کمالشهر و هشتگرد',
  'مشهد (شهرک صنعتی توس، جاده کلات، طرق، پنجتن، طلاب و آزادشهر)',
  'اصفهان (شهرک صنعتی دولت‌آباد، مورچه‌خورت، جی، امیرکبیر، نجف‌آباد، خمینی‌شهر و مبارکه)',
  'کاشان، آران و بیدگل، دلیجان، نطنز و محلات (قطب نساجی، فرشینه و کالای خواب)',
  'یزد، میبد، اردکان و شهرک صنعتی یزد (قطب نساجی، ترمه، رومیزی و کالای خواب)',
  'تبریز، شهرک صنعتی سلیمی آذرشهر، سردرود، مرند و بناب',
  'شیراز (شهرک صنعتی بزرگ شیراز)، کازرون و مرودشت',
  'قم (شهرک صنعتی شکوهیه و محمودآباد) و ساوه (شهرک صنعتی کاوه)',
  'قزوین (شهرک صنعتی البرز و کاسپین)، تاکستان و بویین‌زهرا',
  'رشت، شهرک صنعتی سفیدرود، انزلی، لاهیجان، ساری، بابل، قائمشهر و آمل',
  'اهواز، دزفول، آبادان، خرمشهر، بوشهر و بندرعباس',
  'اراک، خمین، بروجرد، خرم‌آباد، همدان و ملایر',
  'کرمانشاه، سنندج، بانه، مریوان، ارومیه، خوی و مهاباد (تولیدی‌های لباس محلی و کردی)',
  'کرمان، رفسنجان، سیرجان، زاهدان، بیرجند، بجنورد، سبزوار و نیشابور',
  'زنجان، ابهر، اردبیل، گرگان، گنبدکاووس، سمنان، شاهرود و گرمسار',
];

const SUBLIMATION_PAPER_NICHES = [
  'کارگاه‌های چاپ سابلیمیشن طاقه‌ای پارچه و خدمات کلندر حرارتی رول‌به‌رول',
  'تولیدی‌های لباس ورزشی، کیت فوتبالی، تیشرت و شلوارک باشگاهی و لباس رزمی و بدنسازی',
  'تولیدی‌های پرچم ساحلی، پرچم اهتزاز، پرچم رومیزی، تشریفات و کتیبه‌های مخمل و ساتن مذهبی',
  'تولیدی‌های کالای خواب، روتختی سه‌بعدی چاپی، ملحفه، روبالشی و پتو مسافرتی چاپی',
  'تولیدی‌های پرده پانچ تصویری، پرده زبرا چاپی، شید تصویری، کوسن و رومبلی مخمل و شانل',
  'کارگاه‌های چاپ شال و روسری دیجیتال، مانتو چاپی، عبا، کیمونو و لباس مجلسی زنانه',
  'تولیدی‌های فرشینه چاپی، پادری مخمل، موکت چاپی و تابلوفرش چاپی سابلیمیشن',
  'تولیدی‌های کیف، کوله‌پشتی، جامدادی چاپی، ساک پارچه‌ای، پد موس و هدایای تبلیغاتی پارچه‌ای',
  'کارگاه‌های چاپ بند گردن‌آویز نمایشگاهی (لنیارد)، روبان چاپی، مچ‌بند و اتیکت پارچه‌ای',
  'تولیدی‌های لباس کودک، ست نوزادی چاپی، هودی، دورس و تیشرت‌های فلامنت و اسپان',
  'تولیدی‌های رومیزی، رانر، زیربشقابی، پیش‌بند و سرویس آشپزخانه پارچه‌ای چاپی',
  'تولیدی‌های چادر مسافرتی، سایه‌بان تبلیغاتی، آفتاب‌گیر خودرو و روکش صندلی چاپی',
];

const DISCOVERY_SIGNALS = [
  'سایت‌های آگهی و نیازمندی‌های ایرانی دارای شماره تلفن مستقیم در متن آگهی شامل شیپور (sheypoor.com)، ایستگاه (istgah.com)، نیازروز (niazerooz.com)، ایران‌تجارت (irantejarat.com)، راهنما همشهری (rahnama.com)، لوکوپوک (locopoc.com) و باسکول (buskool.com)',
  'بانک‌های اطلاعاتی تخصصی چاپ، نساجی و مشاغل ایران شامل چاپشو (chapshoo.com)، بازار چاپ ایران (iranprintmart.ir)، بهترینو (behtarino.com)، نقشه بلد (balad.ir)، اول (avval.ir) و ویکی‌تولید (wikitolid.com)',
  'سایت‌های آگهی استخدامی ایران شامل نیازمشاغل (niazemashaghel.ir)، ای‌استخدام (e-estekhdam.com)، ایران‌استخدام (iranestekhdam.ir)، جابینجا (jobinja.ir)، جاب‌ویژن (jobvision.ir) و کارپیشه (karpishe.com) برای آگهی‌های جذب اپراتور سابلیمیشن، کلندرکار و طراح راپورت پارچه',
  'کانال‌ها و پست‌های عمومی تلگرام (site:t.me و t.me/s) مربوط به کارگاه‌های چاپ سابلیمیشن طاقه‌ای پارچه، خدمات کلندر رول‌به‌رول، بنکداران پارچه چاپی (عبدل‌آباد، بازار بزرگ، مولوی)، تولیدی‌های لباس ورزشی، پرچم، شال و روسری و کالای خواب که شماره موبایل یا تلفن ثابت سفارشات را در پست‌ها یا بیوی کانال درج کرده‌اند',
  'صفحات، بیو (Bio) و کپشن پست‌ها و ریلزهای اینستاگرام (site:instagram.com) مربوط به کارگاه‌های چاپ سابلیمیشن پارچه، خدمات کلندر رول‌به‌رول، چاپ لباس ورزشی، پرچم، شال و روسری و کالای خواب که شماره موبایل یا تلفن ثابت سفارشات را در بیو، کپشن یا لینک بیو (زی‌لینک/یک‌لینک) درج کرده‌اند',
  'پروفایل‌های لینکدین (site:linkedin.com/in و site:linkedin.com/company) مدیران تولید، مدیران خرید و تدارکات، مدیران کارخانه‌های چاپ دیجیتال پارچه، تکمیل نساجی، کالای خواب، پوشاک ورزشی و فرشینه در ایران + استخراج شماره تلفن مستقیم کارخانه و واحد خرید از وب‌سایت رسمی، بلد و گوگل',
  'پست‌های اینستاگرام، تلگرام و لینکدین شرکت رکورد (chap.record / sdrecord.com) و سایر واردکنندگان دستگاه چاپ سابلیمیشن که نام کارخانه یا آیدی کارگاه‌های خریدار دستگاه را تگ یا معرفی کرده‌اند + یافتن شماره تماس مستقیم آن کارگاه',
  'کارگاه‌هایی که از دستگاه‌های چاپ سابلیمیشن شرکت رکورد (مدل‌های TSR1908، TSR1808، REX1904، TSR18، FH-6100، FT1608 و کلندر PRP) استفاده می‌کنند یا در آگهی‌ها نام این مدل‌ها را برده‌اند',
  'گزارش‌های نصب و راه‌اندازی دستگاه‌های چاپ سابلیمیشن و کلندر توسط شرکت رکورد (sdrecord.com / chap.record)، فتوبهمن، نوین‌تاک، فرارنگ و فبتاک و یافتن شماره مستقیم کارگاه خریدار در بلد و گوگل',
];

const MASTER_SEARCH_KEYWORDS = [
  'چاپ دیجیتال',
  'چاپ دیجیتال پارچه',
  'چاپ سابلیمیشن',
  'چاپ سابلیمیشن پارچه',
  'چاپ پارچه',
  'کلندر',
  'کالندر',
  'کلندر پارچه',
  'کالندر پارچه',
  'سابلیمیشن',
  'سابلیمشن',
  'اپراتور چاپ',
  'اپراتور چاپ پارچه',
  'اپراتور سابلیمیشن',
  'اپراتور کلندر',
  'اپراتور کالندر',
  'اپراتور پلاتر',
  'کارگر چاپ',
  'کارگر چاپخانه پارچه',
  'کارگر کلندر',
  'کارگر کالندر',
  'کارگر ساده چاپ پارچه',
  'کلندرکار',
  'کالندرکار',
  'چاپ طاقه',
  'چاپ طاقه‌ای پارچه',
  'چاپ رول پارچه',
  'چاپ متراژی پارچه',
  'چاپ حرارتی پارچه',
  'پرس حرارتی پارچه',
  'طراح سابلیمیشن',
  'طراح راپورت پارچه',
  'طراح پارچه و روسری',
  'چاپ لباس ورزشی سابلیمیشن',
  'چاپ پرچم سابلیمیشن',
  'چاپ شال و روسری سابلیمیشن',
  'چاپ روتختی سابلیمیشن',
  'چاپ پرده سابلیمیشن',
  'چاپ فرشینه و موکت',
  'چاپ مخمل و ساتن',
  'کلندر عرض ۱۶۰',
  'کلندر عرض ۱۸۰',
  'کلندر عرض ۳۲۰',
  'کالندر حرارتی',
  'دستگاه سابلیمیشن رکورد',
  'کلندر PRP',
];

function synthesizeCombinatorialIdeas(existingSet: Set<string>, count = 6): string[] {
  const generated: string[] = [];
  let attempts = 0;
  while (generated.length < count && attempts < 100) {
    attempts++;
    const hub =
      IRAN_INDUSTRIAL_HUBS[
        (existingSet.size + attempts * 3) % IRAN_INDUSTRIAL_HUBS.length
      ];
    const niche =
      SUBLIMATION_PAPER_NICHES[
        (existingSet.size + attempts * 7) % SUBLIMATION_PAPER_NICHES.length
      ];
    const signal =
      DISCOVERY_SIGNALS[
        (existingSet.size + attempts * 5) % DISCOVERY_SIGNALS.length
      ];
    const kw1 =
      MASTER_SEARCH_KEYWORDS[
        (existingSet.size + attempts * 2) % MASTER_SEARCH_KEYWORDS.length
      ];
    const kw2 =
      MASTER_SEARCH_KEYWORDS[
        (existingSet.size + attempts * 4 + 3) % MASTER_SEARCH_KEYWORDS.length
      ];
    const candidate = `${niche} در «${hub}» با کلیدواژه‌های («${kw1}»، «${kw2}»، کلندر/کالندر، اپراتور چاپ/کلندر، کارگر چاپ/کلندر) از طریق ${signal} (با استخراج حتمی شماره تلفن مستقیم کارفرما)`;
    if (!existingSet.has(candidate)) {
      existingSet.add(candidate);
      generated.push(candidate);
    }
  }
  return generated;
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e);
  }
  return fallback;
}

function loadCreativeStrategyState(): CreativeStrategyState {
  const raw = readJsonSafe<any>(CREATIVE_STRATEGIES_PATH, null);
  if (raw && Array.isArray(raw.activeQueue)) {
    const state: CreativeStrategyState = {
      totalGenerated: Number(raw.totalGenerated) || raw.activeQueue.length,
      lastUpdatedAt: raw.lastUpdatedAt || new Date().toISOString(),
      executedHistory: Array.isArray(raw.executedHistory)
        ? raw.executedHistory
        : [],
      divarQueriesQueue:
        Array.isArray(raw.divarQueriesQueue) && raw.divarQueriesQueue.length > 0
          ? Array.from(
              new Set([...raw.divarQueriesQueue, ...MASTER_SEARCH_KEYWORDS])
            )
          : [...MASTER_SEARCH_KEYWORDS],
      activeQueue: raw.activeQueue,
    };
    const allKnown = new Set([
      ...state.activeQueue,
      ...state.executedHistory,
    ]);
    if (state.activeQueue.length < 12) {
      const fresh = synthesizeCombinatorialIdeas(allKnown, 10);
      state.activeQueue.push(...fresh);
      state.totalGenerated += fresh.length;
      state.lastUpdatedAt = new Date().toISOString();
      atomicWriteFileSync(
        CREATIVE_STRATEGIES_PATH,
        JSON.stringify(state, null, 2)
      );
    }
    return state;
  }

  // Fallback if old array format existed
  const initialSet = new Set<string>(Array.isArray(raw) ? raw : []);
  const synthesized = synthesizeCombinatorialIdeas(initialSet, 15);
  const initialQueue = [...Array.from(initialSet), ...synthesized];
  const state: CreativeStrategyState = {
    totalGenerated: initialQueue.length,
    lastUpdatedAt: new Date().toISOString(),
    executedHistory: [],
    divarQueriesQueue: [...MASTER_SEARCH_KEYWORDS],
    activeQueue: initialQueue,
  };
  atomicWriteFileSync(CREATIVE_STRATEGIES_PATH, JSON.stringify(state, null, 2));
  return state;
}

function getCreativeStrategies(): string[] {
  return loadCreativeStrategyState().activeQueue;
}

const DEFAULT_BALE_BOT_TOKEN = '2136077232:6UYkuEA0H6FyPXbZB0lH38Hy1GjKpojSsv8';
const DEFAULT_BALE_CHAT_ID = '4657775638';
const DEFAULT_BALE_GROUP_TITLE = 'بانک مشتری کاغذ سابلیمیشن';

const savedBaleConfig = readJsonSafe(BALE_CONFIG_PATH, {
  baleBotToken: process.env.BALE_BOT_TOKEN || DEFAULT_BALE_BOT_TOKEN,
  baleChatId: DEFAULT_BALE_CHAT_ID,
  divarToken: process.env.DIVAR_TOKEN || '',
  divarPhone: '',
  detectedChatIds: [] as string[],
  botName: '@romina_admin_test_bot',
  lastBotStatus: 'توکن ربات و شناسه گروه بله به صورت دائمی ذخیره شده است.',
  lastRunAt: '',
  nextRunAt: '',
  lastCycleSummary: '',
});

const startupLogs: any[] = readJsonSafe(path.join(WORK_DIR, 'research-log.json'), []);
const startupDeliveries: any = readJsonSafe(path.join(WORK_DIR, 'bale-delivery.json'), { deliveries: [] });
const latestLogMs = Date.parse(startupLogs?.[0]?.isoTimestamp || '') || 0;
const latestDeliveryMs = Date.parse(startupDeliveries?.deliveries?.[0]?.isoTimestamp || '') || 0;
const latestRealMs = Math.max(latestLogMs, latestDeliveryMs);

const computedLastRunAt =
  latestRealMs > 0
    ? new Date(latestRealMs).toISOString()
    : savedBaleConfig.lastRunAt || new Date(Date.now() - TWO_HOURS_SECONDS * 1000).toISOString();

const computedNextRunAt =
  latestRealMs > 0
    ? new Date(latestRealMs + TWO_HOURS_SECONDS * 1000).toISOString()
    : new Date(Date.now() - 1000).toISOString();

let autoPilotState = {
  enabled: true,
  intervalSeconds: TWO_HOURS_SECONDS,
  currentCityIndex: 0,
  isRunningCycle: false,
  lastRunAt: computedLastRunAt,
  nextRunAt: computedNextRunAt,
  lastCycleSummary:
    savedBaleConfig.lastCycleSummary ||
    'پایش خودکار هر ۲ ساعت یک‌بار فعال است (فقط کارت‌های دارای شماره تلفن غیرتکراری)',
  baleBotToken: savedBaleConfig.baleBotToken || DEFAULT_BALE_BOT_TOKEN,
  baleChatId: savedBaleConfig.baleChatId || DEFAULT_BALE_CHAT_ID,
  divarToken: savedBaleConfig.divarToken || '',
  divarPhone: savedBaleConfig.divarPhone || '',
  botName: savedBaleConfig.botName || '@romina_admin_test_bot',
  lastBotStatus:
    savedBaleConfig.lastBotStatus || 'توکن و گروه به صورت دائمی ذخیره شد.',
};

function saveBaleConfig() {
  atomicWriteFileSync(
    BALE_CONFIG_PATH,
    JSON.stringify(
      {
        baleBotToken: autoPilotState.baleBotToken || DEFAULT_BALE_BOT_TOKEN,
        baleChatId: autoPilotState.baleChatId || DEFAULT_BALE_CHAT_ID,
        targetGroupTitle: DEFAULT_BALE_GROUP_TITLE,
        divarToken: autoPilotState.divarToken || '',
        divarPhone: autoPilotState.divarPhone || '',
        botName: autoPilotState.botName || '@romina_admin_test_bot',
        lastBotStatus: autoPilotState.lastBotStatus,
        lastRunAt: autoPilotState.lastRunAt,
        nextRunAt: autoPilotState.nextRunAt,
        lastCycleSummary: autoPilotState.lastCycleSummary,
      },
      null,
      2
    )
  );
}

ensureDirectories();
saveBaleConfig();

function getIsoDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function toLatinDigits(str: string): string {
  return String(str || '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function extractDivarPostToken(urlOrToken: string): string | null {
  const s = String(urlOrToken || '').trim();
  if (!s) return null;
  const m = s.match(/divar\.ir\/v\/(?:[^/]+\/)?([A-Za-z0-9_-]{6,14})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{7,10}$/.test(s)) return s;
  return null;
}

async function fetchDivarContactPhone(
  postToken: string,
  divarToken: string
): Promise<string[]> {
  if (!postToken || !divarToken) return [];
  const cleanToken = divarToken.trim();
  const endpoints = [
    `https://api.divar.ir/v8/postcontact/web/contact_info_v2/${postToken}`,
    `https://api.divar.ir/v8/postcontact/web/contact_info/${postToken}`,
  ];

  const headerVariants = [
    {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Authorization: `Basic ${cleanToken}`,
      Cookie: `token=${cleanToken}`,
    },
    {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Authorization: `Bearer ${cleanToken}`,
      Cookie: `token=${cleanToken}; did=web`,
    },
    {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      'x-access-token': cleanToken,
      Cookie: `token=${cleanToken}`,
    },
  ];

  for (const ep of endpoints) {
    for (const headers of headerVariants) {
      try {
        const resp = await fetch(ep, {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(6500),
        });
        if (!resp.ok) continue;
        const raw = toLatinDigits(await resp.text());
        const matches =
          raw.match(/(?:09\d{9}|021\d{8}|0\d{2}\d{8})/g) || [];
        const normalized = normalizePhoneList(matches);
        if (normalized.length > 0) {
          return normalized;
        }
      } catch {
        // continue
      }
    }
  }
  return [];
}

async function extractPhonesFromSourceUrl(url: string): Promise<string[]> {
  if (!url) return [];
  const divarPostToken = extractDivarPostToken(url);
  const phonesFound: string[] = [];

  // 1. If it's a Divar post URL, fetch its description text from api.divar.ir + postcontact if logged in
  if (divarPostToken) {
    try {
      const r = await fetch(
        `https://api.divar.ir/v8/posts-v2/web/${divarPostToken}`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6500),
        }
      );
      if (r.ok) {
        const detailJson: any = await r.json().catch(() => null);
        let descText = String(detailJson?.seo?.web_info?.title || '') + ' ';
        for (const sec of detailJson?.sections || []) {
          if (sec?.section_name === 'DESCRIPTION') {
            for (const dw of sec?.widgets || []) {
              if (dw?.data?.text) descText += dw.data.text + ' ';
            }
          }
        }
        const raw = toLatinDigits(descText);
        const matches =
          raw.match(
            /(?:09\d{9}|021[2-9]\d{7}|026[2-9]\d{7}|031[2-9]\d{7}|051[2-9]\d{7}|071[2-9]\d{7}|041[2-9]\d{7}|035[2-9]\d{7}|025[2-9]\d{7})/g
          ) || [];
        phonesFound.push(...normalizePhoneList(matches));
      }
    } catch {
      // ignore
    }

    if (autoPilotState.divarToken) {
      const contactPhones = await fetchDivarContactPhone(
        divarPostToken,
        autoPilotState.divarToken
      );
      phonesFound.push(...contactPhones);
    }

    return normalizePhoneList(phonesFound).slice(0, 4);
  }

  // 2. If it's a Telegram channel URL (t.me/channel), rewrite to public web preview https://t.me/s/channel
  let targetFetchUrl = url.trim();
  const tgMatch = targetFetchUrl.match(
    /^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/(?!s\/)([A-Za-z0-9_]{4,})(?:\/(\d+))?/i
  );
  if (tgMatch) {
    targetFetchUrl = tgMatch[2]
      ? `https://t.me/s/${tgMatch[1]}/${tgMatch[2]}`
      : `https://t.me/s/${tgMatch[1]}`;
  }

  // 3. Scrape the webpage HTML directly
  if (!targetFetchUrl.startsWith('http')) return [];
  try {
    const resp = await fetch(targetFetchUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(6500),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      },
    });
    if (!resp.ok) return [];
    const html = toLatinDigits(await resp.text());
    const matches =
      html.match(
        /(?:09\d{9}|021\d{8}|026\d{8}|031\d{8}|051\d{8}|071\d{8}|041\d{8}|035\d{8}|025\d{8}|028\d{8}|086\d{8})/g
      ) || [];
    return normalizePhoneList(matches).slice(0, 4);
  } catch {
    return [];
  }
}

async function crawlDivarDirectly(query: string): Promise<any[]> {
  const discovered: any[] = [];
  try {
    const s = await fetch('https://api.divar.ir/v8/postlist/w/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        city_ids: [
          '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15',
        ],
        search_data: {
          form_data: { data: { category: { str: { value: 'ROOT' } } } },
          query,
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!s.ok) return [];
    const sj: any = await s.json().catch(() => ({}));
    const widgets: any[] = Array.isArray(sj?.list_widgets)
      ? sj.list_widgets
      : [];

    for (const w of widgets.slice(0, 12)) {
      const token =
        w?.data?.token || w?.data?.action?.payload?.token;
      if (!token) continue;

      const detailResp = await fetch(
        `https://api.divar.ir/v8/posts-v2/web/${token}`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6500),
        }
      ).catch(() => null);
      if (!detailResp || !detailResp.ok) continue;

      const detailJson: any = await detailResp.json().catch(() => null);
      if (!detailJson) continue;

      const title =
        detailJson?.seo?.web_info?.title || w?.data?.title || '';
      const city = detailJson?.seo?.web_info?.city_persian || 'تهران';
      const district = detailJson?.seo?.web_info?.district_persian || '';
      const fullText = toLatinDigits(JSON.stringify(detailJson?.sections || []));

      // Extract description text from DESCRIPTION section
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
      const hasTextileSublimationKeyword =
        /سابلیمیشن|سابلیمشن|کلندر|کالندر|چاپ پارچه|چاپ روسری|چاپ شال|چاپ پرچم|کالای خواب|چاپ طاقه|لباس ورزشی|چاپ تیشرت|پرس حرارتی/.test(
          combinedText
        );
      const isIrrelevantOrEquipmentSale =
        /فروش دستگاه|فروش پلاتر|فروش کلندر|واردکننده دستگاه|دستگاه چاپ|هد اپسون|سربرگ|کتاب|صحافی|کارت ویزیت|تراکت|کافی نت|افست/.test(
          combinedText
        );

      if (!hasTextileSublimationKeyword || isIrrelevantOrEquipmentSale) {
        continue;
      }

      // Extract phones strictly from description/title text OR via Divar postcontact API if divarToken is set
      const inlinePhones = normalizePhoneList(
        toLatinDigits(combinedText).match(
          /(?:09\d{9}|021[2-9]\d{7}|026[2-9]\d{7}|031[2-9]\d{7}|051[2-9]\d{7}|071[2-9]\d{7}|041[2-9]\d{7}|035[2-9]\d{7}|025[2-9]\d{7})/g
        ) || []
      );
      let contactPhones: string[] = [];
      if (inlinePhones.length === 0 && autoPilotState.divarToken) {
        contactPhones = await fetchDivarContactPhone(
          token,
          autoPilotState.divarToken
        );
      }
      const allPhones = normalizePhoneList([...inlinePhones, ...contactPhones]);

      const slugTitle = String(title)
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\u0600-\u06FFa-zA-Z0-9\-]/g, '');
      const divarUrl = `https://divar.ir/v/${slugTitle}/${token}`;

      discovered.push({
        name: title || 'کارگاه چاپ سابلیمیشن پارچه (آگهی دیوار)',
        city: district ? `${city}، ${district}` : city,
        contactPerson: allPhones[0] || 'نامشخص',
        phones: allPhones,
        handleOrDomain: 'ثبت نشده',
        activityType: title,
        relevanceReason: description
          ? `آگهی مستقیم دیوار: ${description.slice(0, 220)}`
          : `آگهی مستقیم دیوار با عنوان «${title}» در ${city}`,
        evidenceStatus:
          allPhones.length > 0
            ? 'آگهی عمومی دیوار؛ شماره مستقیماً از پنل اطلاعات تماس یا متن آگهی دیوار استخراج شد. فعالیت فعلی و نیاز خرید کاغذ با تماس تلفنی تأیید شود.'
            : 'آگهی دیوار بررسی شد؛ در حال جست‌وجوی نام کارگاه در وب و دایرکتوری‌ها برای استخراج خودکار شماره تماس بدون نیاز به کد پیامکی.',
        sourceUrl: divarUrl,
        fullText,
      });
    }
  } catch (e) {
    console.error('Error in crawlDivarDirectly:', e);
  }
  return discovered;
}

// Direct DuckDuckGo Lite HTML search fallback for Iranian sublimation workshops with phone numbers
async function crawlWebSearchDirectly(query: string): Promise<any[]> {
  const discovered: any[] = [];
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(
      `${query} "0912" OR "021" چاپ سابلیمیشن پارچه کلندر`
    )}`;
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const html = toLatinDigits(await resp.text());
    const resultBlocks = html.split(/class="result__body"/i).slice(1, 10);

    for (const block of resultBlocks) {
      const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(
        /class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i
      );
      const urlMatch = block.match(/href="([^"]+)"/i);

      const cleanTitle = (titleMatch?.[1] || '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const cleanSnippet = (snippetMatch?.[1] || snippetMatch?.[2] || '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      let cleanUrl = urlMatch?.[1] || '';
      const uddgMatch = cleanUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          cleanUrl = decodeURIComponent(uddgMatch[1]);
        } catch {
          // ignore
        }
      }

      if (
        !cleanTitle ||
        cleanTitle.includes('فروش دستگاه') ||
        cleanTitle.includes('رکورد') ||
        cleanTitle.includes('فرارنگ') ||
        cleanTitle.includes('نوین تاک') ||
        cleanTitle.includes('فتوبهمن')
      ) {
        continue;
      }

      const phones = normalizePhoneList(
        (cleanTitle + ' ' + cleanSnippet).match(
          /(?:09\d{9}|021\d{8}|026\d{8}|031\d{8}|051\d{8}|071\d{8}|041\d{8}|035\d{8}|025\d{8})/g
        ) || []
      );

      if (phones.length > 0 && cleanUrl.startsWith('http')) {
        discovered.push({
          name: cleanTitle.slice(0, 95),
          city: 'ایران (استخراج‌شده از وب)',
          contactPerson: 'نامشخص',
          phones,
          handleOrDomain: cleanUrl,
          activityType: 'خدمات چاپ سابلیمیشن پارچه و کلندر',
          relevanceReason: cleanSnippet.slice(0, 220) || cleanTitle,
          evidenceStatus:
            'شماره تلفن و مشخصات مستقیماً از نتایج جست‌وجوی وب و صفحهٔ عمومی مجموعه استخراج شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.',
          sourceUrl: cleanUrl,
        });
      }
    }
  } catch {
    // ignore
  }
  return discovered;
}

// Backfill phone numbers for any existing Divar leads in leads.json once divarToken is saved!
async function backfillExistingDivarLeadPhones() {
  if (!autoPilotState.divarToken) return 0;
  const leadsPath = path.join(WORK_DIR, 'leads.json');
  const leads: any[] = readJsonSafe(leadsPath, []);
  let updatedCount = 0;

  for (const lead of leads) {
    if (Array.isArray(lead.phones) && lead.phones.length > 0) continue;
    const postToken = extractDivarPostToken(lead.sourceUrl);
    if (!postToken) continue;

    const phones = await fetchDivarContactPhone(
      postToken,
      autoPilotState.divarToken
    );
    if (phones.length > 0) {
      lead.phones = phones;
      lead.evidenceStatus =
        'شماره تلفن مستقیماً از پنل «اطلاعات تماس» آگهی دیوار با حساب کاربری استخراج شد؛ نیاز خرید کاغذ نیازمند تماس تلفنی است.';
      lead.preText = formatBaleCard(lead);
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    atomicWriteFileSync(leadsPath, JSON.stringify(leads, null, 2));
    buildAllOutputs();
  }
  return updatedCount;
}

function normalizeNameForDedup(name: string): string {
  return String(name || '')
    .replace(/[\s\-_،,()«»؛:]/g, '')
    .replace(
      /چاپخانه|کارگاه|مجموعه|شرکت|تخصصی|دیجیتال|سابلیمیشن|پارچه|تولیدی|مرکز|خدمات/g,
      ''
    )
    .trim()
    .toLowerCase();
}

function normalizeUrlOrHandleForDedup(val: string): string {
  return String(val || '')
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/+$/, '')
    .trim();
}

function nextLeadId(leads: any[]): string {
  let maxNum = 69;
  for (const item of leads) {
    const m = String(item.id || '').match(/SUB-(?:IR-)?(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `SUB-${String(maxNum + 1).padStart(4, '0')}`;
}

function nextSourceId(sources: any[]): string {
  let maxNum = 0;
  for (const item of sources) {
    const m = String(item.id || '').match(/REF-SRC-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `REF-SRC-${String(maxNum + 1).padStart(3, '0')}`;
}

function nextProspectId(prospects: any[]): string {
  let maxNum = 0;
  for (const item of prospects) {
    const m = String(item.id || '').match(/PROS-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `PROS-${String(maxNum + 1).padStart(3, '0')}`;
}

function nextCycleId(logs: any[]): string {
  let maxNum = 0;
  for (const item of logs) {
    const m = String(item.cycleId || '').match(/CYCLE-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `CYCLE-${String(maxNum + 1).padStart(4, '0')}`;
}

async function resolveBaleGroupChatIds(token: string): Promise<string[]> {
  const candidates = new Set<string>();
  const primaryChatId = String(autoPilotState.baleChatId || DEFAULT_BALE_CHAT_ID || '4657775638').trim();
  return [primaryChatId];
}

let isBaleBatchSending = false;
const claimedBaleIds = new Set<string>();

async function sendSingleLeadToBaleBot(
  lead: any
): Promise<{ ok: boolean; error?: string }> {
  if (!lead?.id) {
    return { ok: false, error: 'شناسه کارت نامعتبر است.' };
  }
  const phones = normalizePhoneList(lead?.phones);
  if (phones.length === 0) {
    return { ok: false, error: 'کارت فاقد شماره تلفن است و ارسال نمی‌شود.' };
  }

  const balePath = path.join(WORK_DIR, 'bale-delivery.json');
  const baleData = readJsonSafe(balePath, {
    targetGroupTitle: DEFAULT_BALE_GROUP_TITLE,
    targetGroupUrl: 'https://web.bale.ai/chat?uid=4657775638',
    targetGroupUid: DEFAULT_BALE_CHAT_ID,
    deliveredIds: [] as string[],
    deliveries: [] as any[],
  });

  if (baleData.deliveredIds.includes(lead.id) || claimedBaleIds.has(lead.id)) {
    return { ok: true };
  }

  const token = (autoPilotState.baleBotToken || DEFAULT_BALE_BOT_TOKEN).trim();
  if (!token) {
    return { ok: false, error: 'توکن ربات بله ثبت نشده است.' };
  }

  // Reserve lead.id synchronously before any async network request to prevent duplicate sends
  claimedBaleIds.add(lead.id);

  const cardText = formatBaleCard(lead);
  const chatIdCandidates = await resolveBaleGroupChatIds(token);
  let lastError = '';

  for (const chatId of chatIdCandidates) {
    try {
      const resp = await fetch(`https://tapi.bale.ai/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: cardText,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data: any = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok !== false) {
        autoPilotState.baleChatId = chatId;
        autoPilotState.lastBotStatus = `کارت ${lead.id} با موفقیت فقط یک‌بار به گروه بله (${chatId}) ارسال شد.`;
        saveBaleConfig();

        const freshBaleData = readJsonSafe(balePath, baleData);
        if (!freshBaleData.deliveredIds.includes(lead.id)) {
          freshBaleData.deliveredIds.push(lead.id);
          freshBaleData.deliveries.unshift({
            leadId: lead.id,
            deliveredAt: getIsoDateOnly(),
            isoTimestamp: new Date().toISOString(),
            targetGroup: `${DEFAULT_BALE_GROUP_TITLE} (${chatId})`,
            method: 'ارسال خودکار یکتا با ربات بله',
          });
          atomicWriteFileSync(balePath, JSON.stringify(freshBaleData, null, 2));
        }
        return { ok: true };
      } else {
        lastError = data?.description || `HTTP ${resp.status}`;
      }
    } catch (e: any) {
      lastError = e?.message || String(e);
    }
  }

  // Release reservation only if sending failed completely so a future cycle can retry
  claimedBaleIds.delete(lead.id);
  autoPilotState.lastBotStatus = `در انتظار اتصال سرور بله (${lastError})`;
  saveBaleConfig();
  return { ok: false, error: lastError };
}

async function sendAllUndeliveredToBaleSeparately() {
  if (isBaleBatchSending) {
    return {
      ok: true,
      sentCount: 0,
      remainingCount: 0,
      botStatus: autoPilotState.lastBotStatus,
    };
  }

  const token = (autoPilotState.baleBotToken || DEFAULT_BALE_BOT_TOKEN).trim();
  if (!token) {
    return {
      ok: false,
      sentCount: 0,
      error: 'توکن ربات بله وارد نشده است.',
    };
  }

  isBaleBatchSending = true;
  try {
    const leads: any[] = readJsonSafe(path.join(WORK_DIR, 'leads.json'), []);
    const baleData = readJsonSafe(path.join(WORK_DIR, 'bale-delivery.json'), {
      deliveredIds: [] as string[],
    });
    const deliveredSet = new Set(baleData.deliveredIds || []);

    const pendingLeads = leads.filter(
      (l) =>
        !deliveredSet.has(l.id) &&
        !claimedBaleIds.has(l.id) &&
        Number(String(l.id).replace('SUB-', '')) >= 70 &&
        Array.isArray(l.phones) &&
        l.phones.length > 0
    );

    let sentCount = 0;
    let lastErr = '';

    for (const lead of pendingLeads) {
      const res = await sendSingleLeadToBaleBot(lead);
      if (res.ok) {
        sentCount++;
        await new Promise((r) => setTimeout(r, 900));
      } else {
        lastErr = res.error || 'خطای ارتباط';
        break;
      }
    }

    return {
      ok: sentCount > 0 || pendingLeads.length === 0,
      sentCount,
      remainingCount: pendingLeads.length - sentCount,
      error: lastErr,
      botStatus: autoPilotState.lastBotStatus,
    };
  } finally {
    isBaleBatchSending = false;
  }
}

const MIN_NEW_CARDS_PER_CYCLE = 2;
let cardsFoundInCurrentWindow = 0;

async function runDiscoveryCycle(customCityOrQuery?: string) {
  if (autoPilotState.isRunningCycle) {
    return { skipped: true, reason: 'یک دور جست‌وجو هم‌اکنون در حال اجراست.' };
  }

  autoPilotState.isRunningCycle = true;
  const strategyState = loadCreativeStrategyState();

  try {
    ensureDirectories();
    const leadsPath = path.join(WORK_DIR, 'leads.json');
    const referralPath = path.join(WORK_DIR, 'referral-network.json');
    const logPath = path.join(WORK_DIR, 'research-log.json');

    const leads: any[] = readJsonSafe(leadsPath, []);
    const referral: { sources: any[]; prospects: any[] } = readJsonSafe(
      referralPath,
      { sources: [], prospects: [] }
    );
    const logs: any[] = readJsonSafe(logPath, []);

    const existingPhones = new Set<string>();
    const existingNormNames = new Set<string>();
    const existingUrlsAndHandles = new Set<string>();

    for (const l of leads) {
      for (const p of normalizePhoneList(l.phones)) {
        existingPhones.add(p);
      }
      const nn = normalizeNameForDedup(l.name);
      if (nn.length >= 3) existingNormNames.add(nn);
      if (l.sourceUrl) {
        for (const u of String(l.sourceUrl).split(/\n+/)) {
          const nu = normalizeUrlOrHandleForDedup(u);
          if (nu.length >= 5) existingUrlsAndHandles.add(nu);
        }
      }
      if (l.handleOrDomain && l.handleOrDomain !== 'ثبت نشده') {
        const nh = normalizeUrlOrHandleForDedup(l.handleOrDomain);
        if (nh.length >= 4) existingUrlsAndHandles.add(nh);
      }
    }

    const vendorPhones = new Set<string>([
      '02148315',
      '02188306332',
      '02188848050',
      '02188846393',
    ]);
    for (const s of referral.sources || []) {
      if (s.phones) {
        for (const vp of normalizePhoneList(s.phones)) {
          vendorPhones.add(vp);
        }
      }
    }

    const todayIso = getIsoDateOnly();
    const addedLeads: any[] = [];
    const addedProspects: any[] = [];
    const addedSources: any[] = [];
    const allGroundedUrls: string[] = [];
    const allIncomingIdeas: string[] = [];
    let lastTargetCity = '';
    let round = 0;
    const MAX_ROUNDS_UNTIL_MIN_CARDS = 5;

    // Keep searching across multiple strategies/keywords until at least MIN_NEW_CARDS_PER_CYCLE (2) new cards are found!
    while (
      addedLeads.length < MIN_NEW_CARDS_PER_CYCLE &&
      round < MAX_ROUNDS_UNTIL_MIN_CARDS
    ) {
      round++;
      let targetCity = '';
      if (round === 1 && customCityOrQuery?.trim()) {
        targetCity = customCityOrQuery.trim();
      } else {
        targetCity =
          strategyState.activeQueue.shift() ||
          'کارگاه‌های چاپ سابلیمیشن پارچه و کلندر در سراسر ایران';
        strategyState.executedHistory.push(targetCity);
        if (strategyState.executedHistory.length > 500) {
          strategyState.executedHistory = strategyState.executedHistory.slice(-500);
        }
      }
      lastTargetCity = targetCity;

      // Pick 3 rotating keywords per pass for multi-keyword direct Divar & web crawling
      const activeKeywordsBatch: string[] = [];
      for (let i = 0; i < 3; i++) {
        const q = strategyState.divarQueriesQueue.shift() || 'چاپ سابلیمیشن';
        activeKeywordsBatch.push(q);
        strategyState.divarQueriesQueue.push(q);
      }
      autoPilotState.currentCityIndex = 0;

      // 1. Direct Divar API crawl + Direct Web Search crawl across rotating keywords in parallel
      const [divarBatchResults, webBatchResults] = await Promise.all([
        Promise.all(activeKeywordsBatch.map((kw) => crawlDivarDirectly(kw))),
        Promise.all(activeKeywordsBatch.map((kw) => crawlWebSearchDirectly(kw))),
      ]);
      const directDivarCandidates = divarBatchResults.flat();
      const directWebCandidates = webBatchResults.flat();

      const unnumberedDivarClues = directDivarCandidates
        .filter((c) => !Array.isArray(c.phones) || c.phones.length === 0)
        .slice(0, 10)
        .map(
          (c) =>
            `عنوان آگهی دیوار: «${c.name}» در «${c.city}» — توضیحات: ${String(
              c.relevanceReason || ''
            ).slice(0, 160)} (${c.sourceUrl})`
        )
        .join('\n');

      // 2. Gemini + Google Search creative discovery
      const existingNames = leads.map((l) => l.name).slice(-60).join(' ، ');
      const existingSamplePhones = Array.from(existingPhones).slice(-50).join(', ');

      const searchPrompt = `تو مدیر ارشد فروش و پژوهشگر بازار «فروش رول کاغذ سابلیمیشن پارچه» در ایران هستی.
هدف ما: ما فروشندهٔ «کاغذ سابلیمیشن» هستیم و می‌خواهیم کارگاه‌ها، چاپخانه‌های پارچه، کارخانه‌های نساجی و تولیدی‌هایی را پیدا کنیم که خودشان دستگاه پلاتر سابلیمیشن و کلندر حرارتی دارند و مصرف‌کننده و خریدار واقعی رول کاغذ سابلیمیشن هستند.
محور جست‌وجوی این دور ۲ ساعته (تلاش شماره ${round} برای یافتن حداقل ۲ کارت جدید):
«${targetCity}»

کلیدواژه‌های الزامی جست‌وجو (با هر دو املای رایج در بازار ایران):
«چاپ دیجیتال»، «چاپ سابلیمیشن»، «چاپ پارچه»، «کلندر»، «کالندر»، «سابلیمیشن»، «سابلیمشن»، «اپراتور چاپ»، «اپراتور کلندر»، «اپراتور کالندر»، «کارگر چاپ»، «کارگر کلندر»، «کارگر کالندر»، «کلندرکار»، «کالندرکار»، «چاپ طاقه»، «چاپ رول پارچه»، «اپراتور پلاتر»، «طراح راپورت پارچه» (کلیدواژه‌های ویژه این دور: ${activeKeywordsBatch.join(' ، ')})

${
  unnumberedDivarClues
    ? `آگهی‌های زنده کشف‌شده از دیوار در همین لحظه (که باید بدون نیاز به کد پیامکی دیوار، نام کارگاه/مجموعه آن‌ها را در گوگل، بلد، نشان، تلگرام و اینستاگرام جست‌وجو کنی و شماره تلفن مستقیمشان را پیدا کنی):\n${unnumberedDivarClues}\n`
    : ''
}
قوانین بسیار مهم و الزامی:
1. در این نوبت باید حداقل ۲ تا ۵ مشتری واقعی جدید دارای شماره تلفن معتبر پیدا کنی که در لیست قبلی نباشند.
2. تمرکز صددرصدی روی خریدار کاغذ سابلیمیشن: فقط مجموعه‌هایی را ثبت کن که خط چاپ سابلیمیشن رول پارچه یا پرس حرارتی تیراژ بالا دارند (چاپخانه‌های طاقه‌ای پارچه، خدمات کلندر، تولیدی‌های لباس ورزشی، پرچم، شال و روسری، روتختی و کالای خواب، پرده چاپی، فرشینه و موکت چاپی).
3. پایش گسترده تمام سایت‌های آگهی ایرانی + شبکه‌های اجتماعی (بدون نیاز به کد پیامکی):
   - سایت‌های آگهی و نیازمندی‌های ایرانی: شیپور (sheypoor.com)، ایستگاه (istgah.com)، نیازروز (niazerooz.com)، ایران‌تجارت (irantejarat.com)، راهنما همشهری (rahnama.com)، باسکول (buskool.com)، نیازمشاغل (niazemashaghel.ir)، ای‌استخدام (e-estekhdam.com)، کارپیشه (karpishe.com)، جابینجا (jobinja.ir) و جاب‌ویژن (jobvision.ir).
   - دایرکتوری‌های صنعتی و چاپ ایران: چاپشو (chapshoo.com)، بازار چاپ ایران (iranprintmart.ir)، بهترینو (behtarino.com)، نقشه بلد (balad.ir)، نشان (neshan.org) و اول (avval.ir).
   - تلگرام (site:t.me و site:t.me/s)، اینستاگرام (site:instagram.com) و لینکدین (site:linkedin.com) و کارگاه‌های خریدار دستگاه از شرکت رکورد (chap.record).
4. استخراج حتمی شماره تلفن: هرگز کارتی بدون شماره تلفن ثبت نکن!
5. عدم تکرار مطلق: هیچ‌کدام از مجموعه‌ها یا شماره‌های قبلی را تکرار نکن. نام‌های اخیر ثبت‌شده: (${existingNames}) و شماره‌های اخیر: (${existingSamplePhones}).
6. حذف کامل رقبا و فروشندگان کاغذ/دستگاه: شرکت‌هایی که خودشان فروشنده کاغذ سابلیمیشن، فروشنده دستگاه چاپ و کلندر یا جوهر هستند (مانند شرکت رکورد 02148315، نوین‌تاک، فرارنگ، فتوبهمن، فبتاک) رقیب ما هستند؛ هرگز آن‌ها را در newLeads نگذار.
7. شماره‌ها را به صورت ارقام لاتین (0-9) با صفر آغازین بنویس (مانند 0912... یا 021...).
8. زایش بی‌پایان ایده‌های خلاقانه: در هر دور حتماً ۳ ایده و زاویهٔ خلاقانهٔ کاملاً جدید در آرایه newCreativeIdeas و ۲ کلیدواژه جدید در newDivarQueries تولید کن.

خروجی را فقط به صورت یک آبجکت JSON معتبر برگردان:
{
  "sourcesChecked": ["لیست منابع بررسی شده"],
  "limitations": "توضیح کوتاه فارسی درباره محدودیت‌های این دور",
  "nextStep": "مرحله بعد",
  "newCreativeIdeas": ["ایده ۱", "ایده ۲", "ایده ۳"],
  "newDivarQueries": ["عبارت ۱", "عبارت ۲"],
  "newLeads": [
    {
      "name": "نام دقیق چاپخانه، کارگاه یا تولیدی",
      "city": "شهر و نشانی دقیق",
      "contactPerson": "نام مسئول اعلام‌شده یا نامشخص",
      "phones": ["0912...", "021..."],
      "handleOrDomain": "وب‌سایت، اینستاگرام یا تلگرام مجموعه",
      "activityType": "خلاصه فعالیت چاپ سابلیمیشن پارچه، کلندر، لباس ورزشی، پرچم، شال و روسری یا کالای خواب",
      "relevanceReason": "توضیح دقیق دلیل تناسب و نحوه استخراج شماره تماس از منبع",
      "evidenceStatus": "وضعیت تأیید دقیق",
      "sourceUrl": "https://..."
    }
  ],
  "newProspects": [],
  "newSources": []
}`;

      let rawText = '{}';
      const groundedUrls: string[] = [];
      const candidateModels = [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
      ];

      for (const modelName of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: searchPrompt,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });
          rawText = response.text || '{}';
          const groundingChunks =
            response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
          for (const ch of groundingChunks) {
            if (ch.web?.uri) {
              groundedUrls.push(ch.web.uri);
              allGroundedUrls.push(ch.web.uri);
            }
          }
          break;
        } catch (geminiErr: any) {
          console.warn(
            `Model ${modelName} encountered an issue in round ${round}:`,
            geminiErr?.message || String(geminiErr)
          );
        }
      }

      let parsed: any = {};
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } catch {
        parsed = {};
      }

      // Endless Self-Updating Creative Idea Engine
      const allKnownIdeas = new Set<string>([
        ...strategyState.activeQueue,
        ...strategyState.executedHistory,
      ]);
      if (Array.isArray(parsed.newCreativeIdeas)) {
        for (const item of parsed.newCreativeIdeas) {
          if (typeof item === 'string' && item.trim().length > 15) {
            const trimmed = item.trim();
            allIncomingIdeas.push(trimmed);
            if (!allKnownIdeas.has(trimmed)) {
              allKnownIdeas.add(trimmed);
              strategyState.activeQueue.push(trimmed);
              strategyState.totalGenerated += 1;
            }
          }
        }
      }
      if (Array.isArray(parsed.newDivarQueries)) {
        const knownQueries = new Set(strategyState.divarQueriesQueue);
        for (const q of parsed.newDivarQueries) {
          if (
            typeof q === 'string' &&
            q.trim().length >= 4 &&
            q.trim().length <= 45 &&
            !knownQueries.has(q.trim())
          ) {
            knownQueries.add(q.trim());
            strategyState.divarQueriesQueue.push(q.trim());
          }
        }
      }

      if (Array.isArray(parsed.newSources)) {
        for (const src of parsed.newSources) {
          if (!src?.name) continue;
          if (
            String(src.verifiedSocialHandle || '')
              .toLowerCase()
              .includes('fararangco')
          ) {
            continue;
          }
          const normSrcName = normalizeNameForDedup(src.name);
          const alreadyExists = (referral.sources || []).some(
            (s) => normalizeNameForDedup(s.name) === normSrcName
          );
          if (!alreadyExists && normSrcName.length >= 2) {
            const newSrcObj = {
              id: nextSourceId(referral.sources),
              name: String(src.name).trim(),
              role: String(
                src.role || 'فروشنده ملزومات / نصاب تجهیزات سابلیمیشن'
              ).trim(),
              city: String(src.city || 'ایران').trim(),
              website: String(src.website || groundedUrls[0] || '-'),
              verifiedSocialHandle: String(src.verifiedSocialHandle || '-'),
              notes: String(src.notes || 'فروشنده یا نصاب؛ مصرف‌کننده نهایی نیست.'),
              updatedAt: todayIso,
            };
            referral.sources.push(newSrcObj);
            addedSources.push(newSrcObj);
          }
        }
      }

      const combinedCandidates = [
        ...directDivarCandidates,
        ...directWebCandidates,
        ...(Array.isArray(parsed.newLeads) ? parsed.newLeads : []),
      ];

      for (const item of combinedCandidates) {
        if (!item?.name) continue;
        const roleOrAct = String(item.activityType || '');
        if (
          roleOrAct.includes('فروش دستگاه') ||
          roleOrAct.includes('واردکننده دستگاه') ||
          roleOrAct.includes('فروش کاغذ') ||
          roleOrAct.includes('تعمیرکار')
        ) {
          continue;
        }

        const itemSourceUrl = String(
          item.sourceUrl || groundedUrls[0] || ''
        ).trim();
        let phones = normalizePhoneList(item.phones).filter(
          (p) => !vendorPhones.has(p)
        );

        if (phones.length === 0 && itemSourceUrl.startsWith('http')) {
          const scraped = await extractPhonesFromSourceUrl(itemSourceUrl);
          phones = scraped.filter((p) => !vendorPhones.has(p));
        }

        const normName = normalizeNameForDedup(item.name);
        const normUrl = normalizeUrlOrHandleForDedup(itemSourceUrl);

        if (phones.length === 0) {
          if (normName.length >= 3) {
            referral.prospects = referral.prospects || [];
            const alreadyProspect = referral.prospects.some(
              (pr) => normalizeUrlOrHandleForDedup(pr.sourceUrl) === normUrl
            );
            if (!alreadyProspect) {
              referral.prospects.push({
                id: nextProspectId(referral.prospects),
                name: String(item.name).trim(),
                city: String(item.city || '-').trim(),
                sourceUrl: itemSourceUrl || '-',
                notes:
                  'آگهی یافت شد؛ در صف استخراج شماره تلفن از دایرکتوری‌های عمومی.',
                updatedAt: todayIso,
              });
              addedProspects.push(item.name);
            }
          }
          continue;
        }

        const hasDuplicatePhone = phones.some((p) => existingPhones.has(p));
        const hasDuplicateName =
          normName.length >= 4 && existingNormNames.has(normName);
        const hasDuplicateUrl =
          normUrl.length >= 8 &&
          !normUrl.includes('divar.ir/s/') &&
          !normUrl.includes('chapshoo.com') &&
          !normUrl.includes('iranprintmart.ir') &&
          !normUrl.includes('iran-tejarat.com') &&
          existingUrlsAndHandles.has(normUrl);

        if (hasDuplicatePhone || hasDuplicateName || hasDuplicateUrl) {
          continue;
        }

        const newId = nextLeadId(leads);
        const newLeadObj: any = {
          id: newId,
          name: String(item.name).trim(),
          city: String(item.city || 'ایران').trim(),
          contactPerson: String(item.contactPerson || 'نامشخص').trim(),
          activityType: String(
            item.activityType || 'چاپ سابلیمیشن پارچه و کلندر'
          ).trim(),
          phones,
          handleOrDomain: String(item.handleOrDomain || 'ثبت نشده')
            .replace(/fararangco/gi, 'ثبت نشده')
            .trim(),
          address: String(item.city || '-').trim(),
          equipment: String(
            item.relevanceReason ||
              item.equipment ||
              'معرفی عمومی خدمات چاپ سابلیمیشن روی پارچه و انتقال حرارتی با کلندر.'
          ).trim(),
          evidenceStatus: String(
            item.evidenceStatus ||
              'صفحه عمومی و شماره تماس بررسی و استخراج شد؛ فعالیت جاری و نیاز خرید کاغذ تأیید نشده‌اند.'
          ).trim(),
          sourceUrl: itemSourceUrl || '-',
          updatedAt: todayIso,
          colL_status: 'سرنخ تازه آماده ارسال به بله',
          colM_callResult: '',
          colN_paperSpec: '',
          colO_notes: '',
        };
        newLeadObj.preText = formatBaleCard(newLeadObj);

        leads.push(newLeadObj);
        addedLeads.push(newLeadObj);
        if (normName.length >= 4) existingNormNames.add(normName);
        if (normUrl.length >= 8) existingUrlsAndHandles.add(normUrl);
        for (const p of phones) existingPhones.add(p);
      }
    }

    // Ensure activeQueue never runs low by synthesizing fresh city × niche × signal combinations
    const allKnownIdeasFinal = new Set<string>([
      ...strategyState.activeQueue,
      ...strategyState.executedHistory,
    ]);
    if (strategyState.activeQueue.length < 15) {
      const synthesized = synthesizeCombinatorialIdeas(allKnownIdeasFinal, 10);
      strategyState.activeQueue.push(...synthesized);
      strategyState.totalGenerated += synthesized.length;
    }

    strategyState.lastUpdatedAt = new Date().toISOString();
    atomicWriteFileSync(
      CREATIVE_STRATEGIES_PATH,
      JSON.stringify(strategyState, null, 2)
    );

    atomicWriteFileSync(leadsPath, JSON.stringify(leads, null, 2));
    atomicWriteFileSync(referralPath, JSON.stringify(referral, null, 2));

    if (autoPilotState.baleBotToken && addedLeads.length > 0) {
      await sendAllUndeliveredToBaleSeparately();
    }

    const logEntry = {
      cycleId: nextCycleId(logs),
      timestamp: new Date().toISOString(),
      isoTimestamp: new Date().toISOString(),
      targetCity: lastTargetCity,
      sourcesChecked: allGroundedUrls.slice(0, 8),
      newLeadsAdded: addedLeads.length,
      newProspectsAdded: addedProspects.length,
      newSourcesAdded: addedSources.length,
      newCreativeIdea: allIncomingIdeas.slice(0, 3).join(' | '),
      limitations:
        addedLeads.length >= MIN_NEW_CARDS_PER_CYCLE
          ? `سهمیهٔ حداقل ${MIN_NEW_CARDS_PER_CYCLE} کارت جدید در این نوبت تکمیل شد (${addedLeads.length} کارت جدید ثبت گردید).`
          : `در حال ادامهٔ بی‌وقفهٔ جست‌وجو تا تکمیل حداقل ${MIN_NEW_CARDS_PER_CYCLE} کارت جدید در این نوبت.`,
      nextStep:
        addedLeads.length >= MIN_NEW_CARDS_PER_CYCLE
          ? 'توقف ۲ ساعته پس از تکمیل حداقل ۲ کارت جدید و شروع نوبت بعدی رأس ۲ ساعت آینده'
          : 'ادامهٔ فوری جست‌وجو تا رسیدن به حداقل ۲ کارت جدید',
    };

    logs.unshift(logEntry);
    if (logs.length > 100) logs.length = 100;
    atomicWriteFileSync(logPath, JSON.stringify(logs, null, 2));

    const buildSummary = buildAllOutputs();

    cardsFoundInCurrentWindow += addedLeads.length;
    autoPilotState.lastRunAt = new Date().toISOString();

    if (cardsFoundInCurrentWindow >= MIN_NEW_CARDS_PER_CYCLE) {
      // Quota of >= 2 new cards met! Enter 2-hour rest until next window.
      autoPilotState.nextRunAt = new Date(
        Date.now() + autoPilotState.intervalSeconds * 1000
      ).toISOString();
      autoPilotState.lastCycleSummary = `${cardsFoundInCurrentWindow} کارت جدید با شماره تلفن معتبر در این نوبت پیدا شد (حداقل ۲ کارت تکمیل گردید)؛ نوبت بعدی ۲ ساعت دیگر (مجموع: ${leads.length} مشتری)`;
      cardsFoundInCurrentWindow = 0;
    } else {
      // Fewer than 2 cards found so far in this window -> DO NOT stop for 2 hours! Continue after 30 seconds.
      autoPilotState.nextRunAt = new Date(Date.now() + 30 * 1000).toISOString();
      autoPilotState.lastCycleSummary = `تا این لحظه ${cardsFoundInCurrentWindow} کارت از حداقل ۲ کارت این نوبت پیدا شده است؛ جست‌وجو بدون توقف ادامه دارد تا حداقل ۲ کارت کامل شود (مجموع: ${leads.length} مشتری)`;
    }
    saveBaleConfig();

    return {
      ok: true,
      logEntry,
      addedLeads,
      addedProspects,
      addedSources,
      buildSummary,
    };
  } catch (err: any) {
    console.error('Error in runDiscoveryCycle:', err);
    autoPilotState.nextRunAt = new Date(Date.now() + 30 * 1000).toISOString();
    saveBaleConfig();
    return { ok: false, error: err?.message || String(err) };
  } finally {
    autoPilotState.isRunningCycle = false;
  }
}

async function startServer() {
  ensureDirectories();
  buildAllOutputs();

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true, now: new Date().toISOString(), nextRunAt: autoPilotState.nextRunAt });
  });

  // Immediate check 3 seconds after server startup so if the container woke up after a missed 2-hour window, it runs immediately!
  setTimeout(async () => {
    if (autoPilotState.baleBotToken) {
      await sendAllUndeliveredToBaleSeparately().catch(() => {});
    }
    if (autoPilotState.enabled && !autoPilotState.isRunningCycle) {
      const now = Date.now();
      const nextTime = new Date(autoPilotState.nextRunAt).getTime();
      if (isNaN(nextTime) || now >= nextTime) {
        runDiscoveryCycle().catch((e) =>
          console.error('Startup catch-up discovery cycle failed:', e)
        );
      }
    }
  }, 3000);

  // External self-keepalive ping every 3 minutes to keep Cloud Run instance warm as long as possible
  setInterval(() => {
    const urls = [
      'https://ais-pre-fs3riny74dqvjchsa46w2w-876113692397.us-east1.run.app/api/ping',
      'https://ais-dev-fs3riny74dqvjchsa46w2w-876113692397.us-east1.run.app/api/ping',
    ];
    for (const u of urls) {
      fetch(u, { signal: AbortSignal.timeout(6000) }).catch(() => {});
    }
  }, 180000);

  // Background check every 15 seconds: runs the discovery cycle when the 2-hour timer expires
  setInterval(async () => {
    if (autoPilotState.baleBotToken) {
      await sendAllUndeliveredToBaleSeparately().catch(() => {});
    }
    if (autoPilotState.enabled && !autoPilotState.isRunningCycle) {
      const now = Date.now();
      const nextTime = new Date(autoPilotState.nextRunAt).getTime();
      if (isNaN(nextTime) || now >= nextTime) {
        runDiscoveryCycle().catch((e) =>
          console.error('AutoPilot background 2-hour cycle failed:', e)
        );
      }
    }
  }, 15000);

  app.get('/api/workspace', (_req, res) => {
    const leads = readJsonSafe(path.join(WORK_DIR, 'leads.json'), []);
    const referral = readJsonSafe(path.join(WORK_DIR, 'referral-network.json'), {
      sources: [],
      prospects: [],
    });
    const logs = readJsonSafe(path.join(WORK_DIR, 'research-log.json'), []);
    const baleDelivery = readJsonSafe(
      path.join(WORK_DIR, 'bale-delivery.json'),
      {
        targetGroupTitle: DEFAULT_BALE_GROUP_TITLE,
        targetGroupUrl: 'https://web.bale.ai/chat?uid=4657775638',
        targetGroupUid: DEFAULT_BALE_CHAT_ID,
        deliveredIds: [],
        deliveries: [],
      }
    );

    res.json({
      leads,
      referral,
      logs,
      baleDelivery,
      autoPilot: {
        ...autoPilotState,
        hasBaleToken: Boolean(autoPilotState.baleBotToken),
        hasDivarToken: Boolean(autoPilotState.divarToken),
      },
      cities: getCreativeStrategies(),
    });
  });

  // 1-Time Divar SMS Login (Step 1: Send OTP code from Divar to phone)
  app.post('/api/divar/send-otp', async (req, res) => {
    const rawPhone = toLatinDigits(req.body?.phone || '').replace(/\D/g, '');
    const phone = rawPhone.startsWith('98')
      ? '0' + rawPhone.slice(2)
      : rawPhone.startsWith('9')
      ? '0' + rawPhone
      : rawPhone;

    if (!/^09\d{9}$/.test(phone)) {
      res.status(400).json({
        ok: false,
        error: 'شماره موبایل را به صورت ۱۱ رقمی با صفر آغازین وارد کنید (مثلاً 0912...).',
      });
      return;
    }

    try {
      const resp = await fetch('https://api.divar.ir/v5/auth/authenticate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({ phone }),
        signal: AbortSignal.timeout(10000),
      });
      const data: any = await resp.json().catch(() => ({}));
      if (resp.ok) {
        autoPilotState.divarPhone = phone;
        saveBaleConfig();
        res.json({
          ok: true,
          message: `کد تأیید پیامکی دیوار به شماره ${phone} ارسال شد.`,
          data,
        });
      } else {
        res.status(resp.status).json({
          ok: false,
          error: data?.message || 'خطا در ارسال پیامک از سمت دیوار',
        });
      }
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // 1-Time Divar SMS Login (Step 2: Confirm OTP code and permanently save Divar token)
  app.post('/api/divar/verify-otp', async (req, res) => {
    const rawPhone = toLatinDigits(
      req.body?.phone || autoPilotState.divarPhone || ''
    ).replace(/\D/g, '');
    const phone = rawPhone.startsWith('98')
      ? '0' + rawPhone.slice(2)
      : rawPhone.startsWith('9')
      ? '0' + rawPhone
      : rawPhone;
    const code = toLatinDigits(req.body?.code || '').replace(/\D/g, '');

    if (!phone || !code) {
      res.status(400).json({
        ok: false,
        error: 'شماره موبایل و کد پیامکی دیوار را وارد کنید.',
      });
      return;
    }

    try {
      const resp = await fetch('https://api.divar.ir/v5/auth/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({ phone, code }),
        signal: AbortSignal.timeout(10000),
      });
      const data: any = await resp.json().catch(() => ({}));
      const token = data?.token || data?.access_token;
      if (resp.ok && token) {
        autoPilotState.divarToken = token;
        autoPilotState.divarPhone = phone;
        saveBaleConfig();

        const backfilled = await backfillExistingDivarLeadPhones();
        res.json({
          ok: true,
          divarPhone: phone,
          backfilledCount: backfilled,
          message: `حساب دیوار (${phone}) به صورت دائمی متصل و ذخیره شد! (${backfilled} کارت قبلی دیوار هم شماره‌دار شد)`,
        });
      } else {
        res.status(400).json({
          ok: false,
          error: data?.message || 'کد واردشده معتبر نیست یا منقضی شده است.',
        });
      }
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/bale/pending', (_req, res) => {
    const leads: any[] = readJsonSafe(path.join(WORK_DIR, 'leads.json'), []);
    const baleDelivery = readJsonSafe(
      path.join(WORK_DIR, 'bale-delivery.json'),
      {
        targetGroupTitle: DEFAULT_BALE_GROUP_TITLE,
        targetGroupUrl: 'https://web.bale.ai/chat?uid=4657775638',
        targetGroupUid: DEFAULT_BALE_CHAT_ID,
        deliveredIds: [] as string[],
        deliveries: [] as any[],
      }
    );
    const deliveredSet = new Set(baleDelivery.deliveredIds || []);
    const pending = leads
      .filter(
        (l) =>
          !deliveredSet.has(l.id) &&
          Number(String(l.id).replace('SUB-', '')) >= 70 &&
          Array.isArray(l.phones) &&
          l.phones.length > 0
      )
      .map((l) => ({
        id: l.id,
        name: l.name,
        text: formatBaleCard(l),
      }));

    res.json({
      targetGroupTitle: DEFAULT_BALE_GROUP_TITLE,
      targetGroupUid: DEFAULT_BALE_CHAT_ID,
      pending,
    });
  });

  app.post('/api/bale/send-all-new', async (_req, res) => {
    const result = await sendAllUndeliveredToBaleSeparately();
    res.json(result);
  });

  app.post('/api/bale/send-one', async (req, res) => {
    const { leadId } = req.body || {};
    const leads: any[] = readJsonSafe(path.join(WORK_DIR, 'leads.json'), []);
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) {
      res.status(404).json({ ok: false, error: 'کارت مورد نظر یافت نشد.' });
      return;
    }
    const result = await sendSingleLeadToBaleBot(lead);
    res.json(result);
  });

  app.post('/api/bale/mark-delivered', (req, res) => {
    const { leadIds, method } = req.body || {};
    const ids: string[] = Array.isArray(leadIds)
      ? leadIds
      : [leadIds].filter(Boolean);
    const balePath = path.join(WORK_DIR, 'bale-delivery.json');
    const baleData = readJsonSafe(balePath, {
      targetGroupTitle: DEFAULT_BALE_GROUP_TITLE,
      targetGroupUrl: 'https://web.bale.ai/chat?uid=4657775638',
      targetGroupUid: DEFAULT_BALE_CHAT_ID,
      deliveredIds: [] as string[],
      deliveries: [] as any[],
    });

    const deliveredSet = new Set(baleData.deliveredIds || []);
    const nowDate = getIsoDateOnly();
    let newlyRecorded = 0;

    for (const id of ids) {
      if (!deliveredSet.has(id)) {
        deliveredSet.add(id);
        baleData.deliveredIds.push(id);
        baleData.deliveries.unshift({
          leadId: id,
          deliveredAt: nowDate,
          isoTimestamp: new Date().toISOString(),
          targetGroup: 'بانک مشتری کاغذ سابلیمیشن (4657775638)',
          method: method || 'ارسال خودکار به گروه بله',
        });
        newlyRecorded++;
      }
    }

    atomicWriteFileSync(balePath, JSON.stringify(baleData, null, 2));
    buildAllOutputs();
    res.json({ ok: true, newlyRecorded, baleDelivery: baleData });
  });

  app.post('/api/run-cycle', async (req, res) => {
    const { cityOrQuery } = req.body || {};
    const result = await runDiscoveryCycle(cityOrQuery);
    res.json(result);
  });

  app.post('/api/auto-pilot', async (req, res) => {
    const { enabled, intervalSeconds, baleBotToken, baleChatId, divarToken } =
      req.body || {};
    if (typeof enabled === 'boolean') autoPilotState.enabled = enabled;
    if (typeof intervalSeconds === 'number' && intervalSeconds >= 60) {
      autoPilotState.intervalSeconds = intervalSeconds;
      autoPilotState.nextRunAt = new Date(
        Date.now() + intervalSeconds * 1000
      ).toISOString();
    }
    if (typeof baleChatId === 'string' && baleChatId.trim()) {
      autoPilotState.baleChatId = baleChatId.trim();
    }
    if (typeof baleBotToken === 'string' && baleBotToken.trim()) {
      autoPilotState.baleBotToken = baleBotToken.trim();
    }
    if (typeof divarToken === 'string' && divarToken.trim()) {
      autoPilotState.divarToken = divarToken.trim();
      await backfillExistingDivarLeadPhones();
    }
    saveBaleConfig();
    res.json({ ok: true, autoPilot: autoPilotState });
  });

  app.get('/api/download/xlsx', (_req, res) => {
    buildAllOutputs();
    const filePath = path.join(OUTPUTS_DIR, 'sublimation-leads.xlsx');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="sublimation-leads.xlsx"'
    );
    res.sendFile(filePath);
  });

  app.get('/api/download/html', (_req, res) => {
    buildAllOutputs();
    const filePath = path.join(OUTPUTS_DIR, 'sublimation-copy.html');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="sublimation-copy.html"'
    );
    res.sendFile(filePath);
  });

  app.get('/api/download/json/:name', (req, res) => {
    const allowed: Record<string, string> = {
      leads: 'leads.json',
      'referral-network': 'referral-network.json',
      'research-log': 'research-log.json',
      'bale-delivery': 'bale-delivery.json',
      'creative-strategies': 'creative-strategies.json',
    };
    const fileName = allowed[req.params.name];
    if (!fileName) {
      res.status(404).send('File not found');
      return;
    }
    const filePath = path.join(WORK_DIR, fileName);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(filePath);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sublimation Lead Engine running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
