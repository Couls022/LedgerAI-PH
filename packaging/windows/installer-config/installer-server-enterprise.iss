; ===============================================================================
; LedgerAI PH — Enterprise Multi-Mode Windows Server & Workstation Installer
; Inno Setup 6 Specification (Mode A: Server | Mode B: Server+Desktop | Mode C: Single-PC)
; Target Output: LedgerAI-PH-Enterprise-Setup.exe
;
; CRITICAL DATA PRESERVATION GUARANTEE:
;   Uninstallation and in-place upgrades NEVER delete or overwrite existing
;   company databases in %ProgramData%\LedgerAI\data or %APPDATA%\LedgerAI.
; ===============================================================================

#define MyAppName "LedgerAI PH"
#define MyAppVersion "1.0.0-rc.2"
#define MyAppPublisher "LedgerAI Technologies Inc."
#define MyAppURL "http://ledgerai.local"

[Setup]
AppId={{91F4E7C2-8B10-4D63-A90E-41C0F29A7712}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\LedgerAI PH
DisableDirPage=no
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\..\..\release-installers
OutputBaseFilename=LedgerAI-PH-Enterprise-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\app-icon.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "serverdesktop"; Description: "Mode B: Central Server + Local Desktop Workspace (Recommended for Main Accounting PC 1)"
Name: "serveronly"; Description: "Mode A: Dedicated Central Server Service Only (Headless Office Server)"
Name: "singlepc"; Description: "Mode C: Single-PC Standalone Mode (Localhost 127.0.0.1 Only — No LAN Ports)"

[Components]
Name: "core"; Description: "LedgerAI PH Core Engine & Web Application"; Types: serverdesktop serveronly singlepc; Flags: fixed
Name: "service"; Description: "Windows Background Service (LedgerAIServerService + Auto-Recovery)"; Types: serverdesktop serveronly singlepc; Flags: fixed
Name: "lan"; Description: "Office LAN Hostname & Port 80 Proxy (Domain & Private Firewall Only)"; Types: serverdesktop serveronly
Name: "desktop"; Description: "Local Desktop Browser Shortcut & Admin Tools"; Types: serverdesktop singlepc

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Components: desktop

[Files]
Source: "..\..\..\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\..\resources\ocr\traineddata\*"; DestDir: "{app}\resources\ocr\traineddata"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "..\service-config\*"; DestDir: "{app}\service-config"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\assets\app-icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "http://ledgerai.local"; IconFilename: "{app}\app-icon.ico"; Components: desktop
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "http://ledgerai.local"; IconFilename: "{app}\app-icon.ico"; Tasks: desktopicon; Components: desktop

[Run]
; Mode A: Dedicated Central Server
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config\configure-ledgerai-domain.ps1"" -Hostname ""ledgerai.local"" -AlternateHostname ""ledgerai-server.local"" -EnablePort80Proxy"; StatusMsg: "Configuring LAN hostname and Port 80 proxy..."; Flags: runhidden; Check: IsServerOnlyMode
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config\install-ledgerai-service.ps1"" -InstallMode Server -InstallDir ""{app}"" -EnablePort80Proxy"; StatusMsg: "Registering LedgerAI PH Central Server Service..."; Flags: runhidden; Check: IsServerOnlyMode

; Mode B: Central Server + Desktop
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config\configure-ledgerai-domain.ps1"" -Hostname ""ledgerai.local"" -AlternateHostname ""ledgerai-server.local"" -EnablePort80Proxy"; StatusMsg: "Configuring LAN hostname and Port 80 proxy..."; Flags: runhidden; Check: IsServerDesktopMode
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config\install-ledgerai-service.ps1"" -InstallMode ServerAndDesktop -InstallDir ""{app}"" -EnablePort80Proxy"; StatusMsg: "Registering LedgerAI PH Server + Desktop Service..."; Flags: runhidden; Check: IsServerDesktopMode

; Mode C: Single-PC Standalone (127.0.0.1 loopback only, zero LAN firewall rules)
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config\install-ledgerai-service.ps1"" -InstallMode SinglePC -InstallDir ""{app}"""; StatusMsg: "Registering LedgerAI PH Local Standalone Service..."; Flags: runhidden; Check: IsSinglePCMode

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config\uninstall-ledgerai-service.ps1"""; StatusMsg: "Stopping and unregistering LedgerAI PH Windows Service..."; Flags: runhidden

[Code]
function IsServerOnlyMode(): Boolean;
begin
  Result := WizardSetupType(False) = 'serveronly';
end;

function IsServerDesktopMode(): Boolean;
begin
  Result := WizardSetupType(False) = 'serverdesktop';
end;

function IsSinglePCMode(): Boolean;
begin
  Result := WizardSetupType(False) = 'singlepc';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    MsgBox('LedgerAI PH program binaries and background service have been removed.' + #13#10#13#10 +
           'DATA PRESERVATION GUARANTEE: Your company databases, encryption keystores, ' +
           'and backup archives in %ProgramData%\LedgerAI\data and %APPDATA%\LedgerAI ' +
           'were NOT deleted or modified.', mbInformation, MB_OK);
  end;
end;
