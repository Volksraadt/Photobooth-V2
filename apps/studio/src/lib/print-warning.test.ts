import { createDefaultBoothConfig } from '@pb/schema';
import { describe, expect, it } from 'vitest';
import { extraPrintsWarning } from './print-warning';

describe('extraPrintsWarning', () => {
  it('warns only when extras are sold without a stepper on Pilih Frame', () => {
    const config = createDefaultBoothConfig({ boothId: 'b' });
    expect(extraPrintsWarning(config)).toBeNull();
    config.pages.framePick.elements = config.pages.framePick.elements.filter(
      (e) => e.type !== 'print-copies',
    );
    expect(extraPrintsWarning(config)).toContain('Pilih Frame');
    config.flow.eventMode = true;
    expect(extraPrintsWarning(config)).toBeNull();
    config.flow.eventMode = false;
    config.pricing.extraPrintPrice = null;
    expect(extraPrintsWarning(config)).toBeNull();
  });
});
