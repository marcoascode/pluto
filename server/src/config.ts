/** Configuração vinda do ambiente (docker-compose / .env). Falha cedo se faltar algo essencial. */
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}
const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  /** URL pública do app (links do e-mail, OAuth redirect, checagem de Origin). */
  appUrl: req('APP_URL', isProd ? undefined : 'http://localhost:5173').replace(/\/$/, ''),
  /** Timezone da organização: agrega os dias e define "hoje". */
  appTz: process.env.APP_TZ ?? 'America/Sao_Paulo',
  db: {
    host: req('PGHOST', 'localhost'),
    port: Number(process.env.PGPORT ?? 5432),
    database: req('PGDATABASE', 'pluto'),
    user: req('PGUSER', 'pluto'),
    password: req('PGPASSWORD', isProd ? undefined : 'pluto'),
    max: Number(process.env.PGPOOL_MAX ?? 10),
    ssl: bool(process.env.PGSSL, false),
  },
  session: {
    cookie: process.env.SESSION_COOKIE ?? 'pluto_session',
    days: Number(process.env.SESSION_DAYS ?? 7),
    secure: bool(process.env.COOKIE_SECURE, isProd),
  },
  /** 32 bytes em base64 (openssl rand -base64 32). Criptografa os tokens OAuth no banco. */
  tokenEncKey: req('TOKEN_ENC_KEY', isProd ? undefined : 'ZGV2LW9ubHktZGV2LW9ubHktZGV2LW9ubHktZGV2LTA='),
  admin: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, name: process.env.ADMIN_NAME ?? 'Administrador' },
  mail: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM ?? 'Pluto Mídia <admin@plutomidia.com.br>',
  },
  oauth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    metaAppId: process.env.META_APP_ID,
    metaAppSecret: process.env.META_APP_SECRET,
    metaApiVersion: process.env.META_API_VERSION ?? 'v21.0',
  },
  fx: {
    /** Frankfurter (sem chave). Pode trocar por outra instância (self-host) se quiser. */
    url: process.env.FX_API_URL ?? 'https://api.frankfurter.dev/v2/rates',
    fallbackUrl: process.env.FX_FALLBACK_URL ?? 'https://open.er-api.com/v6/latest/USD',
    backfillDays: Number(process.env.FX_BACKFILL_DAYS ?? 430),
  },
  schedulerEnabled: bool(process.env.SCHEDULER_ENABLED, true),
} as const;
