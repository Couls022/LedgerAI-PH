; =========================================================================
; LedgerAI PH — Enterprise Accounting Suite Inno Setup Script
; =========================================================================
; This script automates compiling a clean, professional Windows Installer Wizard.
; Requires Inno Setup compiler (ISCC) installed on the local Windows build system.

[Setup]
AppId={{D37D80FA-CC31-4FE1-86B6-AF7FCEB9862B}
AppName=LedgerAI PH
AppVersion=1.0.0
AppPublisher=LedgerAI Corp.
AppPublisherURL=https://ledgerai.ph
AppSupportURL=https://ledgerai.ph/support
AppUpdatesURL=https://ledgerai.ph/updates
DefaultDirName={pf}\LedgerAI PH
DefaultGroupName=LedgerAI PH
AllowNoIcons=yes
OutputDir=dist
OutputBaseFilename=LedgerAI_PH_Windows_Setup_x64
Compression=lzma
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
SetupIconFile=..\assets\app-icon.ico
UninstallDisplayIcon={app}\app-icon.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Copy compiled Electron binary assets from packaging out folder
Source: "..\out\LedgerAI PH-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Copy reference application assets
Source: "..\assets\app-icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\LedgerAI PH"; Filename: "{app}\LedgerAI PH.exe"
Name: "{group}\{cm:UninstallProgram,LedgerAI PH}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\LedgerAI PH"; Filename: "{app}\LedgerAI PH.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\LedgerAI PH.exe"; Description: "{cm:LaunchProgram,LedgerAI PH}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Crucial Enterprise Safety Directive:
; Never delete SQLite company database directories, log directories, or backup packages
; upon uninstallation. These files reside in local AppData and must remain preserved.
Type: filesandordirs; Name: "{app}\*"

[Code]
// Verify runtime requirements or configure system setups
function InitializeSetup(): Boolean;
begin
  Log('Initializing LedgerAI PH Desktop Installation Setup Wizard...');
  Result := True;
end;

procedure CurUninstallStepChanged(JustAfterAnUninstallStep: TUninstallStep);
begin
  if JustAfterAnUninstallStep = usPostUninstall then
  begin
    MsgBox('LedgerAI PH binaries have been successfully uninstalled from this computer.' + #13#10#13#10 +
           'CRITICAL DATA PRESERVATION NOTICE: Your company databases, financial logs, and system ' +
           'backup archives located in AppData (%APPDATA%/LedgerAI) have NOT been deleted to protect ' +
           'your financial records. If you reinstall the software, your data will be recovered automatically.',
           mbInformation, MB_OK);
  end;
end;
