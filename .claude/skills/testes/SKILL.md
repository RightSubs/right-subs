---
name: testes
description: Prepara o ambiente (Docker, Git) em Windows, macOS ou Linux e roda todos os testes do RightSubs APK - testes unitários do addon e do app sem gerar o APK, e o roteiro de testes na box. Use quando o desenvolvedor pedir para rodar/conferir os testes, configurar a máquina para testar, ou validar uma mudança antes de commitar.
---

# Rodar os testes

Tudo roda no mesmo container do build (`rightsubs-apk-builder`): o desenvolvedor só instala **Docker** e **Git**. Documentação para humanos: README › Testes.

## 1. Conferir o ambiente

Primeiro descubra o sistema (`$IsWindows`/`$env:OS` no PowerShell, `uname -sm` no shell) e use os comandos dele. Rode a checagem e **mostre o resultado** de cada item; só instale o que faltar, e peça ao desenvolvedor para instalar o que exige o instalador (Docker, Git).

```powershell
# Windows (PowerShell)
docker --version; docker info *> $null; "docker rodando: $($LASTEXITCODE -eq 0)"; git --version
```

```sh
# macOS / Linux
uname -sm; docker --version; docker info > /dev/null 2>&1 && echo "docker rodando" || echo "docker parado ou sem permissão"; git --version
```

| Sistema | Instalação (uma vez) |
|---|---|
| **Windows 10/11** | [Docker Desktop](https://www.docker.com/products/docker-desktop/) com backend WSL 2, **aberto**; [Git for Windows](https://git-scm.com/download/win) (traz o Git Bash, usado por `scripts/adb.sh`). PowerShell 5.1 basta. Comandos `.ps1`. |
| **macOS** | Docker Desktop (ou Colima/OrbStack), aberto; `xcode-select --install` ou `brew install git`. Comandos `sh test.sh`/`sh build.sh`. **Chip Apple (arm64)**: `export DOCKER_DEFAULT_PLATFORM=linux/amd64` antes (Docker Desktop: "Use Rosetta for x86_64/amd64 emulation"); emulação, mais lenta, **não testada**. |
| **Linux** | Docker Engine ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)); `sudo usermod -aG docker $USER` e nova sessão (senão "permission denied" no socket); `sudo apt install git` / `sudo dnf install git`. Fedora/RHEL com SELinux: `:z` no volume `-v …:/work` dos scripts. ARM: mesma observação do Mac Apple. |

| Item | Requisito |
|---|---|
| Espaço | pelo menos 10 GB livres; a imagem tem ≈6 GB. |
| Rede | a primeira execução baixa ~3 GB (SDK, NDK, Gradle); o Gradle baixa as Build-Tools 34 a **cada** execução (container descartável). |

Não é preciso Node, Java, Android Studio, `.env` nem aparelho para os testes automatizados. Não instale nada fora do Docker.

## 2. Testes automatizados (sem APK)

```powershell
.\test.ps1                 # Windows: addon (typecheck + node:test) e app (JUnit)
.\test.ps1 -Only addon     # só o addon
.\test.ps1 -Only app       # só o app
```

```sh
sh test.sh                 # macOS/Linux (e Git Bash)
ONLY=addon sh test.sh      # só o addon; ONLY=app para só o app
```

Medido em 2026-11-03 **no Windows**: **~32 s** com a imagem em cache, 219 testes do addon e 36 do app, todos passando. O `test.sh` foi executado no Git Bash do Windows; **não foi executado em macOS nem em Linux de verdade** (só usa `sh`/Docker, sem nada específico do Windows). Se falhar lá, reporte a saída.

- `scripts/container-test.sh` copia `rightsubs/` (sem `node_modules`, `dist`, `.env`, `config.yaml`) e `android/` para `/tmp` do container: testa o que está **no disco**, sem commitar, e não escreve no repositório. O app usa o `config.example.yaml` e o `languages.ts` reais do addon (`ConfigWriterTest`, `LanguagesTest`).
- A primeira vez sem a imagem constrói o `docker/Dockerfile` (vários minutos). Se o build da imagem falhar por rede, repita.
- Sucesso = código de saída 0 e `==> TODOS OS TESTES PASSARAM`. Em falha: `✖`/`not ok` do node:test, ou o relatório do Gradle; mostre a saída da falha ao desenvolvedor e **pergunte antes de corrigir**.
- Para ler o relatório do app depois de uma falha, rode `.\test.ps1 -Only app` de novo (o container é descartável; o resumo "App: N testes, N falhas" sai no fim).
- Depois de mexer em `rightsubs/` (regras de sincronização, ranking, config), leia as regras de `rightsubs/CLAUDE.md`: todo comportamento novo leva teste, e o caso real vai para `rightsubs/docs/DESCOBERTAS.md`.

