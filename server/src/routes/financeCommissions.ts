/**
 * Finance — Comissões dos gestores. 0.18.8: ROI dos sites de cada gestor (vínculos de Usuários & Squads) × % da modalidade
 * do gestor (progressiva pelas faixas daqui ou fixa pelo cadastro). Ver services/financeResults.ts.
 * Montado dentro do financeRouter (routes/finance.ts): tudo em /api/finance/*.
 *
 * Quem pode o quê (validado aqui, não só na tela):
 *   Admin/SuperAdmin ... tudo; único que aprova, marca como paga e reabre (faixas e % ficam no cadastro do gestor)
 *   Sócio ............. vê as comissões e os sites das suas Empresas
 *   Gestor ............ vê só os próprios sites e a própria comissão (sem caixa nem outros gestores)
 *   Gerente não sócio . bloqueado (403)
 *
 *   GET  /finance/sites?company                                   sites (domínios) das Empresas, para os selects
 *   GET  /finance/commissions?company&month&user                  comissões do mês + cards dos sites
 *   POST /finance/commissions/approve                             { userId, companyId, month, adjustments?, adjustmentNote? }
 *   POST /finance/commissions/:id/paid   { date, note? }          marca como paga (pagamento feito por fora; não mexe no Caixa)
 *   DELETE /finance/commissions/:id/paid                          desmarca
 *   POST /finance/commissions/:id/reopen { reason }               volta a calcular ao vivo (só se não estiver paga)
 *   GET  /finance/assignments?company&user · POST · PUT /:id · DELETE /:id   períodos "Gestores e sites" (só Admin edita)
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { HttpError, notFound, parse } from '../lib/http.js';
import { today } from '../lib/dates.js';
import { isAdminRole } from '../auth/permissions.js';
import { listSites, normSite } from '../services/financeSources.js';
import { audit, commissionsFor, loadAssignments, r2 } from '../services/financeResults.js';

export const financeCommissionsRouter = Router();
const YM = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const ID = z.string().regex(/^\d+$/);
const SITE = z.string().trim().max(120).transform((s, ctx) => { const n = normSite(s); if (!n) { ctx.addIssue({ code: 'custom', message: 'Site inválido. Use o domínio, ex.: dominiox.com' }); return z.NEVER; } return n; });
const NOWM = () => today().slice(0, 7);
const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };

/* ---------- quem está vendo ---------- */
interface Viewer { userId: string; role: 'admin' | 'partner' | 'manager'; companies: { id: string; name: string }[] }
async function viewer(req: Request, allowManager = false): Promise<Viewer> {
  const u = req.user!;
  if (u.role === 'superadmin') return { userId: u.id, role: 'admin', companies: await q('SELECT id::text, name FROM companies ORDER BY name') };
  // 0.18.11: Admin aprova/paga, mas só nas Empresas em que é sócio
  if (isAdminRole(u.role)) return { userId: u.id, role: 'admin', companies: await q('SELECT c.id::text, c.name FROM companies c JOIN company_users cu ON cu.company_id = c.id WHERE cu.user_id = $1 ORDER BY c.name', [u.id]) };
  const own = await q<{ id: string; name: string }>('SELECT c.id::text, c.name FROM companies c JOIN company_users cu ON cu.company_id = c.id WHERE cu.user_id = $1 ORDER BY c.name', [u.id]);
  if (own.length) return { userId: u.id, role: 'partner', companies: own };
  if (allowManager) {
    // gestor com domínio (Usuários & Squads) num Squad da Empresa (é o gestor do site para as comissões)
    const m = await q<{ id: string; name: string }>(`
      SELECT DISTINCT c.id::text, c.name FROM companies c WHERE c.id IN (
        SELECT a.company_id FROM finance_manager_assignments a WHERE a.user_id = $1
        UNION SELECT sq.company_id FROM domain_managers dm JOIN squad_domains sd ON sd.domain_id = dm.domain_id JOIN squads sq ON sq.id = sd.squad_id WHERE dm.user_id = $1
        UNION SELECT sq.company_id FROM squad_users su JOIN squads sq ON sq.id = su.squad_id WHERE su.user_id = $1)
       ORDER BY c.name`, [u.id]);
    if (m.length) return { userId: u.id, role: 'manager', companies: m };
  }
  throw new HttpError(403, 'forbidden_finance', 'O Finance é só para Admin, sócios das Empresas e gestores com site vinculado (Comissões).');
}
async function scope(req: Request, allowManager = false) {
  const v = await viewer(req, allowManager);
  const c = typeof req.query.company === 'string' ? req.query.company : '';
  if (!c) return { v, sel: v.companies };
  const hit = v.companies.find((x) => x.id === c);
  if (!hit) throw new HttpError(403, 'forbidden_company', 'Você não tem acesso a esta Empresa.');
  return { v, sel: [hit] };
}
const canSee = (v: Viewer, companyId: string) => { if (!v.companies.some((c) => c.id === companyId)) throw new HttpError(403, 'forbidden_company', 'Você não tem acesso a esta Empresa.'); };
const adminOnly = (v: Viewer) => { if (v.role !== 'admin') throw new HttpError(403, 'admin_only', 'Só Admin ou SuperAdmin podem fazer isso.'); };

