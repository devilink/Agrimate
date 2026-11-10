'use client';
/** The normal order path, with the real route taken: reached steps carry their time and failure states appear where they happened. */
import type { BuyerOrder, OrderEventView } from '@agrimate/api-client';
import { formatIST, ORDER_TIMELINE } from '@agrimate/shared';
import { Card, CardTitle, cn, humanise } from '@agrimate/ui';
import { DEAD_END_STATES, OFF_PATH_STATES } from '@/lib/order-state';

type Status = 'done' | 'current' | 'upcoming' | 'failed';
interface Step { state: string; status: Status; at?: string }

export function buildSteps(order: Pick<BuyerOrder, 'state'>, events: Pick<OrderEventView, 'to' | 'createdAt'>[] | null): Step[] {
  const seen = new Map<string, string>();
  for (const e of [...(events ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) if (!seen.has(e.to)) seen.set(e.to, e.createdAt);
  const selfCertified = order.state === 'SELF_CERTIFIED' || seen.has('SELF_CERTIFIED');
  const normal: string[] = ORDER_TIMELINE.map((s) => (s === 'INSPECTED' && selfCertified ? 'SELF_CERTIFIED' : s));

  let visited = [...seen.keys()];
  if (!seen.has(order.state)) {
    // No event for the current state (the log failed to load): assume the normal path up to it.
    const i = normal.indexOf(order.state);
    visited = i >= 0 ? normal.slice(0, i + 1) : [...visited, order.state];
  }

  const closed = order.state === 'SETTLED' || order.state === 'REFUNDED' || order.state === 'CANCELLED';
  const steps: Step[] = visited.map((state) => ({
    state,
    at: seen.get(state),
    status: OFF_PATH_STATES.includes(state) ? 'failed' : state === order.state && !closed ? 'current' : 'done',
  }));
  if (DEAD_END_STATES.includes(order.state)) return steps;
  return [...steps, ...normal.filter((s) => !visited.includes(s)).map((state): Step => ({ state, status: 'upcoming' }))];
}

const MARK: Record<Status, string> = {
  done: 'bg-emerald-700 text-white',
  current: 'border-2 border-emerald-700 bg-white text-emerald-800',
  upcoming: 'border border-slate-300 bg-white text-slate-400',
  failed: 'bg-red-600 text-white',
};
const GLYPH: Record<Status, string> = { done: '✓', current: '•', upcoming: '', failed: '!' };
const SR: Record<Status, string> = { done: 'Done: ', current: 'Current step: ', upcoming: 'Upcoming: ', failed: 'Off the normal path: ' };

export function Timeline({ order, events }: { order: BuyerOrder; events: OrderEventView[] | null }) {
  const steps = buildSteps(order, events);
  return (
    <Card className="p-4">
      <CardTitle>Timeline</CardTitle>
      <ol className="text-sm">
        {steps.map((s, i) => (
          <li key={s.state} aria-current={s.status === 'current' ? 'step' : undefined} className="relative flex gap-2.5 pb-2.5 last:pb-0">
            {i < steps.length - 1 && <span aria-hidden className="absolute top-5 bottom-0 left-[9px] w-px bg-slate-200" />}
            <span aria-hidden className={cn('z-10 flex size-[19px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold', MARK[s.status])}>{GLYPH[s.status]}</span>
            <div className="min-w-0 leading-tight">
              <span className="sr-only">{SR[s.status]}</span>
              <span className={cn(s.status === 'upcoming' ? 'text-slate-500' : 'text-slate-900', (s.status === 'current' || s.status === 'failed') && 'font-semibold', s.status === 'failed' && 'text-red-800')}>{humanise(s.state)}</span>
              {s.at && <span className="block text-xs text-slate-500">{formatIST(s.at)}</span>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
