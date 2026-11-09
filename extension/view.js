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
    .top, .row, .actions, .card-title { display: flex; align-items: center; gap: 10px; }
    .top, .card-title { justify-content: space-between; }
    .brand { color: #c2f5d8; font-size: 11px; font-weight: 750; letter-spacing: .16em; }
    h1 { font-size: 26px; letter-spacing: -.035em; line-height: 1.12; margin: 12px 0 6px; }
    h2 { font-size: 15px; margin: 0; }
    header p { margin: 0; color: #c7e1d6; font-size: 13px; }
    main { overflow: auto; flex: 1 1 auto; min-height: 0; padding: 13px; }
    fieldset { display: grid; gap: 10px; min-width: 0; margin: 0; padding: 0; border: 0; }
    section, .review { background: #fff; border: 1px solid #dee8e2; border-radius: 12px; padding: 12px; }
    .step { color: #2c6f55; margin-right: 6px; font: 700 11px system-ui, sans-serif; }
    .hint { color: #496259; font-size: 12px; margin: 6px 0; overflow-wrap: anywhere; }
    textarea, input[type=text] { display: block; width: 100%; border: 1px solid #c6d8ce;
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
  `);
  root.adoptedStyleSheets = [sheet];
  root.innerHTML = `
    <div class="panel" role="region" aria-label="Ponto para WhatsApp Web">
      <header>
        <div class="top"><span class="brand">PONTO / WHATSAPP WEB</span><button id="close" aria-label="Fechar painel">×</button></div>
        <h1>Central de mensagens</h1>
        <p>Prepare seu texto e envie os arquivos em ordem.</p>
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
          </section>
          <section>
            <div class="card-title"><h2><label for="message"><span class="step">02</span> Mensagem</label></h2><span class="tag">Opcional</span></div>
            <textarea id="message" rows="3" placeholder="Olá, [nome]!" aria-describedby="message-help"></textarea>
            <p id="message-help" class="hint">Use [nome], [telefone] ou [field3] para personalizar o texto.</p>
            <p id="preview" class="preview" hidden></p>
          </section>
          <section>
            <div class="card-title"><h2><span class="step">03</span> Anexos</h2><span id="file-count" class="tag">0 arquivos</span></div>
            <div id="drop" class="drop"><button id="add-files">Adicionar arquivos</button><span class="hint">ou arraste para cá</span></div>
            <input id="files" type="file" multiple hidden>
            <p class="hint">Selecione vários arquivos de uma vez. Os limites de formato e tamanho do WhatsApp se aplicam.</p>
            <ul id="attachments" aria-label="Arquivos na fila"></ul>
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
        <progress id="progress" aria-label="Itens confirmados" hidden></progress>
        <p id="status" role="status" aria-live="polite">Os dados do rascunho ficam nesta aba.</p>
        <div class="actions">
          <button id="prepare" class="primary">Revisar envio</button>
          <button id="stop" hidden>Parar após o item atual</button>
          <button id="resume" class="primary" hidden>Continuar lote</button>
          <button id="discard" hidden>Encerrar lote</button>
        </div>
      </footer>
    </div>
  `;
};
