import type { XmlNode } from '@gestao/xml-parser';
import {
  COMPETENCE_SOURCE_LABELS,
  formatBytes,
  formatCnpj,
  formatCompetence,
  formatCpf,
  type RecordDTO,
} from '@gestao/shared';
import { escapeHtml as e } from '../mail';
import { fieldLabel } from './tree';

const dt = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');

export function identificationRows(r: RecordDTO): [string, string][] {
  return [
    ['Empresa', r.companyName],
    ['CNPJ da empresa', formatCnpj(r.companyCnpj)],
    ['Tipo do documento', r.documentTypeLabel ?? r.documentType ?? '—'],
    ['Competência', r.competence ? `${formatCompetence(r.year, r.month)}` : '—'],
    ['Origem da competência', r.competenceSource ? COMPETENCE_SOURCE_LABELS[r.competenceSource] : '—'],
    ['Trabalhador', r.workerName ?? '—'],
    ['CPF do trabalhador', r.workerCpf ? formatCpf(r.workerCpf) : '—'],
    ['Inscrição do empregador (XML)', r.employerCnpj ? formatCnpj(r.employerCnpj) : '—'],
    ['Protocolo', r.protocol ?? '—'],
    ['Recibo', r.receipt ?? '—'],
    ['Identificador do documento', r.documentId ?? '—'],
    ['Data do documento', r.documentDate ? r.documentDate.split('-').reverse().join('/') : '—'],
    ['Arquivo', r.filename],
    ['Caminho na pasta', `${r.folderName}\\${r.relativePath}`],
    ['Tamanho', formatBytes(r.fileSize)],
    ['Data do arquivo', dt(r.fileModifiedAt)],
    ['Importado em', dt(r.importedAt)],
    ['Importado por', r.importedByName ?? '—'],
    ['Hash SHA-256', r.fileHash],
  ];
}

function renderNode(node: XmlNode, depth: number): string {
  if (node.name === 'Signature') {
    return `<details class="sig"><summary>Assinatura digital (presente)</summary><p>Conteúdo técnico da assinatura omitido nesta visualização. O XML original permanece íntegro.</p></details>`;
  }
  const attrs = Object.entries(node.attributes)
    .map(([k, v]) => `<span class="attr">${e(k)}="${e(v)}"</span>`)
    .join(' ');
  if (node.children.length === 0) {
    return `<tr><th title="${e(node.name)}">${e(fieldLabel(node.name))}${attrs ? ` ${attrs}` : ''}</th><td>${e(node.text ?? '')}</td></tr>`;
  }
  const leaves = node.children.filter((c) => c.children.length === 0 && c.name !== 'Signature');
  const groups = node.children.filter((c) => c.children.length > 0 || c.name === 'Signature');
  const tag = depth === 0 ? 'section' : 'div';
  return `<${tag} class="group d${Math.min(depth, 6)}">
    <h3><span>${e(fieldLabel(node.name))}</span>${fieldLabel(node.name) !== node.name ? ` <small>${e(node.name)}</small>` : ''}${attrs ? ` <small>${attrs}</small>` : ''}</h3>
    ${leaves.length ? `<table class="fields">${leaves.map((l) => renderNode(l, depth + 1)).join('')}</table>` : ''}
    ${groups.map((g) => renderNode(g, depth + 1)).join('')}
  </${tag}>`;
}

/** HTML legível e autônomo (sem scripts) com os dados do XML. */
export function renderRecordHtml(record: RecordDTO, root: XmlNode, logoDataUri: string | null): string {
  const title = record.documentTypeLabel ?? record.documentType ?? 'Documento XML';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${e(title)} — ${e(record.filename)}</title>
<style>
  :root { --navy:#0f2a4a; --navy-2:#1d3f6b; --orange:#f07d1a; --line:#e3e8ef; --muted:#5b6b80; }
  * { box-sizing: border-box; }
  body { margin:0; font: 14px/1.5 "Segoe UI", Roboto, Arial, sans-serif; color:#1b2635; background:#f5f7fa; }
  header { background: var(--navy); color:#fff; padding:18px 32px; display:flex; align-items:center; gap:18px; border-bottom:4px solid var(--orange); }
  header img { height:44px; background:#fff; border-radius:6px; padding:4px; }
  header .brand strong { display:block; font-size:16px; letter-spacing:.04em; }
  header .brand span { font-size:12px; opacity:.85; }
  main { max-width: 1000px; margin: 24px auto; padding: 0 16px 48px; }
  h1 { color: var(--navy); font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:20px 24px; margin-bottom:20px; }
  .card > h2 { margin:0 0 12px; font-size:15px; color:var(--navy); text-transform:uppercase; letter-spacing:.05em; border-left:4px solid var(--orange); padding-left:10px; }
  table { width:100%; border-collapse: collapse; }
  table.ident th { text-align:left; width: 34%; color: var(--muted); font-weight:600; }
  th, td { padding:6px 10px; border-bottom:1px solid var(--line); vertical-align:top; word-break: break-word; }
  table.fields th { text-align:left; width:40%; font-weight:500; color:#33475f; }
  .group { margin: 10px 0 0 0; }
  .group h3 { margin: 14px 0 6px; font-size: 14px; color: var(--navy-2); }
  .group h3 small { color: var(--muted); font-weight: 400; font-family: Consolas, monospace; font-size: 11px; }
  .group .group { margin-left: 16px; padding-left: 12px; border-left: 2px solid var(--line); }
  .attr { font-family: Consolas, monospace; font-size: 11px; color: var(--muted); }
  .hash { font-family: Consolas, monospace; font-size: 12px; }
  .sig { margin: 10px 0; color: var(--muted); }
  footer { text-align:center; color: var(--muted); font-size:12px; padding: 16px; border-top:1px solid var(--line); }
  @media print { body { background:#fff; } .card { border:none; padding:0; } header { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
<header>
  ${logoDataUri ? `<img src="${logoDataUri}" alt="Gestão Contadores">` : ''}
  <div class="brand"><strong>GESTÃO CONTADORES</strong><span>Departamento Pessoal · REGISTROS XML-PDF</span></div>
</header>
<main>
  <h1>${e(title)}</h1>
  <p class="sub">${e(record.companyName)} · Competência ${e(formatCompetence(record.year, record.month))}</p>
  <div class="card">
    <h2>Identificação</h2>
    <table class="ident">
      ${identificationRows(record)
        .map(([k, v]) => `<tr><th>${e(k)}</th><td${k === 'Hash SHA-256' ? ' class="hash"' : ''}>${e(v)}</td></tr>`)
        .join('')}
    </table>
  </div>
  <div class="card">
    <h2>Conteúdo do XML</h2>
    ${renderNode(root, 0)}
  </div>
</main>
<footer>Gestão Contadores — Departamento Pessoal · Visualização gerada a partir do XML original, que permanece inalterado.</footer>
</body>
</html>`;
}
