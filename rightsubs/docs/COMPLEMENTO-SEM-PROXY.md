# RightSubs como complemento (sem desinstalar Torrentio, Sootio ou outros addons)

> **Histórico.** Escrito para a instalação antiga (Termux, deploy pelo computador). Hoje o addon roda dentro do APK (`README.md` da raiz); scripts e guias citados aqui foram removidos em 2026-11-01.

Contexto de uma conversa de 2026-10-30. Este é o assunto a seguir: **usar o RightSubs como um addon de legendas comum, ao lado dos addons que o usuário já tem**, sem que as listas de streams passem por ele.

## Objetivo do usuário

- Instalar o RightSubs como **complemento**: manter Torrentio e Sootio instalados direto no Stremio.
- Mais agilidade: não repetir o setup único da TV da sala (proxy de streams, um único usuário do Stremio).
- Aceita guardar as **próprias credenciais do RD** na box, na TV ou em outro dispositivo seu (nunca em serviço compartilhado).
- Preferência: **não ter que remover** os addons de OpenSubtitles e afins (ver "Coexistência" abaixo).

## Por que hoje o proxy existe

O Stremio não envia a URL do vídeo ao addon de legendas. Envia ID do título, nome do arquivo, `videoSize` e `videoHash` (hash do OpenSubtitles sobre os bytes, não o infohash do torrent). Só passando a lista de streams pelo RightSubs ele aprende "nome do arquivo → URL" (`src/streams/proxy.ts`).

A URL é necessária para duas funções que olham dentro do arquivo:

- **ffprobe** (`src/media/probe.ts`): fps real (`r_frame_rate`, só taxas padrão) e lista de faixas embutidas. Alimenta o ranking (±30) e a correção `fps_corrected`.
- **Referência embutida** (`src/sync/embedded-reference.ts`): 3 trechos de 45 s da faixa de texto embutida, usados como referência de sincronização quando o OpenSubtitles não tem legenda exata.

Sem URL, o ranking infere o fps das candidatas **exatas** (`videoFps()` em `src/subtitles/service.ts`), que é menos confiável, e não há referência embutida. A sincronização texto×texto contra legenda exata, o ranking por release e `likely_synced` continuam funcionando.

## Alternativas avaliadas para obter a URL

| Caminho | Mantém Torrentio/Sootio direto | Fps real e embutida | Credencial |
|---|---|---|---|
| Proxy (hoje) | Não | Sim | chave do RD só dentro das URLs |
| Consulta própria aos indexadores | Sim | Sim | URL do indexador (com chave) na config |
| **API do Real-Debrid (proposta)** | Sim | Sim | token do RD no `.env` do dispositivo |
| Modo leve (sem URL) | Sim | Não | nenhuma |

## Proposta: API do Real-Debrid

Quando o Torrentio resolve o stream, o RD registra o link em `/downloads` (com `filename`, `filesize` e o link direto). O RightSubs buscaria nessa lista o arquivo com o mesmo nome e tamanho informados pelo Stremio e usaria esse link no `VideoInspector`.

Plano:

1. Módulo novo (ex.: `src/streams/realdebrid.ts`) que consulta `/downloads` com o token; resultados em cache de poucos itens, com liberação em `resources.onIdle`.
2. `VideoInspector.find` passa a tentar, em ordem: mapa do proxy (se ligado) → RD. O resto (ffprobe, embutida, ranking) não muda.
3. Config opcional `streams.realdebrid` com `token: ${RD_TOKEN}` no `.env` (fora do git). Indexadores desligados.
4. Testes com respostas simuladas da API. Nunca logar URL nem token.

### Hipótese (confirmada em 2026-10-31, ver PLANO-COMPLEMENTO.md)

O 2º pedido do Stremio (o que traz `videoHash`) só deveria acontecer depois que o player abriu o stream, porque o hash é calculado sobre os bytes do arquivo. Se for verdade, o link já está em `/downloads` nesse momento, que é onde o código já dispara `prepare(..., { warm: true })`. O 1º pedido (sem hash) pode chegar antes de o link existir.

**Primeiro passo:** teste com log temporário. No pedido de legendas, consultar `/downloads` e registrar apenas se o arquivo apareceu e após quantos ms (sem URL). Uma ou duas reproduções na TV bastam. Requer o token do RD no `.env` da box, colocado pelo usuário.

### Limitações conhecidas

- Se o 1º pedido não achar o arquivo, fps real e embutida só valem a partir do 2º.
- O token fica onde o RightSubs roda. Para outro dispositivo, o RightSubs precisa rodar nele (ou em máquina sempre acessível). Fora de casa, o IP público muda e voltam as restrições de IP do RD.
- A API do RD não foi testada neste projeto; os campos e os limites acima vêm de conhecimento geral e precisam ser conferidos.

## Coexistência com outros addons de legenda (OpenSubtitles v3 etc.)

