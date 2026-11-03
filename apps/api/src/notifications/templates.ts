/**
 * Vernacular SMS templates. Adding a language means adding one key per template; unknown languages fall back to English.
 * Assamese and Bengali strings are machine-drafted and flagged for native review in DECISIONS.md.
 * Real Indian SMS delivery also needs each template registered on DLT (see DECISIONS.md).
 */
type Tpl = Record<string, string>;
const T: Record<string, Tpl> = {
  otp: {
    en: 'Your Agrimate code is {otp}. It expires in {minutes} minutes. Do not share it.',
    hi: 'आपका एग्रीमेट कोड {otp} है। यह {minutes} मिनट में समाप्त हो जाएगा। इसे साझा न करें।',
    as: 'আপোনাৰ এগ্ৰিমেট ক’ড {otp}। ই {minutes} মিনিটত উকলি যাব। কাকো নিদিব।',
    bn: 'আপনার এগ্রিমেট কোড {otp}। এটি {minutes} মিনিটে শেষ হবে। কাউকে বলবেন না।',
  },
  order_state: {
    en: 'Agrimate order {code}: status is now {state}.',
    hi: 'एग्रीमेट ऑर्डर {code}: स्थिति अब {state} है।',
    as: 'এগ্ৰিমেট অৰ্ডাৰ {code}: স্থিতি এতিয়া {state}।',
    bn: 'এগ্রিমেট অর্ডার {code}: স্ট্যাটাস এখন {state}।',
  },
  harvest_now: {
    en: 'Order {code}: the advance is locked. Harvest and pack by {deadline}. Inspection is on {inspectionDay}.',
    hi: 'ऑर्डर {code}: अग्रिम राशि जमा हो गई। {deadline} तक कटाई और पैकिंग करें। निरीक्षण {inspectionDay} को है।',
    as: 'অৰ্ডাৰ {code}: অগ্ৰিম ধন জমা হৈছে। {deadline}ৰ ভিতৰত চপাই পেক কৰক। পৰিদৰ্শন {inspectionDay}ত।',
    bn: 'অর্ডার {code}: অগ্রিম জমা হয়েছে। {deadline}-এর মধ্যে ফসল তুলে প্যাক করুন। পরিদর্শন {inspectionDay}।',
  },
  sla_reminder: {
    en: 'Order {code}: {hours} hours left before the deadline ({deadline}).',
    hi: 'ऑर्डर {code}: समय सीमा ({deadline}) में {hours} घंटे बाकी हैं।',
    as: 'অৰ্ডাৰ {code}: সময়সীমা ({deadline})লৈ {hours} ঘণ্টা বাকী।',
    bn: 'অর্ডার {code}: সময়সীমা ({deadline}) শেষ হতে {hours} ঘণ্টা বাকি।',
  },
  self_cert_required: {
    en: 'Order {code}: no inspector is available. Open the app and record the self-certification videos.',
    hi: 'ऑर्डर {code}: कोई निरीक्षक उपलब्ध नहीं है। ऐप खोलकर स्व-प्रमाणन वीडियो रिकॉर्ड करें।',
    as: 'অৰ্ডাৰ {code}: কোনো পৰিদৰ্শক উপলব্ধ নহয়। এপ খুলি স্ব-প্ৰমাণীকৰণ ভিডিঅ’ ৰেকৰ্ড কৰক।',
    bn: 'অর্ডার {code}: কোনো পরিদর্শক নেই। অ্যাপ খুলে স্ব-প্রত্যয়ন ভিডিও রেকর্ড করুন।',
  },
  inspector_job: {
    en: 'New inspection job for order {code} on {inspectionDay}. Open the app for details.',
    hi: 'ऑर्डर {code} के लिए {inspectionDay} को नया निरीक्षण कार्य। विवरण के लिए ऐप खोलें।',
    as: 'অৰ্ডাৰ {code}ৰ বাবে {inspectionDay}ত নতুন পৰিদৰ্শন। এপ খোলক।',
    bn: 'অর্ডার {code}-এর জন্য {inspectionDay} নতুন পরিদর্শন। অ্যাপ খুলুন।',
  },
  delivery_otp: {
    en: 'Order {code}: give delivery code {otp} to the driver only after the goods arrive.',
    hi: 'ऑर्डर {code}: माल पहुंचने के बाद ही ड्राइवर को डिलीवरी कोड {otp} दें।',
    as: 'অৰ্ডাৰ {code}: সামগ্ৰী পোৱাৰ পিছতহে চালকক ডেলিভাৰি ক’ড {otp} দিব।',
    bn: 'অর্ডার {code}: পণ্য পৌঁছানোর পরেই চালককে ডেলিভারি কোড {otp} দিন।',
  },
  payout_sent: {
    en: 'Agrimate payout of {amount} for order {code} has been sent to your bank.',
    hi: 'ऑर्डर {code} के लिए {amount} का भुगतान आपके बैंक में भेज दिया गया है।',
    as: 'অৰ্ডাৰ {code}ৰ {amount} ধন আপোনাৰ বেংকলৈ পঠোৱা হৈছে।',
    bn: 'অর্ডার {code}-এর {amount} আপনার ব্যাংকে পাঠানো হয়েছে।',
  },
  kyc_result: {
    en: 'Agrimate verification update: {status}. {note}',
    hi: 'एग्रीमेट सत्यापन अपडेट: {status}। {note}',
    as: 'এগ্ৰিমেট সত্যাপন: {status}। {note}',
    bn: 'এগ্রিমেট যাচাই: {status}। {note}',
  },
};

export function renderTemplate(name: string, lang: string, params: Record<string, unknown> = {}): string {
  const t = T[name];
  if (!t) throw new Error(`Unknown SMS template ${name}`);
  const body = t[lang] ?? t.en!;
  return body.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
}
export const TEMPLATE_NAMES = Object.keys(T);
