(() => {
  const phonePattern = /^[1-9]\d{7,14}$/;
  const groupPattern = /^\d{8,24}(?:-\d{4,16})?@g\.us$/;
  const contactPattern = /^([1-9]\d{7,14})@(c\.us|s\.whatsapp\.net)$/;
  const lidPattern = /^\d{8,24}@lid$/;

  const jidOf = (value) => typeof value === 'string' ? value : value?._serialized ?? '';
  const displayName = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';

  async function resolvePhone(wpp, jid) {
    const phone = jid.match(contactPattern)?.[1];
    if (phone) return { phone };
    if (!lidPattern.test(jid) || typeof wpp.contact.getPnLidEntry !== 'function') return {};
    const mapping = await wpp.contact.getPnLidEntry(jid).catch(() => null);
    const mappedPhone = jidOf(mapping?.phoneNumber).match(contactPattern)?.[1];
    return { phone: mappedPhone, info: mapping?.contact };
  }

  function groupRows(groups) {
    const rows = [];
    const seen = new Set();
    for (const group of groups) {
      const id = jidOf(group?.id);
      if (!groupPattern.test(id) || seen.has(id)) continue;
      rows.push({ id, name: displayName(group.formattedTitle, group.name, group.subject, group.groupMetadata?.subject, id) });
      seen.add(id);
    }
    return rows;
  }

  async function contactSources(wpp) {
    // Etiquetas são opcionais e uma conta pessoal pode não conseguir consultá-las.
    const [groups, labels] = await Promise.allSettled([
      wpp.group.getAllGroups(),
      Promise.resolve().then(() => wpp.labels.getAllLabels())
    ]);
    return {
      groups: groups.status === 'fulfilled' ? groupRows(groups.value) : [],
      labels: labels.status === 'fulfilled' ? labels.value.filter((label) => typeof label.id === 'string')
        .map(({ id, name }) => ({ id, name: displayName(name, id) })) : [],
      groupsAvailable: groups.status === 'fulfilled',
      labelsAvailable: labels.status === 'fulfilled'
    };
  }

  async function hasRecentIncoming(wpp, chat, cutoff) {
    const messages = chat.msgs;
    const last = chat.lastMessage ?? (typeof messages?.last === 'function' ? messages.last() : messages?.last);
    const activity = Number(chat.t ?? last?.t ?? last?.timestamp);
    if (Number.isFinite(activity) && activity < cutoff) return false;
    const received = chat.lastReceivedKey && typeof wpp.chat.getMessageById === 'function'
      ? await wpp.chat.getMessageById(chat.lastReceivedKey).catch(() => null)
      : null;
    const message = received ?? last;
    return (message?.id?.fromMe ?? message?.fromMe) === false &&
      Number(message.t ?? message.timestamp) >= cutoff;
  }

  async function readContacts(wpp, request) {
    const source = request.source;
    const { id, onlyUnsaved } = request;
    const prefix = typeof request.prefix === 'string' ? request.prefix.trim() : '';
    if (source === 'groups') {
      const groups = groupRows(await wpp.group.getAllGroups());
      return { rows: groups.map((group) => ({ phone: group.id, name: group.name })), omitted: 0 };
    }

    let models;
    if (source === 'contacts') {
      models = await wpp.contact.list();
    } else if (source === 'members') {
      const groupId = id === 'active' ? jidOf(wpp.chat.getActiveChat()?.id) : id;
      if (typeof groupId !== 'string' || !groupPattern.test(groupId)) return null;
      models = await wpp.group.getParticipants(groupId);
    } else if (source === 'label') {
      if (typeof id !== 'string' || !id || id.length > 100) return null;
      models = await wpp.chat.list({ onlyUsers: true, withLabels: [id] });
    } else if (source === 'chats' || source === 'recent') {
      models = await wpp.chat.list({ onlyUsers: true });
    } else {
      return null;
    }

    const rows = [];
    const seen = new Set();
    let omitted = 0;
    const cutoff = Date.now() / 1000 - 24 * 60 * 60;
    for (const model of models) {
      if (!model) continue;
      const contact = model.contact ?? model;
      const jid = jidOf(model.id ?? contact.id);
      if (!jid || contact.isMe === true) continue;
      if (source === 'recent' && !await hasRecentIncoming(wpp, model, cutoff)) continue;
      const saved = contact.isMyContact;
      if (onlyUnsaved && saved !== false) continue;
      const { phone, info } = await resolvePhone(wpp, jid);
      if (!phone) {
        if (lidPattern.test(jid)) omitted++;
        continue;
      }
      if (seen.has(phone)) continue;
      const name = displayName(contact.name, info?.name, model.formattedTitle, contact.pushname,
        info?.pushname, contact.shortName, model.name);
      rows.push({ phone, name: saved === false && prefix ? `${prefix}${name || phone}` : name });
      seen.add(phone);
    }
    return { rows, omitted };
  }

  async function checkContact(wpp, phone) {
    if (typeof phone !== 'string') return null;
    if (groupPattern.test(phone)) {
      const isMember = await wpp.group.iAmMember(phone);
      return { phone, status: isMember ? 'registered' : 'missing' };
    }
    if (!phonePattern.test(phone)) return null;
    const result = await wpp.contact.queryWidExists(`${phone}@c.us`);
    if (result === null) return { phone, status: 'missing' };
    if (!result?.wid) return { phone, status: 'unknown' };
    const { phone: corrected } = await resolvePhone(wpp, jidOf(result.wid));
    return { phone: corrected ?? phone, status: 'registered' };
  }

  globalThis.PontoContactsAdapter = async (wpp, request) => {
    if (!wpp?.conn?.isAuthenticated?.()) return { ok: false, reason: 'login' };
    try {
      if (request.operation === 'contactSources') return { ok: true, data: await contactSources(wpp) };
      if (request.operation === 'contactRead') {
        const data = await readContacts(wpp, request);
        return data ? { ok: true, data } : { ok: false, reason: 'contactSource' };
      }
      if (request.operation === 'contactCheck') {
        const data = await checkContact(wpp, request.phone);
        return data ? { ok: true, data } : { ok: false, reason: 'recipient' };
      }
    } catch {
      if (request.operation === 'contactCheck') {
        return { ok: true, data: { phone: request.phone, status: 'unknown' } };
      }
      return { ok: false, reason: 'contactSource' };
    }
    return { ok: false, reason: 'bridge' };
  };
})();
