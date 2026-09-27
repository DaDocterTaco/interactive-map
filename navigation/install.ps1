param([Parameter(Mandatory = $true)][string]$Target)
$ErrorActionPreference = 'Stop'
$targetRoot = (Resolve-Path -LiteralPath $Target).Path
$sourceFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetFolder = Join-Path $targetRoot 'navigation'
if (-not (Test-Path -LiteralPath (Join-Path $targetRoot 'index.html') -PathType Leaf)) {
    throw "Expected the actual app's index.html in $targetRoot"
}
if (Test-Path -LiteralPath $targetFolder) {
    throw "Navigation already exists at $targetFolder; this installer never overwrites it."
}
Copy-Item -LiteralPath $sourceFolder -Destination $targetFolder -Recurse
$sourceFiles = @(Get-ChildItem -LiteralPath $sourceFolder -File -Recurse)
foreach ($sourceFile in $sourceFiles) {
    $relative = [System.IO.Path]::GetRelativePath($sourceFolder, $sourceFile.FullName)
    $installed = Join-Path $targetFolder $relative
    if ((Get-FileHash -LiteralPath $sourceFile.FullName).Hash -ne (Get-FileHash -LiteralPath $installed).Hash) {
        throw "Installed file verification failed: $relative"
    }
}
Write-Output "Installed and hash-verified $($sourceFiles.Count) files in $targetFolder. No host files were edited."
