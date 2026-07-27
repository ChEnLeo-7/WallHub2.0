using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace WallHub.Launcher;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        var layout = RuntimeLayout.FromExecutable();
        var port = ReadPort();
        using var mutex = new Mutex(true, "WallHub.Launcher", out var ownsMutex);

        if (!ownsMutex)
        {
            Browser.Open(port);
            return 0;
        }

        if (args.Any(arg => string.Equals(arg, "--smoke-test", StringComparison.OrdinalIgnoreCase)))
        {
            return RunSmokeTestAsync(layout, port).GetAwaiter().GetResult();
        }

        if (Environment.GetEnvironmentVariable("WALLHUB_UPDATE_RESTART") != "1" && HandOffInterruptedUpdate(layout)) return 0;

        using var context = new LauncherContext(layout, port);
        Application.Run(context);
        return context.ExitCode;
    }

    private static async Task<int> RunSmokeTestAsync(RuntimeLayout layout, int port)
    {
        await using var log = new LauncherLog(layout.LogFile);
        var settings = LauncherSettingsStore.Load(layout.LauncherSettingsFile, log);
        await using var host = new WallHubServerHost(layout, port, log);
        try
        {
            log.Write("launcher smoke test started");
            await PortableValidator.ValidateAsync(layout, log, CancellationToken.None);
            await host.StartAsync(CancellationToken.None, settings.ServerArguments);
            await host.StopAsync(CancellationToken.None);
            log.Write("launcher smoke test passed");
            return 0;
        }
        catch (Exception error)
        {
            log.Write($"launcher smoke test failed: {error}");
            try { await host.StopAsync(CancellationToken.None); } catch { }
            return 1;
        }
    }

    private static int ReadPort()
    {
        return int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var port) && port is > 0 and <= 65535
            ? port
            : 3090;
    }

    private static bool HandOffInterruptedUpdate(RuntimeLayout layout)
    {
        var transactionFile = Path.Combine(layout.RootDirectory, "updates", "update-transaction.json");
        if (!File.Exists(layout.UpdateRequestFile))
        {
            if (File.Exists(transactionFile))
            {
                MessageBox.Show(
                    "WallHub found a pending update transaction but updates\\update-request.json is missing. Normal startup is disabled; restore the request file or reinstall WallHub.",
                    "WallHub",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return true;
            }
            return false;
        }
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(layout.UpdateRequestFile));
            var root = document.RootElement;
            if (root.TryGetProperty("helperPid", out var helperPidValue) && helperPidValue.TryGetInt32(out var helperPid) && helperPid > 1)
            {
                try
                {
                    using var helper = Process.GetProcessById(helperPid);
                    var expectedExecutable = root.GetProperty("helperExecutable").GetString();
                    var actualExecutable = helper.MainModule?.FileName;
                    var expectedStartToken = root.TryGetProperty("helperIdentity", out var identity) && identity.TryGetProperty("startToken", out var token)
                        ? token.GetString()
                        : null;
                    var actualStartToken = helper.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture);
                    if (!helper.HasExited && !string.IsNullOrWhiteSpace(expectedExecutable) && !string.IsNullOrWhiteSpace(actualExecutable) &&
                        !string.IsNullOrWhiteSpace(expectedStartToken) &&
                        string.Equals(Path.GetFullPath(expectedExecutable), Path.GetFullPath(actualExecutable), StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(expectedStartToken, actualStartToken, StringComparison.Ordinal)) return true;
                }
                catch { }
            }

            if (!File.Exists(transactionFile))
            {
                File.Delete(layout.UpdateRequestFile);
                return false;
            }

            var helperExecutable = root.GetProperty("helperExecutable").GetString();
            var helperScript = root.GetProperty("helperScript").GetString();
            var requestPath = layout.UpdateRequestFile;
            if (string.IsNullOrWhiteSpace(helperExecutable) || string.IsNullOrWhiteSpace(helperScript) || string.IsNullOrWhiteSpace(requestPath) ||
                !File.Exists(helperExecutable) || !File.Exists(helperScript) || !File.Exists(requestPath))
            {
                throw new InvalidDataException("interrupted update helper files are unavailable");
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = helperExecutable,
                WorkingDirectory = Path.GetDirectoryName(helperScript) ?? layout.RootDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            startInfo.ArgumentList.Add(helperScript);
            startInfo.ArgumentList.Add(requestPath);
            startInfo.ArgumentList.Add("--recover");
            startInfo.ArgumentList.Add(Environment.ProcessId.ToString(CultureInfo.InvariantCulture));
            var recovery = Process.Start(startInfo);
            if (recovery is null) throw new InvalidOperationException("could not start interrupted update recovery");
            return true;
        }
        catch (Exception error)
        {
            MessageBox.Show(
                $"WallHub could not recover an interrupted update.\n\n{error.Message}\n\nKeep the updates\\backup-previous directory and reinstall WallHub before removing it.",
                "WallHub",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return true;
        }
    }

}

