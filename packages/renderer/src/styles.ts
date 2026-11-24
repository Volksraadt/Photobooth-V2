import type { BoxStyle, ElementAnimation, TextStyle, Transition } from '@pb/schema';
import type { CSSProperties } from 'react';

export function boxStyleToCss(style: BoxStyle | undefined): CSSProperties {
  if (!style) return {};
  const css: CSSProperties = {};
  if (style.fill) css.background = style.fill;
  if (style.borderWidth && style.borderColor) {
    css.border = `${style.borderWidth}px solid ${style.borderColor}`;
  }
  if (style.borderRadius !== undefined) css.borderRadius = style.borderRadius;
  if (style.shadow) {
    const s = style.shadow;
    css.boxShadow = `${s.x}px ${s.y}px ${s.blur}px ${s.color}`;
  }
  return css;
}

export function textStyleToCss(style: TextStyle | undefined): CSSProperties {
  if (!style) return {};
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    color: style.color,
    textAlign: style.align,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
  };
}

export function pickTextStyle(el: TextStyle): TextStyle {
  return {
    fontFamily: el.fontFamily,
    fontSize: el.fontSize,
    fontWeight: el.fontWeight,
    color: el.color,
    align: el.align,
    lineHeight: el.lineHeight,
    letterSpacing: el.letterSpacing,
  };
}

/** CSS animation for an element's entrance + loop (live mode only). */
export function elementAnimationCss(animation: ElementAnimation | undefined): CSSProperties {
  if (!animation) return {};
  const parts: string[] = [];
  const entrance = animation.entrance;
  if (entrance && entrance.kind !== 'none') {
    parts.push(
      `pb-in-${entrance.kind} ${entrance.durationMs}ms ease-out ${entrance.delayMs}ms both`,
    );
  }
  if (animation.loop && animation.loop !== 'none') {
    const delay = entrance && entrance.kind !== 'none' ? entrance.delayMs + entrance.durationMs : 0;
    const duration = animation.loop === 'pulse' ? 1600 : animation.loop === 'bounce' ? 1200 : 3000;
    parts.push(`pb-loop-${animation.loop} ${duration}ms ease-in-out ${delay}ms infinite`);
  }
  return parts.length ? { animation: parts.join(', ') } : {};
}

export function transitionCss(transition: Transition | undefined): CSSProperties {
  if (!transition || transition.kind === 'none' || transition.durationMs === 0) return {};
  return { animation: `pb-in-${transition.kind} ${transition.durationMs}ms ease-out both` };
}

/** Injected once per renderer root (React 19 dedupes by href). */
export const RENDERER_CSS = `
@keyframes pb-in-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes pb-in-slide-up { from { opacity: 0; transform: translateY(40px) } to { opacity: 1; transform: none } }
@keyframes pb-in-slide-left { from { opacity: 0; transform: translateX(60px) } to { opacity: 1; transform: none } }
@keyframes pb-in-zoom { from { opacity: 0; transform: scale(0.9) } to { opacity: 1; transform: none } }
@keyframes pb-loop-pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.06) } }
@keyframes pb-loop-bounce { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-16px) } }
@keyframes pb-loop-float { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
@keyframes pb-pop { from { opacity: 0; transform: scale(1.6) } to { opacity: 1; transform: scale(1) } }
@keyframes pb-flash { from { opacity: 0.9 } to { opacity: 0 } }
@keyframes pb-spin { to { transform: rotate(360deg) } }
@keyframes pb-shimmer { 0%, 100% { opacity: 0.55 } 50% { opacity: 0.85 } }
@keyframes pb-indeterminate { from { transform: translateX(-100%) } to { transform: translateX(250%) } }
.pb-root, .pb-root * { box-sizing: border-box; }
.pb-root { -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
.pb-root img, .pb-root video { -webkit-user-drag: none; }
.pb-root button { font: inherit; color: inherit; margin: 0; padding: 0; border: 0; background: none; }
.pb-root[data-pb-mode="editor"] *, .pb-root[data-pb-mode="editor"] { animation: none !important; transition: none !important; }
@media (prefers-reduced-motion: reduce) {
  .pb-root *, .pb-root { animation-duration: 1ms !important; animation-iteration-count: 1 !important; animation-delay: 0ms !important; }
}
`;
