'use strict';

const { execFileSync } = require('child_process');

function processControlScript(pid, action) {
  const operation = action === 'suspend' ? 'Suspend' : 'Resume';
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WallHubProcessControl {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);
}
'@

function Invoke-ProcessControl([int]$ProcessId, [string]$Operation) {
  $handle = [WallHubProcessControl]::OpenProcess(0x0800, $false, $ProcessId)
  if ($handle -eq [IntPtr]::Zero) { throw "OpenProcess failed for PID $ProcessId" }
  try {
    $status = if ($Operation -eq 'Suspend') {
      [WallHubProcessControl]::NtSuspendProcess($handle)
    } else {
      [WallHubProcessControl]::NtResumeProcess($handle)
    }
    if ($status -ne 0) { throw "$Operation failed for PID $ProcessId with NTSTATUS $status" }
  } finally {
    [void][WallHubProcessControl]::CloseHandle($handle)
  }
}

$rootPid = ${Math.floor(Number(pid))}
$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
$descendants = New-Object System.Collections.Generic.List[int]
$parents = @($rootPid)
while ($parents.Count -gt 0) {
  $children = @($processes | Where-Object { $parents -contains [int]$_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId })
  if ($children.Count -eq 0) { break }
  foreach ($child in $children) { if (-not $descendants.Contains($child)) { $descendants.Add($child) } }
  $parents = $children
}

$handled = New-Object System.Collections.Generic.List[int]
try {
  if ('${operation}' -eq 'Suspend') {
    [void][System.Diagnostics.Process]::GetProcessById($rootPid)
    Invoke-ProcessControl $rootPid 'Suspend'
    $handled.Add($rootPid)
  }

  $targets = if ('${operation}' -eq 'Suspend') {
    @($descendants.ToArray())
  } else {
    @($descendants.ToArray() | Sort-Object -Descending) + @($rootPid)
  }
  foreach ($target in $targets) {
    try { [void][System.Diagnostics.Process]::GetProcessById($target) } catch { continue }
    Invoke-ProcessControl $target '${operation}'
    $handled.Add($target)
  }
  if (-not $handled.Contains($rootPid)) { throw "Target process $rootPid is no longer running" }
} catch {
  if ('${operation}' -eq 'Suspend') {
    foreach ($target in @($handled.ToArray() | Sort-Object -Descending)) {
      try { Invoke-ProcessControl $target 'Resume' } catch {}
    }
  }
  throw
}
`;
}

function controlWindowsProcessTree(pid, action, options = {}) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  if (action !== 'suspend' && action !== 'resume') return false;
  const run = options.execFileSync || execFileSync;
  const encoded = Buffer.from(processControlScript(pid, action), 'utf16le').toString('base64');
  try {
    run('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encoded,
    ], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  controlWindowsProcessTree,
  processControlScript,
};
