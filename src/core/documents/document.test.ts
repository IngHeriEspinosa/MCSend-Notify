import { describe, expect, it } from 'vitest';
import { safeDownloadName, titleFromFileName } from './document';

describe('nombres de documentos', () => {
  it('el título inicial es el nombre sin extensión ni caracteres de control', () => {
    expect(titleFromFileName('Presentación Q3.pptx')).toBe('Presentación Q3');
    expect(titleFromFileName('informe\u0000\u0007.pdf')).toBe('informe');
    expect(titleFromFileName('.pdf')).toBe('Documento');
  });

  it('el nombre de descarga es ASCII seguro para cabeceras', () => {
    expect(safeDownloadName('Presentación "Q3"; final\r\n', 'pptx')).toBe(
      'Presentacion Q3 final.pptx',
    );
    expect(safeDownloadName('***', 'pdf')).toBe('documento.pdf');
  });
});