internal sealed class LauncherContext : ApplicationContext
{
    private readonly RuntimeLayout _layout;
    private readonly int _port;
    private readonly LauncherLog _log;
    private readonly WallHubServerHost _host;
    private readonly NotifyIcon _trayIcon;
    private readonly ToolStripMenuItem _openItem;
    private readonly ToolStripMenuItem _startupOptionsItem;
    private readonly ToolStripMenuItem _restartItem;
    private readonly ToolStripMenuItem _exitItem;
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private readonly SynchronizationContext _uiContext;
    private LauncherSettings _settings;
    private bool _exiting;
    private bool _startupScheduled;

    public int ExitCode { get; private set; }

    public LauncherContext(RuntimeLayout layout, int port)
    {
        _layout = layout;
        _port = port;
        _uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        _log = new LauncherLog(layout.LogFile);
        _settings = LauncherSettingsStore.Load(layout.LauncherSettingsFile, _log);
        _host = new WallHubServerHost(layout, port, _log);
        _host.ExitedUnexpectedly += OnServerExitedUnexpectedly;

        var icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? string.Empty) ?? SystemIcons.Application;
        var menu = new ContextMenuStrip();
        _openItem = new ToolStripMenuItem(Texts.OpenWallHub, null, (_, _) => Browser.Open(_port))
        {
            Font = new Font(SystemFonts.MenuFont!, FontStyle.Bold)
        };
        var rootItem = new ToolStripMenuItem(Texts.OpenRoot, null, (_, _) => Shell.Open(_layout.RootDirectory));
        var logItem = new ToolStripMenuItem(Texts.OpenLog, null, (_, _) => Shell.Open(_layout.LogFile));
        _startupOptionsItem = new ToolStripMenuItem(
            Texts.StartupArguments,
            null,
            async (_, _) => await EditStartupArgumentsAsync());
        _restartItem = new ToolStripMenuItem(Texts.Restart, null, async (_, _) => { await RestartAsync(); });
        _exitItem = new ToolStripMenuItem(Texts.Exit, null, async (_, _) => await ExitAsync());

        menu.Items.AddRange([
            _openItem,
            rootItem,
            logItem,
            new ToolStripSeparator(),
            _startupOptionsItem,
            _restartItem,
            _exitItem
        ]);

        _trayIcon = new NotifyIcon
        {
            ContextMenuStrip = menu,
            Icon = icon,
            Text = Texts.Starting,
            Visible = true
        };
        _trayIcon.DoubleClick += (_, _) => Browser.Open(_port);