- **Tecnicamente não é necessário remover.** O RightSubs consulta o OpenSubtitles v3 por conta própria (via URL do manifest, em `providers`), então não depende do addon instalado no Stremio.
- **Efeito de manter:** o Stremio mostra as faixas de todos os addons, e o player pode selecionar sozinho uma faixa do OpenSubtitles v3 (sem sincronização) no lugar da do RightSubs.
- **O que já foi validado:** a fase 1 (faixa do RightSubs selecionada sozinha no EXO) foi aceita **depois de remover** o OpenSubtitles v3. A coexistência **não foi testada**. Pergunta 3 do `CLAUDE.md` (preferência entre faixas de addons no mesmo idioma) segue em aberto para esse cenário.
- **Pista existente:** o Anime Kitsu também oferece legendas (redireciona ao OpenSubtitles v3) e a recomendação é instalá-lo **depois** do RightSubs, sugerindo que a ordem de instalação influencia a seleção.
- **Teste sugerido:** reinstalar o OpenSubtitles v3 **depois** do RightSubs, tocar 2 ou 3 títulos no EXO e anotar qual faixa vem selecionada. Se a do v3 vencer, a alternativa é remover só ele; os demais addons podem ficar.

### Addons do usuário hoje e recomendação

O usuário tem 3 addons de legenda instalados: **OpenSubtitles**, **OpenSubtitles v3** e **OpenSubtitles Pro**. Todos têm a mesma fonte que o RightSubs já consulta (API + v3), então não somam cobertura e só adicionam faixas sem sincronização.

- **Recomendação para a TV da sala:** deixar só o RightSubs. É o cenário validado (fase 1) e combina com o objetivo de dar play sem escolher legenda.
- **Ressalvas:** não se sabe o que o "OpenSubtitles Pro" oferece além do v3/API (se depender de assinatura do usuário, o RightSubs não usa essa conta); a coexistência segue não testada.
- **Remoção segura:** anotar a URL do manifest de cada um antes (reinstalar é por URL). Gradual: remover primeiro OpenSubtitles e v3 (redundantes), o Pro por último. Em outros dispositivos ou perfis sem o RightSubs, manter o que já usa.

### O player pode dar preferência sempre ao RightSubs?

**Não de forma garantida.** Quem escolhe a faixa é o Stremio/player; o addon só influencia.

- A seleção automática segue o idioma preferido nas configurações. O desempate entre addons com o mesmo idioma é desconhecido (ordem de instalação? ordem de chegada?): é a pergunta 3 do `CLAUDE.md`, em aberto para coexistência.
- **O que o RightSubs já faz a favor:** oferece uma única faixa, no idioma principal (`pob` para PT-BR), sem poluir a lista. Foi selecionada sozinha no EXO, mas **sem** outros addons instalados.
- **O que o usuário pode fazer:** instalar o RightSubs **por último** (único indício, vindo da recomendação do Anime Kitsu; não é garantia) e deixar o idioma de legenda do Stremio igual ao principal do RightSubs.
- Se a faixa do RightSubs não vencer de forma consistente, o caminho seguro é remover os concorrentes.
- Resultado do teste de coexistência deve ser anotado aqui e na pergunta 3 de `docs/DESCOBERTAS.md`.
- **Resultado (2026-10-31, Stremio desktop):** com addon(s) da OpenSubtitles instalados, a faixa do RightSubs funcionou mas **não** veio selecionada sozinha; foi preciso escolhê-la no menu de legendas em português. Na TV (EXO), ainda não testado.

## O que é exatamente o "proxy"

É a classe `StreamProxy` ([src/streams/proxy.ts](../src/streams/proxy.ts)): um intermediário de **listas de streams**, não de vídeo (o player baixa do RD direto).

1. O manifest declara `stream`, e o Stremio pede `GET /stream/:type/:id.json` ao RightSubs.
2. O proxy repassa o pedido ao Torrentio e ao Sootio em paralelo (URLs no `.env`, com a chave do RD) e devolve as listas **sem alterar**, na ordem da config.
3. No caminho, `#remember()` guarda **nome do arquivo → URL** (nome de `behaviorHints.filename` ou da 1ª linha do título; `videoSize` desempata). Em memória: até 500 arquivos, 5 URLs por nome, apagado quando o addon fica ocioso. Streams sem `url` são ignorados.
4. No pedido de legendas, `find(filename, videoSize)` devolve a URL para o ffprobe e o ffmpeg.

Por isso Torrentio e Sootio precisam sair do Stremio: se ficassem, cada stream apareceria duplicado.

## Como o fps real é obtido hoje

- `VideoInspector.inspect()` ([src/media/inspector.ts](../src/media/inspector.ts)) acha a URL via `find`; sem ela devolve `undefined` e o fps real não é usado.
- `probeVideo()` ([src/media/probe.ts](../src/media/probe.ts)) roda `ffprobe` na URL lendo só o cabeçalho (`-probesize 2MB`, `-analyzeduration 0`), com timeout e `SIGKILL`; passa pelo `limiter`; resultado em memória (até 50 arquivos). ~1,5 s na box.
- `parseProbe()` usa `r_frame_rate` (exato) e, se preciso, `avg_frame_rate` (estimado: dava 23,81 num arquivo de 23,976, bug já corrigido), filtrados por `standardRate()` (23,976 / 24 / 25 / 29,97 / 30 / 47,952 / 48 / 50 / 59,94 / 60, tolerância 0,1%).
- Uso: `#rank()` prefere `realFps ?? videoFps(candidatas)`; `fpsOnly()` reescala a legenda quando declara outro fps (`fps_corrected`). O fps **da legenda** continua sendo o declarado no site (o `.srt` não carrega fps).

