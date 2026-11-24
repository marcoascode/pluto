/**
 * 0.18.10 · Faixas da comissão progressiva no cadastro do gestor (Usuários & Squads → editar gestor).
 * A faixa atingida pelo ROI total do mês vale para o ROI todo; sem ROI positivo, sem comissão.
 * Valores como texto (vírgula decimal); a conversão e a validação ficam em parseTiers().
 */
import { Box, Button, IconButton, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { curSym, DEFAULT_TIERS, parseNum, tiersText, type Tier } from '@/lib/financeOps';
import type { Currency } from '@/types/api';

export interface TierDraft { from: string; pct: string }
const txt = (n: number) => String(n).replace('.', ',');
export const toDraft = (tiers?: Tier[] | null): TierDraft[] => [...(tiers?.length ? tiers : DEFAULT_TIERS)].sort((a, b) => a.from - b.from).map((t) => ({ from: txt(t.from), pct: txt(t.pct) }));

/** Converte e confere as faixas. Devolve as faixas ou a mensagem de erro. */
export function parseTiers(d: TierDraft[]): Tier[] | string {
  const list = d.map((t, i) => ({ from: i === 0 ? 0 : parseNum(t.from), pct: parseNum(t.pct) }));
  if (!list.length) return 'Informe ao menos uma faixa da comissão progressiva.';
  if (list.some((t) => !Number.isFinite(t.from) || t.from < 0)) return 'Comissão progressiva: o patamar de cada faixa precisa ser um valor a partir de 0.';
  if (list.some((t) => !Number.isFinite(t.pct) || t.pct < 0 || t.pct > 100)) return 'Comissão progressiva: a % de cada faixa precisa estar entre 0 e 100.';
  if (new Set(list.map((t) => t.from)).size !== list.length) return 'Comissão progressiva: duas faixas não podem começar no mesmo valor.';
  return list.sort((a, b) => a.from - b.from);
}

export function CommissionTiersEditor({ value, currency, onChange, onCurrency }: { value: TierDraft[]; currency: Currency; onChange: (v: TierDraft[]) => void; onCurrency: (c: Currency) => void }) {
  const set = (i: number, k: keyof TierDraft, v: string) => onChange(value.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const parsed = parseTiers(value);
  return (
    <Stack spacing={1}>
      <Typography variant="caption">ROI total do mês nos sites que ele gere: a faixa atingida vale para o ROI todo.</Typography>
      {value.map((t, i) => (
        <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField size="small" label="ROI a partir de" value={i === 0 ? '0' : t.from} disabled={i === 0} onChange={(e) => set(i, 'from', e.target.value)} sx={{ flex: 1 }}
            slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { startAdornment: <InputAdornment position="start">{curSym(currency)}</InputAdornment> } }} />
          <TextField size="small" label="Comissão" value={t.pct} onChange={(e) => set(i, 'pct', e.target.value)} sx={{ width: 118 }}
            slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }} />
          <IconButton size="small" disabled={i === 0} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remover faixa"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
        </Stack>
      ))}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button size="small" startIcon={<AddRoundedIcon />} disabled={value.length >= 10}
          onClick={() => { const last = value[value.length - 1]; onChange([...value, { from: txt((parseNum(last?.from ?? '0') || 0) + 20000), pct: txt((parseNum(last?.pct ?? '10') || 10) + 2) }]); }}>Faixa</Button>
        <Button size="small" onClick={() => { onChange(toDraft(DEFAULT_TIERS)); onCurrency('USD'); }}>Restaurar padrão</Button>
        <Box sx={{ flex: 1 }} />
        <TextField select size="small" label="Moeda" value={currency} onChange={(e) => onCurrency(e.target.value as Currency)} sx={{ width: 100 }}>{(['USD', 'BRL', 'EUR'] as Currency[]).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}</TextField>
      </Stack>
      <Typography variant="caption" sx={{ color: typeof parsed === 'string' ? 'error.main' : undefined }}>
        {typeof parsed === 'string' ? parsed : tiersText(parsed, currency)}
      </Typography>
    </Stack>
  );
}
