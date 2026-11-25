import { Alert, AlertTitle, Box, Button, Card, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, MenuItem, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import { useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAdminMutation, useCashflowCards, useCashflowStatement, useCashflowStatements } from '@/hooks/queries';
import { cashflowApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { ddmm, longDate, money } from '@/lib/format';
import { parseNum } from '@/lib/financeOps';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import type { CashflowCard, CashflowKind, CashflowMaskCounts, CashflowRetention, CashflowStatement, CashflowStatementDetail } from '@/types/api';
import { cardLabel, KIND_LABEL } from './CashFlow';

/**
 * 0.18.16 · Fluxo de caixa → Faturas. Envio da fatura em PDF, revisão do que foi lido e confirmação.
 * O PDF vai em memória para o servidor; só o TEXTO, com dados pessoais mascarados, é lido pelo Claude.
 * O PDF original fica guardado para consulta e é apagado sozinho no prazo escolhido (ou nunca).
 */
const INV = [qk.cashflow];
const brl = (v: number) => money(v, 'BRL');
const RETENTION_OPTS: { v: string; label: string }[] = [
  { v: '7', label: '7 dias' }, { v: '30', label: '30 dias' }, { v: '60', label: '60 dias' }, { v: '90', label: '90 dias' }, { v: '365', label: '365 dias' }, { v: 'never', label: 'Nunca' },
];
const toRetention = (v: string): CashflowRetention => (v === 'never' ? null : (Number(v) as CashflowRetention));
const fromRetention = (r: CashflowRetention) => (r == null ? 'never' : String(r));
const MASK_LABEL: Record<keyof CashflowMaskCounts, string> = { name: 'nome', cpf: 'CPF', cnpj: 'CNPJ', card: 'nº do cartão', address: 'endereço', cep: 'CEP', email: 'e-mail', phone: 'telefone', barcode: 'código de barras' };
const isoDay = (ts: string) => ts.slice(0, 10);

export default function Statements() {
  const { data, error, refetch } = useCashflowStatements();
  const cards = useCashflowCards();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const [del, setDel] = useState<CashflowStatement | null>(null);
  const [delPdf, setDelPdf] = useState<CashflowStatement | null>(null);
  const [toast, setToast] = useState('');
  const remove = useAdminMutation(cashflowApi.deleteStatement, INV);
  const removePdf = useAdminMutation(cashflowApi.deleteStatementPdf, INV);
  const retention = useAdminMutation(cashflowApi.setRetention, INV);
  const cardById = new Map((cards.data?.cards ?? []).map((c) => [c.id, c]));
  const fail = (e: unknown) => setToast(e instanceof ApiError ? e.message : 'Não foi possível concluir.');

  return (
    <>
      <PageHead title="Faturas" crumb={<Link component={RouterLink} to="/fluxo-caixa">Fluxo de caixa</Link>}
        sub="Envie a fatura do cartão em PDF: os lançamentos são lidos, você confere e confirma antes de entrarem no caixa."
        right={<Button variant="contained" startIcon={<UploadFileRoundedIcon />} onClick={() => setUploadOpen(true)}>Enviar fatura (PDF)</Button>} />

      <Alert severity="info" icon={<ShieldOutlinedIcon />} sx={{ mb: 1.75 }}>
        O PDF não vai para a IA: o servidor extrai o texto e troca nome, CPF/CNPJ, número do cartão (fica só o final), endereço, e-mail e telefone por marcadores antes da leitura.
        O arquivo original fica guardado só para você consultar e é apagado no prazo que você escolher.
      </Alert>

      {error ? <ErrorBox error={error} retry={() => refetch()} /> : !data ? <PageSkeleton /> : data.statements.length === 0 ? (
        <Alert severity="info">Nenhuma fatura enviada ainda.</Alert>
      ) : (
        <TableContainer component={Card}><Table size="small">
          <TableHead><TableRow>{['Fatura', 'Cartão', 'Datas', 'Total', 'Status', 'PDF guardado', ''].map((h, i) => <TableCell key={i} align={h === 'Total' ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>{data.statements.map((s) => {
            const c = s.cardId ? cardById.get(s.cardId) : null;
            return (
              <TableRow key={s.id}>
                <TableCell sx={{ maxWidth: 240 }}><Typography variant="body2" noWrap title={s.filename}>{s.filename}</Typography><Typography variant="caption">enviada em {longDate(isoDay(s.createdAt))}{s.pages ? ` · ${s.pages} pág.` : ''}</Typography></TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{c ? cardLabel(c) : [s.issuer, s.cardLast4 && `•••• ${s.cardLast4}`].filter(Boolean).join(' · ') || '—'}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant="body2">{s.closingDate ? `fecha ${ddmm(s.closingDate)}/${s.closingDate.slice(0, 4)}` : '—'}</Typography><Typography variant="caption">{s.dueDate ? `vence ${ddmm(s.dueDate)}/${s.dueDate.slice(0, 4)}` : ''}</Typography></TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{s.totalAmount != null ? brl(s.totalAmount) : '—'}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{s.status === 'review'
                  ? <Button size="small" variant="contained" color="warning" startIcon={<FactCheckOutlinedIcon />} onClick={() => setReview(s.id)}>Revisar</Button>
                  : <Tag tone="pos">{s.entryCount} lançamento{s.entryCount === 1 ? '' : 's'}</Tag>}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {s.hasPdf ? (
                    <Stack>
                      <TextField select size="small" variant="standard" value={fromRetention(s.pdfRetentionDays)} disabled={retention.isPending} sx={{ '& .MuiInputBase-root': { fontSize: 13 } }}
                        onChange={(e) => retention.mutate({ id: s.id, retentionDays: toRetention(e.target.value) }, { onSuccess: (r) => setToast(r.hasPdf ? 'Prazo do PDF atualizado' : 'O prazo já tinha vencido: PDF apagado'), onError: fail })}
                        slotProps={{ htmlInput: { 'aria-label': `Apagar o PDF de ${s.filename} após` } }}>
                        {RETENTION_OPTS.map((o) => <MenuItem key={o.v} value={o.v}>{o.v === 'never' ? 'Guardar sempre' : `Apagar após ${o.label}`}</MenuItem>)}
                      </TextField>
                      <Typography variant="caption">{s.pdfPurgeAt ? `apaga em ${ddmm(isoDay(s.pdfPurgeAt))}/${s.pdfPurgeAt.slice(0, 4)}` : 'sem data para apagar'}</Typography>
                    </Stack>
                  ) : <Typography variant="caption">PDF apagado{s.pdfPurgedAt ? ` em ${ddmm(isoDay(s.pdfPurgedAt))}/${s.pdfPurgedAt.slice(0, 4)}` : ''}</Typography>}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {s.status === 'confirmed' && <Tooltip title="Ver o que foi lido"><IconButton size="small" aria-label={`Ver lançamentos lidos de ${s.filename}`} onClick={() => setReview(s.id)}><FactCheckOutlinedIcon fontSize="small" /></IconButton></Tooltip>}
                  {s.hasPdf && <Tooltip title="Abrir PDF"><IconButton size="small" component="a" href={cashflowApi.pdfUrl(s.id)} target="_blank" rel="noopener" aria-label={`Abrir PDF de ${s.filename}`}><PictureAsPdfOutlinedIcon fontSize="small" /></IconButton></Tooltip>}
                  {s.hasPdf && <Tooltip title="Apagar só o PDF"><IconButton size="small" aria-label={`Apagar o PDF de ${s.filename}`} onClick={() => setDelPdf(s)}><PictureAsPdfOutlinedIcon fontSize="small" color="error" /></IconButton></Tooltip>}
                  <Tooltip title="Excluir fatura e lançamentos"><IconButton size="small" aria-label={`Excluir a fatura ${s.filename}`} onClick={() => setDel(s)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            );
          })}</TableBody>
        </Table></TableContainer>
      )}

      {uploadOpen && <UploadDialog cards={cards.data?.cards ?? []} onClose={() => setUploadOpen(false)} onUploaded={(id) => { setUploadOpen(false); setReview(id); }} />}
      {review && <ReviewDialog id={review} cards={cards.data?.cards ?? []} onClose={() => setReview(null)} onConfirmed={(msg) => { setReview(null); setToast(msg); }} />}
      <ConfirmDialog open={!!del} title="Excluir fatura?" busy={remove.isPending} onClose={() => setDel(null)}
        onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => { setDel(null); setToast('Fatura excluída'); }, onError: (e) => { setDel(null); fail(e); } })}>
        {del && <>“{del.filename}” será excluída junto com o PDF e {del.entryCount ? `os ${del.entryCount} lançamento(s) que vieram dela` : 'o que foi lido'}.</>}
      </ConfirmDialog>
      <ConfirmDialog open={!!delPdf} title="Apagar o PDF?" confirmLabel="Apagar PDF" busy={removePdf.isPending} onClose={() => setDelPdf(null)}
        onConfirm={() => delPdf && removePdf.mutate(delPdf.id, { onSuccess: () => { setDelPdf(null); setToast('PDF apagado'); }, onError: (e) => { setDelPdf(null); fail(e); } })}>
        Só o arquivo é apagado; a fatura e os lançamentos continuam no caixa.
      </ConfirmDialog>
      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast('')} message={toast} />
    </>
  );
}

function UploadDialog({ cards, onClose, onUploaded }: { cards: CashflowCard[]; onClose: () => void; onUploaded: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [needPw, setNeedPw] = useState(false);
  const [retention, setRetention] = useState('90');
  const [cardId, setCardId] = useState('');
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const up = useAdminMutation(cashflowApi.uploadStatement, INV);

  const pick = (f: File | undefined) => {
    setErr('');
    if (!f) return;
    if (f.type && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return setErr('Escolha um arquivo PDF.');
    if (f.size > 10 * 1024 * 1024) return setErr('O PDF passa de 10 MB.');
    setFile(f);
  };
  const send = () => {
    if (!file) return setErr('Escolha o PDF da fatura.');
    setErr('');
    up.mutate({ file, password: password || undefined, retentionDays: retention, cardId: cardId || undefined }, {
      onSuccess: (r) => onUploaded(r.id),
      onError: (e) => {
        if (e instanceof ApiError && (e.code === 'pdf_password_required' || e.code === 'pdf_password_wrong')) setNeedPw(true);
        setErr(e instanceof ApiError ? e.message : 'Não foi possível enviar a fatura.');
      },
    });
  };

  return (
    <Dialog open onClose={up.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Enviar fatura (PDF)</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
            sx={{ border: 2, borderStyle: 'dashed', borderColor: file ? 'primary.main' : 'divider', borderRadius: 1, p: 3, textAlign: 'center' }}>
            <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <PictureAsPdfOutlinedIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
            <Typography sx={{ my: 1 }}>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : 'Arraste o PDF da fatura aqui'}</Typography>
            <Button variant="outlined" size="small" onClick={() => input.current?.click()} disabled={up.isPending}>{file ? 'Trocar arquivo' : 'Escolher arquivo'}</Button>
          </Box>
          <TextField select size="small" label="Cartão" value={cardId} onChange={(e) => setCardId(e.target.value)} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} helperText="Em branco: o cartão é reconhecido pelo final impresso na fatura (ou você escolhe na revisão).">
            <MenuItem value="">Reconhecer pela fatura</MenuItem>
            {cards.map((c) => <MenuItem key={c.id} value={c.id}>{cardLabel(c)}</MenuItem>)}
          </TextField>
          <TextField size="small" type="password" label={needPw ? 'Senha do PDF' : 'Senha do PDF (se houver)'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" error={needPw && !password}
            helperText="Usada só para abrir o arquivo agora; não é guardada." />
          <TextField select size="small" label="Apagar o PDF original após" value={retention} onChange={(e) => setRetention(e.target.value)}
            helperText="Os lançamentos ficam; só o arquivo é apagado. Dá para mudar depois na lista de faturas.">
            {RETENTION_OPTS.map((o) => <MenuItem key={o.v} value={o.v}>{o.v === 'never' ? 'Nunca (guardar sempre)' : o.label}</MenuItem>)}
          </TextField>
          {up.isPending && <Alert severity="info" icon={<CircularProgress size={18} />}>Lendo a fatura… isso pode levar até 2 minutos.</Alert>}
          {err && <Alert severity="error">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose} disabled={up.isPending}>Cancelar</Button><Button variant="contained" onClick={send} disabled={up.isPending || !file}>Enviar e ler</Button></DialogActions>
    </Dialog>
  );
}

interface Row { include: boolean; date: string; description: string; kind: CashflowKind; amount: string }
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ReviewDialog({ id, cards, onClose, onConfirmed }: { id: string; cards: CashflowCard[]; onClose: () => void; onConfirmed: (msg: string) => void }) {
  const { data, error, refetch } = useCashflowStatement(id);
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      {error ? <DialogContent><ErrorBox error={error} retry={() => refetch()} /></DialogContent>
        : !data ? <DialogContent><Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Box></DialogContent>
        : <ReviewBody key={data.id + data.status} s={data} cards={cards} onClose={onClose} onConfirmed={onConfirmed} />}
    </Dialog>
  );
}

function ReviewBody({ s, cards, onClose, onConfirmed }: { s: CashflowStatementDetail; cards: CashflowCard[]; onClose: () => void; onConfirmed: (msg: string) => void }) {
  const readOnly = s.status !== 'review';
  // já no caixa (vindo de outra fatura) começa desmarcado
  const [rows, setRows] = useState<Row[]>(() => s.items.map((i) => ({ include: !i.duplicate, date: i.date, description: i.description, kind: i.kind, amount: fmtNum(i.amount) })));
  const match = cards.find((c) => s.cardLast4 && c.last4 === s.cardLast4);
  const [cardId, setCardId] = useState(s.cardId ?? match?.id ?? '');
  const [err, setErr] = useState('');
  const confirm = useAdminMutation(cashflowApi.confirmStatement, INV);
  const addCard = useAdminMutation(cashflowApi.addCard, INV);
  const set = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const incl = rows.filter((r) => r.include);
  const sum = Math.round(incl.reduce((a, r) => { const v = parseNum(r.amount) || 0; return a + (r.kind === 'refund' ? -v : r.kind === 'payment' ? 0 : v); }, 0) * 100) / 100;
  const masked = (Object.keys(s.maskCounts) as (keyof CashflowMaskCounts)[]).filter((k) => s.maskCounts[k] > 0);

  const save = () => {
    const bad = rows.findIndex((r) => r.include && (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.description.trim() || !(parseNum(r.amount) > 0)));
    if (bad >= 0) return setErr(`Linha ${bad + 1}: confira data, descrição e valor (maior que zero).`);
    setErr('');
    confirm.mutate({ id: s.id, cardId: cardId || null, items: rows.map((r) => ({ include: r.include, date: r.date, description: r.description.trim(), kind: r.kind, amount: parseNum(r.amount) || 0.01 })) }, {
      onSuccess: (r) => onConfirmed(`${r.inserted} lançamento(s) gravado(s) no caixa${r.duplicates ? ` · ${r.duplicates} já existia(m) e não foi(ram) duplicado(s)` : ''}`),
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível confirmar.'),
    });
  };
  const createDetectedCard = () => addCard.mutate({ issuer: s.issuer || 'Cartão', last4: s.cardLast4 }, { onSuccess: (c) => setCardId(c.id), onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível criar o cartão.') });

  return (
    <>
      <DialogTitle>{readOnly ? 'Lançamentos lidos' : 'Revisar fatura'} · {s.filename}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
            <Typography variant="body2">
              {[s.issuer, s.cardLast4 && `final ${s.cardLast4}`].filter(Boolean).join(' · ') || 'Emissor não identificado'}
              {s.closingDate && ` · fechamento ${ddmm(s.closingDate)}/${s.closingDate.slice(0, 4)}`}
              {s.dueDate && ` · vencimento ${ddmm(s.dueDate)}/${s.dueDate.slice(0, 4)}`}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <TextField select size="small" label="Cartão" value={cardId} onChange={(e) => setCardId(e.target.value)} disabled={readOnly} sx={{ minWidth: 240 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              <MenuItem value="">Sem cartão</MenuItem>
              {cards.map((c) => <MenuItem key={c.id} value={c.id}>{cardLabel(c)}</MenuItem>)}
            </TextField>
            {!readOnly && !cardId && (s.issuer || s.cardLast4) && <Button size="small" onClick={createDetectedCard} disabled={addCard.isPending}>Criar “{[s.issuer || 'Cartão', s.cardLast4 && `•••• ${s.cardLast4}`].filter(Boolean).join(' ')}”</Button>}
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip size="small" label={`Total da fatura: ${s.totalAmount != null ? brl(s.totalAmount) : 'não identificado'}`} />
            <Chip size="small" color={s.totalAmount != null && Math.abs(sum - s.totalAmount) < 0.01 ? 'success' : 'default'} label={`Soma ${readOnly ? 'lida' : 'dos marcados'}: ${brl(readOnly ? s.extractedSum : sum)}`} />
            {masked.length > 0 && <Tooltip title="Trocados por marcadores antes de o texto ir para a IA"><Chip size="small" icon={<ShieldOutlinedIcon />} label={`Mascarados: ${masked.map((k) => `${s.maskCounts[k]} ${MASK_LABEL[k]}`).join(', ')}`} /></Tooltip>}
          </Stack>
          {s.warnings.map((w) => <Alert key={w} severity="warning">{w}</Alert>)}
          {!readOnly && s.items.some((i) => i.duplicate) && <Alert severity="info"><AlertTitle>Já no caixa</AlertTitle>Os lançamentos marcados como “já no caixa” vieram de outra fatura e começam desmarcados para não duplicar.</Alert>}

          <TableContainer sx={{ maxHeight: '55vh' }}><Table size="small" stickyHeader>
            <TableHead><TableRow>
              <TableCell padding="checkbox">{!readOnly && <Checkbox size="small" checked={rows.every((r) => r.include)} indeterminate={rows.some((r) => r.include) && !rows.every((r) => r.include)} onChange={(_, v) => setRows((r) => r.map((x) => ({ ...x, include: v })))} slotProps={{ input: { 'aria-label': 'Marcar todos' } }} />}</TableCell>
              {['Data da compra', 'Descrição', 'Origem', 'Tipo', 'Valor (R$)'].map((h) => <TableCell key={h} align={h.startsWith('Valor') ? 'right' : 'left'}>{h}</TableCell>)}
            </TableRow></TableHead>
            <TableBody>{rows.map((r, i) => {
              const it = s.items[i];
              return (
                <TableRow key={i} sx={{ opacity: r.include ? 1 : 0.5 }}>
                  <TableCell padding="checkbox"><Checkbox size="small" checked={r.include} disabled={readOnly} onChange={(_, v) => set(i, { include: v })} slotProps={{ input: { 'aria-label': `Incluir ${r.description}` } }} /></TableCell>
                  <TableCell><TextField size="small" variant="standard" type="date" value={r.date} disabled={readOnly} onChange={(e) => set(i, { date: e.target.value })} slotProps={{ htmlInput: { 'aria-label': `Data de ${r.description}` } }} /></TableCell>
                  <TableCell sx={{ minWidth: 220 }}>
                    <TextField size="small" variant="standard" fullWidth value={r.description} disabled={readOnly} onChange={(e) => set(i, { description: e.target.value })} slotProps={{ htmlInput: { maxLength: 200, 'aria-label': `Descrição da linha ${i + 1}` } }} />
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.25 }}>
                      {it.installmentN && <Typography variant="caption">parcela {it.installmentN}/{it.installmentTotal}</Typography>}
                      {it.amountOriginal != null && <Typography variant="caption">· {it.currencyOriginal} {fmtNum(it.amountOriginal)}</Typography>}
                      {it.duplicate && <Tag tone="warn">já no caixa</Tag>}
                    </Stack>
                  </TableCell>
                  <TableCell><Typography variant="caption">{it.merchantKey}</Typography></TableCell>
                  <TableCell>
                    <TextField select size="small" variant="standard" value={r.kind} disabled={readOnly} onChange={(e) => set(i, { kind: e.target.value as CashflowKind })} slotProps={{ htmlInput: { 'aria-label': `Tipo de ${r.description}` } }}>
                      {(Object.keys(KIND_LABEL) as CashflowKind[]).map((k) => <MenuItem key={k} value={k}>{KIND_LABEL[k]}</MenuItem>)}
                    </TextField>
                  </TableCell>
                  <TableCell align="right"><TextField size="small" variant="standard" value={r.amount} disabled={readOnly} onChange={(e) => set(i, { amount: e.target.value })} inputMode="decimal" sx={{ width: 110 }} slotProps={{ htmlInput: { style: { textAlign: 'right' }, 'aria-label': `Valor de ${r.description}` } }} /></TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table></TableContainer>
          {err && <Alert severity="error">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" sx={{ mr: 'auto', pl: 2 }}>{readOnly ? `${s.entryCount} lançamento(s) desta fatura no caixa.` : `${incl.length} de ${rows.length} lançamento(s) marcados. Pagamento da fatura anterior entra no caixa, mas fica fora das somas.`}</Typography>
        <Button onClick={onClose}>{readOnly ? 'Fechar' : 'Revisar depois'}</Button>
        {!readOnly && <Button variant="contained" onClick={save} disabled={confirm.isPending || incl.length === 0}>Confirmar {incl.length} lançamento(s)</Button>}
      </DialogActions>
    </>
  );
}
