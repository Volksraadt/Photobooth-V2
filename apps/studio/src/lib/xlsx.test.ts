import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildCsv, buildXlsx } from './xlsx';

describe('export files', () => {
  it('writes a readable xlsx with numbers as numbers and escaped text', () => {
    const bytes = buildXlsx('Transaksi', [
      ['Kode', 'Kotor', 'Catatan'],
      ['ABCD2345', 35000, 'a < b & "c"'],
    ]);
    expect(Buffer.from(bytes.subarray(0, 2)).toString()).toBe('PK');
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
      ]),
    );
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<c r="B2"><v>35000</v></c>');
    expect(sheet).toContain('ABCD2345');
    expect(sheet).toContain('a &lt; b &amp; &quot;c&quot;');
    expect(strFromU8(files['xl/workbook.xml']!)).toContain('name="Transaksi"');
  });

  it('writes CSV with BOM, quoting and formula protection', () => {
    const csv = buildCsv([
      ['Kode', 'Catatan'],
      ['A', 'halo, dunia'],
      ['B', '=HYPERLINK("http://evil")'],
      ['C', null],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('A,"halo, dunia"');
    expect(csv).toContain(`B,"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('C,\r\n');
  });
});
