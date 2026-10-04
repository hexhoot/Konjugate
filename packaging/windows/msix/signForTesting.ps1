# Copyright © 2026 Zenin Easa Panthakkalakath

# Local-test only: signs an unsigned .msix (from `make distributableWindowsMsix`) with a throwaway
# self-signed certificate and trusts that certificate, so Windows will sideload it. Run from an
# ELEVATED PowerShell, because trusting the certificate writes to the machine's TrustedPeople
# store. Never use this for a Store submission -- the Store signs the package itself.
#
# Usage: .\signForTesting.ps1 -Msix out\msix\Konjugate-1.1.5-x64.msix
#
# The certificate subject must equal the package's Identity Publisher (the MSIX_PUBLISHER the
# package was built with; 'CN=Konjugate Local Test' by default).

param(
    [Parameter(Mandatory = $true)][string]$Msix,
    [string]$Subject = 'CN=Konjugate Local Test'
)

$ErrorActionPreference = 'Stop'

$certificate = New-SelfSignedCertificate -Type Custom -Subject $Subject -KeyUsage DigitalSignature -FriendlyName 'Konjugate local test' -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$cerPath = Join-Path (Split-Path -Resolve $Msix) 'konjugateLocalTest.cer'
Export-Certificate -Cert $certificate -FilePath $cerPath | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe not found -- install the Windows 10/11 SDK.' }
& $signtool.FullName sign /fd SHA256 /sha1 $certificate.Thumbprint $Msix
if ($LASTEXITCODE -ne 0) { throw "signtool exited with code $LASTEXITCODE." }

Write-Host "Signed $Msix. Install it with:  Add-AppxPackage '$Msix'"
Write-Host "Remove it again with:           Get-AppxPackage *Konjugate* | Remove-AppxPackage"
