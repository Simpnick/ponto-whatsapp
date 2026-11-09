export const GRAPH_HOST = 'https://graph.facebook.com/*';
export const DEFAULT_GRAPH_VERSION = 'v25.0';

const graphOrigin = 'https://graph.facebook.com';
const mediaFormats = {
  image: ['image/jpeg', 'image/png'],
  video: ['video/mp4', 'video/3gpp'],
  audio: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
  document: ['text/plain', 'application/pdf', 'application/msword', 'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  sticker: ['image/webp']
};
const knownExtensions = {
  jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', '3gp': 'video/3gpp',
  aac: 'audio/aac', amr: 'audio/amr', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg',
  txt: 'text/plain', pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint', docx: mediaFormats.document[5],
  xlsx: mediaFormats.document[6], pptx: mediaFormats.document[7], webp: 'image/webp'
};
const maxMediaBytes = { image: 5 * 1024 ** 2, video: 16 * 1024 ** 2, audio: 16 * 1024 ** 2,
  document: 100 * 1024 ** 2, sticker: 500 * 1024 };

export class GraphError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }

  get canSkipItem() {
    return this.status === 400 && [131026, 131047, 131049].includes(this.code);
  }
}

function numericId(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`Informe um ID numérico para ${label}.`);
  return String(value);
}

export function fileMedia(file) {
  const declared = file.type.toLowerCase().split(';', 1)[0];
  const extension = file.name.split('.').pop().toLowerCase();
  const mediaType = Object.values(mediaFormats).some((types) => types.includes(declared)) ? declared : knownExtensions[extension];
  const kind = Object.keys(mediaFormats).find((key) => mediaFormats[key].includes(mediaType));
  if (!kind) throw new Error(`${file.name}: formato não aceito pela API oficial.`);
  if (!file.size || file.size > maxMediaBytes[kind]) throw new Error(`${file.name}: tamanho fora dos limites da Meta.`);
  return { kind, mediaType };
}

