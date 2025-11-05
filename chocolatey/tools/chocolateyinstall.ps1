$ErrorActionPreference = 'Stop'

$packageName = 'termix-ssh'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
$url64 = 'DOWNLOAD_URL_PLACEHOLDER'
$checksum64 = 'CHECKSUM_PLACEHOLDER'
$checksumType64 = 'sha256'

$packageArgs = @{
  packageName    = $packageName
  fileType       = 'msi'
  url64bit       = $url64
  softwareName   = 'Termix*'
  checksum64     = $checksum64
  checksumType64 = $checksumType64
  silentArgs     = "/qn /norestart /l*v `"$($env:TEMP)\$($packageName).$($env:chocolateyPackageVersion).MsiInstall.log`""
  validExitCodes = @(0, 3010, 1641)
}

Install-ChocolateyPackage @packageArgs
