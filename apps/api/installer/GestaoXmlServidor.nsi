; =====================================================================
;  Gestão XML — Servidor (API) para Windows — instalador NSIS 3
;  Gerado por: npm run installer -w @gestao/api
;
;  Instala no computador do escritório que fica ligado:
;    - API do sistema como serviço do Windows (GestaoXmlApi), com Node.js
;      e banco de dados embutidos e backup diário automático;
;    - (opcional) Cloudflare Tunnel, para o site acessar a API pela internet;
;    - (opcional) o Gestão XML Agent neste mesmo computador, já configurado.
;  Gera automaticamente os segredos e o TOKEN DO AGENTE.
; =====================================================================

Unicode true
ManifestDPIAware true

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "TextFunc.nsh"
!include "x64.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef PAYLOAD
  !error "Defina /DPAYLOAD=<pasta com node, app, service, tools, scripts>"
!endif
!ifndef OUTFILE
  !define OUTFILE "GestaoXmlServidor-Setup-${VERSION}.exe"
!endif

!define APPNAME "Gestão XML Servidor"
!define PUBLISHER "Gestão Contadores — Departamento Pessoal"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\GestaoXmlServidor"
!define STARTMENU "$SMPROGRAMS\Gestão XML Servidor"
!define DEFAULT_SITE "https://gestao-registros-xml.pages.dev"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\GestaoXmlServidor"
InstallDirRegKey HKLM "${REGKEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText "${PUBLISHER}"
ShowInstDetails show

Var DataDir
Var MasterPw
Var SiteUrl
Var TunnelToken
Var InstallAgent
Var AgentToken
Var IsUpgrade
Var HealthMsg
Var TunnelMsg
Var hMasterPw
Var hSite
Var hTunnel
Var hAgent

; ---------------------------------------------------------------- páginas
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalação do servidor do sistema REGISTROS XML-PDF"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala a API do sistema neste computador, como serviço do Windows, com banco de dados e backup diário automático.$\r$\n$\r$\nUse um computador que fique ligado durante o expediente.$\r$\n$\r$\nTenha em mãos (opcional):$\r$\n  • o endereço do site no Cloudflare Pages;$\r$\n  • o token do Cloudflare Tunnel (painel da Cloudflare › Zero Trust › Networks › Tunnels)."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom ConfigPage ConfigPageLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Servidor instalado"
!define MUI_FINISHPAGE_TEXT "$HealthMsg$\r$\nAbra o sistema neste computador em http://localhost:3333 (atalho no Menu Iniciar).$\r$\n$TunnelMsg$\r$\n$\r$\nTOKEN DO AGENTE (use no instalador do Gestão XML Agent):$\r$\n$AgentToken$\r$\n$\r$\nTudo isso fica salvo em Menu Iniciar › Gestão XML Servidor › Dados de acesso."
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Abrir os dados de acesso (token do agente)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenAccessData
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
    MessageBox MB_ICONSTOP "O servidor requer Windows 64 bits." /SD IDOK
    Abort
  ${EndIf}
  SetShellVarContext all
  SetRegView 64
  StrCpy $DataDir "$APPDATA\GestaoXmlServidor"
  StrCpy $MasterPw "DP102030"
  StrCpy $InstallAgent ${BST_CHECKED}
  StrCpy $IsUpgrade "0"
  ${If} ${FileExists} "$DataDir\.env"
    StrCpy $IsUpgrade "1"
    ${ConfigRead} "$DataDir\.env" "CORS_ORIGINS=" $SiteUrl
    StrCpy $InstallAgent ${BST_UNCHECKED}
  ${EndIf}
  ${If} $SiteUrl == ""
    StrCpy $SiteUrl "${DEFAULT_SITE}"
  ${EndIf}
  ; parâmetros (instalação pela TI): /SITE="https://..." /TUNNEL="eyJ..." /MASTERPW="..."
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/SITE=" $R1
  ${IfNot} ${Errors}
    StrCpy $SiteUrl $R1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/TUNNEL=" $TunnelToken
  ClearErrors
  ${GetOptions} $R0 "/MASTERPW=" $R1
  ${IfNot} ${Errors}
    StrCpy $MasterPw $R1
  ${EndIf}
  ClearErrors
FunctionEnd

