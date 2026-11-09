(() => {
  const methods = {
    vcard: (chat, id, data, options) => chat.sendVCardContactMessage(id, data, options),
    location: (chat, id, data, options) => chat.sendLocationMessage(id, { ...data, ...options }),
    poll: (chat, id, data, options) => chat.sendCreatePollMessage(id, data.question, data.choices,
      { ...options, selectableCount: data.selectableCount }),
    list: (chat, id, data, options) => chat.sendListMessage(id, { ...data, ...options }),
    pix: (chat, id, data, options) => chat.sendPixKeyMessage(id, data, options),
    event: (chat, id, data, options) => chat.sendEventMessage(id, { ...data, ...options }),
    invite: (chat, id, data, options) => chat.sendGroupInviteMessage(id, { ...data, ...options })
  };
  const names = {
    vcard: 'sendVCardContactMessage', location: 'sendLocationMessage', poll: 'sendCreatePollMessage',
    list: 'sendListMessage', pix: 'sendPixKeyMessage', event: 'sendEventMessage', invite: 'sendGroupInviteMessage'
  };

  globalThis.PontoRichAdapter = {
    supports: (chat, kind) => Object.hasOwn(names, kind) && typeof chat[names[kind]] === 'function',
    send: (chat, id, kind, data, options) => methods[kind](chat, id, data, options)
  };
})();
