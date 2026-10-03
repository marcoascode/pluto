import { Box, Button, Checkbox, FormControlLabel, FormGroup, Popover, Stack, Typography } from '@mui/material';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { useState } from 'react';
import { usePrefs } from '@/context/PrefsContext';
import { METRIC_DEFS, PICKERS, type MetricKey } from '@/lib/metrics';

export function usePicked(screen: keyof typeof PICKERS): MetricKey[] {
  const { prefs } = usePrefs();
  const all = PICKERS[screen].all;
  return ((prefs.metrics?.[screen] as MetricKey[] | undefined) ?? PICKERS[screen].def).filter((k) => all.includes(k));
}

/** "Selecionar métricas" — a escolha fica salva por usuário no servidor. */
export function MetricPicker({ screen }: { screen: keyof typeof PICKERS }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { prefs, update } = usePrefs();
  const picked = usePicked(screen);
  const toggle = (k: MetricKey, on: boolean) => {
    const next = on ? PICKERS[screen].all.filter((x) => x === k || picked.includes(x)) : picked.filter((x) => x !== k);
    update({ metrics: { ...(prefs.metrics ?? {}), [screen]: next } });
  };
  const reset = () => { const m = { ...(prefs.metrics ?? {}) }; delete m[screen]; update({ metrics: m }); };
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<TuneRoundedIcon />} onClick={(e) => setAnchor(e.currentTarget)}>Selecionar métricas</Button>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ p: 1.5, width: 240 }}>
          <Typography variant="overline">Métricas visíveis</Typography>
          <FormGroup>{PICKERS[screen].all.map((k) => (
            <FormControlLabel key={k} control={<Checkbox size="small" checked={picked.includes(k)} onChange={(e) => toggle(k, e.target.checked)} />} label={METRIC_DEFS[k].label} slotProps={{ typography: { sx: { fontSize: 13 } } }} />
          ))}</FormGroup>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}><Button size="small" variant="outlined" onClick={reset}>Padrão</Button><Typography variant="caption">Salvo no seu usuário</Typography></Stack>
        </Box>
      </Popover>
    </>
  );
}
