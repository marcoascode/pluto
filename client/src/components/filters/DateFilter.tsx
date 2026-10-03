import { Box, Button, Drawer, List, ListItemButton, ListItemText, Popover, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { PickerDay, type PickerDayProps } from '@mui/x-date-pickers/PickerDay';
import dayjs, { type Dayjs } from 'dayjs';
import { createContext, useContext, useState } from 'react';
import { useFilters } from '@/context/FiltersContext';
import { PRESETS, addDays, todayISO } from '@/lib/period';
import { shortDate } from '@/lib/format';

const MIN_DAYS_BACK = 180; // até onde o calendário deixa voltar (ajuste ao que o banco guarda)
const RangeCtx = createContext<{ from: string; to: string; pick: string | null }>({ from: '', to: '', pick: null });

/** Dia do calendário com destaque do intervalo selecionado. */
function RangeDay(props: PickerDayProps) {
  const { from, to, pick } = useContext(RangeCtx);
  const { pluto: p } = useTheme();
  const iso = (props.day as Dayjs).format('YYYY-MM-DD');
  const inRange = !props.outsideCurrentMonth && iso >= from && iso <= to;
  const edge = !props.outsideCurrentMonth && (iso === from || iso === to || iso === pick);
  return <PickerDay {...props} selected={edge} sx={{ ...(inRange && !edge ? { bgcolor: 'rgba(91,155,255,.16)', borderRadius: 2 } : {}), ...(edge ? { bgcolor: `${p.accent2} !important`, color: '#fff' } : {}) }} />;
}

/** Botão "Data": atalhos + calendário (1 clique = um dia, 2 cliques = intervalo). Sempre abre em Hoje. */
export function DateFilter() {
  const f = useFilters();
  const mobile = useMediaQuery(useTheme().breakpoints.down('md'));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const close = () => { setAnchor(null); setPick(null); };
  const max = todayISO(); const min = addDays(max, -MIN_DAYS_BACK);
  const range = f.from === f.to ? shortDate(f.from) : `${shortDate(f.from)} – ${shortDate(f.to)}`;
  const label = f.preset === 'custom' ? range : `${PRESETS.find((p) => p.key === f.preset)!.label} · ${range}`;
  const onDay = (d: Dayjs | null) => {
    if (!d) return; const iso = d.format('YYYY-MM-DD');
    if (!pick) { setPick(iso); f.setCustom(iso, iso); } else { f.setCustom(pick, iso); close(); }
  };

  const content = (
    <Stack direction={{ xs: 'column', md: 'row' }}>
      <List dense sx={{ p: 1, minWidth: 160, borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: 'divider', display: { xs: 'flex', md: 'block' }, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <ListItemButton key={p.key} selected={f.preset === p.key} onClick={() => { f.setPreset(p.key); close(); }} sx={{ flex: { xs: '0 0 auto', md: 'unset' } }}>
            <ListItemText primary={p.label} slotProps={{ primary: { sx: { fontSize: 13 } } }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ p: 1 }}>
        <RangeCtx.Provider value={{ from: f.from, to: f.to, pick }}>
          <DateCalendar value={dayjs(pick ?? f.to)} onChange={onDay} minDate={dayjs(min)} maxDate={dayjs(max)} slots={{ day: RangeDay }} views={['day']} />
        </RangeCtx.Provider>
        <Typography variant="caption" sx={{ px: 2, display: 'block', pb: 1 }}>{pick ? 'Agora clique na data final.' : 'Clique em um dia, ou em dois para um intervalo.'}</Typography>
      </Box>
    </Stack>
  );
  return (
    <>
      <Button variant="outlined" onClick={(e) => setAnchor(e.currentTarget)} startIcon={<CalendarMonthOutlinedIcon sx={{ color: 'primary.light' }} />} endIcon={<ExpandMoreRoundedIcon />} sx={{ bgcolor: 'background.paper', flexShrink: 0 }}>
        <Typography component="span" variant="caption" sx={{ mr: 1 }}>Data</Typography><b>{label}</b>
      </Button>
      {mobile
        ? <Drawer anchor="bottom" open={!!anchor} onClose={close} slotProps={{ paper: { sx: { borderRadius: '18px 18px 0 0' } } }}>{content}</Drawer>
        : <Popover open={!!anchor} anchorEl={anchor} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} sx={{ mt: 1 }}>{content}</Popover>}
    </>
  );
}
