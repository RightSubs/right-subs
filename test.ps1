# Roda só os testes unitários (addon + app) no Windows, sem gerar o APK. Requer Docker Desktop rodando.
# Uso:  .\test.ps1                 addon e app
#       .\test.ps1 -Only addon     só o addon (typecheck + node:test)
#       .\test.ps1 -Only app       só o app (JUnit)
# Testa rightsubs\ e android\ como estão no disco (não precisa commitar). Não usa credenciais.
param(
  [ValidateSet('all', 'addon', 'app')][string]$Only = 'all'
)
# Continue: native tools (docker) write progress to stderr; failures are checked by exit code.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker não está rodando: abra o Docker Desktop e tente de novo.' }

# Same image as the build: first time downloads ~3 GB of SDK/NDK; afterwards it is cached.
docker build -t rightsubs-apk-builder (Join-Path $root 'docker')
if ($LASTEXITCODE -ne 0) { throw 'docker build falhou' }

docker run --rm `
  -v "${root}:/work" -v rightsubs-gradle:/gradle -v rightsubs-npm:/root/.npm `
  -e "ONLY=$Only" `
  rightsubs-apk-builder bash /work/scripts/container-test.sh
if ($LASTEXITCODE -ne 0) { throw 'testes falharam (detalhes acima)' }
