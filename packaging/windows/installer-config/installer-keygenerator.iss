; ===============================================================================
; LedgerAI PH — Internal Authority License Key Generator (Inno Setup 6 Script)
; Produces: LedgerAI-PH-KeyGenerator-Setup.exe
; Configures background service strictly on loopback 127.0.0.1:4000
; Creates Desktop and Start Menu shortcuts to http://127.0.0.1:4000
; ===============================================================================

#define MyAppName "LedgerAI PH Key Generator"
#define MyAppVersion "2.6.0"
#define MyAppPublisher "LedgerAI Technologies Inc."
#define MyAppURL "http://127.0.0.1:4000"

[Setup]
AppId={{E5D91834-A78C-4E12-892F-9311DA4421FA}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\LedgerAI Key Generator
DisableDirPage=no
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename=LedgerAI-PH-KeyGenerator-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\keygenerator-icon.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\dist-authority\*"; DestDir: "{app}\dist-authority"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\internal\*"; DestDir: "{app}\internal"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\packaging\windows\service-config-authority\*"; DestDir: "{app}\service-config-authority"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\packaging\windows\assets\keygenerator-icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup-authority.bat"; DestDir: "{app}"; Flags: ignoreversion; DestName: "setup-authority.bat"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "http://127.0.0.1:4000"; IconFilename: "{app}\keygenerator-icon.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "http://127.0.0.1:4000"; IconFilename: "{app}\keygenerator-icon.ico"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config-authority\install-keygenerator-service.ps1"" -InstallDir ""{app}"""; StatusMsg: "Installing LedgerAI PH License Authority Service (127.0.0.1:4000)..."; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config-authority\create-keygenerator-shortcut.ps1"" -TargetUrl ""http://127.0.0.1:4000"" -IconPath ""{app}\keygenerator-icon.ico"""; Flags: runhidden
Filename: "http://127.0.0.1:4000"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: shellexec postinstall nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\service-config-authority\uninstall-keygenerator-service.ps1"""; Flags: runhidden
