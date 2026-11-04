# Histórico de versões

Versões do **APK** (arquivo [VERSION](VERSION)); o addon recebe a mesma versão no build. Como gerar uma versão nova: [README › Versões](README.md#versões).

## [Não lançado]

## [0.1.0] — 2026-11-04

Primeira versão.

- RightSubs num APK para Android TV/Google TV e celular, sem Termux: Node 24 LTS (Termux), ffmpeg/ffprobe 7.1.1 mínimos, serviço em primeiro plano que inicia no boot.
- Credenciais do OpenSubtitles e token do Real-Debrid criptografados com o Android Keystore; preenchimento pelo celular (QR + formulário temporário na rede local).
- Idiomas na tela: principal e secundária (padrão Português do Brasil e de Portugal) e referência para sincronizar (padrão inglês).
- Torrents sem Real-Debrid achados pelo servidor local do Stremio.
- **Instalar no Stremio:** no celular abre o Stremio Web no navegador; na TV mostra onde digitar o endereço (Addons › Add addon), porque o Stremio troca `stremio://` por `https://` e o addon local só responde em `http`.
- **Tradução pelo DeepL** como último recurso (chave opcional na tela e em "Preencher pelo celular"): sem legenda em português, traduz a melhor legenda de qualquer idioma cujo tempo a faixa embutida confirma; filmes sem faixa embutida também, se o fps da legenda for o do arquivo (aviso "tempo não confirmado"). A primeira vez leva de 20 a 60 s, então o vídeo abre com uma legenda provisória.
- **Legenda embutida no próprio vídeo:** se o arquivo já tem faixa no idioma principal ou no secundário, o RightSubs não busca nem baixa nada.
- **Limpeza do texto** de toda legenda servida: notas musicais, caractere de substituição, caracteres de controle, `#` de música e restos de ASS.
- **Visual no estilo do Stremio:** fundo escuro, roxo `#7B5BF5`, fonte Plus Jakarta Sans e foco do controle remoto bem visível; ao abrir, o foco já começa em **Instalar no Stremio**.
- Ícone e banner da TV; tela adaptada ao celular em pé.
- A versão do addon é a do APK (injetada no build, que confere).
- Só para testes: `-Prefill` (credenciais do `.env` no APK), `-WorkingTree` (addon com alterações não commitadas) e `translation.deepl.forceFrom`. Nunca distribuir esses APKs.