        Application.Idle += StartOnFirstIdle;
    }

    private async void StartOnFirstIdle(object? sender, EventArgs eventArgs)
    {
        if (_startupScheduled) return;
        _startupScheduled = true;
        Application.Idle -= StartOnFirstIdle;
        await StartAsync(openBrowser: true);
    }

    private async Task StartAsync(bool openBrowser)
    {
        await _lifecycleGate.WaitAsync();
        try
        {
            SetBusy(true);
            SetStatus(Texts.Starting);
            await PortableValidator.ValidateAsync(_layout, _log, CancellationToken.None);
            await _host.StartAsync(CancellationToken.None, _settings.ServerArguments);
            SetStatus(Texts.Running);
            if (openBrowser) Browser.Open(_port);
        }
        catch (Exception error)
        {
            ExitCode = 1;
            _log.Write($"startup failed: {error}");
            try { await _host.StopAsync(CancellationToken.None); } catch { }
            SetStatus(Texts.Failed);
            _trayIcon.ShowBalloonTip(8000, "WallHub", Texts.StartFailed, ToolTipIcon.Error);
            MessageBox.Show(
                $"{Texts.StartFailed}\n\n{error.Message}\n\n{Texts.LogLocation}:\n{_layout.LogFile}",
                "WallHub",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            SetBusy(false);
            _lifecycleGate.Release();
        }
    }

    private async Task EditStartupArgumentsAsync()
    {
        if (_exiting) return;

        using var dialog = new StartupArgumentsDialog(_settings.ServerArguments);
        if (dialog.ShowDialog() != DialogResult.OK) return;

        var arguments = dialog.Arguments;
        IReadOnlyList<string> parsedArguments;
        try
        {
            parsedArguments = WindowsCommandLine.Parse(arguments);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                $"{Texts.InvalidStartupArguments}\n\n{error.Message}",
                "WallHub",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        if (string.Equals(arguments, _settings.ServerArguments, StringComparison.Ordinal)) return;

        var updated = new LauncherSettings { ServerArguments = arguments };
        try
        {
            LauncherSettingsStore.Save(_layout.LauncherSettingsFile, updated);
            _settings = updated;
            _log.Write($"startup arguments changed: count={parsedArguments.Count}");
        }
        catch (Exception error)
        {
            _log.Write($"could not save launcher settings: {error}");
            _trayIcon.ShowBalloonTip(8000, "WallHub", Texts.SettingsSaveFailed, ToolTipIcon.Error);
            return;
        }

        if (await RestartAsync()) Browser.Open(_port);
    }

    private async Task<bool> RestartAsync()
    {
        if (_exiting) return false;
        await _lifecycleGate.WaitAsync();
        try
        {
            SetBusy(true);
            SetStatus(Texts.Restarting);
            await _host.StopAsync(CancellationToken.None);
            await PortableValidator.ValidateAsync(_layout, _log, CancellationToken.None);
            await _host.StartAsync(CancellationToken.None, _settings.ServerArguments);
            SetStatus(Texts.Running);
            return true;
        }
        catch (Exception error)
        {
            ExitCode = 1;
            _log.Write($"restart failed: {error}");
            try { await _host.StopAsync(CancellationToken.None); } catch { }
            SetStatus(Texts.Failed);
            _trayIcon.ShowBalloonTip(8000, "WallHub", Texts.RestartFailed, ToolTipIcon.Error);
            return false;
        }
        finally
        {
            SetBusy(false);
            _lifecycleGate.Release();
        }
    }

    private async Task ExitAsync()
    {
        if (_exiting) return;
        _exiting = true;
        await _lifecycleGate.WaitAsync();
        try
        {
            SetBusy(true);
            SetStatus(Texts.Stopping);
            await _host.StopAsync(CancellationToken.None);
        }
        catch (Exception error)
        {
            _log.Write($"shutdown failed: {error}");
        }
        finally
        {
            _trayIcon.Visible = false;
            _lifecycleGate.Release();
            ExitThread();
        }
    }

    private void OnServerExitedUnexpectedly(int exitCode)
    {
        _uiContext.Post(_ =>
        {
            if (_exiting) return;
            try
            {
                if (HasActiveUpdateRequest())
                {
                    _exiting = true;
                    _log.Write("server exited for a prepared update; closing launcher");
                    SetStatus(Texts.Updating);
                    _trayIcon.ShowBalloonTip(5000, "WallHub", Texts.Updating, ToolTipIcon.Info);
                    _trayIcon.Visible = false;
                    ExitThread();
                    return;
                }
                SetStatus(Texts.Failed);
                _trayIcon.ShowBalloonTip(8000, "WallHub", Texts.ServerExited, ToolTipIcon.Error);
            }
            catch
            {
                // The UI may already be shutting down.
            }
        }, null);
    }

    private bool HasActiveUpdateRequest()
    {
        if (!File.Exists(_layout.UpdateRequestFile)) return false;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(_layout.UpdateRequestFile));
            var root = document.RootElement;
            if (!root.TryGetProperty("helperPid", out var helperPidValue) || !helperPidValue.TryGetInt32(out var helperPid) || helperPid <= 1)
            {
                throw new InvalidDataException("update marker does not contain a valid helper PID");
            }
            if (!root.TryGetProperty("requestedAt", out var requestedAtValue) || !requestedAtValue.TryGetInt64(out var requestedAt))
            {
                throw new InvalidDataException("update marker does not contain a request time");
            }
            var ageMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - requestedAt;
            if (ageMs < 0 || ageMs > TimeSpan.FromMinutes(15).TotalMilliseconds)
            {
                throw new InvalidDataException("update marker is stale");
            }
            using var helper = Process.GetProcessById(helperPid);
            if (helper.HasExited) throw new InvalidDataException("update helper has already exited");
            return true;
        }
        catch (Exception error)
        {
            _log.Write($"ignoring invalid update marker: {error.Message}");
            try { File.Delete(_layout.UpdateRequestFile); } catch { }
            return false;
        }
    }

    private void SetBusy(bool busy)
    {
        _startupOptionsItem.Enabled = !busy;
        _restartItem.Enabled = !busy;
        _exitItem.Enabled = !busy || _exiting;
        _openItem.Enabled = !busy && _host.IsRunning;
    }

    private void SetStatus(string value)
    {
        _trayIcon.Text = value.Length > 63 ? value[..63] : value;
    }

    protected override void ExitThreadCore()
    {
        _host.ExitedUnexpectedly -= OnServerExitedUnexpectedly;
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        Task.Run(async () => await _host.DisposeAsync()).GetAwaiter().GetResult();
        _log.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _lifecycleGate.Dispose();
        base.ExitThreadCore();
    }
}

