(() => {
  const phonePattern = /^\+?[1-9][0-9(). \t-]*$/;
  const phoneHeaders = new Set(['telefone', 'phone', 'numero', 'number', 'whatsapp', 'field2']);
  const nameHeaders = new Set(['nome', 'name', 'contato', 'field1']);
  const groupPattern = /^\d{8,24}(?:-\d{4,16})?@g\.us$/;
  const legacyGroup = /^(?:\d{16,24}|\d{8,16}-\d{9,12})$/;

  function normalizeTarget(value, allowGroups) {
    if (allowGroups && groupPattern.test(value)) return value;
    if (allowGroups && legacyGroup.test(value) && !normalizePhone(value)) return `${value}@g.us`;
    return normalizePhone(value);
  }

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

  function contactColumns(row) {
    const labels = row?.cells.map(normalizeLabel) ?? [];
    return { labels, phoneIndex: labels.findIndex((label) => phoneHeaders.has(label)),
      nameIndex: labels.findIndex((label) => nameHeaders.has(label)) };
  }

  function phoneColumn(cells, phoneIndex) {
    return phoneIndex >= 0 ? phoneIndex : Math.min(1, cells.length - 1);
  }

  function parseContacts(input, { allowGroups = false } = {}) {
    const rows = readRows(input);
    const { labels, phoneIndex, nameIndex } = contactColumns(rows[0]);
    if (phoneIndex >= 0) rows.shift();
    const contacts = [];
    const seen = new Set();
    const invalid = [];
    let duplicates = 0;

    for (const row of rows) {
      const { cells } = row;
      const telephoneColumn = phoneColumn(cells, phoneIndex);
      const raw = cells[telephoneColumn] ?? '';
      const phone = normalizeTarget(raw, allowGroups);
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
      const fields = Object.fromEntries(labels.slice(0, phoneIndex >= 0 ? labels.length : 0)
        .map((label, index) => [label, cells[index] ?? '']));
      contacts.push({ name, phone, extra, fields });
    }
    return { contacts, duplicates, invalid };
  }

  // A null change removes a row. A replacement changes only its phone cell.
  function rewriteContacts(input, changes, { allowGroups = false } = {}) {
    if (!changes.size) return input;
    const rows = readRows(input);
    const { phoneIndex } = contactColumns(rows[0]);
    const header = phoneIndex >= 0 ? rows.shift() : undefined;
    const retained = header ? [header.cells] : [];
    for (const { cells } of rows) {
      const column = phoneColumn(cells, phoneIndex);
      const original = cells[column];
      const replacement = changes.get(normalizeTarget(original ?? '', allowGroups));
      if (replacement === null) continue;
      if (replacement !== undefined) cells[column] = replacement;
      retained.push(cells);
    }
    return csvText(retained, { spreadsheetSafe: false });
  }

  function personalize(template, contact) {
    return template.replace(/\[([^\[\]\r\n]+)\]/g, (token, key) => {
      const normalized = normalizeLabel(key);
      if (['nome', 'name', 'field1'].includes(normalized)) return contact.name;
      if (['telefone', 'phone', 'number', 'numero', 'field2'].includes(normalized)) return contact.phone;
      if (/^field\d+$/.test(normalized)) return contact.extra[Number(normalized.slice(5)) - 3] ?? token;
      return Object.hasOwn(contact.fields ?? {}, normalized) ? contact.fields[normalized] : token;
    });
  }

  function* queueItems(draft) {
    for (const contact of draft.contacts) {
      if (draft.text) yield { contact, label: 'Texto', text: personalize(draft.text, contact) };
      for (const entry of draft.attachments) {
        yield { contact, label: entry.file.name, file: entry.file, asDocument: entry.asDocument,
          caption: personalize(entry.caption, contact) };
      }
      for (const entry of draft.rich ?? []) yield { contact, label: entry.label, rich: entry };
    }
  }

  function wait(ms, signal) {
    return new Promise((resolve) => {
      if (signal.aborted || ms === 0) return resolve();
      const timer = setTimeout(finish, ms);
      function finish() {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      }
      signal.addEventListener('abort', finish, { once: true });
    });
  }

  async function runQueue(draft, { startAt, signal, send, onProgress }) {
    let index = 0;
    let previousContact;
    for (const item of queueItems(draft)) {
      if (index++ < startAt) {
        previousContact = item.contact;
        continue;
      }
      if (draft.delay && previousContact && item.contact !== previousContact && !signal.aborted) {
        const { min, max } = draft.delay;
        const seconds = min + Math.random() * (max - min);
        if (seconds > 0) {
          onProgress('waiting', item, index);
          await wait(seconds * 1000, signal);
        }
      }
      if (signal.aborted) return { status: 'stopped' };
      previousContact = item.contact;
      onProgress('sending', item, index);
      try {
        await send(item, signal);
      } catch (error) {
        if (error.name === 'AbortError') return { status: 'stopped' };
        onProgress('failed', item, index, error);
        if (draft.continueOnError) continue;
        return { status: 'failed' };
      }
      onProgress('confirmed', item, index);
    }
    return { status: 'done' };
  }

  function csvText(rows, { spreadsheetSafe = true } = {}) {
    return rows.map((row) => row.map((cell) => {
      const text = String(cell ?? '');
      const formula = /^[\s\u0000-\u0020\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text);
      const safe = spreadsheetSafe && formula ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(';')).join('\r\n');
  }

  globalThis.PontoWorkflow = { parseContacts, rewriteContacts, personalize, runQueue, normalizePhone, csvText };
})();
