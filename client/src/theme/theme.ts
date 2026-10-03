import { alpha, createTheme } from '@mui/material/styles';
import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';

/** Paleta Pluto (a mesma do esboço aprovado). */
export const pluto = {
  bg: '#0a1428', side: '#0b172f', panel: '#132342', panel2: '#1a2d52', panel3: '#213762',
  line: '#22385f', line2: '#2f4a7c', fg: '#e8eefb', fg2: '#b5c4df', muted: '#8094b9',
  accent: '#5b9bff', accent2: '#2f6fe0', pos: '#34d399', posStrong: '#138a58', posLite: '#9ff0c0',
  neg: '#ff6b7a', warn: '#f5b84a', na: '#8a9bbd', rev: '#3d8fec', spend: '#cf7a2e',
  rowL1: '#162847', rowL2: '#192c4f',
  display: "'Sora', ui-sans-serif, system-ui, sans-serif",
  body: "'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

declare module '@mui/material/styles' {
  interface Theme { pluto: typeof pluto }
  interface ThemeOptions { pluto?: typeof pluto }
}

const hi = 'inset 0 1px 0 rgba(255,255,255,.055)';

export const theme = createTheme({
  pluto,
  palette: {
    mode: 'dark',
    primary: { main: pluto.accent2, light: pluto.accent },
    success: { main: pluto.pos, dark: pluto.posStrong, light: pluto.posLite },
    error: { main: pluto.neg },
    warning: { main: pluto.warn },
    background: { default: pluto.bg, paper: pluto.panel },
    text: { primary: pluto.fg, secondary: pluto.fg2, disabled: pluto.muted },
    divider: pluto.line,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: pluto.body,
    fontSize: 14,
    h1: { fontFamily: pluto.display, fontSize: 24, fontWeight: 600, letterSpacing: '-.01em' },
    h2: { fontFamily: pluto.display, fontSize: 15.5, fontWeight: 600, letterSpacing: '-.01em' },
    h3: { fontFamily: pluto.display, fontSize: 14, fontWeight: 600 },
    overline: { fontSize: 11, letterSpacing: '.08em', fontWeight: 600, color: pluto.muted, lineHeight: 1.6 },
    caption: { color: pluto.muted, fontSize: 12 },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background: `radial-gradient(1100px 560px at 88% -8%, rgba(47,111,224,.11), transparent 62%), radial-gradient(900px 520px at -8% 108%, rgba(34,163,90,.06), transparent 60%), ${pluto.bg}`,
          backgroundAttachment: 'fixed', WebkitFontSmoothing: 'antialiased', fontVariantNumeric: 'tabular-nums',
        },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          background: `linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,0) 140px), ${pluto.panel}`,
          border: `1px solid ${pluto.line}`, borderRadius: 14, boxShadow: `${hi}, 0 10px 30px -18px rgba(0,0,0,.7)`,
        },
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        root: { padding: '14px 16px', borderBottom: `1px solid ${pluto.line}`, flexWrap: 'wrap', gap: 8 },
        title: { fontFamily: pluto.display, fontSize: 15.5, fontWeight: 600 },
        subheader: { fontSize: 12, color: pluto.muted, marginTop: 2 },
        action: { margin: 0, alignSelf: 'center' },
      },
    },
    MuiCardContent: { styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 9, whiteSpace: 'nowrap', variants: [{ props: { variant: 'contained', color: 'primary' }, style: { background: `linear-gradient(180deg, #3b7cf0, ${pluto.accent2})`, boxShadow: '0 4px 14px rgba(47,111,224,.3)' } }] },
        outlined: { borderColor: pluto.line2, color: pluto.fg, background: pluto.panel2, boxShadow: hi, '&:hover': { background: pluto.panel3, borderColor: pluto.line2 } },
        sizeSmall: { fontSize: 12.5, padding: '3px 10px' },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 8, border: `1px solid ${pluto.line2}`, background: pluto.panel2, color: pluto.fg2, '&:hover': { borderColor: pluto.accent, background: pluto.panel2, color: pluto.fg } } },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, fontVariantNumeric: 'tabular-nums' }, sizeSmall: { height: 22, fontSize: 12 } } },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${pluto.line}`, padding: '10px 12px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
        head: { background: pluto.panel2, color: pluto.fg2, fontWeight: 500, fontSize: 12 },
        sizeSmall: { padding: '6px 10px' },
      },
    },
    MuiTableRow: { styleOverrides: { root: { '&:hover > td': { background: '#182b4f' } } } },
    MuiTableSortLabel: { styleOverrides: { root: { '&.Mui-active': { color: pluto.fg }, '& .MuiTableSortLabel-icon': { fontSize: 14 } } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { background: pluto.panel, borderRadius: 9, boxShadow: hi, fontSize: 13, '& fieldset': { borderColor: pluto.line }, '&:hover fieldset': { borderColor: pluto.line2 } },
        input: { padding: '7px 10px' },
      },
    },
    MuiSelect: { styleOverrides: { select: { padding: '7px 32px 7px 10px' } } },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8, padding: '6px 10px', color: pluto.fg2, gap: 10,
          '&:hover': { background: pluto.panel, color: pluto.fg },
          '&.Mui-selected': { background: `linear-gradient(90deg, ${alpha(pluto.accent, 0.2)}, ${alpha(pluto.accent, 0.06)})`, color: pluto.fg, boxShadow: `inset 2px 0 0 ${pluto.accent}` },
          '&.Mui-selected:hover': { background: alpha(pluto.accent, 0.22) },
        },
      },
    },
    MuiListItemIcon: { styleOverrides: { root: { minWidth: 0, color: 'inherit', '& svg': { fontSize: 18 } } } },
    MuiToggleButton: {
      styleOverrides: {
        root: { textTransform: 'none', border: 0, borderRadius: '7px !important', padding: '4px 12px', color: pluto.fg2, fontSize: 12.5, '&.Mui-selected': { background: pluto.panel3, color: pluto.fg } },
      },
    },
    MuiToggleButtonGroup: { styleOverrides: { root: { background: pluto.panel2, border: `1px solid ${pluto.line}`, borderRadius: 10, padding: 3, gap: 2 } } },
    MuiTooltip: { styleOverrides: { tooltip: { background: pluto.panel3, border: `1px solid ${pluto.line2}`, fontSize: 12 } } },
    MuiDrawer: { styleOverrides: { paper: { background: pluto.panel, borderColor: pluto.line2 } } },
    MuiDialog: { styleOverrides: { paper: { background: pluto.panel, border: `1px solid ${pluto.line2}`, borderRadius: 16 } } },
    MuiPopover: { styleOverrides: { paper: { background: pluto.panel2, border: `1px solid ${pluto.line2}`, borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,.5)' } } },
    MuiMenu: { styleOverrides: { paper: { background: pluto.panel2, border: `1px solid ${pluto.line2}` } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 10, alignItems: 'center' } } },
    MuiSkeleton: { styleOverrides: { root: { background: pluto.panel2, borderRadius: 14 } } },
    MuiLinearProgress: { styleOverrides: { root: { height: 6, borderRadius: 3, background: pluto.panel3 }, bar: { borderRadius: 3 } } },
    MuiBottomNavigation: { styleOverrides: { root: { background: 'rgba(11,23,47,.96)', borderTop: `1px solid ${pluto.line}`, height: 62 } } },
    MuiBottomNavigationAction: { styleOverrides: { root: { color: pluto.muted, minWidth: 0, '&.Mui-selected': { color: pluto.fg } }, label: { fontSize: 10.5, '&.Mui-selected': { fontSize: 10.5 } } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 40 } } },
  },
});
