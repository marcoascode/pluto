import { Box, ButtonBase, Card, CardHeader, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import FacebookRoundedIcon from '@mui/icons-material/FacebookRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import { useFilters } from '@/context/FiltersContext';
import { money, pct0 } from '@/lib/format';
import { RoiChip } from '@/components/ui/Values';
import type { UrlOrigin } from '@/types/api';

const RET_COLORS = ['#f5b84a', '#34d399', '#f472b6', '#22d3ee', '#a78bfa', '#fb923c'];

/**
 * "Origem da receita": quanto da receita veio de Google Ads e Meta Ads (campanha atribuída), de cada utm_source de
 * retenção colocado à mão na URL (?utm_source=push, ?utm_source=whatsapp…) e do que não tem origem.
 * Clicar numa origem filtra a lista de URLs.
 */
export function OriginCard({ origins, value, onChange }: { origins: UrlOrigin[]; value: string; onChange: (k: string) => void }) {
  const { pluto: p } = useTheme();
  const { currency } = useFilters();
  const total = origins.reduce((a, o) => a + o.metrics.revenue, 0);
  let ri = 0;
  const look = origins.map((o) => {
    const name = o.label.toLowerCase();
    const color = o.kind === 'google' ? '#4f8ff7' : o.kind === 'meta' ? '#8b7cf6' : o.kind === 'none' ? p.na : RET_COLORS[ri++ % RET_COLORS.length];
    const Icon = o.kind === 'google' ? GoogleIcon : o.kind === 'meta' ? FacebookRoundedIcon : o.kind === 'none' ? PublicRoundedIcon
      : /push|notif/.test(name) ? NotificationsActiveRoundedIcon : /whats|wpp|zap/.test(name) ? WhatsAppIcon : /mail|news/.test(name) ? MailOutlineRoundedIcon : ReplayRoundedIcon;
    return { o, color, Icon, share: total > 0 ? (o.metrics.revenue / total) * 100 : 0 };
  });
  const retention = origins.filter((o) => o.kind === 'retention');
  const retRev = retention.reduce((a, o) => a + o.metrics.revenue, 0);
  const tile = (key: string, selected: boolean, body: React.ReactNode, color: string) => (
    <ButtonBase key={key} onClick={() => onChange(selected ? '' : key)} aria-pressed={selected}
      sx={{ display: 'block', textAlign: 'left', borderRadius: 2.5, p: 1.5, minWidth: 0, border: `1px solid ${selected ? color : p.line}`, bgcolor: selected ? alpha(color, 0.12) : p.panel2,
        transition: '.15s', '&:hover': { borderColor: color }, '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: 2 } }}>
      {body}
    </ButtonBase>
  );
  return (
    <Card>
      <CardHeader title="Origem da receita"
        subheader={retention.length
          ? `${money(retRev, currency)} (${pct0(total ? (retRev / total) * 100 : null)}) veio de retenção por utm_source · clique numa origem para filtrar as URLs`
          : 'Sem receita com utm_source de retenção no período. Use ?utm_source=push, ?utm_source=whatsapp… nos links de retenção.'} />
      <Box sx={{ px: 2, pb: 2 }}>
        {/* barra com a participação de cada origem na receita */}
        <Stack direction="row" sx={{ height: 10, borderRadius: 5, overflow: 'hidden', bgcolor: p.panel3, mb: 1.75 }} aria-hidden>
          {look.filter((x) => x.share > 0).map((x) => <Tooltip key={x.o.key} title={`${x.o.label}: ${pct0(x.share)}`}><Box sx={{ width: `${x.share}%`, bgcolor: x.color, opacity: value && value !== x.o.key ? 0.35 : 1 }} /></Tooltip>)}
        </Stack>
        <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(auto-fill, minmax(190px, 1fr))' } }}>
          {tile('', !value, (
            <Stack spacing={0.4}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><LayersRoundedIcon sx={{ fontSize: 17, color: p.fg2 }} /><Typography sx={{ fontWeight: 600, fontSize: 13 }}>Todas</Typography></Stack>
              <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 18 }}>{money(total, currency)}</Typography>
              <Typography variant="caption">{origins.length} origens</Typography>
            </Stack>
          ), p.accent)}
          {look.map(({ o, color, Icon, share }) => tile(o.key, value === o.key, (
            <Stack spacing={0.4}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                <Icon sx={{ fontSize: 17, color }} />
                <Typography noWrap sx={{ fontWeight: 600, fontSize: 13 }}>{o.kind === 'retention' ? o.label.replace(/^./, (c) => c.toUpperCase()) : o.label}</Typography>
                {o.kind === 'retention' && <Typography variant="caption" sx={{ color, fontWeight: 600 }}>retenção</Typography>}
              </Stack>
              <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 18 }}>{money(o.metrics.revenue, currency)}</Typography>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                <Typography variant="caption">{pct0(share)} da receita</Typography>
                {o.metrics.spend > 0 && <><Typography variant="caption">· custo {money(o.metrics.spend, currency)}</Typography><RoiChip v={o.metrics.roi} /></>}
                {o.kind === 'none' && <Typography variant="caption">· direto / sem utm</Typography>}
              </Stack>
            </Stack>
          ), color))}
        </Box>
      </Box>
    </Card>
  );
}
