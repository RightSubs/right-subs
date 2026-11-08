# Runs only the unit tests (addon + app) on Windows, without building the APK. Needs Docker Desktop running.
# Usage:  .\test.ps1                 addon and app
#         .\test.ps1 -Only addon     addon only (typecheck + node:test)
#         .\test.ps1 -Only app       app only (JUnit)
# Tests rightsubs\ and android\ as they are on disk (no need to commit). Uses no credentials.
param(
  [ValidateSet('all', 'addon', 'app')][string]$Only = 'all'
)
# Continue: native tools (docker) write progress to stderr; failures are checked by exit code.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker is not running: open Docker Desktop and try again.' }

# Same image as the build: first time downloads ~3 GB of SDK/NDK; afterwards it is cached.
docker build -t rightsubs-apk-builder (Join-Path $root 'docker')
if ($LASTEXITCODE -ne 0) { throw 'docker build failed' }

docker run --rm `
  -v "${root}:/work" -v rightsubs-gradle:/gradle -v rightsubs-npm:/root/.npm `
  -e "ONLY=$Only" `
  rightsubs-apk-builder bash /work/scripts/container-test.sh
if ($LASTEXITCODE -ne 0) { throw 'tests failed (details above)' }