async function sitesOf(ids: string[]) {
  const src = await listSites(ids);
  const used = await q<{ site: string; companyId: string }>(`
    SELECT DISTINCT site, company_id::text AS "companyId" FROM (
      SELECT site, company_id FROM finance_cash_entries UNION ALL SELECT site, company_id FROM finance_costs UNION ALL SELECT site, company_id FROM finance_manager_assignments) x
     WHERE site IS NOT NULL AND company_id = ANY($1::bigint[])`, [ids]);
  const all = new Map<string, { site: string; companyId: string; revshare?: number | null }>();
  for (const s of [...used, ...src.rows]) all.set(`${s.companyId}|${s.site}`, s);   // o do dash (com revshare) por último, prevalece
  return { sites: [...all.values()].sort((a, b) => a.site.localeCompare(b.site)), sourceError: src.error };
}
financeCommissionsRouter.get('/sites', async (req, res) => {
  const { sel } = await scope(req);
  res.json(await sitesOf(sel.map((c) => c.id)));
});

/* ---------- comissões ---------- */
financeCommissionsRouter.get('/commissions', async (req, res) => {
  const { v, sel } = await scope(req, true);
  const month = req.query.month ? parse(YM, req.query.month) : prevMonth(NOWM());
  const ids = sel.map((c) => c.id);
  const mine = v.role === 'manager' ? v.userId : undefined;
  const { lines: all, sites } = await commissionsFor(ids, month, { userId: mine });
  const who = typeof req.query.user === 'string' && req.query.user ? req.query.user : '';
  const lines = who ? all.filter((l) => l.userId === who) : all;
  // cards dos sites: gestor só vê os dele
  let cards = sites;
  if (mine) cards = cards.filter((c) => c.managers.some((m) => m.userId === mine));
  if (who) cards = cards.filter((c) => c.managers.some((m) => m.userId === who));
  const sum = (f: (x: (typeof lines)[number]) => number) => r2(lines.reduce((a, x) => a + f(x), 0));
  const managers = [...new Map(all.map((l) => [l.userId, l.userName])).entries()].map(([id, name]) => ({ id, name }));
  // meses para o filtro: os últimos 12 (o atual aparece como "em apuração")
  const months: string[] = []; let m = NOWM();
  for (let i = 0; i < 12; i++) { months.push(m); m = prevMonth(m); }
  res.json({
    viewer: { role: v.role, userId: v.userId }, month, months, companies: v.companies, managers,
    lines, sites: cards,
    totals: {
      // ROI total dos gestores (soma das linhas) e comissões
      revenue: sum((l) => l.revenue), ads: sum((l) => l.ads), result: sum((l) => l.profit), resultUsd: sum((l) => l.profitUsd),
      commissions: sum((l) => l.approved ?? l.calculated), toPay: sum((l) => (l.status === 'paid' ? 0 : l.approved ?? l.calculated)), paid: sum((l) => (l.status === 'paid' ? l.approved ?? 0 : 0)),
    },
  });
});

const approveBody = z.object({ userId: ID, companyId: ID, month: YM, adjustments: z.number().min(-1e10).max(1e10).default(0), adjustmentNote: z.string().trim().max(300).nullable().optional() })
  .refine((b) => !b.adjustments || (b.adjustmentNote ?? '').length >= 3, { message: 'Explique o ajuste (ex.: bônus, desconto de erro).' });
