# RightSubs — APK

O [RightSubs](rightsubs/) num APK para Android TV/Google TV (e celular/tablet). Instala como qualquer app: sem Termux, sem linha de comando, sem script de boot. Na primeira abertura ele pede as credenciais, guarda-as criptografadas e sobe o addon em `http://127.0.0.1:7000/manifest.json`.

O que vai dentro do APK:

| Peça | Origem |
|---|---|
| RightSubs (`dist/` + `yaml` e `zod`) | pasta [rightsubs/](rightsubs/) deste repositório, no último commit (`git archive`) |
| Node.js 24 LTS | pacote `nodejs-lts` do Termux, o mesmo que já roda na box, com as bibliotecas de que ele precisa |
| ffmpeg + ffprobe | compilados aqui com o NDK, mínimos: só leem cabeçalhos e legendas em texto por HTTP(S) e gravam SRT |
| App Android | Kotlin, sem bibliotecas além da stdlib: tela de credenciais, serviço em primeiro plano, início no boot |

## Segurança das credenciais

- **Armazenamento:** API key, usuário e senha da OpenSubtitles, token do Real-Debrid e chave do DeepL (os dois últimos opcionais) são cifrados com AES-256-GCM. A chave é gerada dentro do **Android Keystore** (no hardware quando o aparelho tem; StrongBox quando existe) e não pode ser exportada: o arquivo cifrado não serve para nada fora deste aparelho. Cada campo é amarrado ao seu nome (AAD), então não dá para trocar um pelo outro.
- **Nada em texto puro no disco:** não existe `.env`. O `config.yaml` gerado mantém os `${VAR}` e os valores vão para o Node só como variáveis de ambiente do processo (no Android, só o próprio app enxerga). Nunca vão na linha de comando.
- **Sem backup:** `allowBackup=false` e regras de extração vazias: nada vai para o backup na nuvem nem para a transferência entre aparelhos.
- **Tela:** `FLAG_SECURE` (sem captura de tela, gravação, transmissão nem miniatura nos recentes); campos com o texto oculto, sem sugestões nem aprendizado do teclado (`flagNoPersonalizedLearning`), sem preenchimento automático (outros apps não recebem os valores) e sem gravar o conteúdo no estado salvo da tela. Depois de salvos, os valores **nunca voltam a aparecer**: editar só substitui (campo em branco mantém o atual). "Apagar credenciais" apaga os dados cifrados e a própria chave do Keystore.
- **Log:** toda linha do Node passa por um filtro que troca qualquer credencial (também na forma codificada em URL) por `***` antes de chegar ao arquivo ou à tela.
- **Preencher pelo celular:** o botão abre, só enquanto a tela está aberta, um formulário na rede de casa (`http://<IP da TV>:7001`), com QR e um código de 6 dígitos que só aparece na TV. Fecha depois de um envio aceito, em 10 minutos, com 5 códigos errados ou ao sair da tela. O envio vai **sem criptografia própria**, protegido só pela senha do Wi-Fi: prefira fazer isso numa rede de confiança.
- **Rede:** o addon só escuta em `127.0.0.1` (só apps do próprio aparelho, como o Stremio, acessam). O app em si só fala HTTP com `127.0.0.1`; o resto exige HTTPS com CAs do sistema. O ffmpeg foi corrigido para **verificar o certificado e o nome do servidor** (o padrão do ffmpeg é não verificar; ver [patches/ffmpeg-tls-verify.patch](patches/ffmpeg-tls-verify.patch)).
- **Componentes:** só a tela principal é exportada; o serviço não é; o receptor de boot só reage aos avisos do sistema.
- **Build:** o pacote do RightSubs vem do `git archive` de `rightsubs/` no último commit, então `.env` e `config.yaml` do seu computador nunca entram; o script ainda confere isso. `npm ci --ignore-scripts` (nada do registro roda no build). Os `.deb` do Termux são conferidos pelo SHA-256 do índice do repositório; ffmpeg, Android SDK e Gradle por hash fixo ou publicado.

