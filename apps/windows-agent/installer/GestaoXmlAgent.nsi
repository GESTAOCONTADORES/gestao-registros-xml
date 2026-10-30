; =====================================================================
;  Gestão XML Agent — instalador para Windows (NSIS 3)
;  Gerado por: npm run installer -w @gestao/windows-agent
;
;  - instala na conta do usuário (não exige administrador): é nessa sessão
;    que a unidade G: do Google Drive para computador existe;
;  - inclui o Node.js (não é preciso instalar nada antes);
;  - pergunta endereço da API, token e pasta monitorada, testa a conexão;
;  - inicia o agente sem janela a cada logon e o reinicia se parar.
;
;  Instalação silenciosa (TI):
;    GestaoXmlAgent-Setup.exe /S /API=https://api... /TOKEN=... [/ROOT="G:\..."]
; =====================================================================

Unicode true
ManifestDPIAware true

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "TextFunc.nsh"
!include "x64.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef PAYLOAD
  !error "Defina /DPAYLOAD=<pasta com node, dist e scripts>"
!endif
!ifndef OUTFILE
  !define OUTFILE "GestaoXmlAgent-Setup-${VERSION}.exe"
!endif

!define APPNAME "Gestão XML Agent"
!define PUBLISHER "Gestão Contadores — Departamento Pessoal"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\GestaoXmlAgent"
!define DEFAULT_ROOT "G:\Drives compartilhados\Departamento Pessoal\REGISTROS ROBO XML - PDF"
!define PS '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"'
!define PSARGS "-NoProfile -ExecutionPolicy Bypass"
!define STARTMENU "$SMPROGRAMS\Gestão XML Agent"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\GestaoXmlAgent"
InstallDirRegKey HKCU "${REGKEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${PUBLISHER}"
ShowInstDetails show

Var ApiUrl
Var Token
Var RootPath
Var hApi
Var hToken
Var hRoot

; ---------------------------------------------------------------- páginas
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalação do Gestão XML Agent"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala o agente que lê a pasta compartilhada do Departamento Pessoal e envia os XML para o sistema REGISTROS XML-PDF.$\r$\n$\r$\nAntes de continuar, tenha em mãos:$\r$\n  • o endereço da API do sistema;$\r$\n  • o token do agente.$\r$\n$\r$\n(Fornecidos pelo responsável pelo sistema.)$\r$\n$\r$\nO Google Drive para computador deve estar aberto e conectado nesta conta do Windows."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom ConfigPage ConfigPageLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Gestão XML Agent instalado"
!define MUI_FINISHPAGE_TEXT "O agente já está em execução em segundo plano e iniciará sozinho sempre que você entrar no Windows.$\r$\n$\r$\nNo sistema web deve aparecer: Agente XML ● Online.$\r$\n$\r$\nAtalhos no Menu Iniciar › Gestão XML Agent:$\r$\nIniciar, Parar, Testar conexão, Abrir logs e Editar configuração."
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "PortugueseBR"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "FileDescription" "Instalador do ${APPNAME}"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "LegalCopyright" "Gestão Contadores"

; ---------------------------------------------------------------- inicialização
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "O Gestão XML Agent requer Windows 64 bits." /SD IDOK
    SetErrorLevel 3
    Abort
  ${EndIf}

  ; parâmetros da linha de comando (instalação silenciosa)
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/API=" $ApiUrl
  ClearErrors
  ${GetOptions} $R0 "/TOKEN=" $Token
  ClearErrors
  ${GetOptions} $R0 "/ROOT=" $RootPath
  ClearErrors

  ; atualização: reaproveita a configuração existente
  ReadRegStr $R1 HKCU "${REGKEY}" "InstallLocation"
  ${If} $R1 != ""
  ${AndIf} ${FileExists} "$R1\.env"
    ${If} $ApiUrl == ""
      ${ConfigRead} "$R1\.env" "API_URL=" $ApiUrl
    ${EndIf}
    ${If} $Token == ""
      ${ConfigRead} "$R1\.env" "AGENT_API_TOKEN=" $Token
    ${EndIf}
    ${If} $RootPath == ""
      ${ConfigRead} "$R1\.env" "ROOT_PATH=" $RootPath
    ${EndIf}
  ${EndIf}
  ${If} $RootPath == ""
    StrCpy $RootPath "${DEFAULT_ROOT}"
  ${EndIf}

  ${If} ${Silent}
    Call ValidateValues
    Pop $0
    ${If} $0 != "ok"
      SetErrorLevel 2
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

