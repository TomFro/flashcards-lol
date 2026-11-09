# Telecharge les donnees de Riot (Data Dragon) et les images dans le dossier data\
# pour que le site marche hors ligne.
#   -Videos : telecharge aussi les videos des sorts (gros : environ 1 a 2 Go)
#   -Force  : retelecharge les images meme si elles existent deja
param([switch]$Videos, [switch]$Force)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = Join-Path $root 'data'
$DD = 'https://ddragon.leagueoflegends.com'
$VIDEO = 'https://d28xe8vt774jo5.cloudfront.net/champion-abilities'
$wc = New-Object Net.WebClient

function Get-Text($url) { [Text.Encoding]::UTF8.GetString($wc.DownloadData($url)) }

function Save-File($url, $path) {
  if ((Test-Path $path) -and -not $Force) { return 0 }
  $dir = Split-Path -Parent $path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  try { $wc.DownloadFile($url, $path); return 1 }
  catch { if (Test-Path $path) { Remove-Item $path -Force }; return 0 }
}

Write-Host "Recherche du dernier patch..."
$versions = Get-Text "$DD/api/versions.json"
$v = ([regex]'"([^"]+)"').Match($versions).Groups[1].Value
Write-Host "Patch $v"

Write-Host "Telechargement des champions et des runes..."
$champ = Get-Text "$DD/cdn/$v/data/fr_FR/championFull.json"
$runes = Get-Text "$DD/cdn/$v/data/fr_FR/runesReforged.json"
$items = Get-Text "$DD/cdn/$v/data/fr_FR/item.json"

if (-not (Test-Path $data)) { New-Item -ItemType Directory -Path $data | Out-Null }

# Images des champions, sorts et passifs
$n = 0
$imgs = [regex]::Matches($champ, '"full":"([^"]+)","sprite":"[^"]+","group":"(\w+)"')
Write-Host "Images des champions et des sorts ($($imgs.Count))..."
foreach ($m in $imgs) {
  $full = $m.Groups[1].Value; $group = $m.Groups[2].Value
  if ($group -eq 'champion') {
    $id = [IO.Path]::GetFileNameWithoutExtension($full)
    $n += Save-File "$DD/cdn/img/champion/loading/$($id)_0.jpg" (Join-Path $data "img\loading\$($id)_0.jpg")
    $n += Save-File "$DD/cdn/$v/img/champion/$full" (Join-Path $data "img\champion\$full")
  } elseif ($group -eq 'spell' -or $group -eq 'passive') {
    $n += Save-File "$DD/cdn/$v/img/$group/$full" (Join-Path $data "img\$group\$full")
  }
}

# Icones des objets
$itemImgs = [regex]::Matches($items, '"full":"([^"]+)","sprite":"[^"]+","group":"item"')
Write-Host "Icones des objets ($($itemImgs.Count))..."
foreach ($m in $itemImgs) {
  $full = $m.Groups[1].Value
  $n += Save-File "$DD/cdn/$v/img/item/$full" (Join-Path $data "img\item\$full")
}

# Icones des runes
$icons = [regex]::Matches($runes, '"icon":"([^"]+)"')
Write-Host "Icones des runes ($($icons.Count))..."
foreach ($m in $icons) {
  $icon = $m.Groups[1].Value
  $n += Save-File "$DD/cdn/img/$icon" (Join-Path $data ("img\runes\" + $icon.Replace('/', '\')))
}
Write-Host "$n nouvelles images."

# Chiffres detailles des sorts (degats par rang, ratios) depuis Meraki Analytics
$MERAKI = 'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions'
$ids = [regex]::Matches($champ, '"id":"(\w+)","key":"\d+"')
Write-Host "Chiffres des sorts ($($ids.Count) champions)..."
$mdir = Join-Path $data 'meraki'
if (-not (Test-Path $mdir)) { New-Item -ItemType Directory -Path $mdir | Out-Null }
$nm = 0
foreach ($m in $ids) {
  $id = $m.Groups[1].Value
  try {
    $json = Get-Text "$MERAKI/$id.json"
    [IO.File]::WriteAllText((Join-Path $mdir "$id.js"), "window.MERAKI_CB(`"$id`", $json);", (New-Object Text.UTF8Encoding($false)))
    $nm++
  } catch { }
}
Write-Host "$nm champions avec chiffres detailles."

# Videos des sorts (optionnel)
if ($Videos) {
  $keys = [regex]::Matches($champ, '"id":"(\w+)","key":"(\d+)"')
  Write-Host "Videos des sorts ($($keys.Count) champions, ca peut etre long)..."
  $nv = 0; $i = 0
  foreach ($m in $keys) {
    $i++
    $k = $m.Groups[2].Value.PadLeft(4, '0')
    Write-Host "  [$i/$($keys.Count)] $($m.Groups[1].Value)"
    foreach ($s in 'P', 'Q', 'W', 'E', 'R') {
      $nv += Save-File "$VIDEO/$k/ability_$($k)_$($s)1.webm" (Join-Path $data "videos\$($k)_$s.webm")
    }
  }
  Write-Host "$nv nouvelles videos."
}

# Fichier lu par le site (un .js, car le navigateur refuse de lire un .json local)
$js = 'window.DD_DATA = {"version":"' + $v + '","champions":' + $champ + ',"runes":' + $runes + ',"items":' + $items + '};'
[IO.File]::WriteAllText((Join-Path $data 'data.js'), $js, (New-Object Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Termine ! Le site est a jour (patch $v) et marche hors ligne."
