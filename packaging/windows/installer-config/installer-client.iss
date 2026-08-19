; ===============================================================================
; LedgerAI PH — Production Client Windows Installer (Inno Setup 6 Script)
; Produces: LedgerAI-PH-Client-Setup.exe
; Configures background service on port 80/3000, domain binding to ledgerai.ph,
; creates Desktop and Start Menu shortcuts, and strictly preserves company databases on uninstall.
; ===============================================================================

#define MyAppName "LedgerAI PH"
#define MyAppVersion "2.6.0"
#define MyAppPublisher "LedgerAI Technologies Inc."
#define MyAppURL "http://ledgerai.ph"
#define MyAppExeName "setup.bat"

[Setup]
AppId={{C82F634A-48FE-4FBE-B349-160B5B11B210}
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
OutputBaseFilename=LedgerAI-PH-Client-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\app-icon.ico

; CRITICAL DATA PRESERVATION NOTICE:
; Uninstallation strictly preserves company accounting records stored in %APPDATA%\LedgerAI.
; Never purge or include user application data directory in [UninstallDelete].

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\packaging\windows\service-config\*"; DestDir: "{app}\service-config"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\packaging\windows\assets\app-icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup.bat"; DestDir: "{app}"; Flags: ignoreversion; DestName: "setup.bat"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "http://ledgerai.ph"; IconFilename: "{app}\app-icon.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "http://ledgerai.ph"; IconFilename: "{app}\app-icon.ico"; Tasks: desktopicon

[Run]
; Run automatic service registration and hosts configuration
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config\configure-ledgerai-domain.ps1"""; StatusMsg: "Configuring local domain binding (http://ledgerai.ph)..."; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config\install-ledgerai-service.ps1"" -InstallDir ""{app}"""; StatusMsg: "Registering and starting LedgerAI PH Background Service..."; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config\create-desktop-shortcut.ps1"" -TargetUrl ""http://ledgerai.ph"" -IconPath ""{app}\app-icon.ico"""; Flags: runhidden
Filename: "http://ledgerai.ph"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: shellexec postinstall nowait skipifsilent

[UninstallRun]
; Stop and deregister Windows service on uninstallation
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config\uninstall-ledgerai-service.ps1"""; Flags: runhidden