## 3. Teste completo do APK (gera o APK; só se pedido)

```powershell
.\build.ps1 -Test                # Windows: build + testes do addon; os do app rodam sempre; confere versões e ausência de credenciais
```

```sh
RUN_TESTS=1 sh build.sh          # macOS/Linux
```

Skill `build-apk` para as variantes; skill `release-check` antes de distribuir ou commitar.

## 4. Testes na box ou no celular (opcional, exige aparelho)

Pergunte ao desenvolvedor antes: precisa de um aparelho Android na mesma rede com **Depuração USB/rede** ligada e do `.env` com as credenciais (`OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USER`, `OPENSUBTITLES_PASSWORD`; opcionais `RD_TOKEN`, `DEEPL_API_KEY`; modelo em `rightsubs/.env.example`). O IP vai em `CLAUDE.local.md` (fora do git). Nunca imprima valores do `.env`.

1. Windows: `.\build.ps1 -WorkingTree -Prefill -DebugLog -Test`; macOS/Linux: `WORKING_TREE=1 PREFILL=1 DEBUG_LOG=1 RUN_TESTS=1 sh build.sh` → APK de teste em `out/` (**nunca distribuir**; leva `NAO-DISTRIBUIR.txt`).
2. Instalar, limpar e abrir (skill `box` para o resto: `/health`, log, medição da extração):
   ```sh
   export BOX=<ip>          # Git Bash, macOS ou Linux
   sh scripts/adb.sh install -r /out/rightsubs-<VERSION>-<abi>-debuglog-prefill.apk   # armeabi-v7a (Xiaomi) ou arm64-v8a (Shield)
   sh scripts/adb.sh shell pm clear com.rightsubs.android
   sh scripts/adb.sh shell am start -n com.rightsubs.android/.MainActivity
   ```
3. Casos reais de regressão e o gabarito: `rightsubs/docs/DESCOBERTAS.md` (Drive, Halloween, Valkyrie, Enter the Void); tradução: `rightsubs/docs/TRADUCAO-DEEPL.md`.
4. Ao terminar: **lembrar o desenvolvedor de desligar a depuração** da box e de gerar o APK normal (`.\build.ps1` / `sh build.sh`) antes de distribuir qualquer coisa.

## O que os testes automatizados não cobrem

`AddonService` e a supervisão do Node (códigos 75 e 78), `BootReceiver`, o `SecretStore` com Keystore real, o Node/ffmpeg reais no aparelho e o comportamento do Stremio/players (limite de 10 s). A conferência do tempo da tradução só foi validada com Real-Debrid. Diga isso ao desenvolvedor ao reportar "tudo passou".

## Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| `Docker não está rodando` | abrir o Docker Desktop (Windows/Mac) e esperar; no Linux `sudo systemctl start docker`; `docker info` |
| Linux: `permission denied` no `/var/run/docker.sock` | `sudo usermod -aG docker $USER` e nova sessão (ou rodar com `sudo`) |
| Linux/Fedora: container não lê `/work` | SELinux: `:z` no volume `-v …:/work` |
| Mac/Linux ARM: erros de `aapt2`/`exec format error` no Gradle | `export DOCKER_DEFAULT_PLATFORM=linux/amd64` e repetir (emulação) |
| Linux: `build/` ou `out/` com dono root | o container roda como root; `sudo rm -rf build out` |
| Erro de caminho/`\r` ao rodar `.sh` no Windows | rodar pelo `.ps1`; no Git Bash use `MSYS_NO_PATHCONV=1` e caminhos `D:/…` |
| `npm ci` falha | sem rede ou registro fora do ar; repetir |
| Gradle: `Could not GET`/licença | sem rede na primeira execução; repetir |
| `.ps1` com acentos quebrados | o arquivo precisa de BOM UTF-8 (não regravar sem BOM) |
| Quer limpar tudo | `docker rmi rightsubs-apk-builder` e `docker volume rm rightsubs-gradle rightsubs-npm` (o volume `rightsubs-adb` guarda a chave do adb da box: a TV pediria autorização de novo) |
