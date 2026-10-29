# Instalação na box (Chromecast com Google TV 4K)

Tempo estimado: 30–40 min na primeira vez. Depois disso, atualizações levam 1 comando.

Você vai precisar de:
- A box ligada na TV
- O **app Google TV no celular** (serve de teclado para digitar na TV)
- Um computador na mesma rede da box (Mac, Linux, ou Windows com WSL/Git Bash)

## 1. Liberar instalação de apps fora da Play Store

1. Na box: **Configurações → Sistema → Sobre** → clique 7 vezes em **Build do Android TV OS** até aparecer "Você é um desenvolvedor".
2. Na Play Store da box, instale o app **Downloader** (AFTVnews).
3. **Configurações → Apps → Segurança e restrições → Fontes desconhecidas** → habilite o **Downloader**.

### 1.1 Desativar a restrição de processos filhos (Android 12 ou mais novo)

A partir do Android 12, o sistema mata processos em segundo plano criados por apps (o *phantom process killer*). O Node e o `sshd` do Termux entram nessa conta, e o addon sumiria sozinho depois de algumas horas. Veja a versão em **Configurações → Sistema → Sobre → Versão do Android TV OS**.

No Android TV a opção não aparece nas Opções do desenvolvedor; use o ADB pelo computador:

1. **Opções do desenvolvedor** (ativadas no passo 1 acima) → **Depuração USB** → ativar. (A *Depuração por Wi-Fi* não é necessária e só liga com a box no Wi-Fi; a Depuração USB já libera o ADB pela rede, inclusive com a box no cabo.)
2. Anote o IP da box: **Configurações → Rede e Internet** → sua conexão.
3. No computador (no Mac: `brew install android-platform-tools`; no Windows/Linux: instale o *Android SDK Platform-Tools*):

   ```sh
   adb connect 192.168.0.50      # aceite "Permitir depuração?" na TV
   adb devices                   # deve mostrar "device" (não "unauthorized")
   ```

   > "failed to authenticate" na primeira tentativa é normal: o pedido ainda estava aberto na TV. Aceite e rode `adb connect` de novo.

4. Desative a restrição e confira:

   ```sh
   # Android 12L, 13, 14 ou mais novo
   adb shell settings put global settings_enable_monitor_phantom_procs false
   adb shell settings get global settings_enable_monitor_phantom_procs   # deve responder: false

   # Somente Android 12
   adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent; /system/bin/device_config put activity_manager max_phantom_processes 2147483647"
   ```

5. `adb disconnect` e **desative a Depuração USB** (deixá-la ligada abre uma porta na rede).

A configuração sobrevive a reinicializações, mas pode voltar ao padrão em atualizações do Android TV — confira de novo depois de cada uma.

> Não altere "Limite de processos em segundo plano" nem "Não manter atividades": ambos fazem o Android encerrar o Termux com mais frequência.

## 2. Instalar Termux e Termux:Boot

Use **as duas do F-Droid** (versões de lojas diferentes não conversam entre si; a versão da Play Store do Termux está desatualizada).

No Downloader, digite (dá para copiar e colar pelo app Google TV no celular) e instale cada APK:
- Termux (versão estável, ~114 MB): `https://f-droid.org/repo/com.termux_1002.apk`
- Termux:Boot: `https://f-droid.org/repo/com.termux.boot_1000.apk`

> Links da versão estável de 2026-10. Se um deles der erro, use a página do app (`https://f-droid.org/packages/com.termux/` e `…/com.termux.boot/`) → **Download APK** da versão mais recente que **não** seja beta.

Depois de instalar:
1. Abra o **Termux:Boot** uma vez (só abrir e fechar — isso ativa a inicialização automática).
2. Abra o **Termux**. Se não aparecer na tela inicial: **Configurações → Apps → Ver todos os apps → Termux → Abrir**.

> Se a box tiver a opção **Configurações → Apps → Termux → Bateria/otimização**, desative a otimização para o Termux.

## 3. Habilitar acesso pelo computador (SSH)

No Termux, na TV (digite pelo teclado do app Google TV no celular):

