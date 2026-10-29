# Próximos passos — onde paramos e como retomar

> Situação em 2026-10-29: **fases 0, 1, 2 e 3 aceitas e em uso na box.** O Stremio da TV tem só o RightSubs instalado (Torrentio e Sootio passam por ele). Detalhes de cada fase: [PLANO-DESENVOLVIMENTO.md](PLANO-DESENVOLVIMENTO.md); evidências: [DESCOBERTAS.md](DESCOBERTAS.md).

## 1. Retomar com o Claude

Abra o Claude Code **dentro da pasta** do projeto (ele lê o `CLAUDE.md`, com o estado e as decisões) e diga, por exemplo:

> Confere o uso do RightSubs na box.

Antes, na TV: abra o Termux e digite `sshd` (o acesso pelo computador não volta sozinho depois de reiniciar a box).

O que o Claude confere:
- `/health` → `uptimeSeconds` (teste das 24 h da fase 0) e `subtitles` (como cada legenda foi sincronizada);
- `subtitles.recentUnsynced` e o log da box: quantas legendas saíram com `no_reference`/`low_confidence` — os casos que a fase 4 resolveria.

## 2. Pendências

| Item | Quando |
|---|---|
| Confirmar 24 h no ar (fase 0) | Na próxima vez que acessar a box |
| Consumer da OpenSubtitles: desmarcar **Under dev** | Quando for conveniente (o uso já é "produção"; não afeta, pois o login é usado) |
| Uma semana de uso sem intervenção (aceite da fase 5) | Uso normal |

## 3. Adiado até haver necessidade

| Item | Gatilho | Ponto de partida |
|---|---|---|
| **Fase 4 — sincronização avançada** | Títulos dessincronizados com `no_reference`/`low_confidence` | 1º: faixa de texto **embutida** como referência (comum: o Licdom tem eng/ita, o Matlock ETHEL tem eng SDH — ver `video.probed` no log); 2º: áudio. Gabarito para testar: Valkyrie/Licdom = +25,5 s |
| **Tradução automática** (DeepL Free) | Muitos títulos caindo no idioma secundário | [Plano §10](PLANO-DESENVOLVIMENTO.md) |
| Fontes extras de legenda (SubDL, SubSource) | PT-BR faltando no OpenSubtitles | Só `config.yaml` ([NOVO-PROVEDOR.md](NOVO-PROVEDOR.md)) |
| Espera pelo indexador mais lento | A lista de streams demorar a aparecer | Reduzir `timeoutMs` do indexador lento em `streams.indexers` |
| Fallback EN e faixa PT-BR embutida × RightSubs | Ocorrerem naturalmente | Conferir no log quando acontecer |
| **Enviar legendas corrigidas para a OpenSubtitles** (ajudar quem tem o mesmo arquivo) | A API REST passar a permitir envio — hoje parece só pelo site (a XML-RPC, que permitia, foi desligada para terceiros no início de 2026) | Só legendas `synced` com confiança alta e **confirmadas pelo usuário** depois de assistir; enviar com o nome e o hash do arquivo (é o que dá match exato para os outros); creditar o tradutor e o release original. Manual não compensa (decisão de 2026-10-29) |

Quando um título vier **dessincronizado**: anote qual foi (filme/episódio e, se der, o arquivo escolhido) e traga para análise — o log da box tem o resto.

## 4. Compartilhar com amigos (guia futuro)

O projeto vai ser compartilhado com amigos que usam o Stremio em **vários aparelhos**. O código não muda; o passo a passo para eles precisa deixar claro:

1. **A lista de addons do Stremio é da conta.** Instalar o RightSubs (`127.0.0.1`, só existe dentro da box) e remover Torrentio/Sootio/OpenSubtitles deixa os outros aparelhos da conta **sem streams e sem legendas**. Recomendação: **uma conta do Stremio só para a TV** com o RightSubs ([INSTALACAO-BOX.md §6](INSTALACAO-BOX.md#6-instalar-no-stremio-e-remover-os-outros-addons)).
2. Cada um precisa das **próprias** contas e chaves: OpenSubtitles (gratuita — usuário, não e-mail), Real-Debrid, e as URLs do Torrentio/Sootio configuradas com o próprio RD. Nunca compartilhar o `.env`.
3. A box precisa rodar Termux: o guia foi validado no **Chromecast com Google TV 4K (Android TV 14, 32 bits)**. Outras boxes Android TV devem funcionar, mas a desativação da restrição de processos filhos (§1.1) e o caminho das configurações podem mudar.
4. Instalação e atualização são feitas a partir de um computador (Mac, Linux ou Windows com WSL/Git Bash) pela rede de casa.
5. Antes de compartilhar o repositório, **revisar dados pessoais**: o `CLAUDE.md` tem o IP da box deste usuário e detalhes do ambiente; o `DESCOBERTAS.md` tem nomes de arquivos assistidos. Trocar por exemplos genéricos ou mover para um arquivo fora do git.

Base para o guia: [INSTALACAO-BOX.md](INSTALACAO-BOX.md) (já está genérico, com IP de exemplo `192.168.0.50`).