## Gerar o APK

Requisitos: **Docker Desktop** (rodando) e Git. Todo o resto (JDK, Android SDK, NDK, Gradle, Node) fica dentro do container.

```powershell
.\build.ps1                                   # Windows
.\build.ps1 -Test                             # também roda os testes do addon (os do app rodam sempre)
```

```sh
sh build.sh                                   # Mac/Linux
```

A primeira vez demora (baixa ~3 GB e compila o ffmpeg); depois é rápido. Saída em `out/`:

| Arquivo | Para |
|---|---|
| `rightsubs-<versão>-armeabi-v7a.apk` | Chromecast com Google TV e outras boxes de 32 bits |
| `rightsubs-<versão>-arm64-v8a.apk` | Shield TV, celulares recentes |
| `rightsubs-<versão>-universal.apk` | qualquer um dos dois (maior) |
| `SHA256SUMS.txt` | hashes, para conferir o download |
| `BUILD-INFO.txt` | versão do APK e do addon, commit usado, versões do Node e do ffmpeg |

Para um emulador x86_64: `.\build.ps1 -Abis x86_64`.

**Commit antes de gerar:** só o último commit de `rightsubs/` entra (o script avisa se houver alterações pendentes).

**Barreiras:** todo build que não é de teste confere que o APK não carrega nenhuma credencial do seu `.env` (e apaga os APKs se carregar), e um hook de commit (`git config core.hooksPath scripts/git-hooks`) impede que credenciais, chaves e APKs entrem no git. Os APKs de teste vêm com o aviso `out/NAO-DISTRIBUIR.txt`.

**Só para testes (nunca distribuir):** `.\build.ps1 -DebugLog` gera `*-debuglog.apk`, que grava uma cópia do log (já sem segredos) em `/sdcard/Android/data/com.rightsubs.android/files/`, legível por adb (o log mostra os filmes que a pessoa assiste). `-Prefill` gera `*-prefill.apk` com as credenciais do `.env` **em texto puro** dentro do APK, gravadas na primeira abertura (numa box que já tem credenciais, `pm clear` antes). `-WorkingTree` empacota o addon com as alterações ainda não commitadas de `rightsubs/`. Eles se combinam: `.\build.ps1 -WorkingTree -Prefill -DebugLog`.

### Chave de assinatura

No primeiro build é criada uma chave em `signing/` (fora do git). **Faça backup dela**: o Android só aceita atualizar o app com um APK assinado pela mesma chave; sem ela, cada amigo precisaria desinstalar (e digitar as credenciais de novo).

## Testes

### Instalação (uma vez)

Só **Docker** e **Git** no computador; Node, JDK, Android SDK/NDK e Gradle ficam dentro do container. Escolha o seu sistema:

**Windows 10/11**
1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) com o backend **WSL 2**; abra-o e deixe-o rodando.
2. [Git for Windows](https://git-scm.com/download/win) (traz o Git Bash, que o `scripts/adb.sh` usa).
3. O PowerShell 5.1 que já vem no Windows basta. Comandos: `.\test.ps1`, `.\build.ps1`.

**macOS**
1. [Docker Desktop para Mac](https://www.docker.com/products/docker-desktop/) (ou outro Docker compatível, como Colima ou OrbStack); abra-o.
2. Git: `xcode-select --install` ou `brew install git`.
3. Comandos: `sh test.sh`, `sh build.sh`.
4. **Mac com chip Apple (M1…)**: o ambiente de build usa ferramentas do Android compiladas para x86_64, então rode com `export DOCKER_DEFAULT_PLATFORM=linux/amd64` (no Docker Desktop, ative "Use Rosetta for x86_64/amd64 emulation"). Funciona por emulação, **mais lento, e não foi testado** por nós.

**Linux (Debian/Ubuntu, Fedora…)**
1. Docker Engine ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)) e, para não usar `sudo` toda hora, `sudo usermod -aG docker $USER` e sair/entrar na sessão. Confira com `docker info`.
2. Git: `sudo apt install git` (Debian/Ubuntu) ou `sudo dnf install git` (Fedora).
3. Comandos: `sh test.sh`, `sh build.sh`.
4. Fedora/RHEL com SELinux: se o container não conseguir ler a pasta, acrescente `:z` ao volume `-v …:/work` dos scripts. PC ARM (Raspberry Pi etc.): mesma observação do Mac com chip Apple.
5. O container roda como root: `build.sh` deixa `build/` e `out/` com dono root (o `test.sh` não grava nada no repositório). Para apagá-los: `sudo rm -rf build out`.

