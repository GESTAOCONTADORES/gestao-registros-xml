import { describe, expect, it } from 'vitest';
import { decodeXml, parseXmlFile, XmlParseError } from '../src';
import { esocialS1200, esocialS2200, nfe } from '../../../test-fixtures/xml';

const mtime = new Date('2026-05-03T12:00:00Z');
const buf = (s: string) => Buffer.from(s, 'utf8');

describe('parser XML', () => {
  it('extrai metadados do S-1200 (eSocial)', () => {
    const { metadata } = parseXmlFile(buf(esocialS1200()), mtime);
    expect(metadata.eventCode).toBe('S-1200');
    expect(metadata.documentTypeLabel).toContain('Remuneração');
    expect(metadata.employerCnpj).toBe('12345678');
    expect(metadata.workerCpf).toBe('52998224725');
    expect(metadata.competence).toBe('2026-10');
    expect(metadata.competenceSource).toBe('XML_PERIOD');
    expect([metadata.year, metadata.month]).toEqual([2026, 10]);
    expect(metadata.receipt).toBe('1.1.0000000000000000001');
    expect(metadata.documentId).toMatch(/^ID/);
  });

  it('usa a data do evento quando não há período de apuração (S-2200)', () => {
    const { metadata } = parseXmlFile(buf(esocialS2200()), mtime);
    expect(metadata.eventCode).toBe('S-2200');
    expect(metadata.workerName).toBe('Maria da Silva');
    expect(metadata.competenceSource).toBe('XML_DATE');
    expect([metadata.year, metadata.month]).toEqual([2026, 10]);
    expect(metadata.extra.nmCargo).toBe('Assistente de DP');
  });

  it('reconhece NF-e', () => {
    const { metadata } = parseXmlFile(buf(nfe()), mtime);
    expect(metadata.documentType).toBe('NFe');
    expect(metadata.employerCnpj).toBe('12345678000195');
    expect(metadata.protocol).toBe('153260000000001');
    expect([metadata.year, metadata.month]).toEqual([2026, 9]);
  });

  it('não quebra quando os campos não existem (usa a data do arquivo)', () => {
    const { metadata } = parseXmlFile(buf('<documento><qualquer>valor</qualquer></documento>'), mtime);
    expect(metadata.documentType).toBe('documento');
    expect(metadata.workerCpf).toBeNull();
    expect(metadata.competenceSource).toBe('FILE_DATE');
    expect(metadata.year).toBe(2026);
  });

  it('apuração anual (13º) é considerada em dezembro', () => {
    const { metadata } = parseXmlFile(buf(esocialS1200({ perApur: '2025' })), mtime);
    expect([metadata.year, metadata.month]).toEqual([2025, 12]);
    expect(metadata.extra.apuracaoAnual).toBe(true);
  });

  it('rejeita XML inválido com mensagem clara', () => {
    expect(() => parseXmlFile(buf('<a><b></a>'), mtime)).toThrow(XmlParseError);
    expect(() => parseXmlFile(buf(''), mtime)).toThrow(/vazio/);
  });

  it('rejeita entidades DTD (proteção contra XXE / billion laughs)', () => {
    const evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>';
    expect(() => parseXmlFile(buf(evil), mtime)).toThrow(/entidades/);
  });

  it('respeita a codificação ISO-8859-1 declarada', () => {
    const latin1 = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><x><nmTrab>João Conceição</nmTrab></x>', 'latin1');
    expect(decodeXml(latin1)).toContain('João Conceição');
    expect(parseXmlFile(latin1, mtime).metadata.workerName).toBe('João Conceição');
  });
});
