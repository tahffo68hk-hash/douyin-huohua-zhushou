param([ValidateSet('once','daemon','check')][string]$Mode='once')
Set-Location $PSScriptRoot
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) { Write-Error '找不到 Python 3，请先安装 Python 3'; exit 2 }
& $python.Source scheduler.py $Mode
exit $LASTEXITCODE
