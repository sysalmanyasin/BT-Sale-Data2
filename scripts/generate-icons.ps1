Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot '..\icons'
$items = @(
  @{ Name = 'favicon-32.png'; Size = 32 },
  @{ Name = 'apple-touch-icon.png'; Size = 180 },
  @{ Name = 'icon-192.png'; Size = 192 },
  @{ Name = 'icon-512.png'; Size = 512 }
)
foreach ($item in $items) {
  $size = [int]$item.Size
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::FromArgb(255, 37, 99, 235))
  $fontSize = [Math]::Max(8, [int]($size * 0.34))
  $font = New-Object System.Drawing.Font('Arial', [single]$fontSize, [System.Drawing.FontStyle]::Bold)
  $brush = [System.Drawing.Brushes]::White
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textRect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $g.DrawString('BT', $font, $brush, $textRect, $sf)
  $out = Join-Path $dir $item.Name
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $font.Dispose()
  $g.Dispose()
  $bmp.Dispose()
  Write-Output "Created $out"
}