Os `.sh` usam só `sh` (POSIX) e funcionam também no Git Bash do Windows. No Windows o fluxo oficial é o `.ps1`.

Espaço e tempo: pelo menos 10 GB livres para a imagem (≈6 GB) e os volumes do Docker; a **primeira** execução baixa ~3 GB (Android SDK, NDK, Gradle) e leva alguns minutos; depois a imagem fica em cache. Precisa de internet na primeira vez (e o Gradle baixa as Build-Tools 34 a cada execução, porque o container é descartável).

Não precisa de credenciais nem de aparelho para os testes automatizados. O `.env` (`cp rightsubs/.env.example .env` na raiz; no Windows, `Copy-Item rightsubs\.env.example .env`) só é lido por `-Prefill`, e só os testes na box usam o resultado.

### Testes automatizados (sem APK, ~30 s com a imagem pronta)

```powershell
.\test.ps1                  # addon (typecheck + node:test) e app (JUnit)
.\test.ps1 -Only addon      # só o addon
.\test.ps1 -Only app        # só o app
```

```sh
sh test.sh                  # macOS/Linux (também no Git Bash); ONLY=addon ou ONLY=app para um só
```

Testam `rightsubs/` e `android/` **como estão no disco** (não precisa commitar) e não gravam nada no repositório. Saída esperada no fim: `ℹ pass 219`, `App: 36 testes, 0 falhas` e `TODOS OS TESTES PASSARAM`; o código de saída é 0. Os números crescem com o código: o que importa é `fail 0`.

| Camada | Onde | O que cobre |
|---|---|---|
| Addon | `rightsubs/test/*.test.ts` | escolha e sincronização de legendas, fontes, cache, tradução DeepL, config |
| App | `android/app/src/test/` | `ConfigWriter` com o template **real** do addon, lista de idiomas × `languages.ts` do addon, `Redactor`, formulário pelo celular, QR, validação de credenciais |

O `build.ps1` também roda os testes do app em todo build (`-Test` acrescenta os do addon), mas aí cada execução gera o APK: demora bem mais.

### O que os testes automatizados **não** cobrem

Só se verificam num aparelho (box ou celular, ver abaixo): `AddonService` e a supervisão do Node (códigos 75 e 78), `BootReceiver`, o `SecretStore` com o Keystore, a instalação e o ffmpeg/Node reais, e o comportamento do Stremio e dos players. A **conferência do tempo da tradução só foi validada com Real-Debrid**.

### Testes na box ou no celular

Opcional, exige um aparelho Android na mesma rede com **Depuração USB/rede** ligada (Opções do desenvolvedor) e as credenciais no `.env` (`OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USER`, `OPENSUBTITLES_PASSWORD`; opcionais `RD_TOKEN` e `DEEPL_API_KEY`). Fluxo:

```powershell
.\build.ps1 -WorkingTree -Prefill -DebugLog -Test                              # Windows: APK de teste, NUNCA distribua
```

```sh
WORKING_TREE=1 PREFILL=1 DEBUG_LOG=1 RUN_TESTS=1 sh build.sh                   # Mac/Linux (ou Git Bash)
```

Depois, no Git Bash (Windows), Mac ou Linux (o adb roda dentro do container, nada a instalar):