; Valida $ApiUrl/$Token/$RootPath. Empilha "ok" ou a mensagem de erro.
Function ValidateValues
  StrCpy $R0 $ApiUrl 8
  StrCpy $R1 $ApiUrl 16
  StrCpy $R2 $ApiUrl 16
  ${If} $R0 != "https://"
  ${AndIf} $R1 != "http://localhost"
  ${AndIf} $R2 != "http://127.0.0.1"
    Push "Informe o endereço da API começando com https://"
    Return
  ${EndIf}
  StrLen $R0 $Token
  ${If} $R0 < 24
    Push "O token do agente deve ter pelo menos 24 caracteres."
    Return
  ${EndIf}
  ${If} $RootPath == ""
    Push "Informe a pasta monitorada."
    Return
  ${EndIf}
  Push "ok"
FunctionEnd

; ---------------------------------------------------------------- página de configuração
Function ConfigPage
  !insertmacro MUI_HEADER_TEXT "Conexão com o sistema" "Dados fornecidos pelo responsável pelo sistema REGISTROS XML-PDF."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 10u "Endereço da API (ex.: https://api-registros.gestaocontadores.com.br):"
  Pop $0
  ${NSD_CreateText} 0 11u 100% 13u $ApiUrl
  Pop $hApi

  ${NSD_CreateLabel} 0 31u 100% 10u "Token do agente:"
  Pop $0
  ${NSD_CreatePassword} 0 42u 100% 13u $Token
  Pop $hToken

  ${NSD_CreateLabel} 0 62u 100% 10u "Pasta monitorada (Google Drive):"
  Pop $0
  ${NSD_CreateText} 0 73u 80% 13u $RootPath
  Pop $hRoot
  ${NSD_CreateBrowseButton} 82% 72u 18% 15u "Procurar..."
  Pop $0
  ${NSD_OnClick} $0 OnBrowseRoot

  ${NSD_CreateLabel} 0 96u 100% 36u "O agente apenas lê esta pasta e grava os relatórios em RELATORIOS ROBO. Nenhum arquivo é apagado ou alterado. A comunicação com o sistema é feita somente pela internet (HTTPS), sem abrir portas neste computador."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function OnBrowseRoot
  ${NSD_GetText} $hRoot $R0
  nsDialogs::SelectFolderDialog "Selecione a pasta REGISTROS ROBO XML - PDF" $R0
  Pop $R1
  ${If} $R1 != error
    ${NSD_SetText} $hRoot $R1
  ${EndIf}
FunctionEnd

Function ConfigPageLeave
  ${NSD_GetText} $hApi $ApiUrl
  ${NSD_GetText} $hToken $Token
  ${NSD_GetText} $hRoot $RootPath
  Call ValidateValues
  Pop $0
  ${If} $0 != "ok"
    MessageBox MB_ICONEXCLAMATION $0
    Abort
  ${EndIf}
  ${IfNot} ${FileExists} "$RootPath\*.*"
    MessageBox MB_YESNO|MB_ICONQUESTION "A pasta não foi encontrada agora:$\r$\n$RootPath$\r$\n$\r$\nVerifique se o Google Drive para computador está aberto e conectado.$\r$\n$\r$\nContinuar mesmo assim?" IDYES +2
    Abort
  ${EndIf}
FunctionEnd

