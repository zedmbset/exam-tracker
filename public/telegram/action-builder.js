(function () {
  function splitTopLevel(value, delimiter) {
    const parts = [];
    let depth = 0;
    let inQuote = false;
    let current = '';
    const tokenDelimiter = delimiter || ',';
    for (const char of String(value || '')) {
      if (char === '"' && depth === 0) {
        inQuote = !inQuote;
        continue;
      }
      if (!inQuote) {
        if (char === '[' || char === '(') depth += 1;
        if ((char === ']' || char === ')') && depth > 0) depth -= 1;
      }
      if (char === tokenDelimiter && depth === 0 && !inQuote) {
        if (current.trim()) parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function normalizePunctValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const quoted = raw.match(/^"(.*)"$/);
    return quoted ? quoted[1] : raw;
  }

  function parsePubLnkToken(token) {
    const model = {
      enabled: false,
      numSequence: false,
      punctBlank: false,
      punctValue: '',
      joinUs: false,
      commentJoinUsMode: 'none',
    };
    const raw = String(token || '').trim();
    if (!/^pub_lnk\s*\[/i.test(raw) || !raw.endsWith(']')) return model;
    model.enabled = true;
    const optsString = raw.slice(raw.indexOf('[') + 1, -1);
    for (const opt of splitTopLevel(optsString)) {
      const lower = opt.toLowerCase();
      if (lower.startsWith('num_sequence')) {
        model.numSequence = true;
      } else if (lower.startsWith('punct_')) {
        const punct = normalizePunctValue(opt.slice(6, opt.endsWith('_') ? -1 : undefined));
        model.punctBlank = punct === '';
        model.punctValue = punct;
      } else if (lower.startsWith('joinus_')) {
        model.joinUs = true;
        if (lower.includes('[cmts__joinus]')) {
          model.commentJoinUsMode = 'joinus_only';
        } else if (lower.includes('[cmts_desp_joinus]') || lower.includes('[cmts]')) {
          model.commentJoinUsMode = 'append_joinus';
        }
      }
    }
    return model;
  }

  function parseActionString(rawValue) {
    const raw = String(rawValue || '').trim();
    const model = {
      raw,
      grouped: false,
      transferMode: 'none',
      pubLnk: {
        enabled: false,
        numSequence: false,
        punctBlank: false,
        punctValue: '',
        joinUs: false,
        commentJoinUsMode: 'none',
      },
    };
    if (!raw) return model;
    const flattened = [];
    for (const token of splitTopLevel(raw)) {
      flattened.push.apply(flattened, splitTopLevel(token));
    }
    for (const token of flattened) {
      const lower = token.toLowerCase();
      if (lower === 'grp') {
        model.grouped = true;
      } else if (lower === 'transfer[posts]' || lower === 'transfer') {
        model.transferMode = 'posts';
      } else if (lower === 'transfer[cmts]') {
        model.transferMode = 'comments';
      } else if (lower.startsWith('pub_lnk[')) {
        model.pubLnk = parsePubLnkToken(token);
      }
    }
    return model;
  }

  function serializePubLnk(pubLnk) {
    if (!pubLnk || !pubLnk.enabled) return '';
    const opts = [];
    if (pubLnk.numSequence) opts.push('Num_Sequence_');
    const punctValue = normalizePunctValue(pubLnk.punctValue);
    if (punctValue) opts.push(`Punct_${punctValue}_`);
    else if (pubLnk.punctBlank) opts.push('Punct__');
    if (pubLnk.joinUs) {
      if (pubLnk.commentJoinUsMode === 'joinus_only') {
        opts.push('Joinus_CHN_LNK[Cmts__Joinus]');
      } else if (pubLnk.commentJoinUsMode === 'append_joinus') {
        opts.push('Joinus_CHN_LNK[Cmts_Desp_Joinus]');
      } else {
        opts.push('Joinus_CHN_LNK');
      }
    }
    return `Pub_lnk[${opts.join(', ')}]`;
  }

  function serializeActionModel(model) {
    const tokens = [];
    if (model && model.grouped) tokens.push('Grp');
    if (model && model.transferMode === 'posts') tokens.push('Transfer[Posts]');
    if (model && model.transferMode === 'comments') tokens.push('Transfer[Cmts]');
    const pubToken = serializePubLnk(model ? model.pubLnk : null);
    if (pubToken) tokens.push(pubToken);
    if (!tokens.length) return '';
    if (!model.grouped || tokens.length === 1) return tokens.join(', ');
    return `Grp, "${tokens.slice(1).join(', ')}"`;
  }

  function summarizeActionModel(model) {
    const bits = [];
    if (model.grouped) bits.push('Grouped');
    if (model.transferMode === 'posts') bits.push('Transfer posts');
    if (model.transferMode === 'comments') bits.push('Transfer comments');
    if (model.pubLnk && model.pubLnk.enabled) bits.push('Pub link');
    if (model.pubLnk && model.pubLnk.numSequence) bits.push('Numbered');
    if (model.pubLnk && model.pubLnk.punctValue) bits.push(`Bullet ${model.pubLnk.punctValue}`);
    else if (model.pubLnk && model.pubLnk.punctBlank) bits.push('No bullet');
    if (model.pubLnk && model.pubLnk.joinUs) {
      if (model.pubLnk.commentJoinUsMode === 'joinus_only') {
        bits.push('Join Us only in comments');
      } else if (model.pubLnk.commentJoinUsMode === 'append_joinus') {
        bits.push('Description + Join Us in comments');
      } else {
        bits.push('Join Us');
      }
    }
    return bits.join(' · ') || 'No actions';
  }

  window.TelegramActionBuilder = {
    parseActionString,
    serializeActionModel,
    summarizeActionModel,
  };
}());
