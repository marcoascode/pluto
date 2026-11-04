import { Alert, Badge, Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, InputAdornment, Link, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import AddToDriveOutlinedIcon from '@mui/icons-material/AddToDriveOutlined';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useFinanceMutation } from '@/hooks/queries';
import { ApiError } from '@/lib/api/client';
import { money } from '@/lib/format';
import { attachmentHref, attachmentsApi, ddmmyyyy, fileSize, MAX_FILE_MB, monthOptions, monthTitle, type Attachment, type AttachmentTarget } from '@/lib/finance';
import { todayISO } from '@/lib/period';
import type { Currency } from '@/types/api';

/** Para o que é o comprovante: valor lançado (para conferir com a NF) e, em custo mensal, o mês. */
export interface AttachmentContext extends AttachmentTarget {
  title: string;               // ex.: "Gasto · Meta Ads · 03/11/2026" ou "Custo · Ferramenta de IA"
  amount: number;              // valor lançado, na moeda do lançamento/custo
  currency: Currency;
  month?: string;              // custo mensal: mês do comprovante (cada mês tem a sua NF)
  monthly?: boolean;
}

/** Clipe com o número de comprovantes. Vermelho-claro quando falta comprovante num gasto/custo. */
export function AttachmentsButton({ count, onClick, required }: { count: number; onClick: () => void; required?: boolean }) {
  const { pluto: p } = useTheme();
  const missing = required && !count;
  return (
    <Tooltip title={count ? `${count} comprovante${count > 1 ? 's' : ''} (NF, recibo)` : 'Anexar comprovante (link do Drive ou PDF)'}>
      <IconButton size="small" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={count ? `Ver ${count} comprovantes` : 'Anexar comprovante'}
        sx={{ color: count ? p.accent : missing ? alpha(p.warn, 0.9) : 'text.disabled' }}>
        <Badge badgeContent={count} color="primary" sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16, px: 0.5 } }}>
          <AttachFileRoundedIcon fontSize="small" sx={{ transform: 'rotate(45deg)' }} />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}