financeCommissionsRouter.post('/commissions/approve', async (req, res) => {
  const v = await viewer(req); adminOnly(v);
  const b = parse(approveBody, req.body); canSee(v, b.companyId);
  if (b.month >= NOWM()) throw new HttpError(422, 'month_not_ended', 'Só dá para aprovar depois que o mês fechar.');
  if (await one('SELECT 1 FROM finance_commission_periods WHERE user_id = $1 AND company_id = $2 AND month = $3', [b.userId, b.companyId, `${b.month}-01`]))
    throw new HttpError(409, 'already_approved', 'Esta comissão já foi aprovada. Reabra para recalcular.');
  const line = (await commissionsFor([b.companyId], b.month, { userId: b.userId })).lines[0];
  if (!line || !line.sites.length) throw notFound('Este gestor não tem site vinculado nesta Empresa (Usuários & Squads) com movimento no mês.');
  const approved = r2(Math.max(0, line.calculated + b.adjustments));
  const r = await one<{ id: string }>(`INSERT INTO finance_commission_periods (user_id, company_id, month, base, calculated, adjustments, adjustment_note, approved_amount, approved_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text`, [b.userId, b.companyId, `${b.month}-01`, JSON.stringify(line), line.calculated, b.adjustments, b.adjustmentNote || null, approved, v.userId]);
  await audit(v.userId, b.companyId, 'approve', 'commission', r!.id, null, { calculated: line.calculated, adjustments: b.adjustments, approved, mode: line.mode, pct: line.pct, profit: line.profit });
  res.status(201).json({ id: r!.id, approved });
});
async function getPeriod(id: string) {
  const p = await one<{ id: string; company_id: string; paid_at: string | null; approved_amount: number }>(`SELECT id::text, company_id::text, paid_at::text, approved_amount::float AS approved_amount FROM finance_commission_periods WHERE id = $1`, [id]);
  if (!p) throw notFound('Comissão não encontrada.');
  return p;
}
financeCommissionsRouter.post('/commissions/:id/paid', async (req, res) => {
  const v = await viewer(req); adminOnly(v);
  const p = await getPeriod(parse(ID, req.params.id)); canSee(v, p.company_id);
  const b = parse(z.object({ date: DAY, note: z.string().trim().max(300).nullable().optional() }), req.body);
  if (b.date > today()) throw new HttpError(422, 'future_date', 'A data do pagamento não pode ser depois de hoje.');
  await q('UPDATE finance_commission_periods SET paid_at = $1, paid_note = $2, paid_by = $3 WHERE id = $4', [b.date, b.note || null, v.userId, p.id]);
  await audit(v.userId, p.company_id, 'paid', 'commission', p.id, { paid_at: p.paid_at }, { paid_at: b.date, amount: p.approved_amount }, b.note ?? undefined);
  res.json({ id: p.id, paidAt: b.date });
});
financeCommissionsRouter.delete('/commissions/:id/paid', async (req, res) => {
  const v = await viewer(req); adminOnly(v);
  const p = await getPeriod(parse(ID, req.params.id)); canSee(v, p.company_id);
  await q('UPDATE finance_commission_periods SET paid_at = NULL, paid_note = NULL, paid_by = NULL WHERE id = $1', [p.id]);
  await audit(v.userId, p.company_id, 'unpaid', 'commission', p.id, { paid_at: p.paid_at }, null);
  res.status(204).end();
});
financeCommissionsRouter.post('/commissions/:id/reopen', async (req, res) => {
  const v = await viewer(req); adminOnly(v);
  const p = await getPeriod(parse(ID, req.params.id)); canSee(v, p.company_id);
  if (p.paid_at) throw new HttpError(409, 'already_paid', 'Comissão já marcada como paga. Desmarque o pagamento antes de reabrir.');
  await q('DELETE FROM finance_commission_periods WHERE id = $1', [p.id]);
  await audit(v.userId, p.company_id, 'reopen', 'commission', p.id, p, null, String(req.body?.reason ?? '') || undefined);
  res.status(204).end();
});

/* ---------- períodos gestor × site ("Gestores e sites", na edição do gestor em Usuários & Squads) ----------
   Datas e rateio de quem responde por um site; nos dias que cobrem, valem por cima do Rateio do domínio. */
financeCommissionsRouter.get('/assignments', async (req, res) => {
  const { v, sel } = await scope(req);
  const ids = sel.map((c) => c.id);
  const who = typeof req.query.user === 'string' && /^\d+$/.test(req.query.user) ? req.query.user : undefined;
  const [asg, sites] = await Promise.all([loadAssignments(ids, who), sitesOf(ids)]);
  const managers = v.role === 'admin' ? await q<{ id: string; name: string; role: string }>(`SELECT id::text, name, role FROM users WHERE role = 'gestor' ORDER BY name`) : [];
  res.json({
    viewer: { role: v.role }, companies: v.companies, sites: sites.sites, managers,
    assignments: asg.map((a) => ({ id: a.id, userId: a.user_id, userName: a.user_name, companyId: a.company_id, site: a.site, startDate: a.start_date, endDate: a.end_date, sharePct: a.share_pct, note: a.note })),
  });
});
const asgBody = z.object({ userId: ID, companyId: ID, site: SITE, startDate: DAY, endDate: DAY.nullable().optional(), sharePct: z.number().gt(0).max(100).default(100), note: z.string().trim().max(300).nullable().optional() })
  .refine((b) => !b.endDate || b.endDate >= b.startDate, { message: 'O fim não pode ser antes do início.' });
