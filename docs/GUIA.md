# RightSubs — comece aqui

O RightSubs é um addon do Stremio que roda **dentro da sua box de TV** e cuida da legenda por você: dá play, e a legenda em português (ou em inglês, se não houver em português) já vem **selecionada e sincronizada**, sem escolher faixa nem ajustar atraso.

Este guia diz se ele serve para você, o que preparar e em que ordem instalar. Os comandos detalhados de cada passo estão em [INSTALACAO-BOX.md](INSTALACAO-BOX.md) — este guia aponta a seção certa.

---

## 1. Serve para mim?

Você precisa de **tudo** isto:

| Requisito | Observação |
|---|---|
| Uma box **Android TV / Google TV** | Testado no **Chromecast com Google TV 4K** (Android TV 14). Outras boxes Android TV devem funcionar, mas alguns menus mudam de nome. Não funciona em TV com Tizen (Samsung), webOS (LG) ou Apple TV. |
| **Stremio** instalado na box | |
| **Real-Debrid** (assinatura paga) | O RightSubs não substitui o Real-Debrid: os vídeos continuam vindo dele. |
| **Torrentio** e/ou **Sootio** configurados com o **seu** Real-Debrid | São os indexadores que você já usa no Stremio. |
| Um **computador** na mesma rede da box | Mac, Linux, ou Windows com WSL. Só para instalar e atualizar; depois não precisa ficar ligado. |
| Cerca de **1 hora** na primeira instalação | Depois, atualizar leva um comando. |

O RightSubs é gratuito e não usa nenhum serviço pago além do Real-Debrid que você já tem.

---

## 2. Antes de começar: uma decisão importante

> **A lista de addons do Stremio é da sua conta, não do aparelho.**

Para o RightSubs funcionar, você vai **remover** do Stremio o Torrentio, o Sootio e os addons de legenda (o RightSubs passa a fazer o papel deles). Essa mudança vale para **todos os aparelhos** da conta. Só que o RightSubs roda dentro da box: no celular, no computador ou em outra TV ele não responde, e esses aparelhos ficam **sem vídeos e sem legendas**.

**Escolha uma opção:**

- **Você usa o Stremio em outros aparelhos → crie uma conta do Stremio só para a TV** (recomendado). Na box, entre com a conta nova e instale o RightSubs; os outros aparelhos continuam na conta de sempre, com tudo como está hoje. A conta nova não tem sua biblioteca nem seu histórico — se isso importar, avalie antes.
- **Você usa o Stremio só na TV →** pode usar sua conta atual.

---

## 3. O que preparar (contas e chaves)

Tudo isso é **seu**: não use as contas ou chaves de outra pessoa, e nunca compartilhe o arquivo `.env`, onde elas ficam.

1. **Conta gratuita na OpenSubtitles** (opensubtitles.com) — é de onde vêm as legendas.
   - Depois de entrar: perfil → **API consumers** → **New consumer**.
   - **Name:** algo como `RightSubs` (só letras e números).
   - Marque **Allow anonymous downloads**. Deixe **Under dev** desmarcado.
   - Anote a **API key** que aparecer.
   - Anote seu **nome de usuário** — o nome, **não o e-mail** (com e-mail o login é recusado).
2. **URL do manifest do Torrentio** já com o seu Real-Debrid: em torrentio.strem.fun/configure, configure como você gosta, e copie a URL do manifest (termina em `/manifest.json`).
3. **URL do manifest do Sootio** (se usar), também terminando em `/manifest.json`.

> As URLs do Torrentio e do Sootio contêm a **chave do seu Real-Debrid**. Trate-as como senha.

---

## 4. Instalação, passo a passo

Marque cada passo conforme for concluindo.

**Na TV**

