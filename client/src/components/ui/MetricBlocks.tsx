import { TableCell, TableRow, useTheme } from '@mui/material';
import { BLOCK_OF, BLOCKS, type BlockKey, type MetricKey } from '@/lib/metrics';

/** Blocos contíguos das colunas escolhidas (Resultados / Despesas / Receitas) para o cabeçalho dos relatórios mistos. */
export function blockSpans(ms: MetricKey[]): { key: BlockKey; label: string; span: number; first: MetricKey }[] {
  const out: { key: BlockKey; label: string; span: number; first: MetricKey }[] = [];
  for (const k of ms) {
    const b = BLOCK_OF[k];
    const last = out[out.length - 1];
    if (last && last.key === b) last.span++;
    else out.push({ key: b, label: BLOCKS.find((x) => x.key === b)!.label, span: 1, first: k });
  }
  return out;
}
/** Primeira coluna de cada bloco (ganha a linha divisória à esquerda). */
export const blockStarts = (ms: MetricKey[]) => new Set(blockSpans(ms).map((b) => b.first));

/** Linha de cima do cabeçalho: um título por bloco, ocupando as colunas dele. `lead` = células antes das métricas. */
export function BlockHeaderRow({ ms, lead }: { ms: MetricKey[]; lead: React.ReactNode }) {
  const { pluto: p } = useTheme();
  const tone: Record<BlockKey, string> = { results: p.pos, costs: p.spend, revenue: p.rev, roiDays: p.fg2 };
  return (
    <TableRow>
      {lead}
      {blockSpans(ms).map((b) => (
        <TableCell key={b.key + b.first} colSpan={b.span} align="center"
          sx={{ py: '6px !important', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: tone[b.key], borderLeft: `1px solid ${p.line2}`, borderBottom: `2px solid ${tone[b.key]}` }}>
          {b.label}
        </TableCell>
      ))}
    </TableRow>
  );
}
