import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Skeleton, Stack, Typography, alpha, useTheme } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ApiError } from '@/lib/api/client';

export function PageHead({ title, sub, right, crumb }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; crumb?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' }, mb: 2 }}>
      <Box sx={{ minWidth: 0 }}>
        {crumb && <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>{crumb}</Typography>}
        <Typography variant="h1" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
        {sub && <Typography color="text.secondary" sx={{ mt: 0.5 }}>{sub}</Typography>}
      </Box>
      {right && <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} >{right}</Stack>}
    </Stack>
  );
}
export function Provisional({ show }: { show: boolean }) {
  const { pluto: p } = useTheme();
  if (!show) return null;
  return <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: -1, mb: 1.75 }}><InfoOutlinedIcon sx={{ fontSize: 15, color: p.warn }} /><Typography variant="caption">Dados de Hoje e D-1 a D-3 podem sofrer ajustes durante o fechamento da receita.</Typography></Stack>;
}
export function PageSkeleton() {
  return (
    <Box>
      <Skeleton variant="rounded" width={240} height={30} />
      <Grid container spacing={1.75} sx={{ mt: 2 }}>{Array.from({ length: 5 }, (_, i) => <Grid key={i} size={{ xs: 6, md: 4, lg: 'grow' }}><Skeleton variant="rounded" height={112} /></Grid>)}</Grid>
      <Skeleton variant="rounded" height={66} sx={{ mt: 1.75 }} />
      <Grid container spacing={1.75} sx={{ mt: 0.25 }}><Grid size={{ xs: 12, md: 6 }}><Skeleton variant="rounded" height={300} /></Grid><Grid size={{ xs: 12, md: 6 }}><Skeleton variant="rounded" height={300} /></Grid></Grid>
    </Box>
  );
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : 'Não foi possível carregar os dados.';
  return <Alert severity="error" variant="outlined" action={retry && <Button color="inherit" size="small" onClick={retry}>Tentar de novo</Button>}>{msg}</Alert>;
}
export function NoAccess({ msg }: { msg: string }) {
  return (
    <Card sx={{ maxWidth: 560, mx: 'auto', mt: 5 }}><CardContent sx={{ textAlign: 'center', py: 4.5 }}>
      <LockOutlinedIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1.5 }} />
      <Typography variant="h2">Acesso restrito</Typography><Typography color="text.secondary" sx={{ my: 1.5 }}>{msg}</Typography>
      <Button variant="outlined" component={RouterLink} to="/">Voltar ao Dashboard</Button>
    </CardContent></Card>
  );
}
const STATUS: Record<string, [string, string]> = { ok: ['pos', 'Conectado'], late: ['warn', 'Sincronização atrasada'], error: ['neg', 'Erro na API'], permission: ['neg', 'Permissão insuficiente'], token: ['warn', 'Token expirando'], disconnected: ['neg', 'Desconectado'], not_imported: ['na', 'Não importada'] };
export function StatusChip({ status }: { status: string }) {
  const { pluto: p } = useTheme();
  const [k, l] = STATUS[status] ?? ['na', status];
  const c = { pos: p.pos, warn: p.warn, neg: p.neg, na: p.na }[k as 'pos'];
  return <Chip size="small" label={l} sx={{ color: c, bgcolor: alpha(c, 0.15), fontWeight: 500 }} />;
}
/** Chip de status genérico (ok / atenção / erro / neutro). */
export function Tag({ tone = 'na', children }: { tone?: 'pos' | 'warn' | 'neg' | 'na' | 'accent'; children: ReactNode }) {
  const { pluto: p } = useTheme();
  const c = { pos: p.pos, warn: p.warn, neg: p.neg, na: p.fg2, accent: p.accent }[tone];
  return <Chip size="small" label={children} sx={{ color: c, bgcolor: alpha(tone === 'na' ? p.na : c, tone === 'na' ? 0.18 : 0.15), fontWeight: 500 }} />;
}
export async function copyText(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }
/** Bloco "rótulo + valor" usado em cartões pequenos. */
export function Stat({ label, children, big }: { label: string; children: ReactNode; big?: boolean }) {
  return <Box sx={{ minWidth: 0 }}><Typography variant="caption" component="div">{label}</Typography><Typography sx={{ fontWeight: 600, fontSize: big ? 18 : 15, fontFamily: big ? 'Sora' : undefined, overflowWrap: 'anywhere' }} component="div">{children}</Typography></Box>;
}

/** Confirmação antes de excluir (nada de window.confirm). */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Excluir', danger = true, busy, onConfirm, onClose }: { open: boolean; title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><Typography color="text.secondary" component="div">{children}</Typography></DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancelar</Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} disabled={busy} onClick={onConfirm}>{busy ? 'Aguarde…' : confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
