param(
  [string]$UpdateUrl = $env:FASP_UPDATE_URL
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptDir '..')
$dist = Join-Path $root 'dist'
$releaseDir = Join-Path $root 'release'
$extensionStage = Join-Path $releaseDir '.extension-package'
$sourceStage = Join-Path $releaseDir '.source-package'

function Get-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-UnderRoot {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$RootPath
  )

  $fullPath = Get-FullPath $Path
  $fullRoot = (Get-FullPath $RootPath).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )

  if ($fullPath -ne $fullRoot -and -not $fullPath.StartsWith($fullRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside release root: $fullPath"
  }
}

function Remove-PathIfExists {
  param([Parameter(Mandatory = $true)][string]$Path)

  Assert-UnderRoot -Path $Path -RootPath $releaseDir
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Copy-IfExists {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (Test-Path -LiteralPath $Source) {
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
  }
}

function New-ZipFromDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $sourceRoot = (Get-FullPath $SourceDirectory).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )

  if (Test-Path -LiteralPath $DestinationPath) {
    Remove-Item -LiteralPath $DestinationPath -Force
  }

  $archive = [System.IO.Compression.ZipFile]::Open($DestinationPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $files = Get-ChildItem -LiteralPath $SourceDirectory -File -Recurse | Sort-Object FullName
    foreach ($file in $files) {
      $fullPath = Get-FullPath $file.FullName
      $relativePath = $fullPath.Substring($sourceRoot.Length + 1)
      $entryName = $relativePath.Replace('\', '/')
      $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = $file.LastWriteTime

      $entryStream = $entry.Open()
      $fileStream = [System.IO.File]::OpenRead($fullPath)
      try {
        $fileStream.CopyTo($entryStream)
      } finally {
        $fileStream.Dispose()
        $entryStream.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
}

Set-Location $root

$npmCommand = 'npm'
if ($env:OS -eq 'Windows_NT') {
  $npmCommand = 'npm.cmd'
}

Write-Host 'Building production extension...'
& $npmCommand run build

if (-not (Test-Path -LiteralPath (Join-Path $dist 'manifest.json'))) {
  throw 'dist/manifest.json was not found after build.'
}

$manifest = Get-Content -LiteralPath (Join-Path $dist 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version
$baseName = "adaptive-start-page-$version"

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

$extensionZip = Join-Path $releaseDir "$baseName-unlisted.zip"
$sourceZip = Join-Path $releaseDir "$baseName-source.zip"

Remove-PathIfExists $extensionStage
Remove-PathIfExists $sourceStage
if (Test-Path -LiteralPath $extensionZip) { Remove-Item -LiteralPath $extensionZip -Force }
if (Test-Path -LiteralPath $sourceZip) { Remove-Item -LiteralPath $sourceZip -Force }

New-Item -ItemType Directory -Path $extensionStage -Force | Out-Null
Copy-Item -Path (Join-Path $dist '*') -Destination $extensionStage -Recurse -Force
$unusedHtmlInputDir = Join-Path $extensionStage 'src'
if (Test-Path -LiteralPath $unusedHtmlInputDir) {
  Remove-Item -LiteralPath $unusedHtmlInputDir -Recurse -Force
}

if ($UpdateUrl) {
  if (-not ($UpdateUrl -match '^https://')) {
    throw 'UpdateUrl must be an HTTPS URL.'
  }

  $stagedManifestPath = Join-Path $extensionStage 'manifest.json'
  $stagedManifest = Get-Content -LiteralPath $stagedManifestPath -Raw | ConvertFrom-Json
  if (-not $stagedManifest.browser_specific_settings) {
    $stagedManifest | Add-Member -MemberType NoteProperty -Name browser_specific_settings -Value ([pscustomobject]@{})
  }
  if (-not $stagedManifest.browser_specific_settings.gecko) {
    $stagedManifest.browser_specific_settings | Add-Member -MemberType NoteProperty -Name gecko -Value ([pscustomobject]@{})
  }
  if ($stagedManifest.browser_specific_settings.gecko.PSObject.Properties.Name -contains 'update_url') {
    $stagedManifest.browser_specific_settings.gecko.update_url = $UpdateUrl
  } else {
    $stagedManifest.browser_specific_settings.gecko | Add-Member -MemberType NoteProperty -Name update_url -Value $UpdateUrl
  }
  $stagedManifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $stagedManifestPath -Encoding UTF8
  Write-Host "Using update_url: $UpdateUrl"
} else {
  Write-Host 'No update_url configured. The signed XPI will require manual updates.'
}

Write-Host 'Creating AMO upload archive...'
New-ZipFromDirectory -SourceDirectory $extensionStage -DestinationPath $extensionZip

New-Item -ItemType Directory -Path $sourceStage -Force | Out-Null

$sourceDirs = @('docs', 'public', 'scripts', 'src', 'tests')
foreach ($dir in $sourceDirs) {
  Copy-IfExists -Source (Join-Path $root $dir) -Destination $sourceStage
}

$sourceFiles = @(
  'AMO_SOURCE_README.md',
  'LICENSE',
  'MIGRATION.md',
  'package-lock.json',
  'package.json',
  'RELEASE.md',
  'TILE_INTERACTION_ENGINE.md',
  'tsconfig.json',
  'updates-template.json',
  'UI.md',
  'vite.config.ts'
)

foreach ($file in $sourceFiles) {
  Copy-IfExists -Source (Join-Path $root $file) -Destination $sourceStage
}

Write-Host 'Creating AMO source archive...'
New-ZipFromDirectory -SourceDirectory $sourceStage -DestinationPath $sourceZip

Remove-PathIfExists $extensionStage
Remove-PathIfExists $sourceStage

Write-Host ''
Write-Host 'Release packages created:'
Write-Host "  $extensionZip"
Write-Host "  $sourceZip"
Write-Host ''
Write-Host 'Upload the *-unlisted.zip file to AMO for self-distribution signing.'