```sh
pkg update -y && pkg install -y openssh rsync
passwd          # defina uma senha para o SSH
sshd
# anote o IP da box: Configurações → Rede e Internet → sua conexão (ex.: 192.168.0.50)
uname -m        # anote a arquitetura (aarch64 ou armv7l/armv8l)
```

No computador (Mac, Linux, ou Windows com WSL/Git Bash), teste:

```sh
ssh -p 8022 192.168.0.50
```

Na primeira vez ele pergunta *"Are you sure you want to continue connecting?"*: responda `yes` por extenso (só Enter cancela). A senha é a do `passwd`; o nome de usuário não importa. Quando aparecer o prompt do Termux (`~ $`), deu certo — daqui em diante tudo pode ser feito pelo terminal do computador.

> O `sshd` não volta sozinho depois de reiniciar a box (de propósito). Para acessar de novo: abra o Termux na TV e digite `sshd` (não aparece nada; é normal).

## 4. Copiar e instalar o RightSubs

No computador, dentro da pasta do projeto (troque `192.168.0.50` pelo IP da box):

```sh
rsync -az --exclude node_modules --exclude dist --exclude .git --exclude config.yaml --exclude .env \
  -e "ssh -p 8022" ./ 192.168.0.50:right-subs/
ssh -p 8022 192.168.0.50 'sh right-subs/scripts/install-termux.sh'
```

> Quando o projeto estiver no GitHub, o passo acima vira `git clone <repo> right-subs` dentro do Termux.

O instalador:
- atualiza os pacotes do Termux e instala Node.js, ffmpeg e utilitários;
- compila o RightSubs e remove o compilador;
- cria `config.yaml` e `.env` a partir dos exemplos;
- registra a inicialização automática no boot;
- valida a configuração e inicia o serviço.

> Dica: para não digitar a senha do SSH a cada comando, rode no computador `ssh-keygen -t ed25519` (se ainda não tiver chave) e `ssh-copy-id -p 8022 192.168.0.50`.

## 5. Preencher credenciais e indexadores

```sh
ssh -p 8022 192.168.0.50
nano ~/right-subs/.env
```

| Variável | De onde vem |
|---|---|
| `OPENSUBTITLES_API_KEY` | Conta **gratuita** em opensubtitles.com → perfil → **API consumers** → **New consumer** (marque "Allow anonymous downloads"). |
| `OPENSUBTITLES_USER` | O **nome de usuário** da conta — **não o e-mail** (com e-mail o login é recusado). |
| `OPENSUBTITLES_PASSWORD` | A senha da conta. |
| `TORRENTIO_URL` | Torrentio configurado com o seu Real-Debrid: em torrentio.strem.fun/configure, copie a URL do manifest (termina em `/manifest.json`). |
| `SOOTIO_URL` | A URL do manifest do seu Sootio (termina em `/manifest.json`). |

As URLs dos indexadores contêm a sua chave do Real-Debrid: **nunca compartilhe o `.env`**. Salve com `Ctrl+O`, `Enter`, saia com `Ctrl+X`.

Depois, ligue os indexadores no `config.yaml` (`nano ~/right-subs/config.yaml`): em `streams.indexers`, mude `enabled: false` para `enabled: true` em cada um que você preencheu. Quem usa só um dos dois deixa o outro com `enabled: false`.

```sh
cd ~/right-subs
npm run check-config        # deve listar os provedores e indexadores como "habilitado"
sh scripts/rightsubs.sh restart
```

## 6. Instalar no Stremio e remover os outros addons

No Stremio da TV: **Addons** → campo de busca/URL → digite (pelo teclado do celular):

```
http://127.0.0.1:7000/manifest.json
```

→ **Instalar**. Depois, **desinstale**:

- **Torrentio e Sootio** (e qualquer outro indexador que você ligou no `config.yaml`): os streams deles passam a vir pelo RightSubs, com a mesma lista; instalados, cada stream apareceria duas vezes.
- **OpenSubtitles v3 e outros addons de legenda**: o RightSubs já busca neles por conta própria. Instalados, o Stremio escolhe a faixa deles e a legenda sincronizada do RightSubs é ignorada.

