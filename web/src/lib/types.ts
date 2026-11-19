export type PartyType = 'buyer' | 'farmer' | 'transporter' | 'inspector';
export type OrderStatus =
  | 'confirmed' | 'quality_check' | 'ready' | 'in_transit' | 'delivered' | 'completed' | 'disputed' | 'cancelled';
export type PaymentMethod = 'razorpay' | 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'other';
export type DocKind = 'invoice' | 'eway_bill' | 'weighbridge_slip' | 'quality_report' | 'photo' | 'proof_of_delivery' | 'other';

export interface Party {
  id: string;
  type: PartyType;
  name: string;
  company: string | null;
  district: string | null;
  state: string | null;
  pin: string | null;
  verified: boolean;
  active: boolean;
  user_id: string | null;
  created_at: string;
}

export interface PartyPrivate {
  party_id: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  bank_holder: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  admin_notes: string | null;
}

export interface Commodity { id: string; name: string; grades: string[]; active: boolean }

export interface Listing {
  id: string; code: string; farmer_id: string; commodity_id: string; grade: string | null; quantity_kg: number;
  price_paise_per_kg: number; location: string | null; pin: string | null; available_from: string | null;
  notes: string | null; status: 'open' | 'closed'; created_at: string;
}

export interface Requirement {
  id: string; code: string; buyer_id: string; commodity_id: string; grade: string | null; quantity_kg: number;
  target_price_paise_per_kg: number | null; delivery_location: string | null; pin: string | null;
  needed_by: string | null; notes: string | null; status: 'open' | 'closed'; created_at: string;
}

export interface Offer {
  id: string; listing_id: string | null; requirement_id: string | null; party_id: string; quantity_kg: number;
  price_paise_per_kg: number; message: string | null; status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  created_at: string;
}

export interface Order {
  id: string; code: string; status: OrderStatus; buyer_id: string; farmer_id: string; commodity_id: string;
  grade: string | null; quantity_kg: number; price_paise_per_kg: number; goods_paise: number; commission_bps: number;
  freight_paise: number; listing_id: string | null; requirement_id: string | null; pickup_location: string | null;
  delivery_location: string | null; expected_date: string | null; transporter_id: string | null;
  vehicle_no: string | null; driver_name: string | null; driver_phone: string | null; inspector_id: string | null;
  inspection_result: 'pass' | 'fail' | null; inspection_notes: string | null; received_qty_kg: number | null;
  created_at: string; updated_at: string;
}

export interface OrderEvent {
  id: number; order_id: string; kind: string; from_status: OrderStatus | null; to_status: OrderStatus | null;
  message: string | null; visibility: 'all' | 'admin'; actor_label: string; created_at: string;
}

export interface Payment {
  id: string; order_id: string; direction: 'in' | 'out'; payee_party_id: string | null; method: PaymentMethod;
  amount_paise: number; reference: string | null; paid_on: string; status: 'confirmed' | 'void'; note: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string; order_id: string; kind: DocKind; file_name: string; storage_path: string; created_at: string;
}