; ---------------------------------------------------------------- página de configuração
Function ConfigPage
  !insertmacro MUI_HEADER_TEXT "Configuração do servidor" "Pode deixar como está e ajustar depois em Menu Iniciar › Gestão XML Servidor › Editar configuração."
  nsDialogs::Create 1018
  Pop $0

  ${If} $IsUpgrade == "1"
    ${NSD_CreateLabel} 0 0 100% 10u "Atualização: os dados, a senha e o token do agente atuais serão mantidos."
    Pop $0
  ${Else}
    ${NSD_CreateLabel} 0 2u 55% 10u "Senha inicial do usuário Master:"
    Pop $0
    ${NSD_CreatePassword} 56% 0 44% 13u $MasterPw
    Pop $hMasterPw
  ${EndIf}

  ${NSD_CreateLabel} 0 18u 100% 10u "Endereço do site (Cloudflare Pages). Vários: separe por vírgula."
  Pop $0
  ${NSD_CreateText} 0 29u 100% 13u $SiteUrl
  Pop $hSite

  ${NSD_CreateLabel} 0 48u 100% 10u "Token do Cloudflare Tunnel (opcional — pode colar o comando inteiro do painel):"
  Pop $0
  ${NSD_CreateText} 0 59u 100% 13u $TunnelToken
  Pop $hTunnel

  ${NSD_CreateCheckbox} 0 78u 100% 20u "Instalar também o Gestão XML Agent neste computador (é o que tem o Google Drive)"
  Pop $hAgent
  ${NSD_SetState} $hAgent $InstallAgent

  ${NSD_CreateLabel} 0 102u 100% 32u "A API fica acessível somente neste computador (127.0.0.1:3333). O acesso pela internet é feito com segurança pelo Cloudflare Tunnel, sem abrir portas no roteador. Dados e backups ficam em C:\ProgramData\GestaoXmlServidor."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function ConfigPageLeave
  ${If} $IsUpgrade != "1"
    ${NSD_GetText} $hMasterPw $MasterPw
    StrLen $0 $MasterPw
    ${If} $0 < 6
      MessageBox MB_ICONEXCLAMATION "A senha inicial do Master deve ter no mínimo 6 caracteres."
      Abort
    ${EndIf}
  ${EndIf}
  ${NSD_GetText} $hSite $SiteUrl
  ${NSD_GetText} $hTunnel $TunnelToken
  ${NSD_GetState} $hAgent $InstallAgent
  StrCpy $0 $SiteUrl 8
  ${If} $SiteUrl != ""
  ${AndIf} $0 != "https://"
    MessageBox MB_ICONEXCLAMATION "O endereço do site deve começar com https://"
    Abort
  ${EndIf}
FunctionEnd

Function OpenAccessData
  ExecShell "open" "$WINDIR\notepad.exe" '"$DataDir\DADOS-DE-ACESSO.txt"'
FunctionEnd

; Lê a primeira linha de um arquivo em $R9
Function ReadFirstLine
  Exch $R8
  Push $R7
  StrCpy $R9 ""
  ClearErrors
  FileOpen $R7 $R8 r
  ${IfNot} ${Errors}
    FileRead $R7 $R9
    FileClose $R7
  ${EndIf}
  ${TrimNewLines} $R9 $R9
  Pop $R7
  Pop $R8
FunctionEnd

