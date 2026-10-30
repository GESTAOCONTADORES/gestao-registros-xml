import { existsSync, readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import type { XmlNode } from '@gestao/xml-parser';
import { MONTHS_SHORT, type RecordDTO } from '@gestao/shared';
import { identificationRows } from './html';
import { flattenTree } from './tree';

type Doc = PDFKit.PDFDocument;

export const COLORS = {
  navy: '#0f2a4a',
  navy2: '#1d3f6b',
  orange: '#f07d1a',
  text: '#1b2635',
  muted: '#5b6b80',
  line: '#d9e0e8',
  zebra: '#f4f6f9',
};

// Margens ABNT (NBR 14724): superior e esquerda 3 cm; inferior e direita 2 cm.
const CM = 28.3465;
export const MARGINS = { top: 3 * CM, left: 3 * CM, bottom: 2 * CM, right: 2 * CM };
const FOOTER_TEXT = 'Gestão Contadores — Departamento Pessoal';

export function loadLogo(path: string): Buffer | null {
  try {
    if (path && existsSync(path)) return readFileSync(path);
  } catch {
    // sem logo
  }
  return null;
}

export function createDoc(title: string): Doc {
  return new PDFDocument({
    size: 'A4',
    margins: MARGINS,
    bufferPages: true,
    info: { Title: title, Author: 'Gestão Contadores — Departamento Pessoal', Creator: 'REGISTROS XML-PDF' },
  });
}

export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

const contentWidth = (doc: Doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottomLimit = (doc: Doc) => doc.page.height - doc.page.margins.bottom;

export function ensureSpace(doc: Doc, height: number) {
  if (doc.y + height > bottomLimit(doc)) doc.addPage();
}

/** Numeração no canto superior direito (ABNT) e rodapé institucional em todas as páginas, exceto a capa. */
export function decoratePages(doc: Doc, opts: { skipFirst: boolean; generatedAt: Date }) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (opts.skipFirst && i === range.start) continue;
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
    doc.text(String(i + 1), left, 2 * CM - 9, { width, align: 'right', lineBreak: false });
    const footerY = doc.page.height - 1.3 * CM;
    doc.moveTo(left, footerY - 6).lineTo(left + width, footerY - 6).lineWidth(0.5).strokeColor(COLORS.line).stroke();
    doc.text(FOOTER_TEXT, left, footerY, { width: width / 2, align: 'left', lineBreak: false });
    doc.text(
      `Gerado em ${opts.generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      left + width / 2,
      footerY,
      { width: width / 2, align: 'right', lineBreak: false },
    );
    doc.page.margins.bottom = savedBottom;
  }
}

export function brandHeader(doc: Doc, logo: Buffer | null, subtitle: string) {
  const left = doc.page.margins.left;
  const top = 1 * CM;
  if (logo) {
    try {
      doc.image(logo, left, top, { fit: [110, 34] });
    } catch {
      // imagem inválida: ignora
    }
  }
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.navy);
  doc.text('GESTÃO CONTADORES', left + (logo ? 120 : 0), top + 4, { lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted);
  doc.text(subtitle, left + (logo ? 120 : 0), top + 18, { lineBreak: false });
  doc
    .moveTo(left, top + 38)
    .lineTo(left + contentWidth(doc), top + 38)
    .lineWidth(1.5)
    .strokeColor(COLORS.orange)
    .stroke();
  doc.x = left;
  doc.y = doc.page.margins.top;
}

/** Título de seção numerada (ABNT: título primário em caixa alta e negrito). */
export function sectionTitle(doc: Doc, text: string) {
  ensureSpace(doc, 50);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.navy).text(text.toUpperCase(), doc.page.margins.left);
  doc.moveDown(0.4);
}

export function caption(doc: Doc, text: string) {
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text).text(text, doc.page.margins.left, doc.y, {
    width: contentWidth(doc),
    align: 'center',
  });
  doc.moveDown(0.3);
}

export function source(doc: Doc, text: string) {
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(text, doc.page.margins.left, doc.y, {
    width: contentWidth(doc),
  });
  doc.moveDown(0.5);
}

export interface Column {
  header: string;
  width: number; // fração da largura
  align?: 'left' | 'right' | 'center';
}

/** Tabela com cabeçalho repetido a cada página. */
export function table(doc: Doc, columns: Column[], rows: string[][], opts: { boldLast?: boolean; fontSize?: number } = {}) {
  const left = doc.page.margins.left;
  const total = contentWidth(doc);
  const widths = columns.map((c) => c.width * total);
  const fs = opts.fontSize ?? 9;
  const pad = 4;

  const drawHeader = () => {
    const h = 18;
    const y = doc.y;
    doc.rect(left, y, total, h).fill(COLORS.navy);
    let x = left;
    doc.font('Helvetica-Bold').fontSize(fs).fillColor('#ffffff');
    columns.forEach((c, i) => {
      doc.text(c.header, x + pad, y + 5, { width: widths[i]! - pad * 2, align: c.align ?? 'left', lineBreak: false });
      x += widths[i]!;
    });
    doc.y = y + h;
  };

  ensureSpace(doc, 40);
  drawHeader();
  rows.forEach((row, idx) => {
    const bold = opts.boldLast && idx === rows.length - 1;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
    const heights = row.map((cell, i) => doc.heightOfString(cell ?? '', { width: widths[i]! - pad * 2 }));
    const h = Math.max(...heights) + pad * 2;
    if (doc.y + h > bottomLimit(doc)) {
      doc.addPage();
      drawHeader();
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
    }
    const y = doc.y;
    if (idx % 2 === 1 || bold) doc.rect(left, y, total, h).fill(bold ? '#fde9d6' : COLORS.zebra);
    let x = left;
    doc.fillColor(COLORS.text);
    row.forEach((cell, i) => {
      doc.text(cell ?? '', x + pad, y + pad, { width: widths[i]! - pad * 2, align: columns[i]!.align ?? 'left' });
      x += widths[i]!;
    });
    doc.moveTo(left, y + h).lineTo(left + total, y + h).lineWidth(0.4).strokeColor(COLORS.line).stroke();
    doc.y = y + h;
  });
  doc.x = left;
  doc.moveDown(0.3);
}

/** Gráfico de barras horizontais (uma linha por categoria). */
export function horizontalBarChart(doc: Doc, data: { label: string; value: number }[], opts: { color?: string } = {}) {
  const left = doc.page.margins.left;
  const total = contentWidth(doc);
  const labelW = total * 0.38;
  const valueW = 40;
  const barMaxW = total - labelW - valueW - 8;
  const rowH = 15;
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLORS.muted).text('Sem dados para o período selecionado.', left);
    return;
  }
  for (const d of data) {
    ensureSpace(doc, rowH);
    const y = doc.y;
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.text);
    doc.text(d.label, left, y + 3, { width: labelW - 6, ellipsis: true, lineBreak: false });
    const w = (d.value / max) * barMaxW;
    doc.rect(left + labelW, y + 2, barMaxW, rowH - 4).fill('#eef1f5');
    if (w > 0) doc.rect(left + labelW, y + 2, Math.max(w, 1.5), rowH - 4).fill(opts.color ?? COLORS.orange);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.navy);
    doc.text(d.value.toLocaleString('pt-BR'), left + labelW + barMaxW + 4, y + 3, { width: valueW, align: 'right', lineBreak: false });
    doc.y = y + rowH;
  }
  doc.x = left;
  doc.moveDown(0.3);
}

/** Gráfico de colunas (janeiro a dezembro). */
export function monthlyColumnChart(doc: Doc, values: number[]) {
  const left = doc.page.margins.left;
  const total = contentWidth(doc);
  const height = 170;
  ensureSpace(doc, height + 30);
  const top = doc.y + 10;
  const baseY = top + height;
  const max = Math.max(1, ...values);
  const slot = total / 12;
  const barW = slot * 0.6;
  doc.lineWidth(0.4).strokeColor(COLORS.line);
  for (let g = 0; g <= 4; g++) {
    const gy = baseY - (height * g) / 4;
    doc.moveTo(left, gy).lineTo(left + total, gy).stroke();
  }
  values.forEach((v, i) => {
    const h = (v / max) * (height - 14);
    const x = left + i * slot + (slot - barW) / 2;
    if (h > 0) doc.rect(x, baseY - h, barW, h).fill(COLORS.orange);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.navy);
    doc.text(v.toLocaleString('pt-BR'), left + i * slot, baseY - h - 11, { width: slot, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.text);
    doc.text(MONTHS_SHORT[i]!, left + i * slot, baseY + 4, { width: slot, align: 'center', lineBreak: false });
  });
  doc.moveTo(left, baseY).lineTo(left + total, baseY).lineWidth(1).strokeColor(COLORS.navy).stroke();
  doc.x = left;
  doc.y = baseY + 20;
}

// ---------------------------------------------------------------------------
// PDF de um registro XML
// ---------------------------------------------------------------------------

export async function renderRecordPdf(record: RecordDTO, root: XmlNode, logo: Buffer | null): Promise<Buffer> {
  const title = record.documentTypeLabel ?? record.documentType ?? 'Documento XML';
  const doc = createDoc(`${title} — ${record.filename}`);
  const generatedAt = new Date();
  doc.on('pageAdded', () => brandHeader(doc, logo, 'Departamento Pessoal · REGISTROS XML-PDF'));
  brandHeader(doc, logo, 'Departamento Pessoal · REGISTROS XML-PDF');

  doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.navy).text(title, { align: 'left' });
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text(record.companyName);
  doc.moveDown(0.5);

  sectionTitle(doc, '1 Identificação');
  table(
    doc,
    [
      { header: 'Campo', width: 0.34 },
      { header: 'Informação', width: 0.66 },
    ],
    identificationRows(record),
  );

  sectionTitle(doc, '2 Conteúdo do XML');
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  for (const row of flattenTree(root)) {
    const indent = Math.min(row.depth, 8) * 10;
    const attrs = Object.entries(row.attributes)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ');
    if (row.kind === 'group') {
      ensureSpace(doc, 30);
      doc.moveDown(0.25);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.navy2);
      doc.text(row.label + (row.label !== row.name ? `  (${row.name})` : ''), left + indent, doc.y, { width: width - indent });
      if (attrs) doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(attrs, left + indent, doc.y, { width: width - indent });
    } else {
      const labelW = Math.min(200, (width - indent) * 0.45);
      doc.font('Helvetica').fontSize(8.5);
      const text = (row.value ?? '') + (attrs ? `  [${attrs}]` : '');
      const h = Math.max(
        doc.heightOfString(row.label, { width: labelW - 6 }),
        doc.heightOfString(text || ' ', { width: width - indent - labelW }),
      );
      ensureSpace(doc, h + 4);
      const y = doc.y;
      doc.fillColor(COLORS.muted).text(row.label, left + indent, y, { width: labelW - 6 });
      doc.fillColor(COLORS.text).text(text || '—', left + indent + labelW, y, { width: width - indent - labelW });
      doc.y = y + h + 2;
      doc.moveTo(left + indent, doc.y).lineTo(left + width, doc.y).lineWidth(0.3).strokeColor(COLORS.line).stroke();
      doc.y += 2;
    }
  }

  doc.moveDown(1);
  ensureSpace(doc, 40);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(COLORS.muted).text(
    `Documento gerado a partir do XML original, que permanece inalterado. SHA-256: ${record.fileHash}`,
    left,
    doc.y,
    { width },
  );

  decoratePages(doc, { skipFirst: false, generatedAt });
  return toBuffer(doc);
}
