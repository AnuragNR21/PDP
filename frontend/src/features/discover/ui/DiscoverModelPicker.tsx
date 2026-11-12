import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import type { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";

type Model = { application_name: string; application_ref_id: string; field_count?: number };

/**
 * The model this table is mapped to, chosen on the panel that lists its fields.
 *
 * It sits on that panel's title because that is what it decides: change the
 * model and the list underneath becomes a different set of fields. It has been
 * in two wrong places — in the page header, where the empty state had to tell
 * people to scroll up, and in the table tab bar, where a control that is not a
 * tab sat in a row of tabs and read as one more table.
 *
 * A model belongs to the table, not to the session. One upload can hold five
 * files from five different source systems, and each is read against the
 * structure that fits it — so switching the model here clears this table's
 * pairings and leaves every other table's alone.
 */
export function DiscoverModelPicker({
  vm,
}: {
  vm: ReturnType<typeof useDiscoverWorkspace>;
}) {
  const [pending, setPending] = useState<Model | null>(null);
  const models: Model[] = vm.structureApplicationsQuery.data ?? [];
  const selectedId = vm.sourceContextQuery.data?.application_ref_id ?? "";
  const current = models.find((m) => m.application_ref_id === selectedId);
  const switching = vm.changeModelMutation.isPending;
  const isEmpty = (m: Model) => typeof m.field_count === "number" && m.field_count === 0;

  // This table's pairings, because those are the ones a switch clears.
  //
  // The other tables of the session keep their own models and their own
  // pairings; naming a session-wide number here would promise to destroy
  // work that a switch does not touch.
  const ofThisTable = new Set((vm.columnsQuery.data ?? []).map((c) => c.column_id));
  const mappedCount = (vm.mappingsQuery.data ?? []).filter(
    (m) => m.target_node_id && ofThisTable.has(m.column_id),
  ).length;

  const failure = vm.changeModelMutation.error;
  const failureMessage =
    (failure as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
    (failure instanceof Error ? failure.message : "");

  const choose = (applicationRefId: string) => {
    const model = models.find((m) => m.application_ref_id === applicationRefId);
    if (!model || model.application_ref_id === selectedId) return;
    vm.changeModelMutation.reset();
    // Nothing to lose yet — switch straight away rather than asking about it.
    if (mappedCount === 0) {
      vm.changeModelMutation.mutate(model);
      return;
    }
    setPending(model);
  };

  return (
    <>
      {/* Sized like the decision it is.
          It began as a chip on the panel title, which read as a label rather
          than a control — the thing it names is the whole list below it, and a
          screen nobody can see the switch on is a screen where the wrong model
          stays chosen. */}
      <Box
        sx={{
          width: "100%",
          p: 1.25,
          mb: 1.5,
          borderRadius: 2,
          border: 1,
          borderColor: selectedId ? "primary.light" : "warning.main",
          bgcolor: selectedId ? "primary.50" : "warning.50",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
          <CategoryOutlinedIcon sx={{ fontSize: 17 }} color={selectedId ? "primary" : "warning"} />
          <Typography variant="caption" fontWeight={700} color={selectedId ? "primary.main" : "warning.main"}>
            {selectedId ? "Model this table is read against" : "Choose the model this table belongs to"}
          </Typography>
          {switching && <CircularProgress size={12} />}
        </Stack>

        <FormControl fullWidth size="small">
          <Select
            displayEmpty
            value={selectedId}
            onChange={(e) => choose(e.target.value)}
            disabled={switching}
            renderValue={() => (
              <Typography variant="body2" fontWeight={600} noWrap>
                {current ? current.application_name : "Select a model…"}
              </Typography>
            )}
            sx={{ bgcolor: "background.paper", ".MuiSelect-select": { py: 1 } }}
          >
            {models.map((model) => (
              <MenuItem
                key={model.application_ref_id}
                value={model.application_ref_id}
                disabled={isEmpty(model)}
                sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}
              >
                <span>{model.application_name}</span>
                {isEmpty(model) ? (
                  <Typography variant="caption" color="error.main">no fields defined</Typography>
                ) : typeof model.field_count === "number" ? (
                  <Typography variant="caption" color="text.secondary">
                    {model.field_count} field{model.field_count === 1 ? "" : "s"}
                  </Typography>
                ) : null}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {failureMessage && !pending && (
          <Alert severity="error" sx={{ mt: 1, py: 0 }}>
            {failureMessage}
          </Alert>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {!selectedId
            ? "Its fields then appear below, ready to pair with your columns."
            : mappedCount > 0
              ? `Changing it clears this table's ${mappedCount} pairing${mappedCount === 1 ? "" : "s"} — you will be asked first.`
              : `${current?.field_count ?? 0} fields available to pair.`}
        </Typography>
      </Box>

      {/*
        Switching model is allowed, but never silently: the pairings point at
        fields of the model being left behind, so they cannot come along. Saying
        how many will go — and which model is being swapped for which — is what
        makes this a decision rather than a surprise.
      */}
      <Dialog open={!!pending} onClose={() => !switching && setPending(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, pb: 0.5 }}>Change model?</DialogTitle>
        <DialogContent>
          {failureMessage && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {failureMessage}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            This table's {mappedCount} pairing{mappedCount === 1 ? "" : "s"} belong to{" "}
            <b>{current?.application_name ?? "the current model"}</b> and cannot move to{" "}
            <b>{pending?.application_name}</b>. Switching clears{" "}
            {mappedCount === 1 ? "it" : "them"} so you can pair against the new model — this
            table's file, columns and profile are untouched, and so is every other table in
            the session.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPending(null)} disabled={switching} sx={{ textTransform: "none" }}>
            Keep {current?.application_name ?? "the current model"}
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              if (!pending) return;
              // Closed only on success. A switch the server refuses used to
              // close the dialog and leave the old model in place, which is
              // indistinguishable from the button doing nothing at all.
              vm.changeModelMutation.mutate(pending, {
                onSuccess: () => setPending(null),
              });
            }}
            disabled={switching}
            startIcon={switching ? <CircularProgress size={15} color="inherit" /> : undefined}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            Clear and switch
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