; ---------------------------------------------------------------- instalação
Section "Gestão XML Agent" SecMain
  SectionIn RO
  ${DisableX64FSRedirection}

  ; atualização: para o agente em execução antes de substituir os arquivos
  ${If} ${FileExists} "$INSTDIR\scripts\parar-agente.ps1"
    DetailPrint "Parando o agente em execução..."
    nsExec::Exec '${PS} ${PSARGS} -File "$INSTDIR\scripts\parar-agente.ps1" -Quiet'
    Pop $0
    Sleep 1500
  ${EndIf}

  SetOutPath "$INSTDIR"
  SetDetailsPrint none
  File /r "${PAYLOAD}\*.*"
  SetDetailsPrint both
  CreateDirectory "$INSTDIR\data\logs"

  ; configuração (o .env fica no perfil do usuário: só ele e administradores leem)
  DetailPrint "Gravando a configuração..."
  FileOpen $0 "$INSTDIR\.env" w
  FileWrite $0 "# Gestão XML Agent - configuração gerada pelo instalador$\r$\n"
  FileWrite $0 "# Após alterar: Menu Iniciar > Gestão XML Agent > Parar agente e depois Iniciar agente$\r$\n"
  FileWrite $0 "API_URL=$ApiUrl$\r$\n"
  FileWrite $0 "AGENT_API_TOKEN=$Token$\r$\n"
  FileWrite $0 "ROOT_PATH=$RootPath$\r$\n"
  FileWrite $0 "REPORTS_FOLDER_NAME=RELATORIOS ROBO$\r$\n"
  FileWrite $0 "DATA_DIR=$INSTDIR\data$\r$\n"
  FileWrite $0 "LOG_RETENTION_DAYS=30$\r$\n"
  FileClose $0

  ; atalhos
  CreateDirectory "${STARTMENU}"
  CreateShortcut "${STARTMENU}\Iniciar agente.lnk" ${PS} '${PSARGS} -WindowStyle Hidden -File "$INSTDIR\scripts\iniciar-agente.ps1"' "$INSTDIR\node\node.exe" 0 SW_SHOWMINIMIZED
  CreateShortcut "${STARTMENU}\Parar agente.lnk" ${PS} '${PSARGS} -WindowStyle Hidden -File "$INSTDIR\scripts\parar-agente.ps1"' "$SYSDIR\shell32.dll" 27 SW_SHOWMINIMIZED
  CreateShortcut "${STARTMENU}\Testar conexão.lnk" "$INSTDIR\scripts\testar-conexao.cmd" "" "$SYSDIR\shell32.dll" 23
  CreateShortcut "${STARTMENU}\Abrir logs.lnk" "$INSTDIR\data\logs" "" "$SYSDIR\shell32.dll" 4
  CreateShortcut "${STARTMENU}\Editar configuração.lnk" "$WINDIR\notepad.exe" '"$INSTDIR\.env"'
  CreateShortcut "${STARTMENU}\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
  ; inicialização automática ao fazer logon (sessão do usuário = acesso ao G:)
  CreateShortcut "$SMSTARTUP\Gestão XML Agent.lnk" ${PS} '${PSARGS} -WindowStyle Hidden -File "$INSTDIR\scripts\launcher.ps1"' "$INSTDIR\node\node.exe" 0 SW_SHOWMINIMIZED

  ; desinstalação (Configurações > Aplicativos)
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\node\node.exe"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegStr HKCU "${REGKEY}" "QuietUninstallString" '"$INSTDIR\Desinstalar.exe" /S'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" "$0"

  ; teste de conexão
  DetailPrint "Testando a pasta e a conexão com a API..."
  Delete "$INSTDIR\data\teste-conexao.txt"
  nsExec::Exec '"$INSTDIR\node\node.exe" "$INSTDIR\dist\agent.cjs" --check --ascii "--out=$INSTDIR\data\teste-conexao.txt"'
  Pop $0
  StrCpy $1 ""
  ClearErrors
  FileOpen $2 "$INSTDIR\data\teste-conexao.txt" r
  ${IfNot} ${Errors}
    ${Do}
      FileRead $2 $3
      ${If} ${Errors}
        ${ExitDo}
      ${EndIf}
      StrCpy $1 "$1$3"
    ${Loop}
    FileClose $2
  ${EndIf}
  DetailPrint $1
  ${If} $0 == 0
    MessageBox MB_ICONINFORMATION "Tudo certo! A conexão com o sistema funcionou e a pasta está acessível.$\r$\n$\r$\n$1" /SD IDOK
  ${ElseIf} $0 == 2
    MessageBox MB_ICONEXCLAMATION "A conexão com o sistema funcionou, mas a pasta monitorada não está acessível agora.$\r$\nAbra o Google Drive para computador e confira o caminho.$\r$\n$\r$\n$1" /SD IDOK
  ${Else}
    MessageBox MB_ICONEXCLAMATION "O agente foi instalado, mas não conseguiu falar com o sistema.$\r$\nConfira o endereço da API e o token (Menu Iniciar › Gestão XML Agent › Editar configuração).$\r$\n$\r$\n$1" /SD IDOK
  ${EndIf}

  ; inicia em segundo plano, sem janela
  DetailPrint "Iniciando o agente..."
  Delete "$INSTDIR\parar.flag"
  ExecShell "open" ${PS} '${PSARGS} -WindowStyle Hidden -File "$INSTDIR\scripts\launcher.ps1"' SW_HIDE

  ${EnableX64FSRedirection}
SectionEnd

; ---------------------------------------------------------------- desinstalação
Section "Uninstall"
  ${DisableX64FSRedirection}
  ${If} ${FileExists} "$INSTDIR\scripts\parar-agente.ps1"
    nsExec::Exec '${PS} ${PSARGS} -File "$INSTDIR\scripts\parar-agente.ps1" -Quiet'
    Pop $0
    Sleep 1500
  ${EndIf}
  ${EnableX64FSRedirection}

  Delete "$SMSTARTUP\Gestão XML Agent.lnk"
  RMDir /r "${STARTMENU}"

  MessageBox MB_YESNO|MB_ICONQUESTION "Remover também os logs e o cache do agente?" /SD IDYES IDNO keepData
    RMDir /r "$INSTDIR\data"
  keepData:

  ; nada na pasta do Google Drive é tocado
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\dist"
  RMDir /r "$INSTDIR\scripts"
  Delete "$INSTDIR\.env"
  Delete "$INSTDIR\.env.example"
  Delete "$INSTDIR\LEIA-ME.txt"
  Delete "$INSTDIR\parar.flag"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
SectionEnd
