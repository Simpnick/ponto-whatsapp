(() => {
  function groupId(value) {
    return /^\d{8,24}(?:-\d{4,16})?(?:@g\.us)?$/.test(value)
      ? (value.endsWith('@g.us') ? value : `${value}@g.us`)
      : '';
  }

  function inviteCode(value) {
    const code = value.replace(/^https:\/\/chat\.whatsapp\.com\//, '').split(/[?#]/, 1)[0];
    return /^[\w-]{10,64}$/.test(code) ? code : '';
  }

  function parseSections(value) {
    const sections = [];
    let current = { title: 'Opções', rows: [] };
    let row = 0;
    for (const line of value.split(/\r?\n/).map((text) => text.trim()).filter(Boolean)) {
      if (line.startsWith('# ')) {
        if (current.rows.length) sections.push(current);
        current = { title: line.slice(2).trim(), rows: [] };
      } else {
        const [title, ...description] = line.split('|');
        if (!title.trim()) throw new Error('Cada item da lista precisa de um título.');
        current.rows.push({ rowId: `ponto-${++row}`, title: title.trim(), description: description.join('|').trim() });
      }
    }
    if (current.rows.length) sections.push(current);
    return sections;
  }

  function coordinates(lat, lng) {
    if (!lat || !lng || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) ||
        Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180) {
      throw new Error('Informe latitude entre −90 e 90 e longitude entre −180 e 180.');
    }
    return { lat: Number(lat), lng: Number(lng) };
  }

  function readRich(root) {
    const value = (id) => root.getElementById(id).value.trim();
    const enabled = (id) => root.getElementById(`rich-${id}-on`).checked;
    const add = (kind, label, data) => items.push({ kind, label, data });
    const items = [];

    if (enabled('vcard')) {
      const { parseContacts, normalizePhone } = globalThis.PontoWorkflow;
      const { contacts, invalid } = parseContacts(value('vcard'));
      if (!contacts.length || invalid.length || contacts.some((contact) => !contact.name)) {
        throw new Error('Informe nome e telefone internacional para cada cartão de contato.');
      }
      const cards = contacts.flatMap(({ name, phone, extra }) => [phone, ...extra.filter(Boolean).map((number) => {
        const normalized = normalizePhone(number);
        if (!normalized) throw new Error('Há um telefone adicional inválido nos cartões de contato.');
        return normalized;
      })].map((number) => ({ name, id: `${number}@c.us` })));
      add('vcard', 'Cartão de contato', cards);
    }

    if (enabled('location')) {
      const point = coordinates(value('location-lat'), value('location-lng'));
      add('location', 'Localização', { ...point, name: value('location-name') || undefined,
        address: value('location-address') || undefined });
    }

    if (enabled('poll')) {
      const question = value('poll-question');
      const choices = value('poll-choices').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const selectableCount = Number(value('poll-count'));
      if (!question || choices.length < 2 || choices.length > 12 || new Set(choices).size !== choices.length ||
          !Number.isInteger(selectableCount) || selectableCount < 1 || selectableCount > choices.length) {
        throw new Error('A enquete precisa de uma pergunta, 2 a 12 opções distintas e um número válido de respostas.');
      }
      add('poll', 'Enquete', { question, choices, selectableCount });
    }

    if (enabled('list')) {
      const buttonText = value('list-button');
      const description = value('list-description');
      const sections = parseSections(value('list-sections'));
      if (!buttonText || !description || !sections.length) {
        throw new Error('A lista interativa precisa de descrição, botão e pelo menos um item.');
      }
      add('list', 'Lista interativa', { buttonText, description, sections, title: value('list-title') || undefined,
        footer: value('list-footer') || undefined });
    }

    if (enabled('pix')) {
      const keyType = value('pix-type');
      const key = value('pix-key');
      const name = value('pix-name');
      if (!keyType || !key || !name) throw new Error('Informe tipo de chave, chave Pix e nome do recebedor.');
      add('pix', 'Chave Pix', { keyType, key, name, instructions: value('pix-instructions') || undefined });
    }

    if (enabled('event')) {
      const name = value('event-name');
      const startTime = Date.parse(value('event-start')) / 1000;
      const end = value('event-end');
      const endTime = end ? Date.parse(end) / 1000 : undefined;
      if (!name || !Number.isFinite(startTime) || (end && (!Number.isFinite(endTime) || endTime < startTime))) {
        throw new Error('Informe nome, início e um término válido para o evento.');
      }
      const place = value('event-place');
      const lat = value('event-lat');
      const lng = value('event-lng');
      let description = value('event-description');
      let location;
      if (lat || lng) {
        const point = coordinates(lat, lng);
        location = { degreesLatitude: point.lat, degreesLongitude: point.lng, name: place || name };
      } else if (place) {
        description = [description, place].filter(Boolean).join('\n');
      }
      add('event', 'Evento', { name, startTime, endTime, description: description || undefined,
        callType: value('event-call') || undefined, location });
    }

    if (enabled('invite')) {
      const id = groupId(value('invite-group'));
      const code = inviteCode(value('invite-code'));
      if (!id || !code) throw new Error('Informe o ID e o código de convite do grupo.');
      add('invite', 'Convite de grupo', { groupId: id, inviteCode: code, groupName: value('invite-name') || undefined,
        caption: value('invite-caption') || undefined });
    }
    return items;
  }

  globalThis.PontoRich = { groupId, inviteCode, parseSections, readRich };
})();
