# Servidor local do Dindom (sem instalar nada): abre o app em http://localhost:8080
# Uso: clique com o botão direito > "Executar com o PowerShell", ou no terminal:  powershell -ExecutionPolicy Bypass -File serve.ps1
param([int]$Port = 8080)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'
  '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'
}

# Se a porta estiver ocupada, tenta as próximas.
$listener = $null
for ($p = $Port; $p -lt $Port + 10; $p++) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start(); $listener = $l; $Port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host "Não encontrei uma porta livre entre $Port e $($Port + 9)."; exit 1 }

Write-Host ""
Write-Host "  Dindom rodando em: http://localhost:$Port" -ForegroundColor Green
Write-Host "  Para parar: feche esta janela (ou Ctrl+C)."
Write-Host ""

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $path))
    # Só entrega arquivos de dentro da pasta do projeto.
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('Arquivo não encontrado')
    } else {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($full)
    }
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch { $res.StatusCode = 500 } finally { $res.OutputStream.Close() }
}
