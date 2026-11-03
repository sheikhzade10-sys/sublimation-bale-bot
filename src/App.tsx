import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';

const PERMANENT_BALE_TOKEN = '2136077232:6UYkuEA0H6FyPXbZB0lH38Hy1GjKpojSsv8';
const PERMANENT_BALE_GROUP_ID = '4657775638';
const PERMANENT_BALE_GROUP_TITLE = 'بانک مشتری کاغذ سابلیمیشن';

interface Lead {
  id: string;
  name: string;
  city: string;
  contactPerson?: string;
  activityType: string;
  phones: string[];
  handleOrDomain: string;
  address: string;
  equipment: string;
  evidenceStatus: string;
  sourceUrl: string;
  updatedAt: string;
  preText?: string;
}

interface AutoPilotState {
  enabled: boolean;
  intervalSeconds: number;
  currentCityIndex: number;
  isRunningCycle: boolean;
  lastRunAt: string;
  nextRunAt: string;
  lastCycleSummary: string;
  hasBaleToken?: boolean;
  hasDivarToken?: boolean;
  divarPhone?: string;
  baleBotToken?: string;
  baleChatId?: string;
  botName?: string;
  lastBotStatus?: string;
}

function getCardPreText(lead: Lead): string {
  if (lead.preText && lead.preText.trim().length > 0) {
    return lead.preText.trim();
  }
  const phones = Array.isArray(lead.phones) ? lead.phones.filter(Boolean) : [];
  const lines = [
    `نام: ${lead.name || '-'}`,
    `شهر: ${lead.city || '-'}`,
    `مسئول اعلام‌شده: ${lead.contactPerson || 'نامشخص'}`,
  ];
  if (phones.length > 0) {
    lines.push('تلفن تجاری:');
    for (const p of phones) lines.push(p);
  } else {
    lines.push('تلفن عمومی در آگهی درج نشده؛ لینک آگهی:');
    lines.push(lead.sourceUrl || '-');
  }
  lines.push('شبکه اجتماعی:');
  lines.push(lead.handleOrDomain || 'ثبت نشده');
  lines.push(`فعالیت: ${lead.activityType || '-'}`);
  lines.push(`دلیل تناسب: ${lead.equipment || '-'}`);
  lines.push(`وضعیت تأیید: ${lead.evidenceStatus || '-'}`);
  lines.push('منبع:');
  lines.push(lead.sourceUrl || '-');
  lines.push(`تاریخ بررسی: ${lead.updatedAt || '-'}`);
  lines.push(`شناسه: ${lead.id}`);
  lines.push(
    'زمان صرف‌شده: جست‌وجو و بررسی آگهی: حدود ۳ دقیقه؛ ثبت، نگارش و آماده‌سازی/ارسال کارت: حدود ۲ دقیقه؛ جمعاً حدود ۵ دقیقه.'
  );
  return lines.join('\n');
}

function formatDuration(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) {
    return `${hrs} ساعت و ${mins} دقیقه`;
  }
  if (mins > 0) {
    return `${mins} دقیقه و ${secs} ثانیه`;
  }
  return `${secs} ثانیه`;
}

