$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
$generator = Join-Path $PSScriptRoot 'generate_local_cert.py'

if (-not (Test-Path $pythonExe)) {
  throw "Expected Python environment not found at $pythonExe"
}

& $pythonExe $generator
