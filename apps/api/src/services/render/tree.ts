import { FIELD_LABELS, type XmlNode } from '@gestao/xml-parser';

export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? name;
}

export interface FlatRow {
  depth: number;
  kind: 'group' | 'field';
  name: string;
  label: string;
  value: string | null;
  attributes: Record<string, string>;
}

/** Achata a árvore do XML em linhas legíveis (grupos e campos). */
export function flattenTree(root: XmlNode, maxRows = 20000): FlatRow[] {
  const rows: FlatRow[] = [];
  const visit = (node: XmlNode, depth: number) => {
    if (rows.length >= maxRows) return;
    if (node.name === 'Signature') {
      rows.push({ depth, kind: 'field', name: node.name, label: 'Assinatura digital', value: 'Presente (conteúdo omitido)', attributes: {} });
      return;
    }
    if (node.children.length === 0) {
      rows.push({ depth, kind: 'field', name: node.name, label: fieldLabel(node.name), value: node.text, attributes: node.attributes });
      return;
    }
    rows.push({ depth, kind: 'group', name: node.name, label: fieldLabel(node.name), value: node.text, attributes: node.attributes });
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return rows;
}