- [ ] **Liberar apps de fora da Play Store** e instalar o app **Downloader** — [INSTALACAO-BOX.md §1](INSTALACAO-BOX.md#1-liberar-instalação-de-apps-fora-da-play-store).
- [ ] **Desativar a restrição de processos filhos** (Android 12 ou mais novo; sem isso o RightSubs some sozinho depois de algumas horas). Precisa do computador por alguns minutos — [§1.1](INSTALACAO-BOX.md#11-desativar-a-restrição-de-processos-filhos-android-12-ou-mais-novo).
- [ ] **Instalar Termux e Termux:Boot** pelos links diretos do F-Droid e abrir os dois uma vez — [§2](INSTALACAO-BOX.md#2-instalar-termux-e-termuxboot).
- [ ] **Ligar o acesso pelo computador (SSH)** e anotar o **IP da box** — [§3](INSTALACAO-BOX.md#3-habilitar-acesso-pelo-computador-ssh).

> Dica: use o **app Google TV no celular** como teclado — dá para copiar e colar os comandos.

**No computador**

- [ ] **Baixar o projeto.** Quem compartilhou o RightSubs com você precisa te dar acesso ao repositório no GitHub. Com o acesso:

  ```sh
  git clone git@github.com:ThiagoVieira01/right-subs.git
  cd right-subs
  ```

  (Sem `git`/SSH configurados no GitHub, baixe pelo botão **Code → Download ZIP** e descompacte.)

- [ ] **Copiar e instalar na box** — [§4](INSTALACAO-BOX.md#4-copiar-e-instalar-o-rightsubs). O instalador leva alguns minutos.
- [ ] **Preencher o `.env` e ligar os indexadores** com o que você preparou no passo 3 — [§5](INSTALACAO-BOX.md#5-preencher-credenciais-e-indexadores). Ao final, `npm run check-config` deve mostrar tudo como "habilitado".

**De volta à TV (no Stremio)**

- [ ] Entrar na conta escolhida no passo 2.
- [ ] **Instalar o RightSubs** pelo endereço `http://127.0.0.1:7000/manifest.json` — [§6](INSTALACAO-BOX.md#6-instalar-no-stremio-e-remover-os-outros-addons).
- [ ] **Desinstalar Torrentio, Sootio, OpenSubtitles v3** e qualquer outro addon de legendas.
- [ ] Em **Configurações → Player**, deixar a legenda padrão em **Português (Brasil)**.
- [ ] *(Opcional, para anime)* instalar o **Anime Kitsu** — **depois** do RightSubs (a ordem importa).

**Conferir**

- [ ] Abrir um filme: a lista de streams aparece como antes, com os nomes do Torrentio/Sootio.
- [ ] Dar play: a faixa **RightSubs** vem selecionada sozinha, em português e sincronizada.
- [ ] Reiniciar a box e repetir: o RightSubs volta sozinho.

O teste completo está em [§7](INSTALACAO-BOX.md#7-teste-de-funcionamento).

---

## 5. No dia a dia

Não há nada a fazer: dê play e assista. O RightSubs só trabalha quando o Stremio pede; parado, ocupa ~50 MB de memória e quase nada de CPU.

**Legenda veio fora de sincronia?** Anote o título (e, se der, o nome do arquivo que você escolheu na lista) e avise quem te passou o RightSubs — o log da box mostra o resto.

**Trocar os idiomas** (outro idioma principal ou secundário): arquivo `config.yaml` na box, seção `languages` — [CONFIGURACAO.md](CONFIGURACAO.md#languages). Depois ajuste também a legenda padrão no Stremio.

---

## 6. Atualizar

Quando houver uma versão nova, no computador, dentro da pasta do projeto (troque `192.168.0.50` pelo IP da sua box):

```sh
git pull
rsync -az --exclude node_modules --exclude dist --exclude .git --exclude config.yaml --exclude .env \
  -e "ssh -p 8022" ./ 192.168.0.50:right-subs/
ssh -p 8022 192.168.0.50 'cd right-subs && sh scripts/update.sh'
```

(Se você baixou pelo **Download ZIP**, em vez do `git pull` baixe o ZIP novo e descompacte por cima da pasta, mantendo seu `config.yaml` e `.env`.)

Isso não mexe no seu `config.yaml` nem no seu `.env`. Se a versão nova trouxer opções novas, compare o seu `config.yaml` com o `config.example.yaml` e rode `npm run check-config` na box.

> Para acessar a box pelo computador depois de reiniciá-la: abra o Termux na TV e digite `sshd`.

Se o RightSubs passar a oferecer algo novo no Stremio, desinstale e instale o addon de novo pelo mesmo endereço.

---

## 7. Se algo der errado

A tabela de **problemas comuns** está em [INSTALACAO-BOX.md](INSTALACAO-BOX.md#problemas-comuns). Os mais frequentes:

| Sintoma | O que fazer |
|---|---|
| Outros aparelhos ficaram sem vídeos/legendas | Ver o passo 2 deste guia (conta só para a TV). |
| A legenda do RightSubs não vem selecionada | Sobrou algum addon de legendas no Stremio: desinstale. |
| Cada stream aparece duas vezes | Torrentio/Sootio ainda instalados: desinstale. |
| `login_failed` no log | Use o **nome de usuário** da OpenSubtitles, não o e-mail. |
| O RightSubs some depois de algumas horas | Refaça o passo da restrição de processos filhos ([§1.1](INSTALACAO-BOX.md#11-desativar-a-restrição-de-processos-filhos-android-12-ou-mais-novo)); atualizações do Android podem desfazê-lo. |

Para desinstalar tudo: [INSTALACAO-BOX.md → Desinstalar](INSTALACAO-BOX.md#desinstalar). Depois, reinstale no Stremio os addons que você removeu.
