# Copyright © 2026 Zenin Easa Panthakkalakath

$ErrorActionPreference = 'Stop'

# Looked up through the Add/Remove Programs entry the installer writes (packaging/windows/
# installer.nsi's UNINSTALL_KEY) rather than a hardcoded path, so this keeps working wherever the
# user pointed the installer at.
$keys = Get-UninstallRegistryKey -SoftwareName 'Konjugate*'

if ($keys.Count -eq 1) {
    $uninstallString = $keys[0].UninstallString.Trim('"')
    Uninstall-ChocolateyPackage -PackageName $env:ChocolateyPackageName -FileType 'exe' -SilentArgs '/S' -File $uninstallString -ValidExitCodes @(0)
} elseif ($keys.Count -eq 0) {
    Write-Warning "$env:ChocolateyPackageName has already been uninstalled by other means."
} else {
    Write-Warning "$($keys.Count) matches found; refusing to guess which to uninstall."
    $keys | ForEach-Object { Write-Warning "- $($_.DisplayName)" }
}