internal sealed class StartupArgumentsDialog : Form
{
    private readonly TextBox _argumentsBox;

    public string Arguments => _argumentsBox.Text.Trim();

    public StartupArgumentsDialog(string currentArguments)
    {
        Text = Texts.StartupArgumentsTitle;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(560, 142);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowIcon = false;
        ShowInTaskbar = false;

        var label = new Label
        {
            AutoSize = true,
            Left = 16,
            Top = 18,
            Text = Texts.StartupArgumentsLabel
        };

        _argumentsBox = new TextBox
        {
            Left = 16,
            Top = 43,
            Width = 528,
            MaxLength = 4096,
            Text = currentArguments,
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };

        var saveButton = new Button
        {
            Text = Texts.Save,
            DialogResult = DialogResult.OK,
            Left = 354,
            Top = 96,
            Width = 90,
            Height = 28
        };
        var cancelButton = new Button
        {
            Text = Texts.Cancel,
            DialogResult = DialogResult.Cancel,
            Left = 454,
            Top = 96,
            Width = 90,
            Height = 28
        };

        AcceptButton = saveButton;
        CancelButton = cancelButton;
        Controls.AddRange([label, _argumentsBox, saveButton, cancelButton]);
        Shown += (_, _) =>
        {
            _argumentsBox.Focus();
            _argumentsBox.SelectionStart = _argumentsBox.TextLength;
        };
    }
}

internal sealed class WallHubServerHost : IAsyncDisposable
{
    private readonly RuntimeLayout _layout;
    private readonly int _port;
    private readonly LauncherLog _log;
    private readonly HttpClient _http;
    private Process? _process;
    private bool _intentionalStop;

    public event Action<int>? ExitedUnexpectedly;

    public bool IsRunning => _process is { HasExited: false };

    public WallHubServerHost(RuntimeLayout layout, int port, LauncherLog log)
    {
        _layout = layout;
        _port = port;
        _log = log;
        _http = new HttpClient(new HttpClientHandler { UseProxy = false })
        {
            Timeout = TimeSpan.FromSeconds(2)
        };
    }

