param([ValidateSet('daemon','once')][string]$Mode = 'daemon')
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$ArgsList=@((Join-Path $Root 'scheduler.py'), '--config', (Join-Path $Root 'config.json'))
if($Mode -eq 'daemon'){$ArgsList+='--daemon'}else{$ArgsList+='--once'}
python @ArgsList
exit $LASTEXITCODE
