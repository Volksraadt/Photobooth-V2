# Prints one image file on a Windows printer through the spooler, without any dialog.
# The image (a full 4x6 sheet at 300 dpi) is drawn edge to edge on the physical page.
# Output (stdout, one line JSON): {"ok":true,"paper":"<name>","copies":N}
param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$Copies = 1,
  [double]$WidthIn = 4,
  [double]$HeightIn = 6,
  [string]$DocName = 'photobooth',
  # Diagnostics/tests only: spool to a file instead of the device (e.g. "Microsoft Print to PDF").
  [string]$OutFile = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile($Path)
try {
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $Printer
  if (-not $doc.PrinterSettings.IsValid) { throw "Printer tidak ditemukan: $Printer" }
  $doc.DocumentName = $DocName
  if ($OutFile) {
    $doc.PrinterSettings.PrintToFile = $true
    $doc.PrinterSettings.PrintFileName = $OutFile
  }
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController

  # Prefer the driver's 4x6 paper (sizes are in hundredths of an inch, either orientation).
  $w = [int]($WidthIn * 100); $h = [int]($HeightIn * 100)
  $paper = $null
  foreach ($ps in $doc.PrinterSettings.PaperSizes) {
    $fits = ([math]::Abs($ps.Width - $w) -le 8 -and [math]::Abs($ps.Height - $h) -le 8) -or
            ([math]::Abs($ps.Width - $h) -le 8 -and [math]::Abs($ps.Height - $w) -le 8)
    if ($fits) { $paper = $ps; break }
  }
  if ($paper) { $doc.DefaultPageSettings.PaperSize = $paper }
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.DefaultPageSettings.Landscape = $false

  $max = $doc.PrinterSettings.MaximumCopies
  # Driver copies when supported, otherwise one job per sheet.
  if ($max -ge $Copies) { $perJob = $Copies; $jobs = 1 } else { $perJob = 1; $jobs = $Copies }
  $doc.PrinterSettings.Copies = $perJob

  $doc.add_PrintPage({
    param($s, $e)
    $g = $e.Graphics
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    # Graphics origin is the printable area; shift back to the physical page corner.
    $g.TranslateTransform(-$e.PageSettings.HardMarginX, -$e.PageSettings.HardMarginY)
    $page = $e.PageBounds
    $imgPortrait = $img.Height -ge $img.Width
    $pagePortrait = $page.Height -ge $page.Width
    if ($imgPortrait -ne $pagePortrait) {
      # Driver paper is landscape: rotate the sheet to fill it.
      $g.TranslateTransform($page.Width, 0)
      $g.RotateTransform(90)
      $dest = New-Object System.Drawing.RectangleF(0, 0, $page.Height, $page.Width)
    } else {
      $dest = New-Object System.Drawing.RectangleF(0, 0, $page.Width, $page.Height)
    }
    $g.DrawImage($img, $dest)
    $e.HasMorePages = $false
  })

  for ($i = 0; $i -lt $jobs; $i++) { $doc.Print() }
  $paperName = if ($paper) { $paper.PaperName } else { $doc.DefaultPageSettings.PaperSize.PaperName }
  Write-Output (ConvertTo-Json -Compress @{ ok = $true; paper = $paperName; copies = $Copies })
} finally {
  $img.Dispose()
}
