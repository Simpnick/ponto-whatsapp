# Ponto para WhatsApp Web

Extensão Chrome com código-fonte legível para importar contatos, personalizar texto e enviar anexos em sequência. É uma reimplementação do fluxo principal do modo WhatsApp Web do ZIP ZDG. O código próprio usa a licença [MIT](LICENSE). A integração usa [WPPConnect WA-JS 4.7.2](https://github.com/wppconnect-team/wa-js/releases/tag/v4.7.2), distribuído sob Apache 2.0 com os avisos da biblioteca incluídos na compilação.

## Instalação local

Com Node.js instalado, execute na raiz do projeto para reconstruir a pasta `dist`.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
npm.cmd test
```

No Chrome 140 ou mais recente, acesse `chrome://extensions`, ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione `dist`. Entre no WhatsApp Web e clique no ícone **Ponto para WhatsApp Web** na barra de extensões. Se já houver outro WA-JS ativo na página, desative a outra extensão e recarregue a aba. [Instalação de extensões locais no Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Contatos e anexos

Cole um telefone internacional por linha ou importe um CSV em UTF-8. São aceitos vírgula, ponto e vírgula e tabulação. As colunas abaixo permitem personalizar a mensagem e as legendas com `[nome]`, `[telefone]` e `[field3]`. Substitua o telefone do exemplo pelo número autorizado antes de enviar.

```csv
nome;telefone;cidade
Ana;+55 11 90000-0000;Recife
```

Escolha vários arquivos no seletor ou arraste-os ao painel. O Ponto não impõe um número máximo de anexos. Cada arquivo vira uma mensagem separada na ordem em que entrou na fila. Os limites de formato e tamanho do WhatsApp Web e da biblioteca se aplicam. [Código de envio de mídia do WA-JS](https://github.com/wppconnect-team/wa-js/blob/v4.7.2/src/chat/functions/sendFileMessage.ts).

Em **Revisar envio**, confira o total e autorize o início. A fila registra a confirmação do WhatsApp por item. A pausa aguarda um envio já iniciado e permite retomar a partir do próximo item. Se o envio falhar ou a confirmação for ambígua, a fila para. Confira a conversa antes de iniciar outro lote. O rascunho e o progresso ficam na memória da aba até ela fechar ou recarregar.

O WA-JS depende de interfaces internas do WhatsApp Web e pode perder compatibilidade após atualizações. A orientação do WhatsApp restringe mensagens automatizadas e em massa. [Uso responsável do WhatsApp](https://faq.whatsapp.com/361005896189245).

## Auditoria do ZIP ZDG 2.3.4

**Arquivo analisado** `zdg arquivos.zip` com SHA-256 `6A505946EB307721620DDC72CB11736C2B8807650395A2775DA16D2CF80F6A3B`. Inspeção estática do manifesto e do código próprio, com análise seletiva de bibliotecas e evidência REA `ev_dfbb1a1da20b0290e104274422b32c4ef2cebd761896c82fce9461739f684283`. Os 47 registros de hashes internos conferiram com os arquivos locais. Esses hashes acompanham o próprio pacote e não estabelecem autoria. O ZIP original não foi executado. Os achados identificam caminhos de risco no código, com tráfego real e comprometimento da conta ainda indeterminados.

| Prioridade | Evidência no ZIP | Impacto |
| --- | --- | --- |
| Crítica | `background.js:178,244–271,321–328` baixa JavaScript de uma branch mutável e o executa com `eval` no contexto da página. O gatilho testa apenas se a URL contém `whatsapp.com`. | O código efetivamente executado pode mudar depois da instalação e ter acesso à página e aos dados da sessão. A branch apontada é [pedroherpeto/wa-js](https://github.com/pedroherpeto/wa-js). |
| Alta | `manifest.json:25–28,34–39` pede acesso amplo a sites. `background.js:73–100,159–161,190–215` altera cabeçalhos CSP e pode limpar registros de service workers sem filtro de origem. | A extensão reduz as proteções do WhatsApp Web e a regra acionada pela troca de aba pode atingir outros sites. |
| Alta | `smph/smphE.js:399–427,868–875,897–916,929–947` injeta dados importados ou colados em `innerHTML`. | Um CSV ou texto com HTML ativo pode injetar código quando a política da página permitir. |
| Alta | `smph/waba-ui.js:144–188,200–234`, `smph/waba-api.js:11–22,445–447` e `smph/wavoip-api.js:11–27` mantêm credenciais da API oficial e do WaVoIP no armazenamento da origem. O diagnóstico da API oficial coloca o token na URL. | Scripts no contexto da página podem ler os tokens. Parâmetros de URL podem ficar registrados na infraestrutura que processa a requisição. |
| Privacidade | `background.js:340–390` envia eventos de uso e identificador persistente de instalação. `smph/smphE.js:251–259` importa FingerprintJS de um CDN e calcula um identificador. `js/wppconnect-wa.js:2` contém telemetria própria e prévias de links por servidores terceiros. | Identificadores e eventos podem sair do navegador. URLs incluídas em mensagens podem ser transmitidas quando a prévia remota é usada. |

O teto de anexos do ZIP era **um arquivo** no modo WhatsApp Web. O seletor não tem `multiple`, o painel possui um único slot e o código limita a fila ao número de slots (`smph/app.js:622–633` e `smph/smphE.js:1547–1563`). O modo da API oficial também seleciona somente `files[0]` (`smph/waba-ui.js:719–732`).

### Controles da reimplementação

O Ponto usa `activeTab` e `scripting`, ativa o painel no domínio exato após ação do usuário e mantém a CSP da página. A interface roda em contexto isolado, exibe os dados importados como texto e chama a biblioteca local em contexto de página apenas para o envio autorizado. A biblioteca tem telemetria e prévias externas desativadas na configuração. Por operar no contexto do WhatsApp Web, o envio confia nessa página e na dependência fixada. [Permissão `activeTab`](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

### Verificação

Testes automatizados cobrem importação, personalização, fila de 25 arquivos, pausa e parada após erro. O pacote foi carregado em Chromium. A integração da interface foi exercitada com transporte simulado, CSP estrita e transferência de um arquivo em mais de um bloco. Falta validar o envio com uma sessão real autenticada.
