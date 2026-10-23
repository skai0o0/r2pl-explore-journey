$ErrorActionPreference = 'Stop'
$adminStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
$adminStartInfo.FileName = 'ssh'
$adminStartInfo.Arguments = 'root@vietrp-server "cd /opt/r2pl-admin-20261019-k6gt99n4/release && node --env-file=/opt/r2pl-game/.env.portal --experimental-strip-types scripts/bootstrap-root-admin.ts"'
$adminStartInfo.UseShellExecute = $false
$adminStartInfo.CreateNoWindow = $true
$adminStartInfo.RedirectStandardInput = $true
$adminStartInfo.RedirectStandardOutput = $true
$adminStartInfo.RedirectStandardError = $true
$adminInitialPassword = Read-Host 'Initial root password (hidden)' -AsSecureString
$adminSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminInitialPassword)
try {
  $adminChild = [System.Diagnostics.Process]::Start($adminStartInfo)
  $adminChild.StandardInput.WriteLine([Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminSecretPointer))
  $adminChild.StandardInput.Close()
  $adminChild.WaitForExit()
  Write-Output $adminChild.StandardOutput.ReadToEnd()
  if ($adminChild.ExitCode -ne 0) { throw 'Root bootstrap failed. Check server diagnostics.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminSecretPointer)
  $adminInitialPassword.Dispose()
}
