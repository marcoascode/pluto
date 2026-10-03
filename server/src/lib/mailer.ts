import nodemailer from 'nodemailer';
import { config } from '../config.js';

const transport = config.mail.host
  ? nodemailer.createTransport({ host: config.mail.host, port: config.mail.port, secure: config.mail.secure, auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined })
  : null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Envia e-mail. Sem SMTP configurado, não envia e devolve false (o admin vê "convite não enviado"). */
export async function sendMail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!transport) {
    console.warn(`[mail] SMTP não configurado; e-mail "${subject}" para ${to} NÃO foi enviado.`);
    return false;
  }
  try {
    await transport.sendMail({ from: config.mail.from, to, subject, html, text });
    return true;
  } catch (e) {
    console.error('[mail] falha ao enviar', (e as Error).message);
    return false;
  }
}

export function inviteEmail(name: string, email: string, password: string) {
  const first = esc(name.split(' ')[0] ?? name);
  const url = config.appUrl + '/login';
  return {
    subject: 'Seu acesso ao Pluto Mídia',
    text: `Olá ${first},\n\nSeu acesso ao Pluto Mídia foi criado.\n\nLogin: ${email}\nSenha temporária: ${password}\n\nAcesse: ${url}\nPor segurança, altere sua senha no primeiro acesso.`,
    html: `<p>Olá ${first},</p><p>Seu acesso ao Pluto Mídia foi criado.</p><p>Login: <b>${esc(email)}</b><br>Senha temporária: <b>${esc(password)}</b></p><p><a href="${url}">Acessar dashboard</a></p><p style="color:#5b6679">Por segurança, altere sua senha no primeiro acesso.</p>`,
  };
}
export function resetEmail(name: string, token: string) {
  const url = `${config.appUrl}/login?reset=${encodeURIComponent(token)}`;
  const first = esc(name.split(' ')[0] ?? name);
  return {
    subject: 'Redefinir sua senha · Pluto Mídia',
    text: `Olá ${first},\n\nPara criar uma nova senha, abra: ${url}\nO link vale por 1 hora. Se não foi você, ignore este e-mail.`,
    html: `<p>Olá ${first},</p><p><a href="${url}">Criar uma nova senha</a></p><p style="color:#5b6679">O link vale por 1 hora. Se não foi você, ignore este e-mail.</p>`,
  };
}
