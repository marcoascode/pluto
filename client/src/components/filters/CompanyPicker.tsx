import { Avatar, AvatarGroup, Box, Button, ButtonBase, Chip, Divider, IconButton, Popover, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { useMyCompanies } from '@/hooks/queries';
import { initials } from '@/lib/format';
import type { MyCompany } from '@/types/api';

/**
 * Seletor "Empresa" (ao lado da Moeda). Cada Empresa = sociedade (sócios) → Squads → domínios.
 * Escolher uma Empresa filtra o painel inteiro (?company= em toda chamada). "Abrir painel" leva para /empresas/:id.
 * Some quando o usuário não vê nenhuma Empresa.
 */
export function CompanyPicker() {
  const { pluto: p } = useTheme();
  const { company, setCompany } = useFilters();
  const { data } = useMyCompanies();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const list = data?.companies ?? [];
  const cur = list.find((c) => c.id === company);
  // Empresa guardada que o usuário não vê mais (perdeu acesso / foi excluída): volta para "Todas"
  useEffect(() => { if (data && company && !cur) setCompany(''); }, [data, company, cur, setCompany]);
  if (!list.length) return null;
  const pick = (id: string) => { setCompany(id); setAnchor(null); };
  const open = (c: MyCompany) => { setCompany(c.id); setAnchor(null); navigate(`/empresas/${c.id}`); };
  const allDomains = new Set(list.flatMap((c) => c.domains)).size;
  return (
    <>
      <Button size="small" variant="outlined" onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="dialog" aria-label="Empresa"
        startIcon={<ApartmentRoundedIcon sx={{ fontSize: '17px !important', color: cur ? p.accent : undefined }} />} endIcon={<KeyboardArrowDownRoundedIcon />}
        sx={{ flexShrink: 0, maxWidth: 240, justifyContent: 'space-between', color: 'text.primary', fontWeight: 500, height: 32, ...(cur ? { borderColor: alpha(p.accent, 0.6), bgcolor: alpha(p.accent, 0.08) } : {}) }}>
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cur ? cur.name : <><Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, mr: 0.5, display: { xs: 'none', sm: 'inline' } }}>Empresa</Box>Todas</>}
        </Box>
      </Button>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 'min(440px, calc(100vw - 24px))', maxHeight: '70vh', mt: 0.75 } } }}>
        <Box sx={{ px: 2, pt: 1.75, pb: 1 }}>
          <Typography variant="overline">Empresas</Typography>
          <Typography variant="caption" component="div">Escolha uma Empresa para ver só os Squads, domínios e números dela.</Typography>
        </Box>
        <Row selected={!company} onClick={() => pick('')}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Avatar variant="rounded" sx={{ width: 34, height: 34, bgcolor: p.panel3, color: p.fg2 }}><ApartmentRoundedIcon fontSize="small" /></Avatar>
            <Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 600 }}>Todas as empresas</Typography><Typography variant="caption">{list.length} empresa{list.length > 1 ? 's' : ''} · {allDomains} domínio{allDomains === 1 ? '' : 's'}</Typography></Box>
            {!company && <CheckRoundedIcon fontSize="small" sx={{ color: p.accent }} />}
          </Stack>
        </Row>
        <Divider />
        {list.map((c) => (
          <Row key={c.id} selected={c.id === company} onClick={() => pick(c.id)}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
              <Avatar variant="rounded" sx={{ width: 34, height: 34, fontSize: 13, fontWeight: 700, background: `linear-gradient(135deg, hsl(${hue(c.name)} 62% 48%), hsl(${(hue(c.name) + 40) % 360} 58% 30%))`, color: '#fff' }}>{initials(c.name.replace(/^empresa (d[aeo]s? )?/i, ''))}</Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{c.name}</Typography>
                  {c.id === company && <CheckRoundedIcon fontSize="small" sx={{ color: p.accent }} />}
                </Stack>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 0.4 }}>
                  {c.partners.length > 0 && (
                    <AvatarGroup max={4} sx={{ '& .MuiAvatar-root': { width: 20, height: 20, fontSize: 9, borderColor: p.panel2 } }}>
                      {c.partners.map((s) => <Tooltip key={s.id} title={s.name}><Avatar sx={{ background: 'linear-gradient(135deg,#2f6fe0,#1b3f86)', color: '#fff' }}>{initials(s.name)}</Avatar></Tooltip>)}
                    </AvatarGroup>
                  )}
                  <Typography variant="caption" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.partners.length ? c.partners.map((s) => s.name.split(' ')[0]).join(' · ') : 'Sem sócios cadastrados'}
                  </Typography>
                </Stack>
                <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>{c.squads.length} Squad{c.squads.length === 1 ? '' : 's'} · {c.domains.length} domínio{c.domains.length === 1 ? '' : 's'}</Typography>
                <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.75 }}>
                  {c.squads.map((s) => <Chip key={s.id} size="small" label={`${s.name} · ${s.domains.length}`} sx={{ height: 20, fontSize: 11, bgcolor: p.panel3 }} />)}
                </Stack>
              </Box>
              <Tooltip title="Abrir painel da Empresa"><IconButton size="small" onClick={(e) => { e.stopPropagation(); open(c); }} aria-label={`Abrir painel de ${c.name}`}><OpenInNewRoundedIcon fontSize="small" /></IconButton></Tooltip>
            </Stack>
          </Row>
        ))}
      </Popover>
    </>
  );
}

function Row({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  const { pluto: p } = useTheme();
  return (
    <ButtonBase component="div" onClick={onClick} sx={{ display: 'block', width: '100%', textAlign: 'left', px: 2, py: 1.25, boxShadow: selected ? `inset 3px 0 0 ${p.accent}` : 'none', bgcolor: selected ? alpha(p.accent, 0.08) : 'transparent', '&:hover': { bgcolor: alpha(p.accent, 0.12) } }}>
      {children}
    </ButtonBase>
  );
}
const hue = (s: string) => { let h = 11; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
