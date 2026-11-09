# Ponto para WhatsApp Web

Extensão Chrome com código-fonte legível para preparar e acompanhar mensagens e ligações. O Ponto reimplementa os fluxos operacionais dos três modos do ZIP ZDG. O código próprio usa a licença [MIT](LICENSE). O modo Web usa [WPPConnect WA-JS 4.7.2](https://github.com/wppconnect-team/wa-js/releases/tag/v4.7.2), distribuído sob Apache 2.0.

## Instalador para Windows

1. Com o Chrome 140 ou mais recente instalado, baixe e execute o [Instalador do Ponto](https://github.com/Simpnick/ponto-whatsapp/releases/latest/download/Ponto-Instalador-Windows.exe). Ele inclui a extensão compilada, prepara a pasta `%LOCALAPPDATA%\Ponto\ChromeExtension` e abre `chrome://extensions`.
2. Na primeira instalação, use **Copiar pasta** no instalador. No Chrome, ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e cole a pasta. Abra o WhatsApp Web e clique no ícone do Ponto.
3. Para atualizar uma extensão já carregada dessa pasta, execute o instalador da versão nova e clique em **Recarregar** no cartão do Ponto. Depois, recarregue o WhatsApp Web.

A instalação direta pelo Chrome em Windows é oferecida pela Chrome Web Store. O instalador do Ponto usa o fluxo de extensão local. O executável é distribuído sem assinatura Authenticode e o SHA-256 está nos arquivos da versão. [Distribuição de extensões no Chrome](https://developer.chrome.com/docs/extensions/how-to/distribute). [Arquivos da versão](https://github.com/Simpnick/ponto-whatsapp/releases/latest).

## Instalação local a partir do código

Com Node.js instalado, execute na raiz do projeto para reconstruir a pasta `dist`.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
npm.cmd test
```

No Chrome 140 ou mais recente, acesse `chrome://extensions`, ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione `dist`. Entre no WhatsApp Web e clique no ícone **Ponto para WhatsApp Web** na barra de extensões. Se já houver outro WA-JS ativo na página, desative a outra extensão e recarregue a aba. [Instalação de extensões locais no Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

Para atualizar uma instalação local, gere `dist` novamente, clique em **Recarregar** no cartão da extensão em `chrome://extensions` e recarregue o WhatsApp Web.

Para gerar o instalador a partir de `dist` no Windows, execute `./scripts/build-windows-installer.ps1`. O executável e o SHA-256 são gerados em `release`.

## Contatos e anexos

Cole um telefone internacional por linha ou importe um CSV em UTF-8. São aceitos vírgula, ponto e vírgula e tabulação. As colunas abaixo permitem personalizar a mensagem e as legendas com `[nome]`, `[telefone]` e `[field3]`. Substitua o telefone do exemplo pelo número autorizado antes de enviar.

```csv
nome;telefone;cidade
Ana;+55 11 90000-0000;Recife
```

Escolha vários arquivos no seletor ou arraste-os ao painel. O Ponto não impõe um número máximo de anexos. Cada arquivo vira uma mensagem separada na ordem em que entrou na fila. Os limites de formato e tamanho do WhatsApp Web e da biblioteca se aplicam. [Código de envio de mídia do WA-JS](https://github.com/wppconnect-team/wa-js/blob/v4.7.2/src/chat/functions/sendFileMessage.ts).

Em **Revisar envio**, confira o total e autorize o início. A fila registra a confirmação do WhatsApp por item. A pausa aguarda um envio já iniciado e permite retomar a partir do próximo item. Por padrão, uma falha ou confirmação ambígua interrompe a fila. Confira a conversa antes de iniciar outro lote. O rascunho e o progresso ficam na memória da aba até ela fechar ou recarregar.

## Modos e recursos

### WhatsApp Web

- Importe ou exporte conversas, agenda, grupos, participantes e etiquetas disponíveis na conta. Há filtros para contatos não salvos e conversas com recebimento nas últimas 24 horas. A verificação permite baixar um CSV, aplicar correções confirmadas pelo WhatsApp e remover os números consultados que não foram encontrados.
- Use campos como `[nome]`, `[number]`, `[field3]` ou o título de uma coluna do CSV, por exemplo `[cidade]`. Use `@g.us` para identificar grupos. IDs de grupos antigos em formato numérico também são reconhecidos no modo Web.
- O painel inclui cartões de contato, localização, enquetes para grupos, listas interativas, chave Pix, eventos e convites de grupo. A disponibilidade de cada formato depende da versão do WhatsApp Web e da conta. [Referência de mensagens do WA-JS](https://wppconnect.io/wa-js/modules/chat.html).
- Configure o intervalo entre destinatários e escolha se a fila deve continuar após uma falha. A opção de continuar pula o item com falha e mantém seu resultado no CSV.

### API oficial da Meta

Abra **API oficial** no cabeçalho do Ponto. No painel do aplicativo Meta, localize o token da Graph API e o ID da conta WABA. A gestão da conta e o envio requerem as permissões `whatsapp_business_management` e `whatsapp_business_messaging`. A extensão pede acesso ao host da Graph API quando você conecta. Você pode consultar conta e números, pesquisar, criar, editar e excluir templates, enviar templates aprovados ou texto e arquivos, consultar analytics e baixar resultados. As regras da Meta para janela de atendimento, mídia, permissões e aprovação de templates se aplicam. [Documentação da API do WhatsApp Business](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api).

O token é usado em memória na aba da extensão e é limpo ao desconectar. O fluxo de login, assinatura e mudança de senha do ZDG era vinculado à infraestrutura daquele produto. No Ponto, a conta e as credenciais vêm diretamente da Meta.

### Ligações WaVoIP

Abra **Ligações WaVoIP** no cabeçalho e informe seus tokens de dispositivo. Você pode consultar o estado dos dispositivos, parear por QR, reiniciar a conexão, preparar uma fila com vários dispositivos, usar áudio gravado ou silêncio, pausar, encerrar e baixar o relatório. As permissões e a disponibilidade de chamadas dependem da conta WaVoIP. A aba da extensão usa um fluxo de áudio local por chamada. [SDK oficial WaVoIP](https://github.com/WaVoIP/wavoip-api).

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

O Ponto usa `activeTab` e `scripting`, ativa o painel no domínio exato após ação do usuário e mantém a CSP da página. A interface roda em contexto isolado e exibe os dados importados como texto. A biblioteca local opera no contexto do WhatsApp Web para ações solicitadas no painel, com telemetria e prévias externas desativadas. O modo Web confia nessa página e na dependência fixada. [Permissão `activeTab`](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

As abas da Meta e do WaVoIP pertencem à extensão. Elas pedem permissões de rede separadas, guardam credenciais em memória e consultam a lista de conversas da aba de origem somente quando você solicita a importação. O SDK WaVoIP é fixado em versão e o build empacota os processadores de áudio localmente. A permissão de WebAssembly da extensão atende ao processador de áudio do SDK. O áudio gravado e o silêncio são gerados na própria aba de ligações.

### Verificação

Os testes automatizados cobrem importação, personalização, fila, formatos especiais, requisições à Meta e estados de chamada. No Chromium, o modo Web processou 25 arquivos, a API oficial processou 22 anexos e o SDK WaVoIP reproduziu áudio gravado e encerrou a chamada. Os testes de integração usaram provedores simulados. A operação com contas reais autorizadas ainda precisa de validação.