## O que se perde sem indexers e sem embutida

Perde-se a sincronização só quando **não existe legenda exata** do arquivo no OpenSubtitles:

| Situação | Com URL (proxy/RD) | Sem URL |
|---|---|---|
| Existe legenda exata | Sincroniza | Sincroniza (igual) |
| Sem exata, mas com texto embutido | Usa a embutida e corrige | Sem referência: entrega a melhor sem ajuste (`no_reference`) |
| Fps da legenda diferente do vídeo, sem referência | Lê o fps real e corrige | Só infere o fps das exatas, se houver |
| Ranking | Fps real | Fps inferido |

Fps inferido ([src/subtitles/service.ts](../src/subtitles/service.ts), `videoFps()`): vem das candidatas **exatas** que declaram fps e concordam entre si; senão fica indefinido e o bônus de ±30 de [src/subtitles/rank.ts](../src/subtitles/rank.ts) nem entra. É o que alguém digitou no site, não o do arquivo. Arquivos WEB costumam ter legenda embutida em texto, então são os mais afetados. Quanto isso ocorre no uso real: `grep subtitles.served ~/.rightsubs/logs/rightsubs.log*` na box.

## `/downloads` do RD: quando o arquivo aparece

`/downloads` é o histórico de links gerados na conta (a página "Downloads" do site do RD). O RightSubs só **lê**; o item é criado pelo RD quando o addon de streams resolve o stream clicado. Streams listados e não clicados não geram nada (dedução, a confirmar no teste). Ponto a conferir: dependendo do addon e do cache, o Torrentio/Sootio pode adicionar o torrent a `/torrents` e não gerar item em `/downloads`; o teste com log deve olhar **as duas listas**. O RightSubs não deve pedir `unrestrict` por conta própria (criaria histórico de arquivos não clicados).

## Se o usuário deixar de usar o Real-Debrid

| Fonte | Proxy | Via API (proposta) |
|---|---|---|
| Outro debrid (AllDebrid, Premiumize, TorBox) | Funciona se o stream trouxer `url` direta | Precisa de adaptador por serviço |
| Torrent direto no Stremio | Não funciona: stream traz `infoHash`, sem `url` (`#remember()` ignora) | Não se aplica |
| Addon com link HTTP direto | Funciona | Não se aplica |

Sem RD também some a restrição de IP, o que facilita hospedar fora de casa.

## Decisão: solução híbrida (RD e sem RD)

O usuário quer atender os dois cenários, inclusive **só Torrentio instalado, sem RD**. Desenho: uma **cadeia de localização do arquivo**, em que cada etapa só roda se estiver configurada e a falha passa para a seguinte:

1. **Proxy** (opcional, como hoje).
2. **API do RD** (se houver token), por nome e tamanho; desenhada como interface, com adaptadores por serviço no futuro.
3. **Servidor local do Stremio** (torrent direto): *experimento, sem promessa.*
4. **Nada encontrado → modo leve** (busca, ranking e texto×texto contra legenda exata). É o piso e funciona sempre.

Incertezas do item 3: o pedido de legendas não traz `infoHash` nem índice do arquivo (seria preciso consultar o Torrentio pelo ID e casar por nome e tamanho); não se sabe se o servidor do Stremio (porta 11470) é acessível ao Termux no Android TV; e ler cabeçalho e 3 trechos de 45 s num torrent força peças fora de ordem e pode competir com a reprodução.

## Decisões já tomadas que continuam valendo

Somente serviços gratuitos; EXO como player; idiomas `pt-BR` / `en-US`; nada em nuvem; recursos mínimos quando ocioso. Ver `CLAUDE.md`.

## Próximos passos

Plano de execução detalhado: [PLANO-COMPLEMENTO.md](PLANO-COMPLEMENTO.md).

1. Reorganizar o localizador de arquivos como interface com a cadeia híbrida (proxy opcional → RD → servidor local do Stremio → modo leve), ainda só com proxy e modo leve; testável já.
2. Teste do `/downloads` e `/torrents` do RD com log temporário (hipótese acima); se valer, implementar `src/streams/realdebrid.ts` e a config `streams.realdebrid`.
3. Testar a coexistência com o OpenSubtitles v3 instalado depois do RightSubs (e, para a TV da sala, remover OpenSubtitles, v3 e Pro se a faixa do RightSubs não vencer).
4. Investigar sem compromisso o servidor local do Stremio na box (torrent direto).
5. Só então decidir sobre o modo leve hospedável (ver `docs/PROXIMOS-PASSOS.md` para multi-aparelho e guia para amigos).