Em **Configurações → Player** do Stremio, deixe a legenda padrão em **Português (Brasil)** (o idioma `primary` do `config.yaml`).

**Anime:** títulos abertos pelo catálogo padrão já recebem legenda. Para usar o catálogo **Anime Kitsu** (melhor organização de episódios), instale-o **depois** do RightSubs: o RightSubs converte os ids do Kitsu para os do IMDb (inclusive a numeração absoluta de episódios). O Anime Kitsu também oferece legendas (do OpenSubtitles v3) e não dá para desligar só essa parte; como o Stremio prefere a faixa do addon instalado primeiro, a ordem importa. Se a faixa do RightSubs deixar de vir selecionada em anime, desinstale o Anime Kitsu e instale-o de novo (ficando depois do RightSubs).

> ### ⚠️ Usa o Stremio em outros aparelhos com a mesma conta?
>
> A lista de addons do Stremio é **da conta**, não do aparelho. Ao instalar o RightSubs e remover o Torrentio/Sootio/OpenSubtitles na TV, a mudança vale também para o celular, o computador e outras TVs dessa conta. Só que o endereço `127.0.0.1` existe **apenas dentro da box**: nos outros aparelhos o RightSubs não responde, e eles ficam **sem streams e sem legendas**.
>
> Opções:
> - **Uma conta do Stremio só para a TV** (recomendado): a box usa a conta nova, com o RightSubs; os outros aparelhos continuam na conta de sempre, com Torrentio/Sootio/OpenSubtitles.
> - Usar o Stremio só na TV.
>
> Instalar o RightSubs com o IP da box na rede (em vez de `127.0.0.1`) **não é uma boa saída**: exigiria abrir o serviço para a rede da casa (`server.host`), só funcionaria em casa e deixaria os outros aparelhos dependendo da box ligada.

> Se um dia o RightSubs for atualizado e passar a oferecer algo novo (como aconteceu com os streams), **desinstale e instale de novo** pelo mesmo endereço: o Stremio guarda a lista de recursos de quando o addon foi instalado.

## 7. Teste de funcionamento

| # | Teste | Como verificar | Esperado |
|---|---|---|---|
| 1 | Node e ffmpeg | `npm run check-config` | `ffmpeg` e `ffprobe` com versão (não "NÃO encontrado") |
| 2 | Streams | Abra um filme no Stremio | A lista de streams aparece como antes, com os nomes do Torrentio/Sootio |
| 3 | Legenda | Dê play | Faixa **RightSubs** selecionada sozinha, em PT-BR, sincronizada |
| 4 | Como a legenda foi escolhida | `sh scripts/rightsubs.sh logs` (ou `grep subtitles.served ~/.rightsubs/logs/rightsubs.log`) | Linha `subtitles.served` com `"sync":{"status":…}` (ver tabela abaixo) |
| 5 | Volta sozinho após reiniciar | Reinicie a box (Configurações → Sistema → Reiniciar), espere 2 min, abra o Termux, `sshd`, depois `sh scripts/rightsubs.sh status` | "RightSubs rodando" + JSON do `/health` |
| 6 | Consumo ocioso | Feche o Stremio, espere 15 min, `sh scripts/rightsubs.sh status` | `"state":"idle"` e `rssMB` em torno de 50–60 |
| 7 | Erro de config é claro | Troque `primary: pt-BR` por `primary: pt-BRR`, rode `npm run check-config`, depois desfaça | Mensagem apontando `languages.primary` com exemplos válidos |

Status de sincronização (`subtitles.served` → `sync.status`, e a contagem em `/health` → `subtitles.served`):

