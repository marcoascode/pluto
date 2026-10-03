import { Box, Button, IconButton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { usePrefs } from '@/context/PrefsContext';
import type { DomainSummary, Preferences } from '@/types/api';
import { DomainCard } from './DomainCard';

type SortKey = NonNullable<Preferences['domainSort']>;
const SORTS: { k: SortKey; label: string }[] = [{ k: 'revenue', label: 'Revenue' }, { k: 'roi', label: 'ROI' }, { k: 'spend', label: 'Custo' }, { k: 'profit', label: 'Profit' }];

/** Fila lateral de domínios, ordenada pelo critério escolhido (salvo por usuário). */
export function DomainStrip({ domains }: { domains: DomainSummary[] }) {
  const { prefs, update } = usePrefs();
  const k = prefs.domainSort ?? 'revenue';
  const label = SORTS.find((s) => s.k === k)!.label;
  const ord = domains.slice().sort((a, b) => (b.metrics[k] ?? -Infinity) - (a.metrics[k] ?? -Infinity));
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <Box sx={{ mt: 3 }}>
      <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.25 }}>
        <Typography variant="h2">Domínios / Sites</Typography>
        <ToggleButtonGroup size="small" exclusive value={k} onChange={(_, v: SortKey | null) => v && update({ domainSort: v })} aria-label="Ordenar domínios" sx={{ order: { xs: 5, sm: 0 } }}>
          {SORTS.map((s) => <ToggleButton key={s.k} value={s.k}>{s.label}</ToggleButton>)}
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={() => scroll(-1)} aria-label="Voltar"><ChevronLeftRoundedIcon fontSize="small" /></IconButton>
        <IconButton size="small" onClick={() => scroll(1)} aria-label="Avançar"><ChevronRightRoundedIcon fontSize="small" /></IconButton>
        <Button size="small" variant="outlined" component={RouterLink} to="/dominios">Ver todos</Button>
      </Stack>
      <Box ref={ref} sx={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: { xs: '84%', md: 'minmax(340px, calc((100% - 28px)/3))' }, gap: 1.75, overflowX: 'auto', scrollSnapType: 'x mandatory', pb: 1.25, '& > *': { scrollSnapAlign: 'start' } }}>
        {ord.map((d, i) => <DomainCard key={d.domain} d={d} rank={i + 1} rankLabel={label} />)}
      </Box>
      {!ord.length && <Typography variant="caption">Nenhum domínio liberado para o seu Squad.</Typography>}
    </Box>
  );
}