    public async Task StartAsync(CancellationToken cancellationToken, string serverArguments = "")
    {
        if (IsRunning) return;
        if (await IsHealthyAsync(cancellationToken))
        {
            throw new InvalidOperationException(Texts.PortInUse(_port));
        }

        _intentionalStop = false;
        var startInfo = new ProcessStartInfo
        {
            FileName = _layout.NodeExecutable,
            WorkingDirectory = _layout.RootDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        startInfo.ArgumentList.Add(_layout.ServerScript);
        var parsedArguments = WindowsCommandLine.Parse(serverArguments);
        foreach (var argument in parsedArguments) startInfo.ArgumentList.Add(argument);
        ApplyRuntimeEnvironment(startInfo);

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, args) => { if (args.Data is not null) _log.Write($"server: {args.Data}"); };
        process.ErrorDataReceived += (_, args) => { if (args.Data is not null) _log.Write($"server-error: {args.Data}"); };
        process.Exited += (_, _) =>
        {
            var code = SafeExitCode(process);
            _log.Write($"server process exited with code {code}");
            if (!_intentionalStop) ExitedUnexpectedly?.Invoke(code);
        };

        if (!process.Start()) throw new InvalidOperationException(Texts.CannotStartNode);
        _process = process;
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        _log.Write($"server process started, pid={process.Id}, port={_port}, customArgCount={parsedArguments.Count}");

        await WaitUntilReadyAsync(process, TimeSpan.FromSeconds(60), cancellationToken);
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        var process = _process;
        if (process is null || process.HasExited)
        {
            _process = null;
            return;
        }

        _intentionalStop = true;
        try
        {
            using var response = await _http.PostAsync(
                $"http://127.0.0.1:{_port}/api/server/shutdown",
                new ByteArrayContent([]),
                cancellationToken);
            _log.Write($"shutdown request returned HTTP {(int)response.StatusCode}");
        }
        catch (Exception error)
        {
            _log.Write($"graceful shutdown request failed: {error.Message}");
        }

        if (!await WaitForExitAsync(process, TimeSpan.FromSeconds(12), cancellationToken))
        {
            _log.Write("server did not exit after graceful shutdown; terminating process tree");
            try { process.Kill(entireProcessTree: true); } catch { }
            await WaitForExitAsync(process, TimeSpan.FromSeconds(3), CancellationToken.None);
        }

        process.Dispose();
        _process = null;
    }

    private void ApplyRuntimeEnvironment(ProcessStartInfo startInfo)
    {
        var oldPath = startInfo.Environment.TryGetValue("PATH", out var path) ? path : string.Empty;
        var runtimePath = string.Join(Path.PathSeparator, [
            _layout.NodeDirectory,
            _layout.PythonDirectory,
            _layout.DotnetDirectory,
            oldPath ?? string.Empty
        ]);

        startInfo.Environment["PATH"] = runtimePath;
        startInfo.Environment["PYTHON"] = _layout.PythonExecutable;
        startInfo.Environment["PYTHON3"] = _layout.PythonExecutable;
        startInfo.Environment["PYTHONUTF8"] = "1";
        startInfo.Environment["PYTHONDONTWRITEBYTECODE"] = "1";
        startInfo.Environment["DOTNET_ROOT"] = _layout.DotnetDirectory;
        startInfo.Environment["DOTNET_ROOT_X64"] = _layout.DotnetDirectory;
        startInfo.Environment["DOTNET_MULTILEVEL_LOOKUP"] = "0";
        startInfo.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1";
        startInfo.Environment["DOTNET_SKIP_FIRST_TIME_EXPERIENCE"] = "1";
        startInfo.Environment["DOTNET_NOLOGO"] = "1";
        startInfo.Environment["NODE_ENV"] = "production";
        startInfo.Environment["WALLHUB_LAUNCHER"] = "1";
        startInfo.Environment["WALLHUB_LAUNCHER_PID"] = Environment.ProcessId.ToString(CultureInfo.InvariantCulture);
        startInfo.Environment["WALLHUB_PACKAGE_MODE"] = File.Exists(Path.Combine(_layout.RootDirectory, "unins000.exe")) ? "installer" : "portable";
        startInfo.Environment["WALLHUB_LAUNCHER_PATH"] = Environment.ProcessPath ?? Path.Combine(_layout.RootDirectory, "WallHub.exe");
        startInfo.Environment["PORT"] = _port.ToString(CultureInfo.InvariantCulture);
        foreach (var key in new[] { "WALLHUB_UPDATE_RESTART", "WALLHUB_UPDATE_HEALTH_TOKEN" })
        {
            var value = Environment.GetEnvironmentVariable(key);
            if (value is not null) startInfo.Environment[key] = value;
        }
    }

