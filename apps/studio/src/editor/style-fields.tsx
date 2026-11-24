'use client';

import type { BoxStyle, ElementAnimation, TextStyle } from '@pb/schema';
import { FONT_FAMILY_PREFIX, useAssetsOfKind } from './assets';
import { ColorField, Grid2, NumberField, Row, SelectField, Toggle, inputCls } from './fields';

export const SYSTEM_FONTS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter / System' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"Courier New", monospace', label: 'Courier New' },
  { value: 'Impact, sans-serif', label: 'Impact' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet' },
  { value: '"Comic Sans MS", cursive', label: 'Comic Sans' },
];

/** System fonts + uploaded font assets (family `pb-font-<assetId>`). */
export function FontField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (family: string, fontAssetId?: string) => void;
}) {
  const fonts = useAssetsOfKind('font');
  const options: { value: string; label: string; assetId?: string }[] = [
    ...SYSTEM_FONTS,
    ...fonts.map((f) => ({
      value: `"${FONT_FAMILY_PREFIX}${f.id}"`,
      label: f.name,
      assetId: f.id,
    })),
  ];
  const known = options.some((o) => o.value === value);
  return (
    <Row label={label}>
      <select
        className={inputCls}
        value={value}
        onChange={(e) => {
          const opt = options.find((o) => o.value === e.target.value);
          onCommit(e.target.value, opt?.assetId);
        }}
      >
        {!known && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function BoxStyleFields({
  value,
  onChange,
  fillLabel = 'Isi',
}: {
  value: BoxStyle | undefined;
  onChange: (next: BoxStyle | undefined) => void;
  fillLabel?: string;
}) {
  const v = value ?? {};
  const set = (patch: Partial<BoxStyle>) => {
    const next: BoxStyle = { ...v, ...patch };
    for (const k of Object.keys(next) as (keyof BoxStyle)[])
      if (next[k] === undefined) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <>
      <ColorField label={fillLabel} value={v.fill} allowEmpty onCommit={(fill) => set({ fill })} />
      <ColorField
        label="Garis"
        value={v.borderColor}
        allowEmpty
        onCommit={(borderColor) => set({ borderColor })}
      />
      <Grid2>
        <NumberField
          compact
          label="T"
          value={v.borderWidth ?? 0}
          min={0}
          onCommit={(borderWidth) => set({ borderWidth: borderWidth || undefined })}
        />
        <NumberField
          compact
          label="R"
          value={v.borderRadius ?? 0}
          min={0}
          onCommit={(borderRadius) => set({ borderRadius })}
        />
      </Grid2>
      <Toggle
        label="Bayangan"
        value={!!v.shadow}
        onCommit={(on) =>
          set({ shadow: on ? { x: 0, y: 8, blur: 24, color: 'rgba(0,0,0,0.35)' } : undefined })
        }
      />
      {v.shadow && (
        <>
          <Grid2>
            <NumberField
              compact
              label="X"
              value={v.shadow.x}
              onCommit={(x) => set({ shadow: { ...v.shadow!, x } })}
            />
            <NumberField
              compact
              label="Y"
              value={v.shadow.y}
              onCommit={(y) => set({ shadow: { ...v.shadow!, y } })}
            />
          </Grid2>
          <NumberField
            label="Blur"
            value={v.shadow.blur}
            min={0}
            onCommit={(blur) => set({ shadow: { ...v.shadow!, blur } })}
          />
          <ColorField
            label="Warna"
            value={v.shadow.color}
            onCommit={(color) => color && set({ shadow: { ...v.shadow!, color } })}
          />
        </>
      )}
    </>
  );
}

export function TextStyleFields({
  value,
  onChange,
}: {
  value: TextStyle;
  onChange: (next: TextStyle, fontAssetId?: string) => void;
}) {
  const set = (patch: Partial<TextStyle>, fontAssetId?: string) =>
    onChange({ ...value, ...patch }, fontAssetId);
  return (
    <>
      <FontField
        label="Font"
        value={value.fontFamily}
        onCommit={(fontFamily, id) => set({ fontFamily }, id)}
      />
      <Grid2>
        <NumberField
          compact
          label="Pt"
          value={value.fontSize}
          min={1}
          onCommit={(fontSize) => set({ fontSize })}
        />
        <NumberField
          compact
          label="W"
          value={value.fontWeight}
          min={100}
          max={900}
          step={100}
          onCommit={(fontWeight) => set({ fontWeight: Math.round(fontWeight / 100) * 100 })}
        />
      </Grid2>
      <ColorField label="Warna" value={value.color} onCommit={(color) => color && set({ color })} />
      <SelectField
        label="Rata"
        value={value.align}
        options={[
          { value: 'left', label: 'Kiri' },
          { value: 'center', label: 'Tengah' },
          { value: 'right', label: 'Kanan' },
        ]}
        onCommit={(align) => set({ align })}
      />
      <Grid2>
        <NumberField
          compact
          label="LH"
          value={value.lineHeight}
          step={0.1}
          min={0.5}
          onCommit={(lineHeight) => set({ lineHeight })}
        />
        <NumberField
          compact
          label="LS"
          value={value.letterSpacing}
          step={0.5}
          onCommit={(letterSpacing) => set({ letterSpacing })}
        />
      </Grid2>
    </>
  );
}

const ENTRANCE = [
  { value: 'none', label: 'Tidak ada' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-up', label: 'Naik' },
  { value: 'slide-left', label: 'Dari kanan' },
  { value: 'zoom', label: 'Zoom' },
] as const;

const LOOP = [
  { value: 'none', label: 'Tidak ada' },
  { value: 'pulse', label: 'Berdenyut' },
  { value: 'bounce', label: 'Memantul' },
  { value: 'float', label: 'Melayang' },
] as const;

export function AnimationFields({
  value,
  onChange,
}: {
  value: ElementAnimation | undefined;
  onChange: (next: ElementAnimation | undefined) => void;
}) {
  const entrance = value?.entrance ?? { kind: 'none' as const, delayMs: 0, durationMs: 400 };
  const loop = value?.loop ?? 'none';
  const emit = (next: ElementAnimation) => {
    const clean: ElementAnimation = {};
    if (next.entrance && next.entrance.kind !== 'none') clean.entrance = next.entrance;
    if (next.loop && next.loop !== 'none') clean.loop = next.loop;
    onChange(Object.keys(clean).length ? clean : undefined);
  };
  return (
    <>
      <SelectField
        label="Masuk"
        value={entrance.kind}
        options={ENTRANCE}
        onCommit={(kind) => emit({ loop, entrance: { ...entrance, kind } })}
      />
      {entrance.kind !== 'none' && (
        <Grid2>
          <NumberField
            compact
            label="D"
            value={entrance.delayMs}
            min={0}
            step={50}
            onCommit={(delayMs) => emit({ loop, entrance: { ...entrance, delayMs } })}
          />
          <NumberField
            compact
            label="ms"
            value={entrance.durationMs}
            min={0}
            max={5000}
            step={50}
            onCommit={(durationMs) => emit({ loop, entrance: { ...entrance, durationMs } })}
          />
        </Grid2>
      )}
      <SelectField
        label="Berulang"
        value={loop}
        options={LOOP}
        onCommit={(l) => emit({ entrance, loop: l })}
      />
    </>
  );
}
