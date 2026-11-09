globalThis.createPontoView = (root) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; position: fixed; inset: 12px 12px 12px auto; z-index: 2147483647;
      width: min(480px, calc(100vw - 24px)); color-scheme: light; }
    :host([hidden]), [hidden] { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    .panel { height: 100%; display: flex; flex-direction: column; overflow: hidden;
      background: #f4f7f5; border: 1px solid #d4e1da; border-radius: 18px;
      box-shadow: 0 18px 62px #14282042; color: #142c24; font: 14px/1.45 system-ui, sans-serif; }
    header { flex: none; padding: 21px 20px 20px; color: #f6fffa; background: #15392f; }
    .top, .row, .actions, .card-title, .modes { display: flex; align-items: center; gap: 10px; }
    .top, .card-title { justify-content: space-between; }
    .brand { color: #c2f5d8; font-size: 11px; font-weight: 750; letter-spacing: .16em; }
    h1 { font-size: 26px; letter-spacing: -.035em; line-height: 1.12; margin: 12px 0 6px; }
    h2 { font-size: 15px; margin: 0; }
    header p { margin: 0; color: #c7e1d6; font-size: 13px; }
    .modes { gap: 6px; flex-wrap: wrap; margin-top: 13px; }
    .modes button, .modes span { border-radius: 8px; padding: 5px 8px; color: #effcf4;
      background: #ffffff14; border: 1px solid #ffffff30; font-size: 11px; font-weight: 700; }
    .modes span { color: #194735; background: #d1f2e0; border-color: #d1f2e0; }
    .modes button:hover:not(:disabled) { background: #ffffff27; }
    main { overflow: auto; flex: 1 1 auto; min-height: 0; padding: 13px; }
    fieldset { display: grid; gap: 10px; min-width: 0; margin: 0; padding: 0; border: 0; }
    section, .review { background: #fff; border: 1px solid #dee8e2; border-radius: 12px; padding: 12px; }
    .step { color: #2c6f55; margin-right: 6px; font: 700 11px system-ui, sans-serif; }
    .hint { color: #496259; font-size: 12px; margin: 6px 0; overflow-wrap: anywhere; }
    textarea, input:not([type=checkbox]):not([type=file]), select { display: block; width: 100%; border: 1px solid #c6d8ce;
      border-radius: 8px; padding: 8px 9px; margin: 7px 0 2px; background: #fbfdfb; color: #142c24;
      font: inherit; font-size: 13px; }
    textarea { resize: vertical; min-height: 64px; }
    button { background: #eaf4ee; color: #174735; border: 1px solid #c8dfd1;
      border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    button:hover:not(:disabled) { background: #dceee3; }
    button:disabled { opacity: .5; cursor: default; }
    :focus-visible { outline: 2px solid #138353; outline-offset: 2px; }
    #close { color: #f6fffa; background: #ffffff12; border-color: #ffffff42; font-size: 20px; line-height: 20px; }
    #close:hover { background: #ffffff25; }
    .tag { border-radius: 20px; padding: 2px 7px; color: #235442; background: #e6f3ec;
      font-size: 11px; font-weight: 700; white-space: nowrap; }
    .preview { white-space: pre-wrap; overflow-wrap: anywhere; background: #eef7ef;
      border-radius: 8px; padding: 8px 10px; margin: 6px 0 0; color: #264b3c; font-size: 12px; }
    .drop { margin-top: 9px; padding: 10px; border: 1px dashed #8bb8a1; border-radius: 8px;
      background: #f5fbf7; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .drop[data-drag] { background: #dceee3; }
    #attachments { list-style: none; margin: 0; padding: 0; max-height: 265px; overflow: auto; }
    #attachments li { border-top: 1px solid #e6ede8; padding: 8px 1px; margin-top: 7px; }
    .file-label { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 12px; font-weight: 700; }
    .file-size { color: #496259; font-size: 11px; white-space: nowrap; }
    .check { display: flex; gap: 6px; align-items: baseline; color: #304e43; font-size: 12px; margin: 6px 0; }
    .check input { accent-color: #167b51; flex: none; }
    footer { border-top: 1px solid #dce7e0; background: #fff; padding: 11px 13px 13px; }
    .actions { flex-wrap: wrap; }
    .primary { background: #146542; border-color: #146542; color: white; padding: 8px 13px; }
    .primary:hover:not(:disabled) { background: #0f5135; }
    #progress { width: 100%; height: 10px; margin: 0 0 5px; accent-color: #146542; }
    #status { margin: 0 0 7px; color: #35584a; overflow-wrap: anywhere; font-size: 12px; }
    #status[data-error] { color: #9a2924; }
    .review { margin-top: 10px; border-color: #8ab7a0; }
    .review p { margin: 6px 0; }
    details { margin-top: 7px; }
    summary { color: #235442; cursor: pointer; font-weight: 700; font-size: 12px; }
    .extras details { background: #f7fbf8; border: 1px solid #e2ece6; border-radius: 8px; padding: 7px 8px; }
    .extras label, .interval label { display: block; font-size: 12px; }
    .extras .check { display: flex; }
    .interval { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .report-list { max-height: 130px; overflow: auto; padding-left: 20px; margin: 5px 0; font-size: 12px; overflow-wrap: anywhere; }
    .thumbnail { display: block; max-width: 100%; margin-top: 7px; border-radius: 6px; }
  `);
  root.adoptedStyleSheets = [sheet];
  root.innerHTML = `
    <div class="panel" role="region" aria-label="Ponto para WhatsApp Web">
      <header>
        <div class="top"><span class="brand">PONTO / WHATSAPP WEB</span><button id="close" aria-label="Fechar painel">×</button></div>
        <h1>Central de mensagens</h1>
        <p>Prepare seu texto e envie os arquivos em ordem.</p>
        <nav class="modes" aria-label="Modos do Ponto">
          <span aria-current="page">WhatsApp Web</span>
          <button id="open-cloud" type="button">API oficial ↗</button>
          <button id="open-voice" type="button">Ligações WaVoIP ↗</button>
        </nav>
      </header>
      <main>
        <fieldset id="draft" aria-label="Rascunho">
          <section>
            <div class="card-title"><h2><label for="contacts"><span class="step">01</span> Contatos</label></h2>
              <button id="import">Importar CSV</button></div>
            <input id="csv" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" hidden>
            <textarea id="contacts" rows="3" placeholder="nome;telefone&#10;Ana;+55 11 90000-0000" aria-describedby="contact-help"></textarea>
            <p id="contact-help" class="hint">Use o código do país e o DDD. Você também pode colar um número por linha.</p>
            <p id="contact-count" class="hint"></p>
            <div class="actions"><button id="csv-model" type="button">Baixar modelo CSV</button></div>
            <div id="contact-tools"></div>
          </section>
          <section>
            <div class="card-title"><h2><label for="message"><span class="step">02</span> Mensagem</label></h2><span class="tag">Opcional</span></div>
            <textarea id="message" rows="3" placeholder="Olá, [nome]!" aria-describedby="message-help"></textarea>
            <p id="message-help" class="hint">Use [nome], [telefone] ou [field3] para personalizar o texto.</p>
            <details><summary>Emojis</summary>
              <select id="emoji" aria-label="Inserir emoji"><option value="">Escolha um emoji</option>
                <option>👋</option><option>😊</option><option>👍</option><option>✅</option><option>🎉</option>
                <option>📌</option><option>📅</option><option>📍</option><option>✨</option><option>❤️</option>
                <option>🙏</option><option>📎</option><option>🎁</option><option>💬</option><option>🚀</option>
              </select>
              <p class="hint">No Windows, pressione Win + . dentro do campo para abrir o teclado completo de emojis.</p>
            </details>
            <p id="preview" class="preview" hidden></p>
          </section>
          <section>
            <div class="card-title"><h2><span class="step">03</span> Anexos</h2><span id="file-count" class="tag">0 arquivos</span></div>
            <div id="drop" class="drop"><button id="add-files">Adicionar arquivos</button><span class="hint">ou arraste para cá</span>
              <button id="clear-files" hidden>Remover todos</button></div>
            <input id="files" type="file" multiple hidden>
            <p class="hint">Selecione vários arquivos de uma vez. Os limites de formato e tamanho do WhatsApp se aplicam.</p>
            <ul id="attachments" aria-label="Arquivos na fila"></ul>
          </section>
          <section class="extras">
            <div class="card-title"><h2><span class="step">04</span> Mensagens especiais</h2><span class="tag">Opcional</span></div>
            <details><summary>Cartões de contato</summary>
              <label class="check"><input id="rich-vcard-on" type="checkbox"> Incluir cartão de contato</label>
              <label>Nome e telefones separados por vírgulas, um contato por linha
                <textarea id="vcard" rows="2" placeholder="Ana,5511900000000"></textarea></label>
            </details>
            <details><summary>Localização</summary>
              <label class="check"><input id="rich-location-on" type="checkbox"> Incluir localização</label>
              <div class="interval"><label>Latitude <input id="location-lat" type="number" min="-90" max="90" step="any"></label>
                <label>Longitude <input id="location-lng" type="number" min="-180" max="180" step="any"></label></div>
              <label>Nome do local <input id="location-name" type="text"></label>
              <label>Endereço <input id="location-address" type="text"></label>
            </details>
            <details><summary>Enquete</summary>
              <label class="check"><input id="rich-poll-on" type="checkbox"> Incluir enquete para grupos</label>
              <label>Pergunta <input id="poll-question" type="text"></label>
              <label>Uma opção por linha <textarea id="poll-choices" rows="3"></textarea></label>
              <label>Respostas por pessoa <input id="poll-count" type="number" min="1" max="12" value="1"></label>
            </details>
            <details><summary>Lista interativa</summary>
              <label class="check"><input id="rich-list-on" type="checkbox"> Incluir lista interativa</label>
              <label>Título opcional <input id="list-title" type="text"></label>
              <label>Descrição <input id="list-description" type="text"></label>
              <label>Texto do botão <input id="list-button" type="text"></label>
              <label>Itens da lista <textarea id="list-sections" rows="3" placeholder="# Seção&#10;Título | descrição"></textarea></label>
              <label>Rodapé opcional <input id="list-footer" type="text"></label>
            </details>
            <details><summary>Chave Pix</summary>
              <label class="check"><input id="rich-pix-on" type="checkbox"> Incluir chave Pix</label>
              <label>Tipo de chave <select id="pix-type"><option value="">Selecione</option><option>CPF</option>
                <option>CNPJ</option><option value="EMAIL">E-mail</option><option value="PHONE">Telefone</option>
                <option value="EVP">Chave aleatória</option></select></label>
              <label>Chave <input id="pix-key" type="text"></label>
              <label>Recebedor <input id="pix-name" type="text"></label>
              <label>Instruções opcionais <input id="pix-instructions" type="text"></label>
            </details>
            <details><summary>Evento</summary>
              <label class="check"><input id="rich-event-on" type="checkbox"> Incluir evento</label>
              <label>Nome <input id="event-name" type="text"></label>
              <label>Descrição <input id="event-description" type="text"></label>
              <label>Início (horário local) <input id="event-start" type="datetime-local"></label>
              <label>Término opcional <input id="event-end" type="datetime-local"></label>
              <label>Local ou link <input id="event-place" type="text"></label>
              <div class="interval"><label>Latitude opcional <input id="event-lat" type="number" step="any"></label>
                <label>Longitude opcional <input id="event-lng" type="number" step="any"></label></div>
              <label>Chamada do WhatsApp <select id="event-call"><option value="">Sem chamada</option>
                <option value="voice">Voz</option><option value="video">Vídeo</option></select></label>
            </details>
            <details><summary>Convite de grupo</summary>
              <label class="check"><input id="rich-invite-on" type="checkbox"> Incluir convite de grupo</label>
              <label>ID do grupo <input id="invite-group" type="text" placeholder="120363…@g.us"></label>
              <label>Código ou link do convite <input id="invite-code" type="text"></label>
              <button id="invite-fetch" type="button">Consultar código do grupo</button>
              <label>Nome do grupo <input id="invite-name" type="text"></label>
              <label>Mensagem opcional <input id="invite-caption" type="text"></label>
            </details>
          </section>
          <section>
            <h2><span class="step">05</span> Intervalo entre destinatários</h2>
            <p class="hint">Defina a pausa em segundos. Os itens da mesma conversa seguem em ordem.</p>
            <div class="interval"><label>Mínimo <input id="delay-min" type="number" min="0" max="3600" value="2" step="1"></label>
              <label>Máximo <input id="delay-max" type="number" min="0" max="3600" value="10" step="1"></label></div>
            <label class="check"><input id="continue-on-error" type="checkbox"> Continuar a fila após falhas, sem repetir o item</label>
          </section>
        </fieldset>
        <section class="review" id="review" hidden>
          <h2>Confirme os destinatários</h2>
          <p id="summary"></p>
          <p id="recipient-preview" class="hint"></p>
          <label class="check"><input id="consent" type="checkbox"> Tenho autorização dos contatos para enviar estas mensagens.</label>
          <div class="actions"><button id="send" class="primary" disabled>Enviar agora</button><button id="cancel-review">Voltar</button></div>
        </section>
      </main>
      <footer>
        <progress id="progress" aria-label="Itens processados" hidden></progress>
        <p id="status" role="status" aria-live="polite">Os dados do rascunho ficam nesta aba.</p>
        <div class="actions">
          <button id="prepare" class="primary">Revisar envio</button>
          <button id="stop" hidden>Parar após o item atual</button>
          <button id="resume" class="primary" hidden>Continuar lote</button>
          <button id="discard" hidden>Encerrar lote</button>
        </div>
        <details id="report-panel" hidden><summary>Relatório de envio</summary>
          <ul id="report-items" class="report-list"></ul><button id="download-report">Baixar CSV do relatório</button>
        </details>
      </footer>
    </div>
  `;
};