```sh
export BOX=<IP do aparelho>
sh scripts/adb.sh install -r /out/rightsubs-<versão>-armeabi-v7a-debuglog-prefill.apk   # arm64-v8a na Shield/celulares
sh scripts/adb.sh shell pm clear com.rightsubs.android      # aplica as credenciais do .env
sh scripts/adb.sh shell am start -n com.rightsubs.android/.MainActivity
```

Na primeira vez a TV pede para autorizar o adb ("Sempre permitir"). O adb roda dentro do container, sem nada a instalar. Para ver o log e o `/health`, medir a extração e os filmes de referência (Drive, Halloween, Valkyrie, Enter the Void), veja [.claude/skills/box/SKILL.md](.claude/skills/box/SKILL.md) e [rightsubs/docs/DESCOBERTAS.md](rightsubs/docs/DESCOBERTAS.md). **Desligue a depuração ao terminar.** Antes de qualquer commit ou distribuição, siga a skill `release-check`.

## Instalar na TV

**Antes, prepare** uma conta gratuita na OpenSubtitles (opensubtitles.com): perfil → **API consumers** → **New consumer** (nome `RightSubs`, marque **Allow anonymous downloads**) e anote a **API key**, o **nome de usuário** (não o e-mail: com e-mail o login é recusado) e a senha. Real-Debrid é opcional: token em real-debrid.com/apitoken. O DeepL também: uma chave gratuita em deepl.com (Conta › Chaves de API, termina em `:fx`; 500 mil caracteres por mês) permite traduzir uma legenda quando não existe nenhuma em português.

1. **Se o RightSubs antigo, do Termux, estiver instalado na box, remova antes** (no Termux: `sh ~/right-subs/scripts/uninstall-termux.sh`): os dois usariam a porta 7000.
2. Copie o APK para a TV: pelo app **Downloader** (servindo `out/` na rede, por exemplo `npx serve out`), por pendrive ou `adb install out/rightsubs-…-armeabi-v7a.apk`. Permita "instalar apps desconhecidos" para o app usado.
3. Abra o **RightSubs** e preencha as credenciais. Mais fácil: toque em **Preencher pelo celular**, aponte a câmera do celular (na mesma rede Wi-Fi) para o QR e preencha ou cole os valores no navegador. Também dá para usar o teclado do app Google TV (controle remoto › teclado). **Sem Real-Debrid, deixe o token em branco:** torrents tocados pelo próprio Stremio também são achados (fps real; sem a legenda embutida como referência).
4. Instale o addon no Stremio. **Na TV:** no Stremio, abra **Addons › Add addon** e digite `http://127.0.0.1:7000/manifest.json` (com `http`, não `https`; o botão **Instalar no Stremio** mostra esse lembrete). O controle não consegue colar: para não digitar letra por letra, use o teclado do app **Google TV** no celular (controle remoto › teclado), que aceita colar. **No celular:** o botão abre o Stremio Web no navegador com o addon pronto para instalar. Um link `stremio://` não serve, porque o Stremio troca `stremio://` por `https://` e o addon só responde em `http` (conferido na NVIDIA Shield, Stremio 1.12.0). Não é preciso desinstalar nada: Torrentio/Sootio e os addons de legenda (OpenSubtitles v3 etc.) continuam instalados, e a faixa do RightSubs aparece junto com as deles. Em outros aparelhos da mesma conta do Stremio, o RightSubs (que só existe neste aparelho) não responde e os outros addons seguem funcionando.
5. Em **Idiomas da legenda**, escolha a principal e a secundária, que são as legendas que você assiste (padrão: Português do Brasil e de Portugal), e a **referência para sincronizar** (padrão: inglês). A referência nunca aparece na tela: legendas nesse idioma feitas para o arquivo exato servem para acertar o tempo, e a faixa embutida nesse idioma é a preferida. A troca vale na hora (o addon reinicia). No Stremio, deixe o idioma de legenda igual à principal, para ele escolher a faixa do RightSubs sozinho.

