$ErrorActionPreference = 'Continue'
$out = 'audit_slots.txt'
Remove-Item $out -ErrorAction SilentlyContinue
Add-Content $out "AD-SLOT / PUB / WORDCOUNT AUDIT"
Add-Content $out "============================="
$targets = @(
  'index.html',
  'deliver-v3\index.html',
  'deliver-v3\deliver-v2\index.html',
  'portfolio.html',
  'portfolio-content-block.html',
  'portfolio-content-block.html.bak',
  'deliver-v3\deliver-v2\deliver\index.html'
)
foreach ($t in $targets) {
  if (Test-Path $t) {
    $c = Get-Content $t -Raw
    Add-Content $out ("`n### FILE: " + $t)
    # AdSense slot ids
    $slots = [regex]::Matches($c, 'data-ad-slot="([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
    Add-Content $out ("  SLOTS (" + $slots.Count + "): " + ($slots -join ' | '))
    # pub ids
    $pubs = [regex]::Matches($c, 'ca-pub-[0-9]+') | ForEach-Object { $_.Value } | Sort-Object -Unique
    Add-Content $out ("  PUBS: " + ($pubs -join ' | '))
    # word count
    $wc = ([regex]::Matches($c, '\S+')).Count
    Add-Content $out ("  WORDS: " + $wc)
    # deliver text occurrence
    $dv = ([regex]::Matches($c, 'deliver', 'IgnoreCase')).Count
    $dv3 = ([regex]::Matches($c, 'deliver-v3', 'IgnoreCase')).Count
    $dv2 = ([regex]::Matches($c, 'deliver-v2', 'IgnoreCase')).Count
    Add-Content $out ("  OCCUR deliver=" + $dv + " deliver-v3=" + $dv3 + " deliver-v2=" + $dv2)
  } else {
    Add-Content $out ("`n### FILE: " + $t + "  [MISSING]")
  }
}
Write-Output "WROTE $out"
