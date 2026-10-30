/** Geradores de XML usados nos testes (dados fictícios). */

export function esocialS1200(opts: { cnpjRaiz?: string; cpf?: string; nome?: string; perApur?: string; id?: string; recibo?: string } = {}) {
  const id = opts.id ?? 'ID1123456780000002026103010000000000000001';
  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtRemun/v_S_01_02_00">
  <evtRemun Id="${id}">
    <ideEvento><indRetif>1</indRetif><indApuracao>1</indApuracao><perApur>${opts.perApur ?? '2026-10'}</perApur><tpAmb>1</tpAmb><procEmi>1</procEmi><verProc>1.0</verProc></ideEvento>
    <ideEmpregador><tpInsc>1</tpInsc><nrInsc>${opts.cnpjRaiz ?? '12345678'}</nrInsc></ideEmpregador>
    <ideTrabalhador><cpfTrab>${opts.cpf ?? '52998224725'}</cpfTrab></ideTrabalhador>
    <dmDev><ideDmDev>1</ideDmDev><codCateg>101</codCateg>
      <infoPerApur><ideEstabLot><tpInsc>1</tpInsc><nrInsc>12345678000195</nrInsc><codLotacao>01</codLotacao>
        <remunPerApur><matricula>0001</matricula>
          <itensRemun><codRubr>1000</codRubr><ideTabRubr>01</ideTabRubr><vrRubr>3500.00</vrRubr></itensRemun>
        </remunPerApur>
      </ideEstabLot></infoPerApur>
    </dmDev>
  </evtRemun>
  <retornoEvento><recibo><nrRecibo>${opts.recibo ?? '1.1.0000000000000000001'}</nrRecibo></recibo></retornoEvento>
</eSocial>`;
}

export function esocialS2200(opts: { cpf?: string; nome?: string; dtAdm?: string } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtAdmissao/v_S_01_02_00">
  <evtAdmissao Id="ID1123456780000002026101510000000000000002">
    <ideEvento><indRetif>1</indRetif><tpAmb>1</tpAmb><procEmi>1</procEmi><verProc>1.0</verProc></ideEvento>
    <ideEmpregador><tpInsc>1</tpInsc><nrInsc>12345678</nrInsc></ideEmpregador>
    <trabalhador><cpfTrab>${opts.cpf ?? '11144477735'}</cpfTrab><nmTrab>${opts.nome ?? 'Maria da Silva'}</nmTrab><sexo>F</sexo></trabalhador>
    <vinculo><matricula>0002</matricula><infoRegimeTrab><infoCeletista><dtAdm>${opts.dtAdm ?? '2026-10-15'}</dtAdm></infoCeletista></infoRegimeTrab>
      <infoContrato><nmCargo>Assistente de DP</nmCargo><remuneracao><vrSalFx>2800.00</vrSalFx><undSalFixo>5</undSalFixo></remuneracao></infoContrato>
    </vinculo>
  </evtAdmissao>
</eSocial>`;
}

export function nfe() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe53261012345678000195550010000001231000001234" versao="4.00">
    <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-09-20T10:00:00-03:00</dhEmi><natOp>Venda</natOp></ide>
    <emit><CNPJ>12345678000195</CNPJ><xNome>Empresa Teste Ltda</xNome></emit>
    <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
  </infNFe></NFe>
  <protNFe><infProt><nProt>153260000000001</nProt></infProt></protNFe>
</nfeProc>`;
}
