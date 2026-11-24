import type { FlowActorRef, FlowSnapshot } from '@pb/flow';
import { useEffect } from 'react';
import type { AgentClient } from './agent/agent-client';

/** Backup polling while a QRIS is shown (the push from the agent is the primary signal). */
const POLL_MS = 2000;

/**
 * Agent → flow (F4): API reachability (QRIS hidden while offline) and payment status of the
 * QRIS on screen, from the agent push (webhook → API stream → agent) with polling as fallback.
 */
export function usePaymentBridge(
  actor: FlowActorRef,
  snapshot: FlowSnapshot,
  agent: AgentClient | null,
): void {
  useEffect(() => {
    if (!agent) return;
    let alive = true;
    const send = (online: boolean) =>
      actor.send({ type: online ? 'NETWORK.ONLINE' : 'NETWORK.OFFLINE' });
    const off = agent.subscribe((msg) => {
      if (msg.type === 'network') send(msg.online);
    });
    agent
      .network()
      .then((n) => alive && n.online !== null && send(n.online))
      .catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, [agent, actor]);

  const session = snapshot.context.session;
  const paymentId =
    snapshot.context.page === 'payment' && session && !session.paid ? session.paymentId : null;

  useEffect(() => {
    if (!agent || !paymentId) return;
    let done = false;
    const handle = (status: string) => {
      if (done) return;
      if (status === 'paid') {
        done = true;
        actor.send({ type: 'PAYMENT.PAID', paymentId });
      } else if (status === 'failed') {
        done = true;
        actor.send({ type: 'PAYMENT.FAILED', message: 'Pembayaran gagal.' });
      }
      // expired / canceled / paid_late: the flow's own expiry timer handles the page.
    };
    const off = agent.subscribe((msg) => {
      if (msg.type === 'payment' && msg.paymentId === paymentId) handle(msg.status);
    });
    const t = setInterval(() => {
      agent
        .getPayment(paymentId)
        .then((p) => handle(p.status))
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      done = true;
      off();
      clearInterval(t);
    };
  }, [agent, actor, paymentId]);
}