O serviço inicia sozinho quando a box liga e depois de cada atualização do app. A notificação "Addon ativo" é o que impede o Android de encerrá-lo.

## Como a legenda é escolhida e sincronizada

**Antes de tudo, o RightSubs olha o próprio arquivo.** Se o vídeo já tem uma faixa de legenda no seu idioma principal (ou, depois, no secundário), ele não busca nem baixa nada, não lê o vídeo e não usa o DeepL: oferece só uma entrada no menu de legendas dizendo que o vídeo já tem legenda embutida no seu idioma. Escolha a faixa do próprio arquivo no menu. (Faixas "forçadas" não contam, e faixas só em outros idiomas também não.) Isso poupa banda do Real-Debrid, a cota do OpenSubtitles e a do DeepL.

Sem essa faixa no arquivo, o RightSubs oferece ao Stremio **uma** faixa no idioma principal (sem nenhuma legenda nele, no secundário). Para escolher, compara cada legenda com o arquivo que está tocando: hash, nome do release, **edição** (DC, Extended, Uncut, Unrated, Theatrical, IMAX), grupo, origem (BluRay/WEB/HDTV/DVD), resolução e fps.

Se a legenda foi feita para outro release, ele acerta o tempo (deslocamento e fps) contra uma referência. Para na primeira opção que existir:

| # | Referência | No log (`subtitles.served`) |
|---|---|---|
| 1 | legenda do OpenSubtitles feita para **este arquivo**, em qualquer idioma buscado; a de outra edição não conta | `synced` / `already_synced` |
| 2 | nenhuma: a legenda é da mesma edição, origem e resolução, então provavelmente já bate; o vídeo não é lido | `likely_synced` |
| 3 | legenda **embutida** no arquivo (texto, preferindo o idioma de referência), lida em 3 trechos de 45 s; o prazo cresce com o tamanho do arquivo | `synced` / `already_synced` |
| 4 | legenda de **outro release da mesma edição**, origem e resolução | `synced` (`referenceMatch: same_edit`) |
| 5 | nenhuma: corrige só o fps, pelo valor real do arquivo | `fps_corrected` / `no_reference` |

**Limpeza do texto:** toda legenda entregue, de qualquer origem, passa por uma limpeza que remove notas musicais (♪ ♫ ♬… e a forma corrompida `â™ª`), caracteres inválidos ou invisíveis, `#` usado como marca de música e restos de códigos ASS (`{\an8}`, `\N`). Sem isso, a TV desenha quadradinhos nas músicas.

O arquivo que está tocando é achado pelo Real-Debrid. Num torrent sem Real-Debrid, é achado pelo servidor local do Stremio: aí só o fps é lido, sem a embutida, porque ler trechos do torrent rouba banda do vídeo.

**Limitações conhecidas:**
- Sem nenhuma referência em texto, a legenda sai como baixada (`no_reference`). Isso vale mesmo se o fps informado pelo OpenSubtitles estiver errado ou se a edição tiver outro nome (ex.: "Extended" = "DC"). Só a sincronização pelo áudio, ainda não feita, resolveria.
- O secundário só entra quando **não existe nenhuma** legenda no principal; uma PT-BR fora de sincronia não troca para PT-PT.

### Sem legenda em português: tradução pelo DeepL (opcional)

Com a chave do DeepL, se não existir nenhuma legenda em português (nem no secundário), o RightSubs traduz uma legenda de **qualquer idioma** do OpenSubtitles para o idioma principal. Ele só traduz uma legenda cujo tempo a faixa embutida no arquivo confirma (lê 6 trechos curtos, nunca o filme todo): legendas feitas para outro corte do filme, mesmo em inglês, são recusadas. A traduzida mostra "[Legenda traduzida por IA (DeepL)]" e usa o estilo de legenda do seu Stremio.

**O que depende do Real-Debrid:** a tradução em si não, mas **conferir o tempo da legenda** sim, porque o RightSubs precisa ler alguns trechos do vídeo e só consegue o link do arquivo pelo Real-Debrid.