export function createCloudClient({ wabaId, token, version = DEFAULT_GRAPH_VERSION, fetcher = globalThis.fetch }) {
  wabaId = numericId(wabaId, 'a conta WABA');
  if (!/^v[1-9]\d?\.\d+$/.test(version)) throw new Error('Informe uma versão da Graph API como v25.0.');
  let credential = token.trim();
  token = '';
  if (!credential || /\s/.test(credential)) throw new Error('Informe um token válido da Meta.');

  async function request(path, { method = 'GET', params, json, body, headers = {}, scheme = 'Bearer', timeout = 45000 } = {}) {
    if (!credential) throw new Error('A sessão da Meta foi desconectada.');
    const auth = credential;
    const url = new URL(`/${version}/${path}`, graphOrigin);
    if (url.origin !== graphOrigin || !url.pathname.startsWith(`/${version}/`)) throw new Error('Caminho inválido na Graph API.');
    url.search = new URLSearchParams(params);
    const requestHeaders = { ...headers, Authorization: `${scheme} ${auth}` };
    if (json !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    let response;
    let result;
    try {
      response = await fetcher(url, {
        method, headers: requestHeaders, body, credentials: 'omit', redirect: 'error', cache: 'no-store',
        referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(timeout)
      });
      result = await response.json();
    } catch {
      throw new GraphError('A Graph API não retornou uma resposta verificável.', response?.status);
    }
    if (!response.ok || result?.error) {
      const code = Number(result?.error?.code) || undefined;
      const details = result?.error?.error_user_msg || result?.error?.message || `HTTP ${response.status}`;
      const message = String(details).replaceAll(auth, '[token oculto]').slice(0, 400);
      throw new GraphError(`${message}${code ? ` (Meta ${code})` : ''}`, response.status, code);
    }
    return result;
  }

  async function collect(path, params) {
    const rows = [];
    const cursors = new Set();
    let after;
    do {
      const page = await request(path, { params: after ? { ...params, after } : params });
      if (!Array.isArray(page?.data)) throw new Error('A Graph API retornou uma lista inválida.');
      rows.push(...page.data);
      const next = page.paging?.next;
      after = next && (page.paging.cursors?.after || new URL(next, graphOrigin).searchParams.get('after'));
      // Only the opaque cursor is reused. The API-provided URL can contain the access token.
      if (after && cursors.has(after)) throw new Error('A Graph API repetiu um cursor de paginação.');
      cursors.add(after);
    } while (after);
    return rows;
  }

  function send(phoneId, phone, type, payload) {
    if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error('Destinatário inválido.');
    return request(`${numericId(phoneId, 'o número remetente')}/messages`, {
      method: 'POST', json: { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type, [type]: payload }
    });
  }

  const templatePath = `${wabaId}/message_templates`;
  return {
    close() { credential = ''; },
    account: () => request(wabaId, { params: { fields: 'id,name,currency,timezone_id,message_template_namespace' } }),
    phones: () => collect(`${wabaId}/phone_numbers`, { fields: 'id,verified_name,display_phone_number,quality_rating,status' }),
    templates: () => collect(templatePath, { fields: 'id,name,category,language,status,components', limit: '100' }),
    createTemplate: (json) => request(templatePath, { method: 'POST', json }),
    editTemplate: (id, json) => request(numericId(id, 'o template'), { method: 'POST', json }),
    deleteTemplate: ({ id, name }) => request(templatePath, {
      method: 'DELETE', params: { hsm_id: numericId(id, 'o template'), name }
    }),
    async upload(phoneId, file) {
      const { kind, mediaType } = fileMedia(file);
      const body = new FormData();
      body.set('messaging_product', 'whatsapp');
      body.set('type', mediaType);
      body.set('file', file.slice(0, file.size, mediaType), file.name);
      const response = await request(`${numericId(phoneId, 'o número remetente')}/media`, { method: 'POST', body, timeout: 180000 });
      return { kind, id: numericId(response.id, 'o arquivo enviado') };
    },
    async uploadTemplateExample(appId, file, expectedKind) {
      const { mediaType, kind } = fileMedia(file);
      if (kind !== expectedKind) throw new Error('O tipo de arquivo não corresponde ao cabeçalho selecionado.');
      const created = await request(`${numericId(appId, 'o aplicativo Meta')}/uploads`, {
        method: 'POST', params: { file_name: file.name, file_length: file.size, file_type: mediaType }
      });
      const session = /^((?:upload:)[\w:+%=-]+)(?:\?sig=([\w%=-]+))?$/.exec(created.id);
      if (!session) throw new Error('A Meta retornou uma sessão de upload inválida.');
      const response = await request(session[1], {
        method: 'POST', params: session[2] ? { sig: decodeURIComponent(session[2]) } : undefined,
        headers: { file_offset: '0', 'Content-Type': mediaType }, scheme: 'OAuth', body: file, timeout: 180000
      });
      if (typeof response.h !== 'string' || !response.h) throw new Error('A Meta não retornou o identificador de exemplo.');
      return response.h;
    },
    sendText: (id, to, text) => send(id, to, 'text', { body: text, preview_url: false }),
    sendMedia(id, to, media, caption, filename) {
      const payload = { id: media.id };
      if (caption && ['image', 'video', 'document'].includes(media.kind)) payload.caption = caption;
      if (media.kind === 'document') payload.filename = filename;
      return send(id, to, media.kind, payload);
    },
    sendTemplate: (id, to, template, components) => send(id, to, 'template', {
      name: template.name, language: { code: template.language }, ...(components.length && { components })
    }),
    analytics: ({ start, end, ids }) => request(`${wabaId}/template_analytics`, { params: {
      start, end, granularity: 'DAILY', metric_types: 'SENT,DELIVERED,READ,CLICKED',
      template_ids: JSON.stringify(ids.map((id) => numericId(id, 'o template')))
    } })
  };
}

export function templateParameters(template) {
  const groups = [];
  for (const component of template?.components ?? []) {
    if (['BODY', 'HEADER'].includes(component.type)) {
      if (component.type === 'HEADER' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(component.format)) {
        groups.push({ type: 'header', kind: component.format.toLowerCase(), fields: ['mídia'] });
      } else {
        const fields = [...new Set(Array.from((component.text ?? '').matchAll(/\{\{\s*([\w]+)\s*\}\}/g), (match) => match[1]))];
        if (fields.every((field) => /^\d+$/.test(field))) fields.sort((a, b) => Number(a) - Number(b));
        if (fields.length) groups.push({ type: component.type.toLowerCase(), kind: 'text', fields });
      }
    }
    if (component.type === 'BUTTONS') {
      component.buttons?.forEach((button, index) => {
        if (button.type === 'URL' && /\{\{\w+\}\}/.test(button.url)) {
          groups.push({ type: 'button', index: String(index), kind: 'text', fields: ['URL'] });
        }
        if (button.type === 'COPY_CODE') groups.push({ type: 'button', index: String(index), kind: 'coupon_code', fields: ['código'] });
      });
    }
  }
  return groups;
}

export function buildTemplateParameters(groups, resolveValue) {
  return groups.map(({ type, kind, fields, index }, group) => {
    const parameters = fields.map((field, position) => {
      const value = resolveValue(group, position).trim();
      if (!value) throw new Error(`Preencha o parâmetro ${field}.`);
      if (['image', 'video', 'document'].includes(kind)) {
        if (/^\d+$/.test(value)) return { type: kind, [kind]: { id: value } };
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use uma URL HTTPS pública ou um ID de mídia.');
        return { type: kind, [kind]: { link: url.href } };
      }
      if (kind === 'coupon_code') return { type: kind, coupon_code: value };
      const parameter = { type: 'text', text: value };
      if (type !== 'button' && !/^\d+$/.test(field)) parameter.parameter_name = field;
      return parameter;
    });
    return { type, parameters, ...(type === 'button' && { index, sub_type: kind === 'coupon_code' ? 'copy_code' : 'url' }) };
  });
}

export function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
