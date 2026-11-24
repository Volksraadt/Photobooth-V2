'use client';

import { PageRenderer } from '@pb/renderer';
import type { BoothConfig } from '@pb/schema';
import { Button, Input, Label, Select, cn } from '@pb/ui';
import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { IDLE } from '@/lib/form';
import { BOOTH_TIMEZONES } from '@/lib/timezones';
import { createBoothAction } from './actions';

export type TemplateOption = {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  config: BoothConfig;
};

export function CreateBoothForm({
  defaultTimezone,
  templates,
}: {
  defaultTimezone: string;
  templates: TemplateOption[];
}) {
  const [state, action, pending] = useActionState(createBoothAction, IDLE);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  return (
    <form action={action} className="space-y-4">
      {templates.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Template</legend>
          <div className="grid gap-3 sm:grid-cols-3" data-testid="template-gallery">
            {templates.map((t) => (
              <label
                key={t.id}
                data-testid={`template-${t.key ?? t.id}`}
                className={cn(
                  'cursor-pointer overflow-hidden rounded-lg border bg-background transition',
                  templateId === t.id ? 'ring-2 ring-primary' : 'hover:border-primary/50',
                )}
              >
                <input
                  type="radio"
                  name="templateId"
                  value={t.id}
                  className="sr-only"
                  checked={templateId === t.id}
                  onChange={() => setTemplateId(t.id)}
                />
                <div
                  style={{
                    aspectRatio: `${t.config.artboard.width} / ${t.config.artboard.height}`,
                  }}
                >
                  <PageRenderer
                    page={t.config.pages.capture}
                    config={t.config}
                    mode="editor"
                    runtime={{ boothName: 'Booth' }}
                  />
                </div>
                <div className="p-2">
                  <div className="text-sm font-medium">{t.name}</div>
                  {t.description && (
                    <div className="text-xs text-muted-foreground">{t.description}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_220px_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="booth-name">Nama booth</Label>
          <Input
            id="booth-name"
            name="name"
            placeholder="mis. Booth Mall Kelapa Gading"
            required
            minLength={2}
            maxLength={80}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="booth-timezone">Zona waktu</Label>
          <Select id="booth-timezone" name="timezone" defaultValue={defaultTimezone}>
            {BOOTH_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          Buat booth
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
