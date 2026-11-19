import 'server-only';
import { fail, text } from '@/lib/action';

function upper(form: FormData, name: string, max: number) {
  return text(form, name, max)?.toUpperCase().replace(/\s/g, '') ?? null;
}

/** Contact, tax and bank fields. Format checks match the database constraints, with friendlier messages. */
export function privateFields(form: FormData) {
  const gstin = upper(form, 'gstin', 15);
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) fail('GSTIN must be 15 characters, starting with the 2-digit state code.');
  const pan = upper(form, 'pan', 10);
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) fail('PAN must look like ABCDE1234F.');
  const bank_account_no = text(form, 'bank_account_no', 20)?.replace(/\s/g, '') ?? null;
  if (bank_account_no && !/^[0-9]{6,20}$/.test(bank_account_no)) fail('Bank account number must be 6 to 20 digits.');
  const bank_ifsc = upper(form, 'bank_ifsc', 11);
  if (bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank_ifsc)) fail('IFSC must look like SBIN0001234.');
  const email = text(form, 'email', 254)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email.');
  return {
    phone: text(form, 'phone', 20),
    email,
    gstin,
    pan,
    address: text(form, 'address', 500),
    bank_holder: text(form, 'bank_holder', 120),
    bank_account_no,
    bank_ifsc,
    upi_id: text(form, 'upi_id', 100),
  };
}

