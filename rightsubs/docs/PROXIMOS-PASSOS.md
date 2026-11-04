# Próximos passos

> Situação em 2026-11-01: o addon roda dentro do APK (box Xiaomi e celular), no modo complemento (Torrentio/Sootio instalados direto no Stremio; o RightSubs acha o arquivo pelo Real-Debrid ou pelo servidor local do Stremio). Evidências: [DESCOBERTAS.md](DESCOBERTAS.md). Box, build e instalação: `README.md` e `CLAUDE.md` da raiz.

Quando um título vier **dessincronizado**: anote qual foi (filme/episódio e, se der, o arquivo escolhido) e traga para análise — o log tem o resto (APK `-debuglog` na box: skill `box`).

## Perguntas ainda em aberto

| # | Pergunta | Onde está |
|---|---|---|
| 3 | Embutida no idioma principal × faixa do addon: qual o Stremio escolhe? | Visto uma vez: a embutida PT-BR venceu (Ted Lasso). [DESCOBERTAS.md](DESCOBERTAS.md) |
| 4 | Quanto tempo o player espera pelo `.srt`? | EXO esperou ≥ 34 s (Drive); limite desconhecido |

## Adiado até haver necessidade

| Item | Gatilho | Ponto de partida |
|---|---|---|
| **Sincronização pelo áudio** | Títulos com `no_reference`/`low_confidence` sem nenhuma referência em texto | Primeiro caso real: Enter the Void r00t "Extended" 24 fps (só PGS, fps declarado errado; esperado ×0,999, ~+0,5 s — `DESCOBERTAS.md`). O ffmpeg do APK precisará de decodificadores de áudio. Gabarito: Valkyrie/Licdom = +25,5 s |
| Leitura da embutida 4× mais lenta com a faixa de legenda | Arquivos pesados demorando para sincronizar | Mesmo trecho: 9,7 s só áudio × 41–44 s com a legenda; causa interna do ffmpeg não descoberta (Drive, `DESCOBERTAS.md`) |
| **Secundário também quando o principal falha** (hoje só quando não existe nenhuma no principal) | Um título com PT-BR fora de sincronia (ou impossível de baixar) e PT-PT disponível | `chooseLanguage`/`#prepare` em `src/subtitles/service.ts`; aplicar `useSecondaryWhen: low_confidence` (já aceito na config, sem efeito). Decidir antes: PT-PT sincronizada × PT-BR sem conferir. `CONFIGURACAO.md` (`languages`) |
| **Tradução automática (DeepL) — FEITA e validada na box em 2026-11-03** | Sem legenda no principal nem no secundário | Ver [TRADUCAO-DEEPL.md](TRADUCAO-DEEPL.md). **Em aberto, nada pedido:** (1) arquivos pesados (23,6 GB): 6 trechos podem estourar o teto de 120 s e cair no caminho sem conferência; (2) a entrada "RightSubs: legenda em preparo" no menu de legendas não foi vista na tela; (3) `<font color>` em legendas entregues **sem** tradução ignora o estilo do Stremio (remover?); (4) sincronizar o inglês em degraus por segmentos (exigiria a faixa embutida inteira: fora de escopo); (5) a mensagem provisória diz "cerca de 30 s", curto para arquivos pesados (Cat's Eyes 2160p: 45 s; o usuário recebeu a provisória duas vezes): avaliar "cerca de 1 minuto"; (6) filmes traduzidos **sem conferir o tempo** (decisão do usuário): uma checagem barata de duração (última fala × duração do filme) pegaria cortes grosseiros; (7) medir o limite exato de espera do Stremio (entre 5,9 s e 12,8 s desde o 1º pedido) e, se for o caso, expor `translationWaitMs`; (8) **fontes sem Real-Debrid não testadas** (torrent do Stremio, outros debrids): tabela em TRADUCAO-DEEPL.md; suportar outro debrid exigiria uma `FileSource` por serviço. **Fora de escopo por decisão do usuário:** traduzir a faixa embutida inteira |
| Fontes extras de legenda (SubDL, SubSource) | PT-BR faltando no OpenSubtitles | [NOVO-PROVEDOR.md](NOVO-PROVEDOR.md) |
| Consumer da OpenSubtitles: desmarcar **Under dev** | Quando for conveniente | Não afeta, pois o login é usado |
| **Enviar legendas corrigidas para a OpenSubtitles** | A API REST passar a permitir envio (a XML-RPC foi desligada para terceiros no início de 2026) | Só legendas `synced` com confiança alta e **confirmadas pelo usuário**; enviar com o nome e o hash do arquivo; creditar o tradutor e o release original. Manual não compensa (decisão de 2026-10-29) |

## Compartilhar com amigos

O APK já cobre o essencial (credenciais na tela ou pelo celular, torrent sem Real-Debrid). O que cada amigo precisa saber está no README da raiz; pontos a lembrar:

1. **A lista de addons do Stremio é da conta.** O RightSubs (`127.0.0.1`) só responde no aparelho onde o APK está; em outros aparelhos da mesma conta ele não traz legenda. Os outros addons de legenda podem continuar instalados (todos os testes no APK foram assim) e seguem servindo esses aparelhos.
2. Cada um usa as **próprias** contas: OpenSubtitles (gratuita — usuário, não e-mail) e, se tiver, Real-Debrid.
3. Antes de compartilhar o repositório, **revisar dados pessoais**: o `DESCOBERTAS.md` tem nomes de arquivos assistidos.
