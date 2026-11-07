# Gera o APK do RightSubs no Windows. Requer Docker Desktop rodando e Git.
# Uso:  .\build.ps1
#       .\build.ps1 -Abis armeabi-v7a,arm64-v8a,x86_64 -Test   (-Test roda os testes do addon antes; os do app rodam sempre)
#       Só os testes, sem gerar o APK: .\test.ps1
#       .\build.ps1 -DebugLog            SÓ TESTES: cópia do log legível por adb (gera *-debuglog.apk)
#       .\build.ps1 -Prefill             SÓ TESTES: credenciais do .env dentro do APK (gera *-prefill.apk)
#       .\build.ps1 -WorkingTree         SÓ TESTES: addon com as alterações ainda não commitadas de rightsubs\
# A versão do APK vem do arquivo VERSION (passo a passo de uma versão nova no README).
# O APK sai em out\. O addon vem de rightsubs\ no último commit deste repositório (git archive):
# .env e config.yaml nunca fazem parte do APK.
param(
  [string[]]$Abis = @('armeabi-v7a', 'arm64-v8a'),
  [switch]$Test,
  [switch]$DebugLog,
  [switch]$Prefill,
  [switch]$WorkingTree
)
# Continue: native tools (docker, git) write progress to stderr; failures are checked by exit code.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker não está rodando: abra o Docker Desktop e tente de novo.' }

New-Item -ItemType Directory -Force (Join-Path $root 'build') | Out-Null
$source = 'HEAD'
if ($WorkingTree) {
  # A tree of the working copy built in a throwaway index: HEAD, the real index and the
  # staged files stay as they are (.gitignore still keeps .env and node_modules out).
  $env:GIT_INDEX_FILE = Join-Path $root 'build\worktree.index'
  Remove-Item $env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
  git -C $root read-tree HEAD
  git -C $root add -A -- rightsubs
  $source = git -C $root write-tree
  Remove-Item Env:GIT_INDEX_FILE
  if ($LASTEXITCODE -ne 0 -or -not $source) { throw 'não foi possível montar o rightsubs\ do diretório de trabalho' }
  Write-Warning 'Addon montado das alterações não commitadas de rightsubs\ (-WorkingTree).'
} elseif (git -C $root status --porcelain -- rightsubs) {
  Write-Warning 'Há alterações não commitadas em rightsubs\: o APK usa só o último commit (use -WorkingTree para testar com elas).'
}
git -C $root archive --format=tar -o (Join-Path $root 'build\rightsubs-src.tar') "${source}:rightsubs"
if ($LASTEXITCODE -ne 0) { throw 'git archive falhou (rightsubs\ está commitado?)' }
# Recorded in out\BUILD-INFO.txt: which commit went into the APK.
$apkCommit = git -C $root rev-parse --short HEAD
if (git -C $root status --porcelain --untracked-files=no) { $apkCommit += '+alterações' }

docker build -t rightsubs-apk-builder (Join-Path $root 'docker')
if ($LASTEXITCODE -ne 0) { throw 'docker build falhou' }

$runTests = if ($Test) { '1' } else { '0' }
docker run --rm `
  -v "${root}:/work" -v rightsubs-gradle:/gradle -v rightsubs-npm:/root/.npm `
  -e "ABIS=$($Abis -join ' ')" -e "RUN_TESTS=$runTests" -e "DEBUG_LOG=$(if ($DebugLog) { '1' } else { '0' })" `
  -e "PREFILL=$(if ($Prefill) { '1' } else { '0' })" -e "APK_COMMIT=$apkCommit" `
  rightsubs-apk-builder bash /work/scripts/container-build.sh
if ($LASTEXITCODE -ne 0) { throw 'build do APK falhou (detalhes acima)' }
Write-Host "`nAPKs em $(Join-Path $root 'out')"
if ($Prefill) { Write-Warning 'ESTES APKs TÊM AS CREDENCIAIS DO .env EM TEXTO PURO. Só para os seus testes: NUNCA distribua.' }
elseif ($DebugLog) { Write-Warning 'ESTES APKs GRAVAM O LOG COM OS FILMES ASSISTIDOS. Só para os seus testes: NUNCA distribua.' }