    private async Task WaitUntilReadyAsync(Process process, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (process.HasExited)
            {
                throw new InvalidOperationException(Texts.ServerExitedWithCode(SafeExitCode(process)));
            }
            if (await IsHealthyAsync(cancellationToken))
            {
                _log.Write("server health check passed");
                return;
            }
            await Task.Delay(250, cancellationToken);
        }
        throw new TimeoutException(Texts.HealthTimeout);
    }

    private async Task<bool> IsHealthyAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _http.GetAsync($"http://127.0.0.1:{_port}/health", cancellationToken);
            if (response.StatusCode != HttpStatusCode.OK) return false;
            var expectedToken = Environment.GetEnvironmentVariable("WALLHUB_UPDATE_HEALTH_TOKEN");
            return string.IsNullOrEmpty(expectedToken) ||
                response.Headers.TryGetValues("X-WallHub-Health-Token", out var values) && values.Contains(expectedToken, StringComparer.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    private static async Task<bool> WaitForExitAsync(Process process, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (process.HasExited) return true;
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        try
        {
            await process.WaitForExitAsync(timeoutSource.Token);
            return true;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return process.HasExited;
        }
    }

    private static int SafeExitCode(Process process)
    {
        try { return process.HasExited ? process.ExitCode : -1; }
        catch { return -1; }
    }

    public async ValueTask DisposeAsync()
    {
        try { await StopAsync(CancellationToken.None); } catch { }
        _http.Dispose();
    }
}

internal static class PortableValidator
{
    public static async Task ValidateAsync(RuntimeLayout layout, LauncherLog log, CancellationToken cancellationToken)
    {
        RequireFile(layout.ServerScript, "server.js");
        RequireFile(layout.PublicIndex, "public/index.html");
        RequireFile(layout.NodeExecutable, "runtime/node/node.exe");
        RequireFile(layout.PythonExecutable, "runtime/python/python.exe");
        RequireFile(layout.DotnetExecutable, "runtime/dotnet/dotnet.exe");
        RequireFile(layout.DepotDownloaderExecutable, "SteamKit/DepotDownloader/DepotDownloader.exe");
        RequireFile(layout.DepotStreamExecutable, "SteamKit/DepotDownloaderStream/DepotDownloader.exe");

        var node = await ProcessProbe.RunAsync(layout.NodeExecutable, ["--version"], layout.RootDirectory, cancellationToken);
        if (node.ExitCode != 0 || !TryReadNodeMajor(node.Output, out var nodeMajor) || nodeMajor < 16)
        {
            throw new InvalidOperationException($"{Texts.InvalidNode}: {node.Output}");
        }

        const string pythonProbe = "from PIL import Image; import lz4.block, etcpak, texture2ddecoder; assert callable(getattr(etcpak, 'compress_etc2_rgba', None)); assert callable(getattr(texture2ddecoder, 'decode_bc3', None)); print('ok')";
        var python = await ProcessProbe.RunAsync(layout.PythonExecutable, ["-c", pythonProbe], layout.RootDirectory, cancellationToken);
        if (python.ExitCode != 0 || !python.Output.Contains("ok", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"{Texts.InvalidPython}: {python.Output}");
        }

        var dotnet = await ProcessProbe.RunAsync(layout.DotnetExecutable, ["--list-runtimes"], layout.RootDirectory, cancellationToken);
        if (dotnet.ExitCode != 0 || !dotnet.Output.Contains("Microsoft.NETCore.App 9.", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"{Texts.InvalidDotnet}: {dotnet.Output}");
        }

        log.Write($"portable runtime validation passed: node={node.Output.Trim()}, python=ok, dotnet=9.x");
    }

    private static void RequireFile(string path, string displayName)
    {
        if (!File.Exists(path)) throw new FileNotFoundException($"{Texts.MissingFile}: {displayName}", path);
    }

    private static bool TryReadNodeMajor(string value, out int major)
    {
        var normalized = value.Trim().TrimStart('v');
        return int.TryParse(normalized.Split('.', 2)[0], NumberStyles.None, CultureInfo.InvariantCulture, out major);
    }
}

internal static class ProcessProbe
{
    public static async Task<ProbeResult> RunAsync(
        string executable,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        CancellationToken cancellationToken)
    {
        var info = new ProcessStartInfo
        {
            FileName = executable,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        foreach (var argument in arguments) info.ArgumentList.Add(argument);

        using var process = new Process { StartInfo = info };
        if (!process.Start()) return new ProbeResult(-1, Texts.ProcessStartFailed(executable));
        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw;
        }
        var output = (await outputTask + Environment.NewLine + await errorTask).Trim();
        return new ProbeResult(process.ExitCode, output);
    }
}

internal readonly record struct ProbeResult(int ExitCode, string Output);

internal sealed class LauncherLog : IAsyncDisposable
{
    private readonly object _gate = new();
    private readonly StreamWriter _writer;

