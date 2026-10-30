import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { AgentFileMetadata, CompetenceSource } from '@gestao/shared';
import { onlyDigits } from '@gestao/shared';
import { ESOCIAL_EVENTS, EXTRA_FIELDS } from './catalog';

export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  text: string | null;
  children: XmlNode[];
}

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlParseError';
  }
}

export interface ParsedXml {
  root: XmlNode;
  metadata: AgentFileMetadata;
}

const MAX_DEPTH = 200;

/**
 * Converte os bytes originais em texto respeitando BOM e a declaração
 * `encoding` do XML. Os bytes originais nunca são alterados.
 */
export function decodeXml(buffer: Uint8Array): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3));
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }
  const head = new TextDecoder('latin1').decode(buffer.subarray(0, 200));
  const match = /<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i.exec(head);
  const declared = match?.[1]?.toLowerCase();
  if (declared && declared !== 'utf-8' && declared !== 'utf8') {
    try {
      return new TextDecoder(declared).decode(buffer);
    } catch {
      // codificação desconhecida: cai para UTF-8
    }
  }
  return new TextDecoder('utf-8').decode(buffer);
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  processEntities: true,
  htmlEntities: false,
});

type OrderedEntry = Record<string, unknown> & { ':@'?: Record<string, string> };

function toNodes(entries: OrderedEntry[], depth: number): XmlNode[] {
  if (depth > MAX_DEPTH) throw new XmlParseError('XML com profundidade excessiva');
  const nodes: XmlNode[] = [];
  for (const entry of entries) {
    const name = Object.keys(entry).find((k) => k !== ':@');
    if (!name || name === '#text' || name.startsWith('?') || name === '#comment') continue;
    const rawChildren = (entry[name] as OrderedEntry[] | undefined) ?? [];
    const textParts: string[] = [];
    for (const child of rawChildren) {
      if ('#text' in child && child['#text'] != null) textParts.push(String(child['#text']));
    }
    const attributes: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry[':@'] ?? {})) {
      if (k === 'xmlns' || k.startsWith('xmlns:')) continue;
      attributes[k] = String(v);
    }
    nodes.push({
      name,
      attributes,
      text: textParts.length ? textParts.join(' ').trim() || null : null,
      children: toNodes(rawChildren, depth + 1),
    });
  }
  return nodes;
}

/** Lê o XML e devolve a árvore de elementos. Lança XmlParseError se for inválido. */
export function parseXmlTree(input: Uint8Array | string): XmlNode {
  const text = typeof input === 'string' ? input : decodeXml(input);
  if (!text.trim()) throw new XmlParseError('Arquivo vazio');
  if (/<!ENTITY/i.test(text)) {
    throw new XmlParseError('XML com declaração de entidades (DTD) não é aceito por segurança');
  }
  const validation = XMLValidator.validate(text, { allowBooleanAttributes: true });
  if (validation !== true) {
    const err = validation.err;
    throw new XmlParseError(`XML inválido: ${err.msg} (linha ${err.line}, coluna ${err.col})`);
  }
  let parsed: OrderedEntry[];
  try {
    parsed = parser.parse(text) as OrderedEntry[];
  } catch (e) {
    throw new XmlParseError(`XML inválido: ${(e as Error).message}`);
  }
  const roots = toNodes(parsed, 0);
  if (roots.length === 0) throw new XmlParseError('XML sem elemento raiz');
  return roots[0]!;
}

// ---------------------------------------------------------------------------
// Busca na árvore
// ---------------------------------------------------------------------------

export function* walk(node: XmlNode): Generator<XmlNode> {
  const stack: XmlNode[] = [node];
  while (stack.length) {
    const current = stack.pop()!;
    yield current;
    for (let i = current.children.length - 1; i >= 0; i--) stack.push(current.children[i]!);
  }
}

export function findFirst(node: XmlNode | null | undefined, predicate: (n: XmlNode) => boolean): XmlNode | null {
  if (!node) return null;
  for (const n of walk(node)) if (predicate(n)) return n;
  return null;
}

export function findByName(node: XmlNode | null | undefined, ...names: string[]): XmlNode | null {
  return findFirst(node, (n) => names.includes(n.name));
}

