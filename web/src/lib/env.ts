// Read settings lazily so a missing value fails loudly at the moment it's needed, with a clear message.
function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const env = {
  // NEXT_PUBLIC_ values must be referenced literally so Next.js can inline them into the browser bundle.
  get supabaseUrl() { return need('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL); },
  get supabaseAnonKey() { return need('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY); },
  get supabaseServiceKey() { return need('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY); },
  get razorpayKeyId() { return need('RAZORPAY_KEY_ID', process.env.RAZORPAY_KEY_ID); },
  get razorpayKeySecret() { return need('RAZORPAY_KEY_SECRET', process.env.RAZORPAY_KEY_SECRET); },
  get razorpayWebhookSecret() { return need('RAZORPAY_WEBHOOK_SECRET', process.env.RAZORPAY_WEBHOOK_SECRET); },
  get razorpayEnabled() { return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET); },
};