    public LauncherLog(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        Rotate(path);
        _writer = new StreamWriter(new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false))
        {
            AutoFlush = true
        };
        Write("launcher initialized");
    }

    public void Write(string message)
    {
        lock (_gate)
        {
            _writer.WriteLine($"[{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz}] {message}");
        }
    }

    private static void Rotate(string path)
    {
        try
        {
            var file = new FileInfo(path);
            if (!file.Exists || file.Length <= 10 * 1024 * 1024) return;
            var previous = Path.Combine(file.DirectoryName!, $"{Path.GetFileNameWithoutExtension(path)}.previous{file.Extension}");
            if (File.Exists(previous)) File.Delete(previous);
            File.Move(path, previous);
        }
        catch
        {
            // Logging should not block startup when an old log is locked.
        }
    }

    public ValueTask DisposeAsync()
    {
        lock (_gate) _writer.Dispose();
        return ValueTask.CompletedTask;
    }
}

internal sealed record RuntimeLayout(
    string RootDirectory,
    string ServerScript,
    string PublicIndex,
    string NodeDirectory,
    string NodeExecutable,
    string PythonDirectory,
    string PythonExecutable,
    string DotnetDirectory,
    string DotnetExecutable,
    string DepotDownloaderExecutable,
    string DepotStreamExecutable,
    string LogFile,
    string LauncherSettingsFile,
    string UpdateRequestFile)
{
    public static RuntimeLayout FromExecutable()
    {
        var root = Path.GetFullPath(AppContext.BaseDirectory);
        var nodeDirectory = Path.Combine(root, "runtime", "node");
        var pythonDirectory = Path.Combine(root, "runtime", "python");
        var dotnetDirectory = Path.Combine(root, "runtime", "dotnet");
        return new RuntimeLayout(
            root,
            Path.Combine(root, "server.js"),
            Path.Combine(root, "public", "index.html"),
            nodeDirectory,
            Path.Combine(nodeDirectory, "node.exe"),
            pythonDirectory,
            Path.Combine(pythonDirectory, "python.exe"),
            dotnetDirectory,
            Path.Combine(dotnetDirectory, "dotnet.exe"),
            Path.Combine(root, "SteamKit", "DepotDownloader", "DepotDownloader.exe"),
            Path.Combine(root, "SteamKit", "DepotDownloaderStream", "DepotDownloader.exe"),
            Path.Combine(root, "logs", "WallHub.log"),
            Path.Combine(root, "launcher-settings.json"),
            Path.Combine(root, "updates", "update-request.json"));
    }
}

internal sealed class LauncherSettings
{
    public string ServerArguments { get; init; } = string.Empty;
}

internal static class LauncherSettingsStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public static LauncherSettings Load(string path, LauncherLog log)
    {
        if (!File.Exists(path)) return new LauncherSettings();
        try
        {
            var stored = JsonSerializer.Deserialize<StoredLauncherSettings>(File.ReadAllText(path), SerializerOptions);
            if (stored is null) return new LauncherSettings();
            if (stored.ServerArguments is not null)
            {
                return new LauncherSettings { ServerArguments = stored.ServerArguments.Trim() };
            }
            if (stored.NsfwEnabled == true)
            {
                log.Write("migrating legacy NSFW launcher option to custom startup arguments");
                return new LauncherSettings { ServerArguments = "--NSFW" };
            }
            return new LauncherSettings();
        }
        catch (Exception error)
        {
            log.Write($"launcher settings are invalid; using safe defaults: {error.Message}");
            return new LauncherSettings();
        }
    }

    public static void Save(string path, LauncherSettings settings)
    {
        var temporaryPath = path + ".tmp";
        try
        {
            var json = JsonSerializer.Serialize(settings, SerializerOptions);
            File.WriteAllText(temporaryPath, json + Environment.NewLine, new UTF8Encoding(false));
            File.Move(temporaryPath, path, true);
        }
        finally
        {
            try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); } catch { }
        }
    }

    private sealed class StoredLauncherSettings
    {
        public string? ServerArguments { get; init; }
        public bool? NsfwEnabled { get; init; }
    }
}

