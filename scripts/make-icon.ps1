$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path $PSScriptRoot '../assets'
[System.IO.Directory]::CreateDirectory($assetDirectory) | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(17, 21, 29))
$pink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(242, 90, 133))
$mint = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(98, 231, 215))
$graphics.FillRectangle($pink, 117, 62, 30, 120)
$graphics.FillRectangle($pink, 79, 85, 107, 27)
$graphics.FillEllipse($pink, 117, 157, 69, 48)
$graphics.FillRectangle($mint, 105, 52, 30, 120)
$graphics.FillRectangle($mint, 67, 75, 107, 27)
$graphics.FillEllipse($mint, 105, 147, 69, 48)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $stream.ToArray()
$file = [System.IO.File]::Create((Join-Path $assetDirectory 'icon.ico'))
$writer = New-Object System.IO.BinaryWriter $file
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32)
$writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
$writer.Dispose(); $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $pink.Dispose(); $mint.Dispose()
Write-Output 'Generated assets/icon.ico'