const parseMoney = (s: string) => Number(s.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
const toInput = (n: number) => n.toFixed(2).replace('.', ',');
const ACCEPT = 'application/pdf,image/jpeg,image/png';

/** Comprovantes de um lançamento do caixa ou de um custo: lista + anexar link do Drive ou arquivo. */
export function AttachmentsDialog({ ctx, onClose }: { ctx: AttachmentContext; onClose: () => void }) {
  const { pluto: p } = useTheme();
  const target: AttachmentTarget = ctx.entryId ? { entryId: ctx.entryId } : { costId: ctx.costId };
  const [month, setMonth] = useState(ctx.month ?? todayISO().slice(0, 7));
  const listQ = { ...target, ...(ctx.monthly ? { month } : {}) };
  const { data, error } = useQuery({ queryKey: ['finance', 'attachments', listQ], queryFn: () => attachmentsApi.list(listQ) });
  const [mode, setMode] = useState<'link' | 'file'>('link');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState({ docNumber: '', docDate: '', amount: toInput(ctx.amount), note: '' });
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = useFinanceMutation((x: { kind: 'link' | 'file' }) => {
    const v = doc.amount.trim() ? parseMoney(doc.amount) : undefined;
    const meta = { month: ctx.monthly ? month : undefined, amount: v, currency: ctx.currency, docNumber: doc.docNumber || undefined, docDate: doc.docDate || undefined, note: doc.note || undefined };
    return x.kind === 'link' ? attachmentsApi.addLink(target, url.trim(), meta) : attachmentsApi.upload(target, file!, meta);
  });
  const remove = useFinanceMutation(attachmentsApi.remove);
  const months = useMemo(() => monthOptions(24, 2), []);
  const pickFile = (f?: File | null) => {
    setErr('');
    if (!f) return;
    if (!ACCEPT.split(',').includes(f.type)) return setErr('Envie um PDF, JPG ou PNG.');
    if (f.size > MAX_FILE_MB * 1024 * 1024) return setErr(`Arquivo acima de ${MAX_FILE_MB} MB. Use o link do Drive.`);
    setFile(f);
  };
  const submit = () => {
    setErr('');
    if (mode === 'link' && !/^https:\/\/\S+$/.test(url.trim())) return setErr('Cole o link completo (começa com https://), por exemplo do Google Drive.');
    if (mode === 'file' && !file) return setErr('Escolha o arquivo da NF.');
    if (doc.amount.trim() && !(parseMoney(doc.amount) > 0)) return setErr('Valor da NF inválido.');
    add.mutate({ kind: mode }, {
      onSuccess: () => { setUrl(''); setFile(null); setDoc({ docNumber: '', docDate: '', amount: toInput(ctx.amount), note: '' }); },
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível anexar.'),
    });
  };
  const list = data?.attachments ?? [];
  /** O valor da NF bate com o lançado? (mesma moeda, tolerância de 1 centavo) */
  const check = (a: Attachment) => {
    if (a.amount == null) return null;
    if (a.currency && a.currency !== ctx.currency) return 'other';
    return Math.abs(a.amount - ctx.amount) < 0.01 ? 'ok' : 'diff';
  };
  const icon = (a: Attachment) => a.kind === 'link' ? <AddToDriveOutlinedIcon sx={{ color: '#4f8ff7' }} /> : a.mime === 'application/pdf' ? <PictureAsPdfOutlinedIcon sx={{ color: p.neg }} /> : <ImageOutlinedIcon sx={{ color: p.accent }} />;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Comprovantes</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap', mb: 1.5 }}>
          <Typography sx={{ fontWeight: 600 }}>{ctx.title}</Typography>
          <Typography color="text.secondary">· lançado {money(ctx.amount, ctx.currency)}</Typography>
        </Stack>
        {ctx.monthly && (
          <TextField select size="small" label="Mês da NF" value={month} onChange={(e) => setMonth(e.target.value)} sx={{ mb: 1.5, minWidth: 200 }}>
            {months.map((m) => <MenuItem key={m} value={m}>{monthTitle(m)}</MenuItem>)}
          </TextField>
        )}

        {/* lista */}
        {error ? <Alert severity="error" variant="outlined">{error instanceof ApiError ? error.message : 'Não foi possível carregar.'}</Alert>
          : !data ? <Typography variant="caption">Carregando…</Typography>
          : list.length === 0 ? (
            <Box sx={{ p: 1.5, borderRadius: 2, border: `1px dashed ${p.line2}`, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">Nenhum comprovante{ctx.monthly ? ` em ${monthTitle(month)}` : ''}. Anexe a NF, recibo ou fatura abaixo.</Typography>
            </Box>
          ) : (
            <Stack spacing={1}>
              {list.map((a) => {
                const c = check(a);
                return (
                  <Stack key={a.id} direction="row" spacing={1.25} sx={{ alignItems: 'center', p: 1.25, borderRadius: 2, bgcolor: p.panel2 }}>
                    {icon(a)}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Link href={attachmentHref(a)} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ fontWeight: 600, fontSize: 13.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.kind === 'link' ? (a.url?.includes('drive.google') ? 'Arquivo no Google Drive' : a.url) : a.filename}
                      </Link>
                      <Typography variant="caption" component="div">
                        {[a.docNumber && `NF ${a.docNumber.replace(/^NF\s*/i, '')}`, a.docDate && ddmmyyyy(a.docDate), a.month && ctx.monthly && monthTitle(a.month), a.kind === 'file' && fileSize(a.size), a.note, a.createdBy && `por ${a.createdBy}`].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                    {a.amount != null && (
                      <Tooltip title={c === 'ok' ? 'Valor da NF igual ao lançado' : c === 'diff' ? `A NF é de ${money(a.amount, a.currency ?? ctx.currency)} e o lançado é ${money(ctx.amount, ctx.currency)}` : 'NF em outra moeda'}>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: c === 'ok' ? p.pos : c === 'diff' ? p.warn : 'text.secondary', whiteSpace: 'nowrap' }}>
                          {c === 'ok' ? <CheckCircleRoundedIcon sx={{ fontSize: 16 }} /> : c === 'diff' ? <ErrorOutlineRoundedIcon sx={{ fontSize: 16 }} /> : null}
                          <Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(a.amount, a.currency ?? ctx.currency)}</Typography>
                        </Stack>
                      </Tooltip>
                    )}
                    <Tooltip title="Abrir"><IconButton size="small" component="a" href={attachmentHref(a)} target="_blank" rel="noopener noreferrer" aria-label="Abrir comprovante"><OpenInNewRoundedIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Remover"><IconButton size="small" onClick={() => remove.mutate(a.id)} disabled={remove.isPending} aria-label="Remover comprovante"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
                  </Stack>
                );
              })}
              {list.some((a) => check(a) === 'diff') && <Alert severity="warning" variant="outlined" sx={{ py: 0 }}>O valor de uma NF é diferente do valor lançado. Confira e corrija o lançamento ou o comprovante.</Alert>}
            </Stack>
          )}

        <Divider sx={{ my: 2 }} />

        {/* anexar */}
        <Typography variant="overline">Anexar comprovante</Typography>
        <ToggleButtonGroup exclusive size="small" fullWidth value={mode} onChange={(_, v) => { if (v) { setMode(v); setErr(''); } }} sx={{ my: 1 }}>
          <ToggleButton value="link"><AddToDriveOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />Link do Drive</ToggleButton>
          <ToggleButton value="file"><CloudUploadOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />Enviar PDF</ToggleButton>
        </ToggleButtonGroup>
        <Stack spacing={1.5}>
          {mode === 'link' ? (
            <TextField size="small" label="Link do arquivo" placeholder="https://drive.google.com/file/d/…" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus
              helperText="No Drive: Compartilhar → acesso para os sócios (ou “qualquer pessoa com o link”) → Copiar link." />
          ) : (
            <ButtonBase onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files?.[0]); }}
              sx={{ display: 'block', width: '100%', p: 2, borderRadius: 2, border: `1.5px dashed ${drag ? p.accent : p.line2}`, bgcolor: drag ? alpha(p.accent, 0.08) : 'transparent', textAlign: 'center' }}>
              <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => pickFile(e.target.files?.[0])} />
              {file ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                  {file.type === 'application/pdf' ? <PictureAsPdfOutlinedIcon sx={{ color: p.neg }} /> : <ImageOutlinedIcon sx={{ color: p.accent }} />}
                  <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{file.name}</Typography><Typography variant="caption">{fileSize(file.size)} · trocar</Typography>
                </Stack>
              ) : (
                <>
                  <CloudUploadOutlinedIcon sx={{ color: 'text.secondary' }} />
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>Clique ou arraste a NF aqui</Typography>
                  <Typography variant="caption">PDF, JPG ou PNG · até {MAX_FILE_MB} MB</Typography>
                </>
              )}
            </ButtonBase>
          )}
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Nº da NF" value={doc.docNumber} onChange={(e) => setDoc({ ...doc, docNumber: e.target.value })} sx={{ flex: 1 }} placeholder="opcional" />
            <TextField size="small" label="Valor da NF" value={doc.amount} onChange={(e) => setDoc({ ...doc, amount: e.target.value })} inputMode="decimal" sx={{ flex: 1 }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start">{ctx.currency === 'BRL' ? 'R$' : ctx.currency === 'USD' ? 'US$' : '€'}</InputAdornment> } }} />
            <TextField size="small" type="date" label="Data da NF" value={doc.docDate} onChange={(e) => setDoc({ ...doc, docDate: e.target.value })} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
          <TextField size="small" label="Observação (opcional)" value={doc.note} onChange={(e) => setDoc({ ...doc, note: e.target.value })} />
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Fechar</Button>
        <Button variant="contained" onClick={submit} disabled={add.isPending} startIcon={<AttachFileRoundedIcon />}>{add.isPending ? 'Anexando…' : 'Anexar'}</Button>
      </DialogActions>
    </Dialog>
  );
}