internal static class WindowsCommandLine
{
    public static IReadOnlyList<string> Parse(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return Array.Empty<string>();

        var argv = CommandLineToArgvW("wallhub.exe " + value, out var argumentCount);
        if (argv == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var arguments = new List<string>(Math.Max(0, argumentCount - 1));
            for (var index = 1; index < argumentCount; index++)
            {
                var argumentPointer = Marshal.ReadIntPtr(argv, index * IntPtr.Size);
                arguments.Add(Marshal.PtrToStringUni(argumentPointer) ?? string.Empty);
            }
            return arguments;
        }
        finally
        {
            LocalFree(argv);
        }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW(string commandLine, out int argumentCount);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
}

internal static class Browser
{
    public static void Open(int port)
    {
        Shell.Open($"http://localhost:{port}");
    }
}

internal static class Shell
{
    public static void Open(string target)
    {
        try
        {
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch
        {
            // A missing shell association should not terminate the launcher.
        }
    }
}

internal static class Texts
{
    private static readonly bool Chinese = CultureInfo.CurrentUICulture.Name.StartsWith("zh", StringComparison.OrdinalIgnoreCase);

    public static string OpenWallHub => Chinese ? "打开 WallHub" : "Open WallHub";
    public static string OpenRoot => Chinese ? "打开项目根目录" : "Open root directory";
    public static string OpenLog => Chinese ? "查看运行日志" : "Open log";
    public static string StartupArguments => Chinese ? "启动参数..." : "Startup arguments...";
    public static string StartupArgumentsTitle => Chinese ? "WallHub 启动参数" : "WallHub startup arguments";
    public static string StartupArgumentsLabel => Chinese ? "传递给 server.js 的启动参数" : "Arguments passed to server.js";
    public static string Save => Chinese ? "保存" : "Save";
    public static string Cancel => Chinese ? "取消" : "Cancel";
    public static string Restart => Chinese ? "重新启动" : "Restart";
    public static string Exit => Chinese ? "退出" : "Exit";
    public static string Starting => Chinese ? "WallHub 正在启动" : "WallHub is starting";
    public static string Running => Chinese ? "WallHub 正在运行" : "WallHub is running";
    public static string Restarting => Chinese ? "WallHub 正在重新启动" : "WallHub is restarting";
    public static string Updating => Chinese ? "WallHub 正在安装更新" : "WallHub is installing an update";
    public static string Stopping => Chinese ? "WallHub 正在退出" : "WallHub is stopping";
    public static string Failed => Chinese ? "WallHub 启动失败" : "WallHub failed";
    public static string StartFailed => Chinese ? "WallHub 无法启动，请查看日志。" : "WallHub could not start. Check the log.";
    public static string RestartFailed => Chinese ? "WallHub 重新启动失败，请查看日志。" : "WallHub could not restart. Check the log.";
    public static string SettingsSaveFailed => Chinese ? "无法保存启动参数，请查看日志。" : "Could not save startup options. Check the log.";
    public static string InvalidStartupArguments => Chinese ? "启动参数无效。" : "The startup arguments are invalid.";
    public static string ServerExited => Chinese ? "WallHub 服务异常退出，请查看日志。" : "The WallHub server exited unexpectedly. Check the log.";
    public static string LogLocation => Chinese ? "日志位置" : "Log location";
    public static string CannotStartNode => Chinese ? "无法启动内置 Node 运行时。" : "The bundled Node runtime could not start.";
    public static string HealthTimeout => Chinese ? "WallHub 服务启动超时，请查看日志。" : "WallHub timed out while starting. Check the log.";
    public static string InvalidNode => Chinese ? "内置 Node 运行时验证失败" : "Bundled Node validation failed";
    public static string InvalidPython => Chinese ? "内置 Python/MPKG 模块验证失败" : "Bundled Python/MPKG validation failed";
    public static string InvalidDotnet => Chinese ? "内置 .NET 9 Runtime 验证失败" : "Bundled .NET 9 Runtime validation failed";
    public static string MissingFile => Chinese ? "Portable 文件不完整" : "The portable package is incomplete";
    public static string ProcessStartFailed(string executable) => Chinese ? $"无法启动 {executable}" : $"Could not start {executable}";
    public static string PortInUse(int port) => Chinese ? $"端口 {port} 已被其他程序占用。" : $"Port {port} is already in use.";
    public static string ServerExitedWithCode(int code) => Chinese ? $"WallHub 服务已退出，代码 {code}。" : $"The WallHub server exited with code {code}.";
}
