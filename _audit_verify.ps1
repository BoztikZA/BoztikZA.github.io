$ErrorActionPreference = 'Continue'
$root = 'd:\Boztik Website'

Write-Output '=== VERIFY NESTED STRUCTURE ==='
$nested = Join-Path $root 'deliver-v3\deliver-v2\index.html'
Write-Output ("Nested deliver-v3\deliver-v2\index.html exists: " + (Test-Path -LiteralPath $nested))

Write-Output ''
Write-Output '=== TOP-LEVEL LISTING OF deliver-v3 ==='
$v3 = Join-Path $root 'deliver-v3'
if (Test-Path -LiteralPath $v3) {
  Get-ChildItem -LiteralPath $v3 -Force | Select-Object Name, Mode | Format-Table -AutoSize | Out-String -Width 200
} else {
  Write-Output 'deliver-v3 does not exist'
}

Write-Output '=== RECURSIVE FILE LISTING OF deliver-v3 ==='
if (Test-Path -LiteralPath $v3) {
  Get-ChildItem -LiteralPath $v3 -Recurse -Force -File | ForEach-Object { $_.FullName } | Out-String -Width 300
} else {
  Write-Output 'deliver-v3 does not exist'
}

Write-Output ''
Write-Output '=== AUDIT FILES CONTENT ==='
$auditFiles = @('_audit_compare.txt', '_tmp_sel.txt', '_tree.txt', 'audit_slots.ps1', 'audit_slots.txt', 'sitemap_status_check.txt')
foreach ($f in $auditFiles) {
  $p = Join-Path $root $f
  Write-Output ''
  Write-Output ('----- ' + $f + ' -----')
  if (Test-Path -LiteralPath $p) {
    Get-Content -LiteralPath $p -Raw -Encoding UTF8
  } else {
    Write-Output ('(not found at ' + $p + ')')
  }
}
