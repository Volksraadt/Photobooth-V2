import type { CaptureSource } from '@pb/capture';
import type { FlowActorRef, FlowSnapshot } from '@pb/flow';
import { useState } from 'react';

type MockLike = CaptureSource & { simulateDisconnect?: () => void };

/** Simulates a camera unplug for both sources (mock API, or ending the real webcam track). */
export function simulateCameraUnplug(camera: MockLike, stream: MediaStream | null): void {
  if (camera.simulateDisconnect) {
    camera.simulateDisconnect();
    return;
  }
  // A real unplug fires `ended` on the track; stop() alone does not.
  stream?.getVideoTracks().forEach((t) => t.dispatchEvent(new Event('ended')));
}

/** Dev-only overlay. "Simulasikan lunas" stands in for the payment webhook until F4. */
export function DevTools({
  actor,
  snapshot,
  camera,
  stream,
}: {
  actor: FlowActorRef;
  snapshot: FlowSnapshot;
  camera: MockLike;
  stream: MediaStream | null;
}) {
  const [open, setOpen] = useState(true);
  const inPayment = snapshot.matches('payment');
  const paymentId = snapshot.context.session?.paymentId ?? undefined;
  const state = JSON.stringify(snapshot.value);

  if (!open) {
    return (
      <div className="dev-tools" data-testid="dev-tools">
        <button type="button" onClick={() => setOpen(true)}>
          dev
        </button>
      </div>
    );
  }
  return (
    <div className="dev-tools" data-testid="dev-tools">
      <span data-testid="dev-state">{state}</span>
      {inPayment && (
        <button
          type="button"
          className="pay"
          data-testid="simulate-paid"
          onClick={() => actor.send({ type: 'PAYMENT.PAID', paymentId })}
        >
          Simulasikan lunas
        </button>
      )}
      <button type="button" onClick={() => simulateCameraUnplug(camera, stream)}>
        Putus kamera
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        ×
      </button>
    </div>
  );
}