| Como você assiste | Conferência do tempo | O que a tradução faz |
|---|---|---|
| **Real-Debrid** | sim | completa: escolhe a legenda certa entre os idiomas e acerta o tempo |
| **Torrent pelo próprio Stremio** (sem debrid) | não | legenda exata pelo hash: traduzida como está; **filme**: traduzido com "tempo não confirmado"; **série**: nada |
| **Outro debrid** (AllDebrid, Premiumize, TorBox…) ou link direto | não | só a legenda exata pelo hash |

Só o caso do Real-Debrid foi testado de verdade; os outros são o que o código faz.

**Filmes sem legenda embutida para conferir o tempo** também são traduzidos, desde que o fps da legenda seja o do arquivo, mas a legenda mostra "tempo não confirmado" e pode sair adiantada ou atrasada. Séries (episódios têm cortes e anúncios) não.

**Na primeira vez de um filme ou episódio** a tradução leva de 20 a 60 s, mais do que os 10 s que o Stremio espera. O vídeo abre com uma legenda provisória pedindo para **sair e abrir de novo em cerca de 30 s**; a tradução termina em segundo plano e, da segunda vez em diante, sai na hora.

Casos reais medidos e o porquê de cada regra: [rightsubs/docs/DESCOBERTAS.md](rightsubs/docs/DESCOBERTAS.md); todas as opções: [rightsubs/docs/CONFIGURACAO.md](rightsubs/docs/CONFIGURACAO.md); a tradução pelo DeepL em detalhe: [rightsubs/docs/TRADUCAO-DEEPL.md](rightsubs/docs/TRADUCAO-DEEPL.md).

## Atualizar

Instale o APK novo por cima do antigo. As credenciais continuam (mesma chave de assinatura).

## Versões

A versão do APK fica no arquivo [VERSION](VERSION) (`X.Y.Z`) e o que mudou em cada uma no [CHANGELOG.md](CHANGELOG.md). Cada versão é um commit "Versão X.Y.Z" com a tag `vX.Y.Z`. O addon em `rightsubs/` recebe a mesma versão no build (é a que o app mostra na linha de status e o Stremio no manifesto), e o build confere que o APK e o addon dizem o mesmo número.

| Mudou | Sobe | Exemplo |
|---|---|---|
| só correções | o último número | X.Y.Z → X.Y.(Z+1) |
| funcionalidade nova | o do meio (e zera o último) | X.Y.Z → X.(Y+1).0 |
| quem atualiza precisa desinstalar ou digitar as credenciais de novo | o primeiro | X.Y.Z → (X+1).0.0 |

Durante o trabalho, anote cada mudança em `[Não lançado]` no `CHANGELOG.md`. Para lançar:

1. **Atualize a versão:** escreva o número novo no `VERSION`. No `CHANGELOG.md`, renomeie `[Não lançado]` para `[X.Y.Z] — AAAA-MM-DD` e crie um `[Não lançado]` vazio acima.
2. **Commite:**
   ```powershell
   git add VERSION CHANGELOG.md        # e o resto que fizer parte da versão
   git commit -m "Versão X.Y.Z"
   ```
3. **Gere o APK:** `.\build.ps1 -Test`. Confira o `out\BUILD-INFO.txt`: a versão certa e o commit sem `+alterações` (se tiver, falta commitar algo).
4. **Crie a tag:**
   ```powershell
   git tag -a vX.Y.Z -m "RightSubs APK X.Y.Z"
   git push origin main vX.Y.Z
   ```
