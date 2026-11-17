param([switch]$Install)
$ErrorActionPreference = 'Stop'
$projectDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectDirectory
function Test-TikDeskPackage([string]$Executable) {
    $started = Get-Date
    $process = Start-Process -FilePath $Executable -ArgumentList "--smoke-test --smoke-profile=package-$PID" -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(20000)) { $process.Kill(); throw 'Packaged application timeout' }
    if ($process.ExitCode -ne 0) { throw "Packaged application exited with $($process.ExitCode)" }
    $reportPath = Join-Path $projectDirectory 'artifacts/package-smoke.json'
    $report = Get-Item -LiteralPath $reportPath
    if ($report.LastWriteTime -lt $started.AddSeconds(-1)) { throw 'Packaged application did not write a fresh report' }
    if (-not (Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json).passed) { throw 'Packaged application verification failed' }
}
Test-TikDeskPackage (Join-Path $projectDirectory 'dist/win-unpacked/TikDesk.exe')
if ($Install) {
    if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) { throw 'Silent installation tests are restricted to the disposable GitHub runner' }
    $runnerDirectory = [System.IO.Path]::GetFullPath($env:RUNNER_TEMP)
    $destination = [System.IO.Path]::GetFullPath((Join-Path $runnerDirectory 'TikDesk-Install-QA'))
    if (-not $destination.StartsWith($runnerDirectory + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe installer test location' }
    $installer = Join-Path $projectDirectory ('dist/TikDesk-Setup-' + (Get-Content package.json -Raw | ConvertFrom-Json).version + '.exe')
    $setup = Start-Process -FilePath $installer -ArgumentList "/S /D=$destination" -PassThru -WindowStyle Hidden
    if (-not $setup.WaitForExit(120000)) { $setup.Kill(); throw 'Installer timeout' }
    if ($setup.ExitCode -ne 0) { throw 'Installer failed' }
    Test-TikDeskPackage (Join-Path $destination 'TikDesk.exe')
    $uninstallers = @(Get-ChildItem -LiteralPath $destination -Filter '*uninstall*.exe' -File)
    if ($uninstallers.Count -ne 1) { throw 'Cannot identify the installer uninstaller' }
    $uninstall = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList '/S' -PassThru -WindowStyle Hidden
    if (-not $uninstall.WaitForExit(60000)) { $uninstall.Kill(); throw 'Uninstaller timeout' }
    if ($uninstall.ExitCode -ne 0) { throw 'Uninstaller failed' }
    $deadline = (Get-Date).AddSeconds(30)
    while ((Test-Path -LiteralPath (Join-Path $destination 'TikDesk.exe')) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    if (Test-Path -LiteralPath (Join-Path $destination 'TikDesk.exe')) { throw 'Application remained after uninstalling' }
}
Write-Output 'Packaged application checks passed.'
