# Run once as Administrator to allow the fingerprint scanner service without elevation.
# Right-click PowerShell -> Run as administrator, then:
#   cd path\to\SmartPOS\fingerprintScanner
#   .\register-url.ps1

$port = if ($env:FINGERPRINT_PORT) { $env:FINGERPRINT_PORT } else { "17890" }
$url = "http://+:$port/"
$user = $env:USERNAME

Write-Host "Registering URL ACL: $url for user $user"
netsh http delete urlacl url=$url 2>$null | Out-Null
netsh http add urlacl url=$url user=$user
if ($LASTEXITCODE -ne 0) {
    Write-Host "Wildcard registration failed, trying 127.0.0.1..."
    $url = "http://127.0.0.1:$port/"
    netsh http delete urlacl url=$url 2>$null | Out-Null
    netsh http add urlacl url=$url user=$user
}
if ($LASTEXITCODE -eq 0) {
    Write-Host "Done. You can now run: dotnet run"
} else {
    Write-Host "Failed. Make sure this PowerShell window is running as Administrator."
    exit 1
}
