#ifndef SourceDir
  #error SourceDir must point to the prepared WallHub portable directory.
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#ifndef AppVersion
  #define AppVersion "2.0.1"
#endif
#ifndef Architecture
  #define Architecture "x64"
#endif
#ifndef SetupIcon
  #error SetupIcon must point to the generated WallHub icon.
#endif
#ifndef ChineseMessages
  #error ChineseMessages must point to the Simplified Chinese Inno Setup messages file.
#endif

[Setup]
AppId={{6A8B4B30-1CE6-4D94-A0F8-C5A98714E35D}
AppName=WallHub
AppVersion={#AppVersion}
AppPublisher=WallHub
AppPublisherURL=https://github.com/ChEnLeo-7/WallHub2.0
AppSupportURL=https://github.com/ChEnLeo-7/WallHub2.0/issues
DefaultDirName={localappdata}\WallHub2.0
DefaultGroupName=WallHub
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
AppMutex=WallHub.Launcher
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=WallHub-Setup-win-{#Architecture}
SetupIconFile={#SetupIcon}
UninstallDisplayIcon={app}\WallHub.exe
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ChangesAssociations=no
ChangesEnvironment=no
LicenseFile={#SourceDir}\LICENSE

[Languages]
Name: "chinesesimp"; MessagesFile: "{#ChineseMessages}"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
chinesesimp.UninstallDataDialogTitle=卸载 WallHub
chinesesimp.UninstallDataHeading=是否同时删除本地数据？
chinesesimp.UninstallDataCheckbox=同时删除此 WallHub 根目录中的全部本地数据
chinesesimp.UninstallDataDetails=将删除此根目录中的所有文件，包括 Downloads、Steam 登录文件、SteamKit 运行缓存、logs 和设置文件。此操作无法撤销。
chinesesimp.UninstallDataLocation=将清理以下 WallHub 根目录：
chinesesimp.UninstallDataKeepHint=默认不勾选，卸载程序时将保留上述数据。
chinesesimp.UninstallDataContinue=继续卸载
english.UninstallDataDialogTitle=Uninstall WallHub
english.UninstallDataHeading=Delete local data as well?
english.UninstallDataCheckbox=Also delete all local data under this WallHub root
english.UninstallDataDetails=Deletes every file under this root, including Downloads, Steam sign-in files, SteamKit runtime caches, logs, and settings. This cannot be undone.
english.UninstallDataLocation=WallHub will clean data only under this root:
english.UninstallDataKeepHint=Leave this unchecked to keep the data when uninstalling the app.
english.UninstallDataContinue=Continue uninstall

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\WallHub"; Filename: "{app}\WallHub.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\WallHub"; Filename: "{app}\WallHub.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\WallHub.exe"; Description: "{cm:LaunchProgram,WallHub}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
var
  PurgeUserData: Boolean;

function HasUninstallParameter(const Value: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
  begin
    if CompareText(ParamStr(I), Value) = 0 then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

function IsUnsafePurgeRoot(const Path: String): Boolean;
begin
  Result := (Path = '') or
    (CompareText(AddBackslash(Path), AddBackslash(ExtractFileDrive(Path))) = 0);
end;

procedure PurgeInstallationRoot();
var
  AppRoot: String;
begin
  AppRoot := ExpandConstant('{app}');
  if IsUnsafePurgeRoot(AppRoot) then
  begin
    Log('Refusing to remove an unsafe WallHub installation root: ' + AppRoot);
    Exit;
  end;

  Log('Removing the complete WallHub installation root: ' + AppRoot);
  if not DelTree(AppRoot, True, True, True) then
    Log('Some files could not be removed from the WallHub installation root.');
end;

procedure ShowUninstallDataChoice();
var
  Form: TSetupForm;
  HeadingLabel, DetailLabel, LocationLabel, KeepLabel: TNewStaticText;
  DeleteDataCheckBox: TNewCheckBox;
  ContinueButton: TNewButton;
begin
  Form := CreateCustomForm(ScaleX(500), ScaleY(290), False, True);
  try
    Form.Caption := CustomMessage('UninstallDataDialogTitle');

    HeadingLabel := TNewStaticText.Create(Form);
    HeadingLabel.Parent := Form;
    HeadingLabel.Left := ScaleX(20);
    HeadingLabel.Top := ScaleY(18);
    HeadingLabel.Width := Form.ClientWidth - ScaleX(40);
    HeadingLabel.Height := ScaleY(24);
    HeadingLabel.AutoSize := False;
    HeadingLabel.Caption := CustomMessage('UninstallDataHeading');
    HeadingLabel.Font.Style := [fsBold];

    DeleteDataCheckBox := TNewCheckBox.Create(Form);
    DeleteDataCheckBox.Parent := Form;
    DeleteDataCheckBox.Left := ScaleX(20);
    DeleteDataCheckBox.Top := ScaleY(50);
    DeleteDataCheckBox.Width := Form.ClientWidth - ScaleX(40);
    DeleteDataCheckBox.Height := ScaleY(24);
    DeleteDataCheckBox.Caption := CustomMessage('UninstallDataCheckbox');
    DeleteDataCheckBox.Checked := False;

    DetailLabel := TNewStaticText.Create(Form);
    DetailLabel.Parent := Form;
    DetailLabel.Left := ScaleX(40);
    DetailLabel.Top := ScaleY(86);
    DetailLabel.Width := Form.ClientWidth - ScaleX(60);
    DetailLabel.Height := ScaleY(58);
    DetailLabel.AutoSize := False;
    DetailLabel.WordWrap := True;
    DetailLabel.Caption := CustomMessage('UninstallDataDetails');
    DetailLabel.Font.Color := clGray;

    LocationLabel := TNewStaticText.Create(Form);
    LocationLabel.Parent := Form;
    LocationLabel.Left := ScaleX(40);
    LocationLabel.Top := ScaleY(150);
    LocationLabel.Width := Form.ClientWidth - ScaleX(60);
    LocationLabel.Height := ScaleY(38);
    LocationLabel.AutoSize := False;
    LocationLabel.WordWrap := True;
    LocationLabel.Caption := CustomMessage('UninstallDataLocation') + #13#10 + ExpandConstant('{app}');

    KeepLabel := TNewStaticText.Create(Form);
    KeepLabel.Parent := Form;
    KeepLabel.Left := ScaleX(20);
    KeepLabel.Top := ScaleY(201);
    KeepLabel.Width := Form.ClientWidth - ScaleX(150);
    KeepLabel.Height := ScaleY(34);
    KeepLabel.AutoSize := False;
    KeepLabel.WordWrap := True;
    KeepLabel.Caption := CustomMessage('UninstallDataKeepHint');
    KeepLabel.Font.Color := clGray;

    ContinueButton := TNewButton.Create(Form);
    ContinueButton.Parent := Form;
    ContinueButton.Caption := CustomMessage('UninstallDataContinue');
    ContinueButton.Width := Form.CalculateButtonWidth([ContinueButton.Caption]);
    ContinueButton.Height := ScaleY(25);
    ContinueButton.Left := Form.ClientWidth - ContinueButton.Width - ScaleX(20);
    ContinueButton.Top := Form.ClientHeight - ContinueButton.Height - ScaleY(16);
    ContinueButton.ModalResult := mrOk;
    ContinueButton.Default := True;

    Form.ActiveControl := DeleteDataCheckBox;
    Form.ShowModal();
    PurgeUserData := DeleteDataCheckBox.Checked;
  finally
    Form.Free();
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    if UninstallSilent() then
      PurgeUserData := HasUninstallParameter('/PURGEDATA')
    else
      ShowUninstallDataChoice();
  end;

  if (CurUninstallStep = usPostUninstall) and PurgeUserData then
    PurgeInstallationRoot();
end;
