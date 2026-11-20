param([string]$RuntimePath = (Join-Path $PSScriptRoot "runtime.ps1"))

$ErrorActionPreference = "Stop"
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = Join-Path $PSHOME "powershell.exe"
$start.Arguments = '-NoProfile -NonInteractive -File "' + $RuntimePath + '" -Serve'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$child = [Diagnostics.Process]::Start($start)
$errors = $child.StandardError.ReadToEndAsync()

function Invoke-TestRequest($Request) {
    $child.StandardInput.WriteLine(($Request | ConvertTo-Json -Compress))
    $child.StandardInput.Flush()
    $read = $child.StandardOutput.ReadLineAsync()
    if (-not $read.Wait(30000)) { throw "Native provider did not answer the request." }
    $reply = $read.Result | ConvertFrom-Json
    if ($reply.requestId -ne $Request.requestId) { throw "Native provider returned a different request ID." }
    $reply
}

try {
    $ready = $child.StandardOutput.ReadLineAsync()
    if (-not $ready.Wait(30000) -or -not (($ready.Result | ConvertFrom-Json).ready)) { throw "Native provider did not announce readiness." }
    $handshake = Invoke-TestRequest @{ requestId = 1; tool = "handshake" }
    if (-not $handshake.ok -or $null -eq $handshake.capabilities) { throw "Native provider handshake failed." }
    $missing = Invoke-TestRequest @{ requestId = 2; tool = "launch_app"; app = "javis_nonexistent_native_launch_fixture_d3a843d" }
    if ($missing.ok -or $missing.error -notmatch "appNotFound|app not found") { throw "Native app launch did not report a missing app." }
    $child.StandardInput.Close()
    if (-not $child.WaitForExit(10000)) { throw "Native provider did not exit after stdin closed." }
    if ($child.ExitCode -ne 0) { throw "Native provider exited unsuccessfully." }
    Write-Output "Native Windows protocol checks passed."
} finally {
    if (-not $child.HasExited) { $child.Kill(); [void]$child.WaitForExit(10000) }
    $child.Dispose()
}
