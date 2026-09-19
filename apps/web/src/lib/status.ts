import {
  Archive,
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  Coins,
  Globe,
  Hourglass,
  Loader,
  PenLine,
  type LucideIcon,
} from 'lucide-react';

export type FormStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type SubmissionStatus = 'RESERVED' | 'DEPOSIT_PAID' | 'PAID' | 'EXPIRED' | 'CANCELLED';
export type PaymentStatus = 'NEW' | 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'ERROR' | 'ABANDONED' | 'EXPIRED';

export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

const tone = {
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-emerald-100 text-emerald-700',
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-700',
};

export const FORM_STATUS: Record<FormStatus, StatusMeta> = {
  DRAFT: { label: 'Szkic', icon: PenLine, className: tone.neutral },
  PUBLISHED: { label: 'Opublikowane', icon: Globe, className: tone.success },
  ARCHIVED: { label: 'Zarchiwizowane', icon: Archive, className: tone.warning },
};

export const SUBMISSION_STATUS: Record<SubmissionStatus, StatusMeta> = {
  PAID: { label: 'Opłacone', icon: CircleCheck, className: tone.success },
  DEPOSIT_PAID: { label: 'Zaliczka', icon: Coins, className: tone.warning },
  RESERVED: { label: 'Rezerwacja', icon: Hourglass, className: tone.info },
  EXPIRED: { label: 'Wygasłe', icon: Clock, className: tone.neutral },
  CANCELLED: { label: 'Anulowane', icon: Ban, className: tone.warning },
};

export const PAYMENT_STATUS: Record<PaymentStatus, StatusMeta> = {
  NEW: { label: 'Rozpoczęta', icon: Loader, className: tone.neutral },
  PENDING: { label: 'W trakcie', icon: Hourglass, className: tone.info },
  CONFIRMED: { label: 'Potwierdzona', icon: CircleCheck, className: tone.success },
  REJECTED: { label: 'Odrzucona', icon: CircleX, className: tone.danger },
  ERROR: { label: 'Błąd płatności', icon: CircleX, className: tone.danger },
  ABANDONED: { label: 'Przerwana', icon: Ban, className: tone.warning },
  EXPIRED: { label: 'Wygasła', icon: Clock, className: tone.neutral },
};

/** Etykieta statusu płatności z bezpiecznym fallbackiem na nieznaną wartość z API. */
export function paymentStatusLabel(status: string | null | undefined): string {
  if (!status) return 'brak';
  return PAYMENT_STATUS[status as PaymentStatus]?.label ?? status;
}
