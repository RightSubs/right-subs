# Builds the RightSubs APK on Windows. Needs Docker Desktop running and Git.
# Usage:  .\build.ps1
#         .\build.ps1 -Abis armeabi-v7a,arm64-v8a,x86_64 -Test   (-Test runs the addon tests first; the app tests always run)
#         Tests only, without building the APK: .\test.ps1
#         .\build.ps1 -DebugLog            TESTING ONLY: log copy readable with adb (builds *-debuglog.apk)
#         .\build.ps1 -Prefill             TESTING ONLY: credentials from .env inside the APK (builds *-prefill.apk)
#         .\build.ps1 -WorkingTree         TESTING ONLY: addon with the still uncommitted changes in rightsubs\
# The APK version comes from the VERSION file (steps for a new version in the README).
# The APK lands in out\. The addon comes from rightsubs\ in this repository's last commit (git archive):
# .env and config.yaml are never part of the APK.
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
if ($LASTEXITCODE -ne 0) { throw 'Docker is not running: open Docker Desktop and try again.' }

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
  if ($LASTEXITCODE -ne 0 -or -not $source) { throw 'could not assemble rightsubs\ from the working directory' }
  Write-Warning 'Addon built from the uncommitted changes in rightsubs\ (-WorkingTree).'
} elseif (git -C $root status --porcelain -- rightsubs) {
  Write-Warning 'rightsubs\ has uncommitted changes: the APK uses only the last commit (use -WorkingTree to test with them).'
}
git -C $root archive --format=tar -o (Join-Path $root 'build\rightsubs-src.tar') "${source}:rightsubs"
if ($LASTEXITCODE -ne 0) { throw 'git archive failed (is rightsubs\ committed?)' }
# Recorded in out\BUILD-INFO.txt: which commit went into the APK.
$apkCommit = git -C $root rev-parse --short HEAD
if (git -C $root status --porcelain --untracked-files=no) { $apkCommit += '+dirty' }

docker build -t rightsubs-apk-builder (Join-Path $root 'docker')
if ($LASTEXITCODE -ne 0) { throw 'docker build failed' }

$runTests = if ($Test) { '1' } else { '0' }
docker run --rm `
  -v "${root}:/work" -v rightsubs-gradle:/gradle -v rightsubs-npm:/root/.npm `
  -e "ABIS=$($Abis -join ' ')" -e "RUN_TESTS=$runTests" -e "DEBUG_LOG=$(if ($DebugLog) { '1' } else { '0' })" `
  -e "PREFILL=$(if ($Prefill) { '1' } else { '0' })" -e "APK_COMMIT=$apkCommit" `
  rightsubs-apk-builder bash /work/scripts/container-build.sh
if ($LASTEXITCODE -ne 0) { throw 'APK build failed (details above)' }
Write-Host "`nAPKs in $(Join-Path $root 'out')"
if ($Prefill) { Write-Warning 'THESE APKs CARRY THE .env CREDENTIALS IN PLAIN TEXT. For your own tests only: NEVER distribute them.' }
elseif ($DebugLog) { Write-Warning 'THESE APKs WRITE A LOG WITH THE MOVIES WATCHED. For your own tests only: NEVER distribute them.' }
