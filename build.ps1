$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== SceneOCR Docker build ===" -ForegroundColor Cyan
Write-Host "First run takes 10-20 min (downloads Python, FFmpeg, npm packages)."
Write-Host ""

if (Test-Path dist-electron) {
    try {
        Remove-Item -Recurse -Force dist-electron -ErrorAction Stop
    } catch {
        Write-Host "Cannot delete dist-electron -- SceneOCR.exe is still running. Close the app first." -ForegroundColor Red
        exit 1
    }
}

docker build -f Dockerfile.build -o dist-electron .

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
$zip = Get-ChildItem dist-electron\*.zip | Select-Object -First 1
if ($zip) {
    Write-Host "Release: $($zip.FullName)"
}
Write-Host ""