async function checkShare(b: z.infer<typeof asgBody>, ignoreId?: string) {
  const r = await one<{ total: number }>(`SELECT coalesce(sum(share_pct), 0)::float AS total FROM finance_manager_assignments
    WHERE company_id = $1 AND site = $2 AND ($3::bigint IS NULL OR id <> $3::bigint)
      AND start_date <= coalesce($5::date, '9999-12-31') AND coalesce(end_date, '9999-12-31') >= $4::date`, [b.companyId, b.site, ignoreId ?? null, b.startDate, b.endDate ?? null]);
  if ((r?.total ?? 0) + b.sharePct > 100.0001)
    throw new HttpError(422, 'share_over_100', `Neste período o site já tem ${r!.total}% com outro(s) gestor(es). A soma do rateio não pode passar de 100%.`);
}
async function getAsg(id: string) {
  const a = await one<{ id: string; user_id: string; company_id: string; site: string; start_date: string; end_date: string | null; share_pct: number }>(
    `SELECT id::text, user_id::text, company_id::text, site, start_date::text, end_date::text, share_pct::float AS share_pct FROM finance_manager_assignments WHERE id = $1`, [id]);
  if (!a) throw notFound('Vínculo não encontrado.');
  return a;
}
const hasApproved = async (a: { user_id: string; company_id: string; start_date: string; end_date: string | null }) =>
  !!(await one(`SELECT 1 FROM finance_commission_periods WHERE user_id = $1 AND company_id = $2 AND month BETWEEN date_trunc('month', $3::date) AND coalesce($4::date, '9999-12-31')`, [a.user_id, a.company_id, a.start_date, a.end_date]));
financeCommissionsRouter.post('/assignments', async (req, res) => {
  const v = await viewer(req); adminOnly(v);
  const b = parse(asgBody, req.body); canSee(v, b.companyId);
  if (!(await one('SELECT 1 FROM users WHERE id = $1', [b.userId]))) throw notFound('Usuário não encontrado.');
  await checkShare(b);
  const r = await one<{ id: string }>(`INSERT INTO finance_manager_assignments (user_id, company_id, site, start_date, end_date, share_pct, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`,
    [b.userId, b.companyId, b.site, b.startDate, b.endDate ?? null, b.sharePct, b.note || null, v.userId]);
  await audit(v.userId, b.companyId, 'create', 'assignment', r!.id, null, b);
  res.status(201).json({ id: r!.id });
});
financeCommissionsRouter.put('/assignments/:id', async (req, res) => {
  const v = await viewer(req); adminOnly(v);
  const id = parse(ID, req.params.id);
  const old = await getAsg(id); canSee(v, old.company_id);
  const b = parse(asgBody, req.body); canSee(v, b.companyId);
  const core = old.user_id !== b.userId || old.company_id !== b.companyId || old.site !== b.site || old.start_date !== b.startDate || old.share_pct !== b.sharePct;
  if (core && (await hasApproved(old))) throw new HttpError(409, 'history_locked', 'Este vínculo já tem comissão aprovada. Para trocar gestor, site ou rateio, coloque a data de fim e crie um vínculo novo (os meses anteriores não mudam).');
  await checkShare(b, id);
  await q(`UPDATE finance_manager_assignments SET user_id=$1, company_id=$2, site=$3, start_date=$4, end_date=$5, share_pct=$6, note=$7 WHERE id = $8`,
    [b.userId, b.companyId, b.site, b.startDate, b.endDate ?? null, b.sharePct, b.note || null, id]);
  await audit(v.userId, b.companyId, 'update', 'assignment', id, old, b);
  res.json({ id });
});
financeCommissionsRouter.delete('/assignments/:id', async (req, res) => {
  const v = await viewer(req); adminOnly(v);
  const id = parse(ID, req.params.id);
  const old = await getAsg(id); canSee(v, old.company_id);
  if (await hasApproved(old)) throw new HttpError(409, 'history_locked', 'Este vínculo já tem comissão aprovada. Coloque uma data de fim em vez de excluir.');
  await q('DELETE FROM finance_manager_assignments WHERE id = $1', [id]);
  await audit(v.userId, old.company_id, 'delete', 'assignment', id, old, null);
  res.status(204).end();
});

/* 0.18.10: as faixas da comissão progressiva ficam no cadastro de cada gestor (Usuários & Squads); PUT /commission-rule saiu. */