export function textOf(node: XmlNode | null | undefined, ...names: string[]): string | null {
  for (const name of names) {
    const found = findFirst(node, (n) => n.name === name && !!n.text);
    if (found?.text) return found.text;
  }
  return null;
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ---------------------------------------------------------------------------
// Extração de metadados
// ---------------------------------------------------------------------------

const DATE_FIELDS = [
  'dtAdm',
  'dtDeslig',
  'dtAlteracao',
  'dtIniAfast',
  'dtInicio',
  'dtTerm',
  'dtPgto',
  'dtAcid',
  'dtAso',
  'dhEmi',
  'dEmi',
  'dhRecepcao',
  'dhProcessamento',
  'dhRecbto',
];

export function extractMetadata(root: XmlNode, fileModifiedAt: Date): AgentFileMetadata {
  // --- tipo do documento ---
  const esocialEvent = findFirst(root, (n) => /^evt[A-Z]/.test(n.name));
  const nfe = findByName(root, 'infNFe');
  const cte = findByName(root, 'infCte');

  let documentType: string | null = root.name;
  let documentTypeLabel: string | null = null;
  let eventCode: string | null = null;
  let documentId: string | null = null;
  let scope: XmlNode = root;

  if (esocialEvent) {
    const known = ESOCIAL_EVENTS[esocialEvent.name];
    documentType = esocialEvent.name;
    eventCode = known?.code ?? null;
    documentTypeLabel = known ? `${known.code} — ${known.label}` : `eSocial — ${esocialEvent.name}`;
    documentId = esocialEvent.attributes.Id ?? esocialEvent.attributes.id ?? null;
    scope = esocialEvent;
  } else if (nfe) {
    const mod = textOf(nfe, 'mod');
    documentType = mod === '65' ? 'NFCe' : 'NFe';
    documentTypeLabel = mod === '65' ? 'NFC-e — Nota Fiscal de Consumidor Eletrônica' : 'NF-e — Nota Fiscal Eletrônica';
    documentId = nfe.attributes.Id ?? null;
    scope = nfe;
  } else if (cte) {
    documentType = 'CTe';
    documentTypeLabel = 'CT-e — Conhecimento de Transporte Eletrônico';
    documentId = cte.attributes.Id ?? null;
    scope = cte;
  } else {
    documentTypeLabel = `XML — ${root.name}`;
    documentId = root.attributes.Id ?? root.attributes.id ?? null;
  }

  // --- empregador / emitente ---
  const ideEmpregador = findByName(scope, 'ideEmpregador') ?? findByName(root, 'ideEmpregador');
  const emit = findByName(scope, 'emit');
  let employerCnpj: string | null = null;
  if (ideEmpregador) {
    const nr = textOf(ideEmpregador, 'nrInsc');
    employerCnpj = nr ? onlyDigits(nr) : null;
  } else if (emit) {
    const nr = textOf(emit, 'CNPJ', 'CPF');
    employerCnpj = nr ? onlyDigits(nr) : null;
  } else {
    const nr = textOf(root, 'CNPJ', 'cnpj', 'nrInsc');
    employerCnpj = nr ? onlyDigits(nr) : null;
  }
  const employerName = emit ? textOf(emit, 'xNome') : textOf(root, 'razaoSocial', 'nmRazao');

  // --- trabalhador ---
  const workerCpfRaw = textOf(scope, 'cpfTrab', 'cpfBenef') ?? textOf(root, 'cpfTrab', 'cpfBenef');
  const workerCpf = workerCpfRaw ? onlyDigits(workerCpfRaw) : null;
  const workerName = textOf(scope, 'nmTrab', 'nmBenefic', 'nmSoc') ?? textOf(root, 'nmTrab');

  // --- competência ---
  let competence: string | null = null;
  let competenceSource: CompetenceSource = 'FILE_DATE';
  let year = fileModifiedAt.getFullYear();
  let month = fileModifiedAt.getMonth() + 1;
  let documentDate: string | null = null;
  const extra: Record<string, unknown> = {};

  const perApur = textOf(scope, 'perApur') ?? textOf(root, 'perApur', 'perRef');
  const perMatch = perApur ? /^(\d{4})(?:-(\d{2}))?/.exec(perApur.trim()) : null;
  if (perMatch) {
    year = Number(perMatch[1]);
    if (perMatch[2]) {
      month = Number(perMatch[2]);
      competence = `${perMatch[1]}-${perMatch[2]}`;
    } else {
      // apuração anual (13º salário): considerada em dezembro
      month = 12;
      competence = perMatch[1]!;
      extra.apuracaoAnual = true;
    }
    competenceSource = 'XML_PERIOD';
  }

  for (const field of DATE_FIELDS) {
    const d = isoDate(textOf(scope, field) ?? textOf(root, field));
    if (d) {
      documentDate = d;
      break;
    }
  }
  if (!perMatch && documentDate) {
    year = Number(documentDate.slice(0, 4));
    month = Number(documentDate.slice(5, 7));
    competence = documentDate.slice(0, 7);
    competenceSource = 'XML_DATE';
  }
  if (!competence) {
    competence = `${year}-${String(month).padStart(2, '0')}`;
  }

  // --- protocolo / recibo ---
  const protocol = textOf(root, 'nrProtocolo', 'protocoloEnvioLote', 'nProt', 'protocolo');
  const receipt = textOf(root, 'nrRecibo', 'recibo');

  for (const field of EXTRA_FIELDS) {
    const v = textOf(scope, field) ?? textOf(root, field);
    if (v) extra[field] = v;
  }
  if (findByName(root, 'Signature')) extra.assinaturaDigital = true;

  return {
    documentType,
    documentTypeLabel,
    eventCode,
    documentId,
    employerCnpj,
    employerName: employerName ?? null,
    workerCpf: workerCpf || null,
    workerName: workerName ?? null,
    competence,
    competenceSource,
    year,
    month,
    documentDate,
    protocol: protocol ?? null,
    receipt: receipt ?? null,
    rootElement: root.name,
    extra,
  };
}

/** Lê o arquivo e extrai os metadados. Nunca altera os bytes originais. */
export function parseXmlFile(content: Uint8Array, fileModifiedAt: Date): ParsedXml {
  const root = parseXmlTree(content);
  return { root, metadata: extractMetadata(root, fileModifiedAt) };
}