5. **Distribua:** os APKs, o `SHA256SUMS.txt` e o `BUILD-INFO.txt` de `out\`.

Comandos úteis:

| Para | Comando |
|---|---|
| ver as versões | `git tag -n` |
| ver o que mudou entre duas versões | `git log vA.B.C..vX.Y.Z --oneline` |
| gerar uma versão antiga de novo | `git switch --detach vX.Y.Z`, depois `.\build.ps1` (o Node vem do Termux atual, então pode sair mais novo) |
| corrigir só uma versão antiga | `git switch -c correcao-X.Y.Z+1 vX.Y.Z`, depois os passos acima com o número seguinte |

Antes do push, uma tag errada se apaga com `git tag -d vX.Y.Z`. Depois do push, não mova a tag: lance a versão seguinte.

O `versionCode` interno do Android é automático: são os minutos desde 1970, então sempre cresce e qualquer build novo instala por cima do anterior.

## Limitações

- A **conferência do tempo** da tradução só existe com Real-Debrid; em torrent do Stremio ou em outros debrids a tradução é mais limitada (tabela em "Sem legenda em português").
- A tradução pelo DeepL usa a cota gratuita (~21 mil caracteres por episódio, de 500 mil por mês), só traduz uma série com faixa embutida em texto para conferir o tempo (um filme sem ela é traduzido com "tempo não confirmado") e, na primeira vez de cada episódio, pede para abrir o vídeo de novo.
- A tela configura só as credenciais e os idiomas; as demais opções (prazos, cache, sincronização) usam os padrões de `rightsubs/config.example.yaml`. O RightSubs só entrega legendas: os vídeos continuam vindo dos addons de streams instalados no Stremio (Torrentio, Sootio…).
- O ffmpeg tem só o necessário para o RightSubs atual. A sincronização pelo áudio (ainda não feita) vai precisar de decodificadores de áudio em [scripts/build-ffmpeg.sh](scripts/build-ffmpeg.sh).
- Node vem do repositório do Termux, que só mantém a versão mais recente: cada build pega a atual (o `out/BUILD-INFO.txt` registra qual).

## Estrutura

| Caminho | Conteúdo |
|---|---|
| [build.ps1](build.ps1), [build.sh](build.sh) | ponto de entrada no computador (Docker) |
| [test.ps1](test.ps1), [test.sh](test.sh) | só os testes unitários (addon + app), sem gerar o APK |
| [docker/Dockerfile](docker/Dockerfile) | ambiente de build e de testes |
| [scripts/container-build.sh](scripts/container-build.sh), [scripts/container-test.sh](scripts/container-test.sh) | etapas dentro do container (build / testes) |
| [scripts/termux-node.mjs](scripts/termux-node.mjs) | Node e bibliotecas do Termux → `jniLibs` |
| [scripts/build-ffmpeg.sh](scripts/build-ffmpeg.sh) | ffmpeg mínimo com o NDK |
| [scripts/build-payload.sh](scripts/build-payload.sh) | build do RightSubs → `rightsubs.zip` |
| [android/](android) | app Android |
| [scripts/adb.sh](scripts/adb.sh) | adb na box pela rede, de dentro do container (`BOX=<ip> sh scripts/adb.sh …`) |
| [scripts/box/extract-timing.sh](scripts/box/extract-timing.sh) | mede na box a extração de legenda embutida (diagnóstico) |
| [rightsubs/](rightsubs/) | o addon (cópia própria do right-subs, que evolui aqui; instruções dele em [rightsubs/CLAUDE.md](rightsubs/CLAUDE.md)) |
| [VERSION](VERSION), [CHANGELOG.md](CHANGELOG.md) | versão do APK e o que mudou em cada uma |
| [.claude/skills/](.claude/skills) | procedimentos para o Claude: `testes`, `build-apk`, `box`, `release-check`, `new-version` |

## Créditos e licenças

- **Fonte:** o app usa a [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) (Tokotype), licença **SIL Open Font License 1.1**, que permite embutir e redistribuir. O arquivo é o mesmo que o Stremio usa no app web (`android/app/src/main/res/font/plus_jakarta_sans.ttf`).
- **Cores:** o visual segue a paleta pública do app web do Stremio. O RightSubs é um projeto independente, **sem vínculo com o Stremio**.
