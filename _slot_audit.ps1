$ErrorActionPreference = 'Continue'
Write-Output '=====AD SLOT RECONCILIATION====='
$pages = @(
  'd:\Boztik Website\index.html',
  'd:\Boztik Website\portfolio.html',
  'd:\Boztik Website\dashboard.html',
  'd:\Boztik Website\deliver-v3\index.html',
  'd:\Boztik Website\portfolio-content-block.html',
  'd:\Boztik Website\about.html',
  'd:\Boztik Website\services.html',
  'd:\Boztik Website\contact.html',
  'd:\Boztik Website\privacy.html',
  'd:\Boztik Website\terms.html',
  'd:\Boztik Website\support.html'
)
foreach ($p in $pages) {
  if (-not (Test-Path -LiteralPath $p)) { Write-Output ("MISSING: " + $p); continue }
  $c = Get-Content -LiteralPath $p -Raw
  $slots = [regex]::Matches($c, 'data-ad-slot="([0-9]+)"') | ForEach-Object { $_.Groups[1].Value }
  $pubs  = [regex]::Matches($c, 'ca-pub-[0-9]+') | ForEach-Object { $_.Value } | Sort-Object -Unique
  $gslot = ([regex]::Matches($c, 'google_ad_slot\s*=\s*"([0-9]+)"') | ForEach-Object { $_.Groups[1].Value })
  Write-Output ("FILE: " + (Split-Path $p -Leaf))
  Write-Output ("  data-ad-slot slots: " + (($slots | Sort-Object -Unique) -join ','))
  Write-Output ("  google_ad_slot=     : " + ($gslot -join ','))
  Write-Output ("  pubs: " + ($pubs -join ','))
  Write-Output ("  adssby count: " + ([regex]::Matches($c,'adsbygoogle').Count))
}
Write-Output '=====SITEMAP====='
$sm = Get-Content -LiteralPath 'd:\Boztik Website\sitemap.xml' -Raw
[regex]::Matches($sm,'<loc>(.*?)</loc>') | ForEach-Object { Write-Output $_.Groups[1].Value }
Write-Output '=====ROBOTS====='
Get-Content -LiteralPath 'd:\Boztik Website\robots.txt'
