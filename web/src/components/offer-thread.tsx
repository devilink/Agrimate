import { counterOffer, respondToOffer, withdrawOffer } from '@/app/actions/market';
import { ActionForm, Submit } from '@/components/action-form';
import { PriceField, QuantityField } from '@/components/unit-fields';
import { TrustBadges } from '@/components/trust';
import { Badge, Field, Textarea, cx, statusTone } from '@/components/ui';
import { IconCheck, IconX } from '@/components/icons';
import { partyLabel } from '@/lib/data';
import { dateTimeIN, kg, rupees } from '@/lib/money';
import { pctDiff, priceIn, type Unit } from '@/lib/units';
import type { Viewer } from '@/lib/auth';
import type { Offer, OfferMessage, Party } from '@/lib/types';

const KIND_LABEL: Record<OfferMessage['kind'], string> = {
  offer: 'Offer', counter: 'Counter-offer', accept: 'Accepted', reject: 'Declined', withdraw: 'Withdrawn',
};

/**
 * One offer as a conversation: each side's terms in turn, then accept / counter / decline for whoever's turn it is.
 * The server actions enforce the same turn rule; this only decides which buttons to show.
 */
export function OfferThread({ offer, messages, parties, viewer, ownerId, reference, referenceLabel, negotiable, unit = 'kg' }: {
  offer: Offer; messages: OfferMessage[]; parties: Map<string, Party>; viewer: Viewer; ownerId: string;
  reference: number | null; referenceLabel: string; negotiable: boolean; unit?: Unit;
}) {
  const me = viewer.party?.id;
  const awaited = offer.last_by === offer.party_id ? ownerId : offer.party_id;
  const pending = offer.status === 'pending';
  const myTurn = pending && (viewer.isAdmin || me === awaited);
  const canWithdraw = pending && (me === offer.party_id || viewer.isAdmin);
  const actingAs = viewer.isAdmin ? ` for ${parties.get(awaited)?.name ?? 'them'}` : '';

  return (
    <article className="overflow-hidden rounded-xl border border-stone-200">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 bg-stone-50/70 px-4 py-2.5">
        <div className="min-w-0 text-sm">
          <span className="font-semibold text-stone-900">{partyLabel(parties.get(offer.party_id))}</span>
          <TrustBadges party={parties.get(offer.party_id)} className="ml-2 align-middle" />
          <div className="text-xs text-stone-500">
            Now: <span className="font-medium text-stone-700">{kg(offer.quantity_kg)} at {priceIn(offer.price_paise_per_kg, unit)}</span>
            {' '}= <span className="font-medium text-stone-700">{rupees(offer.quantity_kg * offer.price_paise_per_kg)}</span>
          </div>
        </div>
        <Badge tone={statusTone(offer.status)}>{offer.status}</Badge>
      </header>

      <ol className="space-y-2.5 px-4 py-3">
        {messages.map((m) => {
          const mine = me ? m.party_id === me : m.party_id === ownerId;
          const hasTerms = m.price_paise_per_kg !== null && m.quantity_kg !== null;
          return (
            <li key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm', mine ? 'bg-brand-700 text-white' : 'bg-stone-100 text-stone-900')}>
                <div className={cx('text-[0.7rem] font-semibold uppercase tracking-wide', mine ? 'text-brand-100' : 'text-stone-500')}>
                  {KIND_LABEL[m.kind]} · {parties.get(m.party_id)?.name ?? '—'}
                </div>
                {hasTerms && m.kind !== 'accept' && (
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                    <strong className="tabular-nums">{priceIn(m.price_paise_per_kg, unit)}</strong>
                    <span className={mine ? 'text-brand-100' : 'text-stone-500'}>× {kg(m.quantity_kg)}</span>
                    {reference ? (
                      <span className={cx('text-xs tabular-nums', mine ? 'text-brand-100' : 'text-stone-500')}>
                        ({pctDiff(Number(m.price_paise_per_kg), reference)} vs {referenceLabel})
                      </span>
                    ) : null}
                  </div>
                )}
                {m.kind === 'accept' && hasTerms && (
                  <div className="mt-0.5 font-semibold">Deal at {priceIn(m.price_paise_per_kg, unit)} × {kg(m.quantity_kg)}</div>
                )}
                {m.message && <p className={cx('mt-1 whitespace-pre-line', mine ? 'text-brand-50' : 'text-stone-700')}>{m.message}</p>}
                <div className={cx('mt-1 text-[0.68rem]', mine ? 'text-brand-200' : 'text-stone-400')}>{dateTimeIN(m.created_at)}</div>
              </div>
            </li>
          );
        })}
      </ol>

      {pending && (
        <div className="space-y-3 border-t border-stone-100 px-4 py-3">
          {myTurn ? (
            <>
              <ActionForm action={respondToOffer} hidden={{ offer_id: offer.id, counters: String(offer.counters) }} className="flex flex-wrap gap-2 space-y-0">
                <Submit small name="decision" value="accept"><IconCheck />Accept{actingAs}</Submit>
                <Submit small variant="secondary" name="decision" value="reject"><IconX />Decline</Submit>
              </ActionForm>
              {negotiable && (
                <details className="group rounded-xl border border-stone-200 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-semibold text-brand-700">Counter-offer{actingAs}…</summary>
                  <ActionForm action={counterOffer} hidden={{ offer_id: offer.id }} className="mt-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <QuantityField label="Quantity" defaultKg={offer.quantity_kg} />
                      <PriceField label="Price" defaultPaisePerKg={offer.price_paise_per_kg} />
                    </div>
                    <Field label="Message" hint="Optional"><Textarea name="message" maxLength={1000} rows={2} /></Field>
                    <Submit small>Send counter-offer</Submit>
                  </ActionForm>
                </details>
              )}
            </>
          ) : (
            <p className="text-sm text-stone-500">Waiting for {parties.get(awaited)?.name ?? 'the other side'} to respond.</p>
          )}
          {canWithdraw && (
            <ActionForm action={withdrawOffer} hidden={{ offer_id: offer.id }}>
              <Submit small variant="ghost">Withdraw this offer</Submit>
            </ActionForm>
          )}
        </div>
      )}
    </article>
  );
}
