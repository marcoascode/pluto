import { Box, Link, Tooltip } from '@mui/material';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { TECH_DOMAIN } from '@/lib/format';

export const NO_URL = '(sem URL)';
/** Endereço completo da página: https://domínio/slug. null quando não há URL (receita sem caminho ou "Sem domínio"). */
export function pageHref(domain: string, path: string): string | null {
  if (!path || path === NO_URL || domain === TECH_DOMAIN || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return `https://${domain}${path.startsWith('/') ? path : '/' + path}`;
}

/**
 * Slug da URL clicável: abre domínio + slug numa aba nova do navegador.
 * "(sem URL)" explica por que não há caminho (o Ad Manager não recebeu o key-value da página).
 */
export function UrlLink({ domain, path, size = 12.5, noWrap }: { domain: string; path: string; size?: number; noWrap?: boolean }) {
  const href = pageHref(domain, path);
  const font = { fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: size, minWidth: 0, ...(noWrap ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : { overflowWrap: 'anywhere' }) } as const;
  if (!href) {
    return (
      <Tooltip title={path === NO_URL ? 'Receita sem o caminho da página: o site precisa mandar o key-value page_path no GPT e o Ad Manager precisa dele como dimensão personalizada.' : ''}>
        <Box component="span" sx={{ ...font, color: 'text.secondary' }}>{path}</Box>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={`Abrir ${href}`} enterDelay={500} describeChild>
      <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover" color="primary.light" onClick={(e) => e.stopPropagation()}
        sx={{ ...font, display: 'inline-flex', alignItems: 'center', gap: 0.5, maxWidth: '100%' }}>
        <Box component="span" sx={noWrap ? { overflow: 'hidden', textOverflow: 'ellipsis' } : undefined}>{path}</Box>
        <OpenInNewRoundedIcon sx={{ fontSize: size + 1, flexShrink: 0, opacity: 0.7 }} />
      </Link>
    </Tooltip>
  );
}