; ---------------------------------------------------------------- instalação
Section "Servidor" SecMain
  SectionIn RO
  SetShellVarContext all
  SetRegView 64
  ${DisableX64FSRedirection}

  ; atualização: para o serviço antes de substituir os arquivos
  ${If} ${FileExists} "$INSTDIR\service\GestaoXmlApi.exe"
    DetailPrint "Parando o serviço da API..."
    nsExec::Exec '"$INSTDIR\service\GestaoXmlApi.exe" stop'
    Pop $0
    Sleep 2000
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*.*"
  CreateDirectory "$DataDir"

  ; configuração (.env com segredos aleatórios na 1ª instalação)
  DetailPrint "Gerando a configuração..."
  InitPluginsDir
  FileOpen $0 "$PLUGINSDIR\mpw.txt" w
  FileWrite $0 $MasterPw
  FileClose $0
  ; o token do túnel pode vir como o comando completo do painel: usa a última palavra
  ${If} $TunnelToken != ""
    ${WordFind} "$TunnelToken" " " "-1" $R0
    ${IfNot} ${Errors}
      StrCpy $TunnelToken $R0
    ${EndIf}
    ClearErrors
  ${EndIf}
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\tools\setup.cjs" configure --data "$DataDir" --app "$INSTDIR\app" --site "$SiteUrl" --master-password-file "$PLUGINSDIR\mpw.txt"'
  Pop $0
  Delete "$PLUGINSDIR\mpw.txt"
  ${If} $0 != 0
    Push "$DataDir\setup-resultado.txt"
    Call ReadFirstLine
    MessageBox MB_ICONSTOP "Falha ao gerar a configuração do servidor ($R9). Verifique o log da instalação." /SD IDOK
  ${EndIf}

  ; somente Administradores e o sistema acessam dados, segredos e backups
  nsExec::Exec 'icacls "$DataDir" /inheritance:r /grant:r *S-1-5-32-544:(OI)(CI)F *S-1-5-18:(OI)(CI)F /T /Q'
  Pop $0

  ; serviço do Windows (WinSW): inicia com o Windows e reinicia sozinho em caso de falha
  DetailPrint "Registrando o serviço GestaoXmlApi..."
  FileOpen $0 "$INSTDIR\service\GestaoXmlApi.xml" w
  FileWrite $0 '<?xml version="1.0" encoding="utf-8"?>$\r$\n<service>$\r$\n'
  FileWrite $0 '  <id>GestaoXmlApi</id>$\r$\n  <name>Gestao XML - API</name>$\r$\n'
  FileWrite $0 '  <description>API do sistema REGISTROS XML-PDF (Departamento Pessoal - Gestao Contadores)</description>$\r$\n'
  FileWrite $0 '  <executable>$INSTDIR\node\node.exe</executable>$\r$\n'
  FileWrite $0 '  <arguments>"$INSTDIR\app\dist\index.js"</arguments>$\r$\n'
  FileWrite $0 '  <workingdirectory>$INSTDIR\app</workingdirectory>$\r$\n'
  FileWrite $0 '  <env name="ENV_FILE" value="$DataDir\.env"/>$\r$\n'
  FileWrite $0 '  <startmode>Automatic</startmode>$\r$\n  <delayedAutoStart>true</delayedAutoStart>$\r$\n'
  FileWrite $0 '  <onfailure action="restart" delay="10 sec"/>$\r$\n  <onfailure action="restart" delay="30 sec"/>$\r$\n  <onfailure action="restart" delay="60 sec"/>$\r$\n'
  FileWrite $0 '  <resetfailure>1 hour</resetfailure>$\r$\n  <stoptimeout>15 sec</stoptimeout>$\r$\n'
  FileWrite $0 '  <logpath>$DataDir\logs</logpath>$\r$\n'
  FileWrite $0 '  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>$\r$\n'
  FileWrite $0 '</service>$\r$\n'
  FileClose $0
  nsExec::ExecToLog '"$INSTDIR\service\GestaoXmlApi.exe" install'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\service\GestaoXmlApi.exe" start'
  Pop $0

  DetailPrint "Aguardando a API responder..."
  nsExec::Exec '"$INSTDIR\node\node.exe" "$INSTDIR\tools\setup.cjs" wait-health --port 3333 --timeout 120 --out "$DataDir\health.txt"'
  Pop $0
  ${If} $0 == 0
    StrCpy $HealthMsg "OK: API em funcionamento neste computador (http://127.0.0.1:3333)."
  ${Else}
    StrCpy $HealthMsg "ATENÇÃO: a API ainda não respondeu. Veja Menu Iniciar › Gestão XML Servidor › Status do servidor."
  ${EndIf}
  DetailPrint $HealthMsg

  ; Cloudflare Tunnel (serviço "Cloudflared")
  StrCpy $TunnelMsg "Cloudflare Tunnel: não configurado nesta instalação (pode ser feito depois)."
  ${If} $TunnelToken != ""
    DetailPrint "Configurando o Cloudflare Tunnel..."
    nsExec::Exec 'sc query Cloudflared'
    Pop $0
    ${If} $0 == 0
      nsExec::ExecToLog '"$INSTDIR\cloudflared\cloudflared.exe" service uninstall'
      Pop $0
      Sleep 2000
    ${EndIf}
    nsExec::ExecToLog '"$INSTDIR\cloudflared\cloudflared.exe" service install $TunnelToken'
    Pop $0
    ${If} $0 == 0
      WriteRegDWORD HKLM "${REGKEY}" "TunnelInstalled" 1
      StrCpy $TunnelMsg "OK: Cloudflare Tunnel instalado. No painel da Cloudflare, aponte o endereço público para http://127.0.0.1:3333"
    ${Else}
      StrCpy $TunnelMsg "ATENÇÃO: não foi possível instalar o Cloudflare Tunnel (confira o token)."
    ${EndIf}
  ${EndIf}
  DetailPrint $TunnelMsg

  Push "$DataDir\agent-token.txt"
  Call ReadFirstLine
  StrCpy $AgentToken $R9

  ; atalhos de administração
  CreateDirectory "${STARTMENU}"
  WriteINIStr "${STARTMENU}\Abrir o sistema (neste computador).url" "InternetShortcut" "URL" "http://localhost:3333"
  CreateShortcut "${STARTMENU}\Criar link de teste temporário.lnk" "$INSTDIR\scripts\link-de-teste.cmd" "" "$SYSDIR\shell32.dll" 13
  CreateShortcut "${STARTMENU}\Status do servidor.lnk" "$INSTDIR\scripts\status.cmd" "" "$SYSDIR\shell32.dll" 15
  CreateShortcut "${STARTMENU}\Reiniciar servidor.lnk" "$INSTDIR\scripts\reiniciar.cmd" "" "$SYSDIR\shell32.dll" 238
  CreateShortcut "${STARTMENU}\Fazer backup agora.lnk" "$INSTDIR\scripts\backup-agora.cmd" "" "$SYSDIR\shell32.dll" 7
  CreateShortcut "${STARTMENU}\Restaurar backup.lnk" "$INSTDIR\scripts\restaurar-backup.cmd" "" "$SYSDIR\shell32.dll" 238
  CreateShortcut "${STARTMENU}\Editar configuração.lnk" "$INSTDIR\scripts\editar-configuracao.cmd" "" "$SYSDIR\shell32.dll" 21
  CreateShortcut "${STARTMENU}\Dados de acesso (token do agente).lnk" "$INSTDIR\scripts\dados-de-acesso.cmd" "" "$SYSDIR\shell32.dll" 47
  CreateShortcut "${STARTMENU}\Abrir logs.lnk" "$INSTDIR\scripts\abrir-logs.cmd" "" "$SYSDIR\shell32.dll" 4
  CreateShortcut "${STARTMENU}\Instalador do Agente.lnk" "$INSTDIR\agente\GestaoXmlAgent-Setup.exe"
  CreateShortcut "${STARTMENU}\Desinstalar servidor.lnk" "$INSTDIR\Desinstalar.exe"

  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKLM "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${REGKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${REGKEY}" "DisplayIcon" "$INSTDIR\node\node.exe"
  WriteRegStr HKLM "${REGKEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKLM "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${REGKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${REGKEY}" "EstimatedSize" "$0"

  ; agente neste computador: abre o instalador do agente já preenchido,
  ; SEM privilégios de administrador (ele roda na sessão do usuário do Google Drive)
  ${If} $InstallAgent == ${BST_CHECKED}
  ${AndIf} $AgentToken != ""
    FileOpen $0 "$TEMP\gx-instalar-agente.cmd" w
    FileWrite $0 '@echo off$\r$\nstart "" "$INSTDIR\agente\GestaoXmlAgent-Setup.exe" /API="http://localhost:3333" /TOKEN="$AgentToken"$\r$\n(goto) 2>nul & del "%~f0"$\r$\n'
    FileClose $0
    Exec '"$WINDIR\explorer.exe" "$TEMP\gx-instalar-agente.cmd"'
  ${EndIf}

  ${EnableX64FSRedirection}
SectionEnd

; ---------------------------------------------------------------- desinstalação
Section "Uninstall"
  SetShellVarContext all
  SetRegView 64
  ${DisableX64FSRedirection}
  StrCpy $DataDir "$APPDATA\GestaoXmlServidor"

  ${If} ${FileExists} "$INSTDIR\service\GestaoXmlApi.exe"
    nsExec::ExecToLog '"$INSTDIR\service\GestaoXmlApi.exe" stop'
    Pop $0
    Sleep 2000
    nsExec::ExecToLog '"$INSTDIR\service\GestaoXmlApi.exe" uninstall'
    Pop $0
  ${EndIf}
  ReadRegDWORD $0 HKLM "${REGKEY}" "TunnelInstalled"
  ${If} $0 == 1
    nsExec::ExecToLog '"$INSTDIR\cloudflared\cloudflared.exe" service uninstall'
    Pop $0
  ${EndIf}

  RMDir /r "${STARTMENU}"
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\web"
  RMDir /r "$INSTDIR\service"
  RMDir /r "$INSTDIR\tools"
  RMDir /r "$INSTDIR\scripts"
  RMDir /r "$INSTDIR\cloudflared"
  RMDir /r "$INSTDIR\agente"
  Delete "$INSTDIR\LEIA-ME.txt"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir "$INSTDIR"

  ; por segurança os dados são mantidos, a menos que a pessoa confirme
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Apagar também o BANCO DE DADOS, os backups e a configuração em$\r$\n$DataDir ?$\r$\n$\r$\nTodos os registros do sistema serão perdidos. Na dúvida, clique em Não." /SD IDNO IDNO keepData
    RMDir /r "$DataDir"
  keepData:

  DeleteRegKey HKLM "${REGKEY}"
  ${EnableX64FSRedirection}
SectionEnd
