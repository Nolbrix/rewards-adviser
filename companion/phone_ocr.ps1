$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# One image on stdin; local processing only. No UI, screenshots or image files.
$resources = New-Object System.Collections.Generic.List[System.IDisposable]
$failureCode = 'ocr-unavailable'
try {
    $inputText = [Console]::In.ReadToEnd()
    if ($inputText.Length -gt 24000000) { $failureCode = 'ocr-input-too-large'; throw $failureCode }
    $request = $inputText | ConvertFrom-Json
    if ($request.image -isnot [string] -or $request.image.Length -eq 0) { throw $failureCode }
    $scale = 3
    if ($null -ne $request.scale) {
        if ($request.scale -notin @(1, 2, 3)) { throw $failureCode }
        $scale = [int]$request.scale
    }
    $imageBytes = [Convert]::FromBase64String($request.image)
    if ($imageBytes.Length -gt 16000000) { $failureCode = 'ocr-input-too-large'; throw $failureCode }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    Add-Type -AssemblyName System.Drawing
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.DataWriter, Windows.Foundation, ContentType=WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 } |
        Select-Object -First 1
    function Await-Result($operation, $resultType) {
        $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
        $task.GetAwaiter().GetResult()
    }

    $source = New-Object System.IO.MemoryStream(,$imageBytes)
    $resources.Add($source)
    $image = [System.Drawing.Image]::FromStream($source, $false, $true)
    $resources.Add($image)
    $width = [int]$image.Width
    $height = [int]$image.Height
    $scaledWidth = $width * $scale
    $scaledHeight = $height * $scale
    $maximum = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
    if ($width -lt 1 -or $height -lt 1 -or $scaledWidth -gt $maximum -or $scaledHeight -gt $maximum) {
        $failureCode = 'ocr-dimensions-unsupported'; throw $failureCode
    }
    $pixels = New-Object System.Drawing.Bitmap($scaledWidth, $scaledHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $resources.Add($pixels)
    $graphics = [System.Drawing.Graphics]::FromImage($pixels)
    $resources.Add($graphics)
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($image, 0, 0, $scaledWidth, $scaledHeight)
    $encoded = New-Object System.IO.MemoryStream
    $resources.Add($encoded)
    $pixels.Save($encoded, [System.Drawing.Imaging.ImageFormat]::Png)
    $random = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $resources.Add($random)
    $writer = New-Object Windows.Storage.Streams.DataWriter($random)
    $writer.WriteBytes($encoded.ToArray())
    $null = Await-Result ($writer.StoreAsync()) ([uint32])
    $null = $writer.DetachStream()
    $writer.Dispose()
    $random.Seek(0)
    $decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($random)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $software = Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $resources.Add($software)
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) { $failureCode = 'ocr-language-unavailable'; throw $failureCode }
    $result = Await-Result ($engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
    $lines = @(
        foreach ($line in $result.Lines) {
            $words = @(
                foreach ($word in $line.Words) {
                    $bounds = $word.BoundingRect
                    [ordered]@{ text = $word.Text; x = [double]$bounds.X / $scale; y = [double]$bounds.Y / $scale;
                        width = [double]$bounds.Width / $scale; height = [double]$bounds.Height / $scale }
                }
            )
            [ordered]@{ text = $line.Text; words = $words }
        }
    )
    [ordered]@{ width = $width; height = $height; lines = $lines } | ConvertTo-Json -Depth 8 -Compress
}
catch {
    # Exception text may contain input content; expose only a bounded code.
    [ordered]@{ error = $failureCode } | ConvertTo-Json -Compress
    exit 1
}
finally {
    for ($index = $resources.Count - 1; $index -ge 0; $index--) {
        try { $resources[$index].Dispose() } catch { }
    }
}
