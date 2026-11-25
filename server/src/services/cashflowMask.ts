/**
 * 0.18.16 · Fluxo de caixa — mascara dados pessoais do texto da fatura ANTES de enviá-lo ao Claude.
 * O PDF nunca vai à IA: só este texto, já sem CPF/CNPJ, nome do titular, número do cartão (fica só o final),
 * endereço/CEP, e-mail, telefone e código de barras. O que é mascarado fica contado para mostrar na revisão.
 *
 * É uma proteção por padrões: cobre o formato das faturas dos bancos brasileiros, mas não garante 100%
 * (ex.: um nome de adicional que não aparece perto de "Titular"/"Nome" e não é o do usuário).
 */

export type MaskCounts = Record<'cpf' | 'cnpj' | 'card' | 'email' | 'phone' | 'cep' | 'address' | 'name' | 'barcode', number>;

const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Palavras que não são nome de pessoa (nunca mascaradas sozinhas). */
const NOT_NAME = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'CARTAO', 'CREDITO', 'FATURA', 'TITULAR', 'ADICIONAL', 'NOME', 'CLIENTE', 'FINAL', 'VISA', 'MASTERCARD', 'ELO', 'AMEX', 'BLACK', 'GOLD', 'PLATINUM', 'INFINITE', 'SIGNATURE', 'INTERNACIONAL', 'NACIONAL', 'BANCO', 'BRASIL', 'SAO', 'PAULO', 'RIO', 'JANEIRO', 'SANTOS', 'SANTA', 'SANTO', 'LTDA', 'ME', 'EIRELI']);

const ADDRESS_LINE = /^\s*(RUA|R\.|AV\.?|AVENIDA|ALAMEDA|AL\.|TRAVESSA|TV\.|ESTRADA|ESTR\.|RODOVIA|ROD\.|PRACA|PCA\.?|LARGO|QUADRA|QD\.?|SQN|SQS|SHIN|SHIS|CONDOMINIO|LOTEAMENTO|BAIRRO|COMPLEMENTO|APTO|APARTAMENTO|BLOCO)\b/i;
/** Rótulos que antecedem o nome do titular/portador. */
const NAME_LABEL = /\b(?:TITULAR(?:\s+DO\s+CARTAO)?|NOME(?:\s+DO\s+(?:TITULAR|CLIENTE|PORTADOR))?|PORTADOR|CLIENTE|OLA|PREZADO\(?A?\)?|PREZADA)\s*[:,-]?\s+([A-Z][A-Z' ]{4,60})/i;

export function maskPersonalData(lines: string[], knownNames: string[]): { text: string; counts: MaskCounts } {
  const counts: MaskCounts = { cpf: 0, cnpj: 0, card: 0, email: 0, phone: 0, cep: 0, address: 0, name: 0, barcode: 0 };

  // 1) nomes: o do usuário do Pluto + o que vier depois de "Titular", "Nome", "Olá"… (texto sem acento, em maiúsculas)
  const up = lines.map((l) => strip(l));   // sem acento, caixa original (as regras abaixo ignoram maiúsculas/minúsculas)
  const names = new Set<string>();
  for (const n of knownNames) if (n.trim()) names.add(strip(n).toUpperCase().trim());
  for (const l of up) {
    const m = NAME_LABEL.exec(l);
    if (m) {
      const cand = m[1].replace(/\s{2,}.*$/, '').trim().toUpperCase();          // até o próximo "buraco" de coluna
      if (cand.split(' ').filter((w) => w.length >= 2 && !NOT_NAME.has(w)).length >= 2) names.add(cand);
    }
  }
  const tokens = new Set<string>();
  for (const n of names) for (const w of n.split(/\s+/)) if (w.length >= 3 && !NOT_NAME.has(w)) tokens.add(w);
  const fullRes = [...names].sort((a, b) => b.length - a.length).map((n) => new RegExp(`\\b${n.split(/\s+/).map(esc).join('\\s+')}\\b`, 'gi'));
  const tokenRe = tokens.size ? new RegExp(`\\b(?:${[...tokens].map(esc).join('|')})\\b`, 'gi') : null;

  const out = up.map((l) => {
    if (!l.trim()) return l;
    // linha de endereço (ou com CEP) sai inteira
    if (ADDRESS_LINE.test(l) || /\b\d{5}-\d{3}\b/.test(l)) {
      counts.address++;
      if (/\b\d{5}-\d{3}\b/.test(l)) counts.cep++;
      return '[ENDERECO]';
    }
    let s = l;
    const rep = (re: RegExp, k: keyof MaskCounts, by: string | ((...a: string[]) => string)) => {
      s = s.replace(re, (...a: string[]) => { counts[k]++; return typeof by === 'string' ? by : by(...a); });
    };
    rep(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'email', '[EMAIL]');
    rep(/\b\d{5}[.\s]?\d{5}\s+\d{5}[.\s]?\d{6}\s+\d{5}[.\s]?\d{6}\s+\d\s+\d{14}\b/g, 'barcode', '[CODIGO DE BARRAS]');   // linha digitável
    rep(/\b\d{44,48}\b/g, 'barcode', '[CODIGO DE BARRAS]');
    rep(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, 'cnpj', '[CNPJ]');
    rep(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, 'cpf', '[CPF]');
    rep(/\b(?:\d{3}|[X*•.]{3})\.(?:\d{3}|[X*•]{3})\.(?:\d{3}|[X*•]{3})-(?:\d{2}|[X*•]{2})\b/gi, 'cpf', '[CPF]');   // CPF parcialmente oculto
    // número do cartão (completo ou com XXXX/****): fica só o final
    rep(/\b(?:\d{4}|[X*•]{4})(?:[ .-]?(?:\d{4}|[X*•]{4})){2}[ .-]?(\d{4})\b/gi, 'card', (_m, last4) => `CARTAO FINAL ${last4}`);
    rep(/\b\d{13,19}\b/g, 'card', (m) => `CARTAO FINAL ${m.slice(-4)}`);
    rep(/(?:\(?\b\d{2}\)?\s?)?\b9?\d{4}-\d{4}\b/g, 'phone', '[TELEFONE]');
    rep(/\(\d{2}\)\s?9?\d{4}\s?\d{4}\b/g, 'phone', '[TELEFONE]');
    for (const re of fullRes) rep(re, 'name', '[TITULAR]');
    if (tokenRe) rep(tokenRe, 'name', '[TITULAR]');
    return s;
  });
  // linhas vazias seguidas viram uma só
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, counts };
}
