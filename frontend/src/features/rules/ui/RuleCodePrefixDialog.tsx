import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import RestartAltIcon from "@mui/icons-material/RestartAltOutlined";
import type { RuleCodePrefixReport } from "@/features/rules/api/rulesApi";

type Props = {
  open: boolean;
  report: RuleCodePrefixReport | undefined;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onSave: (category: string, prefix: string) => void;
  onClear: (category: string) => void;
  onClose: () => void;
};

/**
 * Choosing what a category's rule codes look like.
 *
 * A prefix is guessed from the category name by default — "Asset register"
 * gives AR. That is a reasonable guess and a bad rule: every organisation
 * codes its rules differently. This is where a team overrides the guess.
 *
 * What it does not do is rewrite codes already issued. A result cites the code
 * of the rule that produced it, so reissuing one would quietly re-label old
 * evidence. The new family starts with the next rule created, and the table
 * says exactly what that next code will be.
 */
export function RuleCodePrefixDialog(props: Props) {
  const { open, report, loading, busy, error } = props;
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // A reply from the server is the truth; anything typed and not saved is
  // dropped rather than left sitting over a value it no longer matches.
  useEffect(() => {
    if (report) setDrafts({});
  }, [report]);

  const valueFor = (category: string, prefix: string) => drafts[category] ?? prefix;
  const items = report?.items ?? [];

  return (
    <Dialog open={open} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Rule codes
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Each category hands out its own family of codes. Set the prefix your team uses.
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <Alert severity="info">
            Codes already issued keep the prefix they were issued under — results cite them, so
            changing one would re-label existing evidence. A new prefix applies to rules created
            from then on.
          </Alert>

          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={22} />
            </Box>
          ) : items.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
              No categories yet. Write a rule first — its category appears here.
            </Typography>
          ) : (
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Category</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 200 }}>Prefix</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 130 }}>Next code</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 100 }}>Issued</TableCell>
                    <TableCell sx={{ width: 96 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item) => {
                    const draft = valueFor(item.category, item.prefix);
                    const dirty = draft.trim().toUpperCase() !== item.prefix.toUpperCase();
                    return (
                      <TableRow key={item.category} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>
                            {item.category}
                          </Typography>
                          {item.shared_with.length > 0 && (
                            <Typography variant="caption" color="text.secondary">
                              shares this family with {item.shared_with.join(", ")}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <TextField
                              size="small"
                              value={draft}
                              inputProps={{
                                maxLength: report?.max_length ?? 8,
                                style: { textTransform: "uppercase", fontFamily: "monospace" },
                              }}
                              onChange={(event) =>
                                setDrafts((state) => ({
                                  ...state,
                                  [item.category]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter" && dirty) props.onSave(item.category, draft);
                              }}
                              sx={{ width: 110 }}
                            />
                            {item.source === "default" && !dirty && (
                              <Tooltip title="Guessed from the category name. Type your own to override it.">
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label="default"
                                  sx={{ height: 18, fontSize: "0.6rem" }}
                                />
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                            {dirty ? "—" : item.next_code}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {item.issued}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                            {dirty && (
                              <Tooltip title="Save this prefix">
                                <span>
                                  <IconButton
                                    size="small"
                                    color="primary"
                                    disabled={busy}
                                    onClick={() => props.onSave(item.category, draft)}
                                  >
                                    <CheckIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            )}
                            {item.source === "configured" && !dirty && (
                              <Tooltip title={`Back to the default, ${item.default_prefix}`}>
                                <span>
                                  <IconButton
                                    size="small"
                                    disabled={busy}
                                    onClick={() => props.onClear(item.category)}
                                  >
                                    <RestartAltIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}

          <Typography variant="caption" color="text.secondary">
            Letters and digits only, starting with a letter, up to {report?.max_length ?? 8}{" "}
            characters. The hyphen and the number are added automatically — ASSET becomes
            ASSET-0001.
          </Typography>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={props.onClose} sx={{ textTransform: "none" }}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
