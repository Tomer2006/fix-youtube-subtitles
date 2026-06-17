# Generates the extension icons (icons/icon{16,32,48,128}.png).
# A red rounded badge with two white "caption line" pills — matches the popup.
# Run:  powershell -ExecutionPolicy Bypass -File make-icons.ps1

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$outDir = Join-Path $root 'icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function New-RoundedRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $d = [single][Math]::Min($r * 2, [Math]::Min($w, $h))
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# brand colors (match popup.html accent)
$c1 = [System.Drawing.Color]::FromArgb(255, 255, 78, 69)  # #ff4e45
$c2 = [System.Drawing.Color]::FromArgb(255, 179, 0, 27)   # #b3001b

foreach ($s in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # red rounded-square background
  $rect = New-Object System.Drawing.RectangleF(0, 0, $s, $s)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45)
  $brush.WrapMode = [System.Drawing.Drawing2D.WrapMode]::TileFlipXY
  $bg = New-RoundedRect 0 0 $s $s ([single]($s * 0.22))
  $g.FillPath($brush, $bg)

  # two white caption pills
  $barH = [single]($s * 0.12)
  $gap = [single]($s * 0.11)
  $w1 = [single]($s * 0.60)
  $w2 = [single]($s * 0.40)
  $groupH = $barH * 2 + $gap
  $startY = [single]((($s - $groupH) / 2) + ($s * 0.02))
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

  $b1 = New-RoundedRect ([single](($s - $w1) / 2)) $startY $w1 $barH ([single]($barH / 2))
  $g.FillPath($white, $b1)
  $b2 = New-RoundedRect ([single](($s - $w2) / 2)) ([single]($startY + $barH + $gap)) $w2 $barH ([single]($barH / 2))
  $g.FillPath($white, $b2)

  $path = Join-Path $outDir ("icon{0}.png" -f $s)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $b1.Dispose(); $b2.Dispose(); $bg.Dispose(); $white.Dispose(); $brush.Dispose(); $g.Dispose(); $bmp.Dispose()
  Write-Output ("wrote {0}" -f $path)
}
