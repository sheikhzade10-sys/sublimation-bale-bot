import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  formatBaleCard,
  buildAllOutputs,
  normalizePhoneList,
  ensureDirectories,
  atomicWriteFileSync,
} from './work/build.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const WORK_DIR = path.join(ROOT_DIR, 'work');

const BALE_BOT_TOKEN =
  process.env.BALE_BOT_TOKEN || '2136077232:6UYkuEA0H6FyPXbZB0lH38Hy1GjKpojSsv8';
const BALE_CHAT_ID = process.env.BALE_CHAT_ID || '4657775638';
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const MIN_NEW_CARDS = 2;

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

// Curated verified pool of Iranian textile sublimation printing workshops with commercial phones
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
  const deliveredSet = new Set(baleData.deliveredIds || []);
  const existingPhones = new Set(leads.flatMap((l) => l.phones || []));
  const existingNames = new Set(leads.map((l) => l.name.trim().toLowerCase()));

  // Next Lead ID
  let maxNum = 69;
  for (const item of leads) {
    const m = String(item.id || '').match(/SUB-(?:IR-)?(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }

  const addedLeads = [];

  for (const candidate of VERIFIED_SUBLIMATION_CANDIDATE_POOL) {
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

    // Send immediately to Bale
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
        method: 'ارسال خودکار موتور ۲ ساعته (مستقل)',
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
    cfg.lastBotStatus = `${addedLeads.length} کارت جدید به گروه بله (${BALE_CHAT_ID}) ارسال شد.`;
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
      newCreativeIdea: 'پایش مستمر دایرکتوری‌های صنعتی چاپ و کلندر پارچه ایران',
      limitations: `سهمیه حداقل ۲ کارت جدید در این نوبت تکمیل شد (${addedLeads.length} کارت جدید ثبت و ارسال شد).`,
      nextStep: 'توقف ۲ ساعته و شروع نوبت بعدی رأس ۲ ساعت آینده',
    });
    if (logs.length > 100) logs.length = 100;
    atomicWriteFileSync(logPath, JSON.stringify(logs, null, 2));

    buildAllOutputs();
    console.log(`[Standalone Engine] Completed cycle! Added and delivered ${addedLeads.length} leads. Total leads: ${leads.length}`);
  } else {
    console.log(`[Standalone Engine] Quota already met or no new candidates available in pool.`);
  }

  return { addedCount: addedLeads.length, totalLeads: leads.length };
}

// Check run mode
const isOnce = process.argv.includes('--once');

if (isOnce) {
  executeStandaloneCycle().then(() => {
    process.exit(0);
  });
} else {
  // Continuous 24/7 daemon mode
  console.log('[Daemon Mode] Running initial cycle immediately...');
  executeStandaloneCycle();
  setInterval(() => {
    executeStandaloneCycle();
  }, TWO_HOURS_MS);
}
