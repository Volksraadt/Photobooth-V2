'use client';

import { useEffect } from 'react';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Indonesian text for the browser's built-in form validation (it follows the browser language). */
function messageFor(el: Field): string {
  const v = el.validity;
  if (v.valueMissing) return el instanceof HTMLSelectElement ? 'Pilih salah satu.' : 'Wajib diisi.';
  if (v.typeMismatch && el.type === 'email') return 'Masukkan alamat email yang valid.';
  if (v.typeMismatch && el.type === 'url') return 'Masukkan URL yang valid.';
  if (v.tooShort && el instanceof HTMLInputElement)
    return `Minimal ${el.minLength} karakter (sekarang ${el.value.length}).`;
  if (v.tooLong && el instanceof HTMLInputElement) return `Maksimal ${el.maxLength} karakter.`;
  if (v.rangeUnderflow && el instanceof HTMLInputElement) return `Minimal ${el.min}.`;
  if (v.rangeOverflow && el instanceof HTMLInputElement) return `Maksimal ${el.max}.`;
  if (v.stepMismatch) return 'Nilai tidak sesuai kelipatan yang diizinkan.';
  if (v.badInput) return 'Masukkan angka yang valid.';
  if (v.patternMismatch) return el.title || 'Format tidak sesuai.';
  return '';
}

/**
 * Mounted once in the root layout. Native constraint validation stays (no JS needed to block an
 * empty submit); only the bubble text is replaced. Pages that set their own message keep it.
 */
export function ValidationMessages() {
  useEffect(() => {
    const onInvalid = (e: Event) => {
      const el = e.target as Field;
      if (!('validity' in el) || el.dataset.customValidity === 'own') return;
      el.setCustomValidity('');
      if (!el.validity.valid) el.setCustomValidity(messageFor(el));
    };
    // Clear the custom text as soon as the user edits, so the field can become valid again.
    const onInput = (e: Event) => {
      const el = e.target as Field;
      if ('setCustomValidity' in el && el.dataset.customValidity !== 'own')
        el.setCustomValidity('');
    };
    document.addEventListener('invalid', onInvalid, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    return () => {
      document.removeEventListener('invalid', onInvalid, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('change', onInput, true);
    };
  }, []);
  return null;
}
