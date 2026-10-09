Set-Location $PSScriptRoot
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) { Write-Error '未找到 Python 3'; exit 2 }
& $python.Source manager.py