| Status | Significado |
|---|---|
| `exact` | A legenda foi feita para este arquivo (mesmo hash ou mesmo release). |
| `synced` | Era de outro release; foi alinhada a uma legenda deste arquivo (`offsetMs`, `scale`, `confidence`). |
| `already_synced` | Era de outro release, mas a comparação mostrou que já estava no tempo certo. |
| `likely_synced` | Era de outro release, mas da mesma origem e resolução (ex.: BluRay 2160p para um BluRay 2160p): entregue sem conferir. |
| `fps_corrected` | Sem referência, mas o fps da legenda era diferente do fps real do arquivo: corrigido. |
| `no_reference` | Nada para comparar: entregue como baixada (pode estar fora de sincronia). |
| `low_confidence` | A comparação não foi conclusiva: entregue como baixada. |

`no_reference` e `low_confidence` frequentes indicam que vale implementar a sincronização avançada (embutida/áudio). O `/health` guarda os últimos 10 em `subtitles.recentUnsynced`.

## Comandos do dia a dia

Dentro de `~/right-subs`:

| Comando | O que faz |
|---|---|
| `sh scripts/rightsubs.sh status` | Mostra se está rodando + `/health` |
| `sh scripts/rightsubs.sh logs` | Acompanha os logs (`Ctrl+C` para sair) |
| `sh scripts/rightsubs.sh restart` | Reinicia (depois de editar `config.yaml`/`.env`) |
| `sh scripts/rightsubs.sh stop` / `start` | Para / inicia |
| `npm run check-config` | Valida a configuração sem iniciar |

Atualizar a partir do computador (compila lá, copia e reinicia; não toca em `config.yaml` nem `.env`):

```sh
BOX=192.168.0.50 sh scripts/deploy-from-mac.sh
```

Se a nova versão mudou opções do `config.yaml`, compare o seu com `config.example.yaml` e rode `npm run check-config` na box.

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Serviço some depois de um tempo | Android encerrou o Termux | Confirme que a notificação do Termux mostra "wake lock held"; desative otimização de bateria se a opção existir |
| Serviço some depois de horas, mesmo com wake lock | Restrição de processos filhos do Android 12+ (voltou após atualização do sistema?) | Refaça o §1.1 e confira se o `get` responde `false` |
| Não volta após reiniciar | Termux:Boot nunca foi aberto, ou instalado de outra loja | Abra o Termux:Boot uma vez; reinstale ambos do F-Droid |
| `ssh: connection refused` | `sshd` não está rodando (não sobe sozinho após reiniciar a box) | Abra o Termux na TV e rode `sshd` |
| Stremio não instala o addon | Serviço parado ou porta diferente | `sh scripts/rightsubs.sh status`; confira `server.port` |
| Serviço não inicia, log diz "invalid config" | Erro em `config.yaml`/`.env` | `npm run check-config` mostra o que corrigir |
| Legenda do RightSubs não vem selecionada | Outro addon de legendas instalado (ex.: OpenSubtitles v3) | Desinstale os outros addons de legenda (§6) |
| Cada stream aparece duas vezes | Torrentio/Sootio ainda instalados no Stremio | Desinstale-os (§6) |
| Sem streams (só legendas) | RightSubs instalado antes de ligar os indexadores, ou indexador desligado | Confira `enabled: true` em `streams.indexers` e reinstale o RightSubs no Stremio |
| Outros aparelhos ficaram sem streams/legendas | A lista de addons é da conta do Stremio | Ver o aviso no §6 |
| `opensubtitles.login_failed` no log | E-mail no lugar do nome de usuário, ou senha errada | Corrija `OPENSUBTITLES_USER`/`OPENSUBTITLES_PASSWORD` no `.env` e reinicie |
| Depois de atualizar, "opção desconhecida: upstream" | `config.yaml` de uma versão antiga | Troque o bloco `streams` pelo de `config.example.yaml` |

Logs ficam em `~/.rightsubs/logs/rightsubs.log` (rotação automática a cada 2 MB, no máximo 4 MB).

## Desinstalar

```sh
cd ~/right-subs
sh scripts/uninstall-termux.sh          # para o serviço; remove boot, cache e logs
sh scripts/uninstall-termux.sh --all    # idem + a pasta do projeto (config.yaml e .env inclusos)
```

Depois, remova o addon no Stremio (Addons → RightSubs → Desinstalar).
