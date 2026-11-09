(() => {
  const phonePattern = /^\+?[1-9][0-9(). \t-]*$/;
  const phoneHeaders = new Set(['telefone', 'phone', 'numero', 'number', 'whatsapp', 'field2']);
  const nameHeaders = new Set(['nome', 'name', 'contato', 'field1']);

  function normalizePhone(value) {
    const candidate = value.trim();
    if (!phonePattern.test(candidate)) return '';
    const digits = candidate.replace(/\D/g, '');
    return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
  }

  function normalizeLabel(value) {
    return value.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  }

  function readRows(input) {
    const source = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!source.trim()) return [];

    // Detect separators on the first record, ignoring punctuation inside quoted cells.
    const firstRecord = source.replace(/^(?:[ \t]*\n)+/, '');
    const header = firstRecord.match(/^(?:"(?:[^"]|"")*"|[^"\n])*/)?.[0] ?? '';
    const separators = header.replace(/"(?:[^"]|"")*"/g, '').match(/[,;\t]/g) ?? [];
    const delimiter = [';', ',', '\t'].sort((a, b) =>
      separators.filter((item) => item === b).length - separators.filter((item) => item === a).length)[0];

    const rows = [];
    let cells = [];
    let cell = '';
    let quoted = false;
    let afterQuote = false;
    let line = 1;
    let rowLine = 1;

    for (let index = 0; index <= source.length; index++) {
      const character = source[index] ?? '\n';
      if (quoted) {
        if (character !== '"') cell += character;
        else if (source[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          afterQuote = true;
        }
        if (character === '\n') line++;
        continue;
      }
      if (character === delimiter || character === '\n') {
        cells.push(cell.trim());
        cell = '';
        afterQuote = false;
        if (character === '\n') {
          if (cells.some(Boolean)) rows.push({ line: rowLine, cells });
          cells = [];
          rowLine = ++line;
        }
      } else if (afterQuote && character === ' ') {
        continue;
      } else if (character === '"' && !cell.trim() && !afterQuote) {
        quoted = true;
        cell = '';
      } else if (afterQuote || character === '"') {
        throw new Error(`CSV inválido na linha ${line}. Confira as aspas.`);
      } else {
        cell += character;
      }
    }
    if (quoted) throw new Error(`Há um campo entre aspas sem fechamento na linha ${rowLine}.`);
    return rows;
  }

  function parseContacts(input) {
    const rows = readRows(input);
    const labels = rows[0]?.cells.map(normalizeLabel) ?? [];
    const phoneIndex = labels.findIndex((label) => phoneHeaders.has(label));
    const nameIndex = labels.findIndex((label) => nameHeaders.has(label));
    if (phoneIndex >= 0) rows.shift();
    const contacts = [];
    const seen = new Set();
    const invalid = [];
    let duplicates = 0;

    for (const row of rows) {
      const { cells } = row;
      const telephoneColumn = phoneIndex >= 0 ? phoneIndex : Math.min(1, cells.length - 1);
      const phone = normalizePhone(cells[telephoneColumn] ?? '');
      if (!phone) {
        invalid.push(row.line);
        continue;
      }
      if (seen.has(phone)) {
        duplicates++;
        continue;
      }
      seen.add(phone);
      const name = cells[phoneIndex >= 0 ? nameIndex : telephoneColumn - 1] || '';
      const extra = cells.filter((_, column) => column !== telephoneColumn &&
        column !== (phoneIndex >= 0 ? nameIndex : telephoneColumn - 1));
      contacts.push({ name, phone, extra });
    }
    return { contacts, duplicates, invalid };
  }

  function personalize(template, contact) {
    return template.replace(/\[(nome|name|telefone|phone|field\d+)\]/gi, (token, key) => {
      const normalized = key.toLowerCase();
      if (['nome', 'name', 'field1'].includes(normalized)) return contact.name;
      if (['telefone', 'phone', 'field2'].includes(normalized)) return contact.phone;
      return contact.extra[Number(normalized.slice(5)) - 3] ?? token;
    });
  }

  function* queueItems(draft) {
    for (const contact of draft.contacts) {
      if (draft.text) yield { contact, label: 'Texto', text: personalize(draft.text, contact) };
      for (const entry of draft.attachments) {
        yield { contact, label: entry.file.name, file: entry.file, asDocument: entry.asDocument,
          caption: personalize(entry.caption, contact) };
      }
    }
  }

  async function runQueue(draft, { startAt, signal, send, onProgress }) {
    let index = 0;
    for (const item of queueItems(draft)) {
      if (index++ < startAt) continue;
      if (signal.aborted) return { status: 'stopped' };
      onProgress('sending', item, index);
      try {
        await send(item, signal);
      } catch (error) {
        if (error.name === 'AbortError') return { status: 'stopped' };
        onProgress('failed', item, index, error);
        return { status: 'failed' };
      }
      onProgress('confirmed', item, index);
    }
    return { status: 'done' };
  }

  globalThis.PontoWorkflow = { parseContacts, personalize, runQueue };
})();
