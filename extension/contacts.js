(() => {
  function csvContacts(rows, { spreadsheetSafe = false, onlyNumbers = false, includeStatus = false } = {}) {
    let maxExtra = 0;
    for (const { extra } of rows) maxExtra = Math.max(maxExtra, extra?.length ?? 0);
    const header = onlyNumbers ? ['telefone'] : ['nome', 'telefone'];
    if (includeStatus) header.push('status', 'telefone corrigido');
    if (!onlyNumbers) {
      for (let index = 0; index < maxExtra; index++) header.push(`field${index + 3}`);
    }
    const body = rows.map((row) => {
      if (onlyNumbers) return [row.phone];
      const fields = [row.name, row.phone];
      if (includeStatus) fields.push(row.status ?? '', row.corrected ?? '');
      for (let index = 0; index < maxExtra; index++) fields.push(row.extra?.[index] ?? '');
      return fields;
    });
    return globalThis.PontoWorkflow.csvText([header, ...body], { spreadsheetSafe });
  }

  function waitBetweenChecks(signal) {
    return new Promise((resolve) => {
      const timeout = setTimeout(finish, 1500);
      signal.addEventListener('abort', finish, { once: true });
      function finish() {
        clearTimeout(timeout);
        signal.removeEventListener('abort', finish);
        resolve();
      }
    });
  }

  function download(root, csv, fileName) {
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    root.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setup({ root, request, updatePreview, report }) {
    const host = root.getElementById('contact-tools');
    const draft = root.getElementById('contacts');
    if (!host || !draft) return;

    host.innerHTML = `
      <details>
        <summary>Importar e exportar da sessão</summary>
        <p class="hint">Escolha a fonte de contatos da aba atual.</p>
        <label>Fonte
          <select data-source>
            <option value="chats">Conversas individuais</option>
            <option value="recent">Conversas com recebimento nas últimas 24h</option>
            <option value="contacts">Agenda do WhatsApp</option>
            <option value="groups">Grupos como destinatários</option>
            <option value="members">Participantes de um grupo</option>
            <option value="label">Conversas de uma etiqueta</option>
          </select>
        </label>
        <label data-choice-label hidden>Grupo ou etiqueta <select data-choice></select></label>
        <label class="check" data-unsaved-label><input data-unsaved type="checkbox"> Somente contatos não salvos</label>
        <label data-prefix-label>Prefixo de nome para não salvos <input data-prefix type="text" maxlength="40" placeholder="Ex.: WA_"></label>
        <label class="check"><input data-numbers type="checkbox"> Exportar CSV com apenas números</label>
        <div class="actions">
          <button data-read type="button">Carregar contatos</button>
          <button data-apply type="button" hidden>Substituir lista</button>
          <button data-export type="button" hidden>Baixar CSV</button>
        </div>
        <p class="hint" data-source-status role="status"></p>
        <ul class="hint" data-sample hidden aria-label="Amostra de contatos"></ul>
      </details>
      <details>
        <summary>Verificar números e grupos</summary>
        <p class="hint">Consulta o cadastro dos números e a participação nos grupos da lista. Resultados incertos ficam na lista.</p>
        <div class="actions">
          <button data-check type="button">Verificar lista</button>
          <button data-stop-check type="button" hidden>Interromper verificação</button>
          <button data-filter type="button" hidden>Remover não encontrados</button>
          <button data-correct type="button" hidden>Aplicar números confirmados</button>
          <button data-export-check type="button" hidden>Baixar verificação</button>
        </div>
        <p class="hint" data-check-status role="status"></p>
        <ul class="hint" data-results hidden aria-label="Amostra da verificação"></ul>
      </details>`;

    const get = (key) => host.querySelector(`[data-${key}]`);
    const source = get('source');
    const choice = get('choice');
    const sourceStatus = get('source-status');
    const checkStatus = get('check-status');
    const readButton = get('read');
    const checkButton = get('check');
    const stopButton = get('stop-check');
    let sourceRows = [];
    let checkRows = [];
    let checkedDraft;
    let currentCheck;

    function showRows(list, rows, format) {
      list.replaceChildren();
      list.hidden = !rows.length;
      for (const row of rows.slice(0, 12)) {
        const item = document.createElement('li');
        item.textContent = format(row);
        list.append(item);
      }
    }

    function setSourceRows(rows) {
      sourceRows = rows;
      get('apply').hidden = !rows.length;
      get('export').hidden = !rows.length;
      showRows(get('sample'), rows, ({ name, phone }) => name ? `${name} · ${phone}` : phone);
    }

    function writeDraft(value, message) {
      draft.value = value;
      updatePreview();
      report(message);
      draft.focus();
    }

    function resetSource() {
      choice.replaceChildren();
      get('choice-label').hidden = true;
      get('unsaved-label').hidden = source.value === 'groups';
      get('prefix-label').hidden = source.value === 'groups';
      readButton.textContent = ['members', 'label'].includes(source.value) ? 'Listar opções' : 'Carregar contatos';
      sourceStatus.textContent = '';
      setSourceRows([]);
    }

    source.addEventListener('change', resetSource);
    choice.addEventListener('change', () => {
      setSourceRows([]);
      sourceStatus.textContent = '';
    });
    readButton.addEventListener('click', async (event) => {
      if (!event.isTrusted || readButton.disabled) return;
      const selectedSource = source.value;
      source.disabled = true;
      choice.disabled = true;
      readButton.disabled = true;
      setSourceRows([]);
      sourceStatus.textContent = 'Carregando…';
      try {
        await request('prepare');
        if (['members', 'label'].includes(selectedSource) && !choice.options.length) {
          const options = await request('contactSources');
          if (selectedSource === 'members') choice.add(new Option('Grupo aberto nesta aba', 'active'));
          for (const option of selectedSource === 'members' ? options.groups : options.labels) {
            choice.add(new Option(option.name, option.id));
          }
          if (!choice.options.length) {
            sourceStatus.textContent = options.labelsAvailable ? 'Nenhuma etiqueta encontrada.' : 'Etiquetas indisponíveis nesta conta.';
            return;
          }
          get('choice-label').hidden = false;
          readButton.textContent = 'Carregar contatos';
          sourceStatus.textContent = 'Selecione uma opção e carregue os contatos.';
          return;
        }
        const { rows, omitted } = await request('contactRead', {
          source: selectedSource,
          id: choice.value,
          onlyUnsaved: get('unsaved').checked,
          prefix: get('prefix').value
        });
        setSourceRows(rows);
        const omittedMessage = omitted ? ` ${omitted} sem telefone disponível.` : '';
        sourceStatus.textContent = `${rows.length} contato(s) disponível(is).${omittedMessage}`;
      } catch (error) {
        sourceStatus.textContent = error.message;
      } finally {
        source.disabled = false;
        choice.disabled = false;
        readButton.disabled = false;
      }
    });

    get('apply').addEventListener('click', (event) => {
      if (event.isTrusted) writeDraft(csvContacts(sourceRows), `${sourceRows.length} contato(s) importado(s) para a lista.`);
    });
    get('export').addEventListener('click', (event) => {
      if (event.isTrusted) download(root, csvContacts(sourceRows, {
        spreadsheetSafe: true, onlyNumbers: get('numbers').checked
      }), 'ponto-contatos.csv');
    });

    const statuses = {
      registered: 'Confirmado',
      missing: 'Não encontrado',
      unknown: 'Consulta inconclusiva',
      pending: 'Não consultado'
    };

    function presentCheck() {
      const totals = { registered: 0, missing: 0, unknown: 0, pending: 0 };
      for (const row of checkRows) totals[row.status]++;
      const parts = [`${totals.registered} confirmado(s)`, `${totals.missing} não encontrado(s)`];
      if (totals.unknown) parts.push(`${totals.unknown} inconclusivo(s)`);
      if (totals.pending) parts.push(`${totals.pending} não consultado(s)`);
      showRows(get('results'), checkRows, ({ phone, status, corrected }) =>
        `${phone} · ${statuses[status]}${corrected ? ` · Número confirmado: ${corrected}` : ''}`);
      get('filter').hidden = !totals.missing;
      get('correct').hidden = !checkRows.some((row) => row.corrected);
      get('export-check').hidden = !checkRows.length;
      return parts.join(' · ');
    }

    checkButton.addEventListener('click', async (event) => {
      if (!event.isTrusted || currentCheck) return;
      checkedDraft = draft.value;
      checkRows = [];
      presentCheck();
      try {
        const { contacts, invalid } = globalThis.PontoWorkflow.parseContacts(checkedDraft, { allowGroups: true });
        if (invalid.length) throw new Error('Corrija as linhas inválidas da lista antes de consultar.');
        if (!contacts.length) throw new Error('Adicione pelo menos um destinatário à lista.');
        checkRows = contacts.map((contact) => ({ ...contact, status: 'pending' }));
      } catch (error) {
        checkStatus.textContent = error.message;
        return;
      }

      const { signal } = currentCheck = new AbortController();
      checkButton.disabled = true;
      stopButton.disabled = false;
      stopButton.hidden = false;
      checkStatus.textContent = 'Conectando à sessão do WhatsApp Web…';
      let errorMessage;
      try {
        await request('prepare');
        for (const [index, row] of checkRows.entries()) {
          if (signal.aborted) break;
          checkStatus.textContent = `Consultando ${index + 1} de ${checkRows.length}…`;
          const result = await request('contactCheck', { phone: row.phone });
          row.status = result.status;
          if (result.status === 'registered' && result.phone !== row.phone) row.corrected = result.phone;
          if (!signal.aborted && index < checkRows.length - 1 && !row.phone.endsWith('@g.us')) {
            await waitBetweenChecks(signal);
          }
        }
      } catch (error) {
        errorMessage = error.message;
      } finally {
        currentCheck = undefined;
        checkButton.disabled = false;
        stopButton.hidden = true;
        const summary = presentCheck();
        checkStatus.textContent = errorMessage ? `${errorMessage} ${summary}.` : `${summary}.`;
      }
    });

    stopButton.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      currentCheck?.abort();
      stopButton.disabled = true;
      checkStatus.textContent = 'Interrompendo após a consulta em andamento…';
    });

    function applyCheck(changes) {
      if (draft.value !== checkedDraft) {
        checkStatus.textContent = 'A lista mudou após a verificação. Consulte a lista atual antes de aplicar os resultados.';
        return;
      }
      const updated = globalThis.PontoWorkflow.rewriteContacts(checkedDraft, changes, { allowGroups: true });
      checkRows = checkRows.flatMap((row) => {
        const replacement = changes.get(row.phone);
        if (replacement === null) return [];
        if (replacement === undefined) return [row];
        return [{ ...row, phone: replacement, corrected: undefined }];
      });
      writeDraft(updated, `Lista atualizada com ${checkRows.length} destinatário(s).`);
      checkedDraft = draft.value;
      checkStatus.textContent = `${presentCheck()}.`;
    }

    get('filter').addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      const retained = new Set(checkRows.filter((row) => row.status !== 'missing').map((row) => row.phone));
      const missing = checkRows.filter((row) => row.status === 'missing' && !retained.has(row.phone));
      applyCheck(new Map(missing.map((row) => [row.phone, null])));
    });
    get('correct').addEventListener('click', (event) => {
      if (event.isTrusted) applyCheck(new Map(checkRows.filter((row) => row.corrected)
        .map((row) => [row.phone, row.corrected])));
    });
    get('export-check').addEventListener('click', (event) => {
      if (event.isTrusted) download(root, csvContacts(checkRows.map((row) => ({ ...row, status: statuses[row.status] })), {
        spreadsheetSafe: true, includeStatus: true
      }), 'ponto-verificacao.csv');
    });
  }

  globalThis.setupPontoContacts = setup;
  globalThis.PontoContactsCsv = csvContacts;
})();
