import { Box, ButtonBase, Popover, Stack, Typography, alpha, useTheme } from '@mui/material';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { useState, type MouseEvent } from 'react';
import { Money } from '@/components/ui/Values';
import type { Metrics } from '@/types/api';

/**
 * 0.15 · Retenção: receita com utm_source de retenção (links de Push e WhatsApp com ?utm_source=…).
 * Push = pushalert ou terminando em "push" · WhatsApp = terminando em "wpp" ou "whatsapp" · o resto (email…) = Outros.
 * Clique no nome para ver Push × WhatsApp. Funciona dentro de cards clicáveis (não abre o link do card).
 */
export function RetentionLine({ m, compact }: { m: Metrics; compact?: boolean }) {
  const { pluto: p } = useTheme();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const total = m.retentionRevenue ?? 0;
  if (!total) return null;
  const push = m.pushRevenue ?? 0, wpp = m.whatsappRevenue ?? 0, other = Math.max(0, total - push - wpp);
  const share = m.revenue > 0 ? Math.round((total / m.revenue) * 100) : null;
  const stop = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  const rows: [string, number, React.ReactNode, string][] = [
    ['Push', push, <NotificationsActiveOutlinedIcon key="p" sx={{ fontSize: 16 }} />, p.accent],
    ['WhatsApp', wpp, <WhatsAppIcon key="w" sx={{ fontSize: 16 }} />, '#25D366'],
    ...(other > 0.004 ? [['Outros (email…)', other, null, p.fg2] as [string, number, React.ReactNode, string]] : []),
  ];
  return (
    <>
      <ButtonBase component="span" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { stop(e); setEl(e.currentTarget as HTMLElement); }}
        aria-label="Ver receita de retenção por canal"
        sx={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', mt: compact ? 0.75 : 1.25, px: 1, py: 0.6, borderRadius: 1.5, bgcolor: alpha(p.accent, 0.08), '&:hover': { bgcolor: alpha(p.accent, 0.16) } }}>
        <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 600, color: p.accent, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>Retenção{share != null ? ` · ${share}%` : ''}</Typography>
        <Typography component="span" sx={{ fontSize: 13, fontWeight: 600 }}><Money v={total} cur="USD" /></Typography>
      </ButtonBase>
      <Popover open={!!el} anchorEl={el} onClose={(e: object) => { (e as MouseEvent).stopPropagation?.(); setEl(null); }} onClick={stop}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}>
        <Box sx={{ p: 1.5, minWidth: 240 }}>
          <Typography variant="overline">Receita de retenção</Typography>
          {rows.map(([l, v, icon, c]) => (
            <Stack key={l} direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.5 }}>
              <Box sx={{ color: c, display: 'flex', width: 16 }}>{icon}</Box>
              <Typography sx={{ fontSize: 13, flex: 1 }}>{l}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}><Money v={v} cur="USD" /></Typography>
              <Typography variant="caption" sx={{ width: 38, textAlign: 'right' }}>{total ? `${Math.round((v / total) * 100)}%` : ''}</Typography>
            </Stack>
          ))}
          <Typography variant="caption" component="div" sx={{ mt: 0.75, maxWidth: 260 }}>Pelo utm_source do link: pushalert ou …push = Push · …wpp ou …whatsapp = WhatsApp.</Typography>
        </Box>
      </Popover>
    </>
  );
}
