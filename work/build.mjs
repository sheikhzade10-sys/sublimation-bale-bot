import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const ROOT_DIR = process.cwd();
const WORK_DIR = path.join(ROOT_DIR, 'work');
const BACKUP_DIR = path.join(WORK_DIR, 'backups');
const OUTPUTS_DIR = path.join(ROOT_DIR, 'outputs');

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toLatinDigits(input = '') {
  let str = String(input || '');
  for (let i = 0; i < 10; i++) {
    str = str.replaceAll(PERSIAN_DIGITS[i], String(i));
    str = str.replaceAll(ARABIC_DIGITS[i], String(i));
  }
  return str;
}

export function normalizePhone(rawPhone = '') {
  const latin = toLatinDigits(rawPhone).replace(/[^\d+]/g, '');
  if (!latin) return '';
  let cleaned = latin;
  if (cleaned.startsWith('+98')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (cleaned.startsWith('0098')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('98') && cleaned.length >= 11) {
    cleaned = '0' + cleaned.slice(2);
  } else if (!cleaned.startsWith('0') && cleaned.length >= 9 && !cleaned.startsWith('9000')) {
    cleaned = '0' + cleaned;
  }
  return cleaned;
}

export function isValidIranPhone(norm = '') {
  if (!norm) return false;
  // Valid Iranian mobile: 090x, 091x, 092x, 093x, 099x (11 digits)
  if (/^09(?:0[1-5]|1[0-9]|2[0-3]|3[0-9]|9[0-6])\d{7}$/.test(norm)) {
    return true;
  }
  // Valid Iranian landline: valid province area code + 8-digit subscriber starting with 2..9
  if (
    /^0(?:11|13|17|21|23|24|25|26|28|31|34|35|38|41|44|45|51|54|56|58|61|66|71|74|76|77|81|83|84|86|87)[2-9]\d{7}$/.test(
      norm
    )
  ) {
    return true;
  }
  // Valid 4-5 digit corporate landline or 9000 shortcodes
  if (/^(?:021\d{5}|9000\d{4})$/.test(norm)) {
    return true;
  }
  return false;
}

export function normalizePhoneList(phones) {
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

export function formatBaleCard(lead) {
  if (lead.preText && String(lead.preText).trim().length > 0) {
    return String(lead.preText).trim();
  }

  const phonesList = normalizePhoneList(lead.phones);
  const lines = [
    `نام: ${lead.name || '-'}`,
    `شهر: ${lead.city || '-'}`,
  ];

  if (lead.contactPerson) {
    lines.push(`مسئول اعلام‌شده: ${lead.contactPerson}`);
  } else {
    lines.push(`مسئول اعلام‌شده: نامشخص`);
  }

  if (phonesList.length > 0) {
    lines.push(`تلفن تجاری:`);
    for (const p of phonesList) {
      lines.push(p);
    }
  } else {
    lines.push(`تلفن عمومی در آگهی درج نشده؛ لینک آگهی:`);
    lines.push(String(lead.sourceUrl || '-'));
  }

  lines.push(`شبکه اجتماعی:`);
  lines.push(String(lead.handleOrDomain || 'ثبت نشده'));
  lines.push(`فعالیت: ${lead.activityType || '-'}`);
  lines.push(`دلیل تناسب: ${lead.equipment || '-'}`);
  lines.push(`وضعیت تأیید: ${lead.evidenceStatus || '-'}`);
  lines.push(`منبع:`);
  lines.push(String(lead.sourceUrl || '-'));
  lines.push(`تاریخ بررسی: ${lead.updatedAt || '-'}`);
  lines.push(`شناسه: ${lead.id}`);
  lines.push(
    `زمان صرف‌شده: جست‌وجو و بررسی آگهی: حدود ۳ دقیقه؛ ثبت، نگارش و آماده‌سازی/ارسال کارت: حدود ۲ دقیقه؛ جمعاً حدود ۵ دقیقه.`
  );

  return lines.join('\n');
}

export function ensureDirectories() {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

export function atomicWriteFileSync(targetPath, dataBufferOrString) {
  ensureDirectories();
  const tempPath = `${targetPath}.tmp.${Date.now()}`;
  try {
    if (fs.existsSync(targetPath)) {
      const baseName = path.basename(targetPath);
      const backupPath = path.join(BACKUP_DIR, `${baseName}.bak`);
      try {
        fs.copyFileSync(targetPath, backupPath);
      } catch {
        // ignore
      }
    }
    fs.writeFileSync(tempPath, dataBufferOrString);
    fs.renameSync(tempPath, targetPath);
    return { ok: true, path: targetPath };
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
    }
    const recoveryPath = path.join(
      WORK_DIR,
      `recovery-${Date.now()}-${path.basename(targetPath)}`
    );
    fs.writeFileSync(recoveryPath, dataBufferOrString);
    return { ok: false, path: recoveryPath, error: String(err) };
  }
}

export function buildAllOutputs() {
  ensureDirectories();

  const leadsPath = path.join(WORK_DIR, 'leads.json');
  const referralPath = path.join(WORK_DIR, 'referral-network.json');
  const logPath = path.join(WORK_DIR, 'research-log.json');

  const rawLeads = fs.existsSync(leadsPath)
    ? JSON.parse(fs.readFileSync(leadsPath, 'utf-8'))
    : [];
  const leads = [...rawLeads].sort((a, b) => {
    const numA = Number(String(a?.id || '').replace(/\D+/g, '')) || 0;
    const numB = Number(String(b?.id || '').replace(/\D+/g, '')) || 0;
    return numB - numA;
  });
  const referral = fs.existsSync(referralPath)
    ? JSON.parse(fs.readFileSync(referralPath, 'utf-8'))
    : { sources: [], prospects: [] };
  const logs = fs.existsSync(logPath)
    ? JSON.parse(fs.readFileSync(logPath, 'utf-8'))
    : [];

  const headersAO = [
    'شناسه',
    'نام مجموعه',
    'شهر',
    'نوع فعالیت',
    'تلفن تجاری',
    'شبکه اجتماعی و وب‌سایت',
    'مسئول اعلام‌شده',
    'دلیل تناسب سابلیمیشن',
    'وضعیت تأیید و محدودیت‌ها',
    'منبع',
    'تاریخ بررسی',
    'وضعیت پیگیری فروش',
    'نتیجه تماس و تأیید مصرف',
    'گرماژ و عرض کاغذ مصرفی',
    'یادداشت اختصاصی فروش',
  ];

  const rowsAO = [headersAO];
  for (const lead of leads) {
    const phonesList = normalizePhoneList(lead.phones);
    rowsAO.push([
      String(lead.id || ''),
      String(lead.name || ''),
      String(lead.city || ''),
      String(lead.activityType || ''),
      phonesList.join('\n'),
      String(lead.handleOrDomain || ''),
      String(lead.contactPerson || ''),
      String(lead.equipment || ''),
      String(lead.evidenceStatus || ''),
      String(lead.sourceUrl || ''),
      String(lead.updatedAt || ''),
      String(lead.colL_status || ''),
      String(lead.colM_callResult || ''),
      String(lead.colN_paperSpec || ''),
      String(lead.colO_notes || ''),
    ]);
  }

  const wsLeads = XLSX.utils.aoa_to_sheet(rowsAO);

  for (let r = 1; r < rowsAO.length; r++) {
    const phoneCellRef = XLSX.utils.encode_cell({ r, c: 4 });
    if (wsLeads[phoneCellRef]) {
      wsLeads[phoneCellRef].t = 's';
      wsLeads[phoneCellRef].v = String(wsLeads[phoneCellRef].v || '');
    }
    const idCellRef = XLSX.utils.encode_cell({ r, c: 0 });
    if (wsLeads[idCellRef]) {
      wsLeads[idCellRef].t = 's';
    }
  }

  wsLeads['!views'] = [{ rightToLeft: true }];
  wsLeads['!cols'] = [
    { wch: 14 },
    { wch: 36 },
    { wch: 24 },
    { wch: 38 },
    { wch: 18 },
    { wch: 28 },
    { wch: 20 },
    { wch: 42 },
    { wch: 44 },
    { wch: 34 },
    { wch: 16 },
    { wch: 22 },
    { wch: 26 },
    { wch: 24 },
    { wch: 34 },
  ];

  const sourcesHeaders = [
    'شناسه منبع',
    'نام شرکت یا نصاب یا فروشنده ملزومات',
    'نقش',
    'شهر',
    'وب‌سایت رسمی',
    'شناسه معتبر بررسی‌شده',
    'یادداشت تفکیک',
    'تاریخ بررسی',
  ];
  const sourcesRows = [sourcesHeaders];
  for (const src of referral.sources || []) {
    sourcesRows.push([
      String(src.id || ''),
      String(src.name || ''),
      String(src.role || ''),
      String(src.city || ''),
      String(src.website || ''),
      String(src.verifiedSocialHandle || ''),
      String(src.notes || ''),
      String(src.updatedAt || ''),
    ]);
  }
  const wsSources = XLSX.utils.aoa_to_sheet(sourcesRows);
  wsSources['!views'] = [{ rightToLeft: true }];

  const prospectsHeaders = [
    'شناسه سرنخ',
    'نام چاپخانه یا کارگاه',
    'شهر',
    'حوزه فعالیت سابلیمیشن',
    'منبع شناسایی اولیه',
    'محدودیت فعلی',
    'لینک مدرک',
    'تاریخ شناسایی',
  ];
  const prospectsRows = [prospectsHeaders];
  for (const p of referral.prospects || []) {
    prospectsRows.push([
      String(p.id || ''),
      String(p.name || ''),
      String(p.city || ''),
      String(p.activity || ''),
      String(p.discoverySource || ''),
      String(p.missingInfo || ''),
      String(p.sourceUrl || ''),
      String(p.updatedAt || ''),
    ]);
  }
  const wsProspects = XLSX.utils.aoa_to_sheet(prospectsRows);
  wsProspects['!views'] = [{ rightToLeft: true }];

  const wb = XLSX.utils.book_new();
  wb.Workbook = {
    Views: [{ RTL: true }],
  };

  XLSX.utils.book_append_sheet(wb, wsLeads, 'مشتریان_کاغذ_سابلیمیشن');
  XLSX.utils.book_append_sheet(wb, wsSources, 'منابع_معرفی_فروشندگان_نصابان');
  XLSX.utils.book_append_sheet(wb, wsProspects, 'سرنخهای_نصب_بدون_تلفن_مستقل');

  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const xlsxOutPath = path.join(OUTPUTS_DIR, 'sublimation-leads.xlsx');
  const xlsxWriteResult = atomicWriteFileSync(xlsxOutPath, xlsxBuffer);

  // Build outputs/sublimation-copy.html matching the exact user format
  const articlesHtml = leads
    .map((lead) => {
      const cardText = formatBaleCard(lead);
      return `<article id="${lead.id}"><header><h2>${lead.name}</h2><button type="button">کپی مشخصات</button></header><pre dir="auto">${cardText}</pre></article>`;
    })
    .join('');

  const copyHtmlContent = `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>کپی مشخصات مشتریان</title><style>body{font:16px Tahoma,Arial;background:#f3f6fa;color:#17365d;margin:24px auto;max-width:950px;padding:0 16px}article{background:white;padding:20px;margin:18px 0;border-radius:12px;border:1px solid #dae2ed}header{display:flex;align-items:center;justify-content:space-between;gap:20px}h2{font-size:19px}button{background:#176b49;color:white;border:0;border-radius:8px;padding:13px 20px;cursor:pointer;font:inherit;white-space:nowrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.9 Tahoma,Arial;unicode-bidi:plaintext}input{width:95%;padding:12px;font:inherit;border:1px solid #aaa;border-radius:8px}#status{position:sticky;top:0;background:#e2f0d9;padding:12px;min-height:20px}</style><h1>مشخصات آمادهٔ ارسال مشتریان</h1><p>دکمهٔ هر مشتری، مشخصات همان مشتری را برای ارسال به تیم فروش کپی می‌کند. نیاز خرید هنوز تأیید نشده است. پس از به‌روزرسانی فایل، صفحه را تازه کنید.</p><input id="search" placeholder="جست‌وجوی نام، شهر یا شماره"><p id="status" role="status">${leads.length} مشتری</p>${articlesHtml}<script>document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{const text=b.closest('article').querySelector('pre').textContent;try{try{await navigator.clipboard.writeText(text)}catch(e){const t=document.createElement('textarea');t.value=text;document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();if(!ok)throw Error('copy')}document.querySelector('#status').textContent='مشخصات کپی شد؛ اکنون در پیام‌رسان جای‌گذاری کنید.';b.textContent='کپی شد ✓';setTimeout(()=>b.textContent='کپی مشخصات',1800)}catch(e){document.querySelector('#status').textContent='مرورگر اجازهٔ کپی نداد؛ متن کارت را انتخاب و کپی کنید.'}});document.querySelector('#search').oninput=e=>{document.querySelectorAll('article').forEach(a=>a.hidden=!a.textContent.toLowerCase().includes(e.target.value.toLowerCase()))};</script></html>`;

  const htmlOutPath = path.join(OUTPUTS_DIR, 'sublimation-copy.html');
  const htmlWriteResult = atomicWriteFileSync(htmlOutPath, copyHtmlContent);

  return {
    xlsxResult: xlsxWriteResult,
    htmlResult: htmlWriteResult,
    leadsCount: leads.length,
    sourcesCount: (referral.sources || []).length,
    prospectsCount: (referral.prospects || []).length,
    logsCount: logs.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = buildAllOutputs();
  console.log('Built outputs successfully:', JSON.stringify(res));
}