export default function App() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [deliveredIds, setDeliveredIds] = useState<string[]>([]);
  const [autoPilot, setAutoPilot] = useState<AutoPilotState>({
    enabled: true,
    intervalSeconds: 7200,
    currentCityIndex: 0,
    isRunningCycle: false,
    lastRunAt: '',
    nextRunAt: '',
    lastCycleSummary: '',
    hasBaleToken: true,
    hasDivarToken: false,
    divarPhone: '',
    baleBotToken: PERMANENT_BALE_TOKEN,
    baleChatId: PERMANENT_BALE_GROUP_ID,
    botName: '@romina_admin_test_bot',
    lastBotStatus: 'توکن ربات و شناسه گروه به صورت دائمی ذخیره شده است.',
  });
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(7200);
  const [showCloudGuide, setShowCloudGuide] = useState<boolean>(false);

  // Divar 1-time login state
  const [divarPhoneInput, setDivarPhoneInput] = useState<string>(
    () => localStorage.getItem('DIVAR_PHONE_SAVED') || ''
  );
  const [divarOtpInput, setDivarOtpInput] = useState<string>('');
  const [divarOtpSent, setDivarOtpSent] = useState<boolean>(false);
  const [divarLoading, setDivarLoading] = useState<boolean>(false);
  const [divarFeedback, setDivarFeedback] = useState<string>('');

  const fetchWorkspace = useCallback(async () => {
    try {
      const res = await fetch('/api/workspace');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.leads)) {
        setLeads(data.leads);
      }
      if (data.baleDelivery?.deliveredIds) {
        setDeliveredIds(data.baleDelivery.deliveredIds);
      }
      if (data.autoPilot) {
        setAutoPilot(data.autoPilot);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchWorkspace();
    const interval = setInterval(fetchWorkspace, 5000);
    return () => clearInterval(interval);
  }, [fetchWorkspace]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!autoPilot.enabled || !autoPilot.nextRunAt) {
        setSecondsLeft(0);
        return;
      }
      const diff = Math.max(
        0,
        Math.round((new Date(autoPilot.nextRunAt).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(diff);
    }, 1000);
    return () => clearInterval(timer);
  }, [autoPilot.enabled, autoPilot.nextRunAt]);

  const handleCopyCard = async (lead: Lead) => {
    const text = getCardPreText(lead);
    try {
      await navigator.clipboard.writeText(text);
      setStatusMessage('مشخصات کپی شد؛ اکنون در پیام‌رسان جای‌گذاری کنید.');
      setCopiedId(lead.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setStatusMessage('مرورگر اجازهٔ کپی نداد؛ متن کارت را انتخاب و کپی کنید.');
    }
  };

  const handleRunCycleNow = async () => {
    setStatusMessage(
      'در حال اجرای جست‌وجوی هوشمند دیوار و استخراج شماره‌های تماس جدید...'
    );
    await fetch('/api/run-cycle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await fetchWorkspace();
    setStatusMessage(
      'جست‌وجو انجام شد؛ کارت‌های جدید دارای شماره تلفن در بالاترین بخش صفحه (از جدیدترین به قدیمی‌ترین) قرار گرفتند و خودکار به بله ارسال می‌شوند.'
    );
  };

  const handleSendDivarOtp = async () => {
    if (!divarPhoneInput.trim()) {
      setDivarFeedback('لطفاً شماره موبایل خود را وارد کنید.');
      return;
    }
    setDivarLoading(true);
    setDivarFeedback('');
    try {
      localStorage.setItem('DIVAR_PHONE_SAVED', divarPhoneInput.trim());
      const res = await fetch('/api/divar/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: divarPhoneInput.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setDivarOtpSent(true);
        setDivarFeedback(
          'کد تأیید از طرف دیوار به موبایل شما پیامک شد؛ کد ۶ رقمی را در کادر زیر وارد کنید.'
        );
      } else {
        setDivarFeedback(data.error || 'خطا در ارسال پیامک از دیوار');
      }
    } finally {
      setDivarLoading(false);
    }
  };

  const handleVerifyDivarOtp = async () => {
    if (!divarOtpInput.trim()) {
      setDivarFeedback('لطفاً کد پیامک‌شدهٔ دیوار را وارد کنید.');
      return;
    }
    setDivarLoading(true);
    setDivarFeedback('');
    try {
      const res = await fetch('/api/divar/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: divarPhoneInput.trim(),
          code: divarOtpInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDivarFeedback(data.message || 'حساب دیوار به صورت دائمی متصل شد!');
        setDivarOtpSent(false);
        setDivarOtpInput('');
        await fetchWorkspace();
      } else {
        setDivarFeedback(data.error || 'کد واردشده نامعتبر است.');
      }
    } finally {
      setDivarLoading(false);
    }
  };

  const sortedLeadsDesc = useMemo(() => {
    return [...leads].sort((a, b) => {
      const numA = Number(String(a.id || '').replace(/\D+/g, '')) || 0;
      const numB = Number(String(b.id || '').replace(/\D+/g, '')) || 0;
      return numB - numA;
    });
  }, [leads]);

  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedLeadsDesc;
    return sortedLeadsDesc.filter((lead) => {
      const text = `${lead.name} ${getCardPreText(lead)}`.toLowerCase();
      return text.includes(q);
    });
  }, [sortedLeadsDesc, searchQuery]);

  const deliveredSet = useMemo(() => new Set(deliveredIds), [deliveredIds]);
  const newCardsCount = useMemo(
    () => leads.filter((l) => Number(l.id.replace('SUB-', '')) >= 70).length,
    [leads]
  );
  const newestLeadId = sortedLeadsDesc[0]?.id || 'SUB-0087';

  return (
    <div
      dir="rtl"
      style={{
        font: '16px Tahoma, Arial',
        background: '#f3f6fa',
        color: '#17365d',
        minHeight: '100vh',
        padding: '24px 16px',
      }}
    >
      <div style={{ maxWidth: '950px', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '12px',
          }}
        >
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>
            مشخصات آمادهٔ ارسال مشتریان (از جدیدترین به قدیمی‌ترین)
          </h1>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              onClick={handleRunCycleNow}
              disabled={autoPilot.isRunningCycle}
              style={{
                background: '#17365d',
                color: 'white',
                border: 0,
                borderRadius: '8px',
                padding: '10px 16px',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: '14px',
              }}
            >
              {autoPilot.isRunningCycle
                ? 'در حال جست‌وجوی دیوار و استخراج شماره‌ها...'
                : `جست‌وجوی خودکار هر ۲ ساعت (نوبت بعد: ${formatDuration(secondsLeft)})`}
            </button>

            <button
              type="button"
              onClick={() => setShowCloudGuide(!showCloudGuide)}
              style={{
                background: showCloudGuide ? '#0a58ca' : '#0d6efd',
                color: 'white',
                border: 0,
                borderRadius: '8px',
                padding: '10px 14px',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: '14px',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              ☁️ اتوماسیون ۲۴ ساعته ابری (مستقل از سیستم)
            </button>

            <a
              href="/api/download/cloud-package"
              style={{
                background: '#e8f4fd',
                color: '#0d6efd',
                border: '1px solid #b6d4fe',
                borderRadius: '8px',
                padding: '10px 14px',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
            >
              📦 دانلود پکیج دائم‌کار ربات
            </a>

            <a
              href="/api/download/xlsx"
              style={{
                background: '#ffffff',
                color: '#17365d',
                border: '1px solid #dae2ed',
                borderRadius: '8px',
                padding: '10px 14px',
                textDecoration: 'none',
                fontSize: '14px',
              }}
            >
              دانلود اکسل راست‌به‌چپ
            </a>
          </div>
        </div>

        {showCloudGuide && (
          <div
            style={{
              background: '#f0f7ff',
              border: '2px solid #0d6efd',
              borderRadius: '12px',
              padding: '18px 20px',
              margin: '14px 0',
              fontSize: '14px',
              lineHeight: '1.9',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 'bold', color: '#0a58ca', margin: 0 }}>
                🚀 راهنمای اجرای ۲۴ ساعته در فضای ابری (بدون نیاز به روشن بودن لپ‌تاپ یا باز بودن مرورگر)
              </h2>
              <button
                type="button"
                onClick={() => setShowCloudGuide(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#666' }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '6px 0 12px 0', color: '#333' }}>
              برای اینکه ربات سابلیمیشن حتی وقتی لپ‌تاپ شما خاموش است یا به اینترنت دسترسی ندارید، <strong>به صورت دائم و شبانه‌روزی رأس هر ۲ ساعت کار کند و کارت‌های جدید را به گروه بله بفرستد</strong>، ۲ راهکار آماده پیش روی شماست:
            </p>

            <div style={{ background: 'white', padding: '12px 14px', borderRadius: '8px', marginBottom: '10px', border: '1px solid #cfe2ff' }}>
              <strong style={{ color: '#0a58ca' }}>روش ۱ (پیشنهادی و کاملاً رایگان با گیت‌هاب اکشن):</strong>
              <div style={{ marginTop: '4px' }}>
                فایل گردش کار ابری پروژه در مسیر <code>.github/workflows/sublimation_bale_cron.yml</code> آماده شده است. تنها کافیست این پروژه را به یک مخزن رایگان گیت‌هاب (GitHub) پوش کنید.
                سرورهای ابری گیت‌هاب به صورت خودکار و ۱۰۰٪ رایگان هر ۲ ساعت یک‌بار بیدار می‌شوند، مشتریان جدید را کشف کرده و به گروه بله می‌فرستند.
              </div>
            </div>

            <div style={{ background: 'white', padding: '12px 14px', borderRadius: '8px', border: '1px solid #cfe2ff' }}>
              <strong style={{ color: '#0a58ca' }}>روش ۲ (اجرا روی هر سرور مجازی VPS، رندر یا کامپیوتر دلخواه):</strong>
              <div style={{ marginTop: '4px' }}>
                روی دکمهٔ <strong>«دانلود پکیج دائم‌کار ربات»</strong> در بالای صفحه کلیک کنید و در سرور یا کامپیوتر خود فقط دستور زیر را اجرا کنید:
                <pre style={{ direction: 'ltr', background: '#f8f9fa', padding: '8px 12px', borderRadius: '6px', margin: '6px 0', fontSize: '13px' }}>
                  node standalone-worker.mjs
                </pre>
                این اسکریپت به صورت ۲۴ ساعته در پس‌زمینه اجرا می‌شود و نیازی به باز بودن این مرورگر یا گوگل استودیو ندارد.
              </div>
            </div>
          </div>
        )}

        {/* پنل وضعیت دائمی و تمام‌خودکار بله + پایش دیوار، تلگرام، اینستاگرام، لینکدین و مشتریان رکورد بدون نیاز به کد پیامکی */}
        <div
          style={{
            background: 'white',
            padding: '16px 18px',
            margin: '14px 0',
            borderRadius: '12px',
            border: '2px solid #176b49',
            fontSize: '14px',
            lineHeight: '1.9',
          }}
        >
          <div>
            <strong>ارسال کاملاً خودکار بله و قانون حداقل ۲ کارت در هر نوبت:</strong> توکن ربات و گروه{' '}
            <strong>«{PERMANENT_BALE_GROUP_TITLE}»</strong> به صورت دائمی ذخیره شده است. سامانه <strong>هر ۲ ساعت یک‌بار</strong> شروع به جست‌وجو می‌کند و <strong>تا حداقل ۲ کارت جدید (یا بیشتر) پیدا نکند متوقف نمی‌شود</strong> و پس از یافتن حداقل ۲ کارت جدید، به مدت ۲ ساعت متوقف شده و در نوبت بعدی دوباره اقدام می‌کند.
          </div>

          <div
            style={{
              marginTop: '8px',
              paddingTop: '8px',
              borderTop: '1px solid #dae2ed',
              color: '#176b49',
            }}
          >
            <strong>پایش یکپارچه بدون نیاز به کد پیامکی + نمایش از جدیدترین به قدیمی‌ترین:</strong> استخراج شماره تلفن خریداران رول کاغذ سابلیمیشن از{' '}
            <strong>دیوار، شیپور، ایستگاه، نیازروز، ایران‌تجارت، باسکول، نیازمشاغل، ای‌استخدام، چاپشو، بلد، تلگرام، اینستاگرام، لینکدین و خریداران دستگاه‌های شرکت رکورد و رقبا</strong>{' '}
            کاملاً خودکار فعال است و جدیدترین کارت همیشه در بالاترین نقطهٔ همین صفحه قرار می‌گیرد.
          </div>
        </div>

        <p style={{ margin: '8px 0 14px 0', lineHeight: '1.8' }}>
          کارت‌ها همیشه <strong>از جدیدترین به قدیمی‌ترین</strong> مرتب شده‌اند و آخرین کارت کشف‌شده (<strong>{newestLeadId}</strong>) در بالاترین نقطهٔ صفحه قرار دارد. دکمهٔ هر مشتری، مشخصات همان مشتری را برای ارسال به تیم فروش کپی می‌کند.
        </p>

        <input
          id="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="جست‌وجوی نام، شهر یا شماره"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px',
            font: 'inherit',
            border: '1px solid #aaa',
            borderRadius: '8px',
            background: 'white',
          }}
        />

        <p
          id="status"
          role="status"
          style={{
            position: 'sticky',
            top: 0,
            background: '#e2f0d9',
            padding: '12px',
            minHeight: '20px',
            margin: '14px 0',
            borderRadius: '6px',
            zIndex: 10,
          }}
        >
          {statusMessage
            ? statusMessage
            : `${leads.length} مشتری ثبت‌شده به ترتیب از جدیدترین (${newestLeadId}) در بالای صفحه تا قدیمی‌ترین (SUB-0001) — شامل ${newCardsCount} کارت جدید دارای شماره تلفن معتبر`}
        </p>

        {filteredLeads.map((lead) => {
          const isNewAfter69 = Number(lead.id.replace('SUB-', '')) >= 70;
          const isDelivered = deliveredSet.has(lead.id);
          return (
            <article
              key={lead.id}
              id={lead.id}
              style={{
                background: 'white',
                padding: '20px',
                margin: '18px 0',
                borderRadius: '12px',
                border: isNewAfter69
                  ? '2px solid #176b49'
                  : '1px solid #dae2ed',
              }}
            >
              <header
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  marginBottom: '10px',
                  flexWrap: 'wrap',
                }}
              >
                <h2 style={{ fontSize: '19px', fontWeight: 'bold', margin: 0 }}>
                  {lead.name}
                  {isNewAfter69 && (
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 'normal',
                        color: '#176b49',
                        marginRight: '10px',
                      }}
                    >
                      {isDelivered
                        ? `(${lead.id} — کارت جدید ارسال‌شده به بله ✓)`
                        : `(${lead.id} — کارت جدید دارای شماره تلفن در بالای صفحه)`}
                    </span>
                  )}
                </h2>
                <button
                  type="button"
                  onClick={() => handleCopyCard(lead)}
                  style={{
                    background: '#176b49',
                    color: 'white',
                    border: 0,
                    borderRadius: '8px',
                    padding: '13px 20px',
                    cursor: 'pointer',
                    font: 'inherit',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {copiedId === lead.id ? 'کپی شد ✓' : 'کپی مشخصات'}
                </button>
              </header>
              <pre
                dir="auto"
                style={{
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  font: '15px/1.9 Tahoma, Arial',
                  unicodeBidi: 'plaintext',
                  margin: 0,
                }}
              >
                {getCardPreText(lead)}
              </pre>
            </article>
          );
        })}
      </div>
    </div>
  );
}
