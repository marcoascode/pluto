import { Box, Button, Checkbox, Divider, ListItemButton, ListSubheader, Popover, Stack, Tooltip, Typography } from '@mui/material';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { Fragment, useState } from 'react';
import { usePrefs } from '@/context/PrefsContext';
import { BLOCKS, METRIC_DEFS, PICKERS, orderFor, type MetricKey, noSessions } from '@/lib/metrics';

export function usePicked(screen: keyof typeof PICKERS): MetricKey[] {
  const { prefs } = usePrefs();
  const all = PICKERS[screen].all;
  // ordem dos blocos; nas telas de campanha o ROI e o ROI do dia ficam na ponta direita (mesmo em escolhas antigas)
  return orderFor(screen, noSessions((prefs.metrics?.[screen] as MetricKey[] | undefined) ?? PICKERS[screen].def).filter((k) => all.includes(k)));
}

/**
 * "Selecionar métricas" — separado nos blocos Resultados / Despesas / Receitas (ListSubheader), na ordem das colunas.
 * Receita e IVA aparecem em dois grupos e são a mesma coluna (marcar num marca no outro). A escolha fica salva por usuário.
 */
export function MetricPicker({ screen }: { screen: keyof typeof PICKERS }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { prefs, update } = usePrefs();
  const picked = usePicked(screen);
  const all = PICKERS[screen].all;
  const toggle = (k: MetricKey) => {
    const next = picked.includes(k) ? picked.filter((x) => x !== k) : orderFor(screen, [...picked, k]);
    update({ metrics: { ...(prefs.metrics ?? {}), [screen]: next } });
  };
  const reset = () => { const m = { ...(prefs.metrics ?? {}) }; delete m[screen]; update({ metrics: m }); };
  const groups = BLOCKS.map((b) => ({ ...b, keys: b.keys.filter((k) => all.includes(k)) })).filter((b) => b.keys.length);
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<TuneRoundedIcon />} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="listbox">Selecionar métricas</Button>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 270, maxHeight: '72vh', display: 'flex', flexDirection: 'column' } } }}>
        <Box sx={{ overflowY: 'auto', flex: 1 }} role="listbox" aria-multiselectable="true" aria-label="Métricas visíveis">
          {groups.map((g, gi) => (
            <Fragment key={g.key}>
              {gi > 0 && <Divider />}
              <ListSubheader sx={{ lineHeight: '34px', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', bgcolor: 'background.paper' }}>{g.label}</ListSubheader>
              {g.keys.map((k) => {
                const d = METRIC_DEFS[k];
                const item = (
                  <ListItemButton key={k} dense onClick={() => toggle(k)} role="option" aria-selected={picked.includes(k)} sx={{ py: 0.25, pl: 1 }}>
                    <Checkbox size="small" checked={picked.includes(k)} tabIndex={-1} sx={{ p: 0.5, mr: 0.75 }} />
                    <Typography sx={{ fontSize: 13 }}>{d.label}</Typography>
                  </ListItemButton>
                );
                return d.hint ? <Tooltip key={k} title={d.hint} placement="left" enterDelay={400} describeChild>{item}</Tooltip> : item;
              })}
            </Fragment>
          ))}
        </Box>
        <Divider />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.25 }}><Button size="small" variant="outlined" onClick={reset}>Padrão</Button><Typography variant="caption">Salvo no seu usuário</Typography></Stack>
      </Popover>
    </>
  );
}
