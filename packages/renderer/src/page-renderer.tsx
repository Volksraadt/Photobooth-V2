'use client';

import {
  FONT_FAMILY_PREFIX,
  type Background,
  type BoothConfig,
  type Element,
  type Page,
} from '@pb/schema';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { RendererContext, useRenderer } from './context';
import { ElementView } from './element-view';
import { computeFit, type FitResult } from './fit';
import { RENDERER_CSS, transitionCss } from './styles';
import type {
  AssetUrlResolver,
  RenderMode,
  RenderRuntime,
  RendererAction,
  RendererContextValue,
} from './types';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const noop = () => {};

/** Short stable key for the font stylesheet (React 19 dedupes <style> by href). */
function hashKey(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export type RendererProviderProps = {
  config: BoothConfig;
  runtime?: RenderRuntime;
  mode: RenderMode;
  onAction?: (action: RendererAction) => void;
  /** Map an assetId to a URL (e.g. a locally cached file). Defaults to `config.assets[].url`. */
  resolveAssetUrl?: AssetUrlResolver;
  children: ReactNode;
};

/** Context for renderer components used outside <PageRenderer> (e.g. FrameComposite in Studio). */
export function RendererProvider({
  config,
  runtime,
  mode,
  onAction,
  resolveAssetUrl,
  children,
}: RendererProviderProps) {
  const assetUrls = useMemo(
    () => new Map(config.assets.map((a) => [a.id, a.url] as const)),
    [config.assets],
  );
  const resolveAsset = useCallback<AssetUrlResolver>(
    (id) => resolveAssetUrl?.(id) ?? assetUrls.get(id),
    [resolveAssetUrl, assetUrls],
  );
  // Uploaded fonts: family `pb-font-<assetId>` (see FONT_FAMILY_PREFIX in @pb/schema).
  const fontFaces = useMemo(
    () =>
      config.assets
        .filter((a) => a.kind === 'font')
        .map((a) => {
          const url = resolveAsset(a.id) ?? a.url;
          return `@font-face{font-family:"${FONT_FAMILY_PREFIX}${a.id}";src:url("${url}");font-display:block}`;
        })
        .join('\n'),
    [config.assets, resolveAsset],
  );
  const fontKey = useMemo(() => hashKey(fontFaces), [fontFaces]);
  const value = useMemo<RendererContextValue>(
    () => ({ config, runtime: runtime ?? {}, mode, resolveAsset, onAction: onAction ?? noop }),
    [config, runtime, mode, resolveAsset, onAction],
  );
  return (
    <RendererContext.Provider value={value}>
      <style href="pb-renderer" precedence="default">
        {RENDERER_CSS}
      </style>
      {fontFaces && (
        <style href={`pb-fonts-${fontKey}`} precedence="default">
          {fontFaces}
        </style>
      )}
      {children}
    </RendererContext.Provider>
  );
}

export type PageRendererProps = Omit<RendererProviderProps, 'children'> & {
  page: Page;
  /**
   * `contain` (default): fill the parent and scale the artboard to fit, letterboxed.
   * `none`: render at artboard size (1 artboard px = 1 CSS px); the host scales/zooms (editor).
   */
  fit?: 'contain' | 'none';
  className?: string;
  style?: CSSProperties;
};

/** Draws one page of a booth config on its artboard. Shared by Kiosk and Studio (WYSIWYG). */
export function PageRenderer({
  page,
  fit = 'contain',
  className,
  style,
  ...provider
}: PageRendererProps) {
  const { width, height, letterboxColor } = provider.config.artboard;
  return (
    <RendererProvider {...provider}>
      {fit === 'none' ? (
        <div
          className={['pb-root', className].filter(Boolean).join(' ')}
          data-pb-mode={provider.mode}
          data-pb-page={page.type}
          data-pb-artboard
          style={{ position: 'relative', width, height, overflow: 'hidden', ...style }}
        >
          <PageContent page={page} />
        </div>
      ) : (
        <FitContainer
          artboard={{ width, height }}
          letterboxColor={letterboxColor}
          className={className}
          style={style}
          mode={provider.mode}
          pageType={page.type}
        >
          <PageContent page={page} />
        </FitContainer>
      )}
    </RendererProvider>
  );
}

function FitContainer({
  artboard,
  letterboxColor,
  className,
  style,
  mode,
  pageType,
  children,
}: {
  artboard: { width: number; height: number };
  letterboxColor: string;
  className?: string;
  style?: CSSProperties;
  mode: RenderMode;
  pageType: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fitResult, setFit] = useState<FitResult | null>(null);

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setFit(computeFit({ width: rect.width, height: rect.height }, artboard));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [artboard.width, artboard.height]);

  return (
    <div
      ref={ref}
      className={['pb-root', className].filter(Boolean).join(' ')}
      data-pb-mode={mode}
      data-pb-page={pageType}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: letterboxColor,
        ...style,
      }}
    >
      <div
        data-pb-artboard
        data-pb-scale={fitResult?.scale ?? ''}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: artboard.width,
          height: artboard.height,
          overflow: 'hidden',
          transformOrigin: '0 0',
          transform: fitResult
            ? `translate(${fitResult.offsetX}px, ${fitResult.offsetY}px) scale(${fitResult.scale})`
            : undefined,
          visibility: fitResult && fitResult.scale > 0 ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Elements on the page; for Tutorial the active slide is drawn below the page's own elements. */
function PageContent({ page }: { page: Page }) {
  const { runtime, mode } = useRenderer();
  const slides = page.type === 'tutorial' ? (page.slides ?? []) : [];
  const slideIndex = Math.min(Math.max(0, runtime.slideIndex ?? 0), Math.max(0, slides.length - 1));
  const slide = slides[slideIndex];
  const background = slide?.background ?? page.background;
  const elements: Element[] = slide ? [...slide.elements, ...page.elements] : page.elements;
  const key = `${page.type}:${slide?.id ?? ''}`;
  return (
    <div
      key={key}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        ...(mode === 'live' ? transitionCss(page.transitionIn) : {}),
      }}
    >
      <BackgroundView background={background} />
      {elements.map((el) => (
        <ElementView key={el.id} element={el} />
      ))}
    </div>
  );
}

function BackgroundView({ background }: { background: Background }) {
  const { resolveAsset, mode } = useRenderer();
  const base: CSSProperties = { position: 'absolute', inset: 0 };
  switch (background.kind) {
    case 'color':
      return <div data-pb-background style={{ ...base, background: background.color }} />;
    case 'gradient':
      return <div data-pb-background style={{ ...base, background: background.css }} />;
    case 'image': {
      const src = resolveAsset(background.assetId);
      return src ? (
        <img
          data-pb-background
          src={src}
          alt=""
          draggable={false}
          style={{ ...base, width: '100%', height: '100%', objectFit: background.fit }}
        />
      ) : (
        <div data-pb-background style={{ ...base, background: '#000000' }} />
      );
    }
    case 'video': {
      const src = resolveAsset(background.assetId);
      return src ? (
        <video
          data-pb-background
          src={src}
          autoPlay={mode === 'live'}
          loop
          muted
          playsInline
          style={{ ...base, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div data-pb-background style={{ ...base, background: '#000000' }} />
      );
    }
  }
}
