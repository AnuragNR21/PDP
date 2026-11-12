import { useEffect, useMemo, useState } from "react";
import { MenuItem, TextField } from "@mui/material";
import { useHierarchyModels } from "@/features/structure/state/useStructureWorkspace";

/**
 * The hierarchy model a Structure projection page (Diagram / Matrix) reads.
 * Defaults to the first Active model, so the page never asks for a model that
 * does not exist.
 */
export function useProjectionModel() {
  const models = useHierarchyModels();
  const options = useMemo(
    () => [...(models.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [models.data]
  );
  const [modelId, setModelId] = useState("");
  useEffect(() => {
    if (modelId && options.some((model) => model.id === modelId)) return;
    const first = options.find((model) => model.status === "active") ?? options[0];
    setModelId(first?.id ?? "");
  }, [modelId, options]);
  return { modelId, setModelId, options, model: options.find((item) => item.id === modelId), isLoading: models.isLoading };
}

export function ProjectionModelPicker({ value, options, onChange }: {
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <TextField
      select
      size="small"
      label="Hierarchy model"
      value={options.some((model) => model.id === value) ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth: 280 }}
      disabled={options.length === 0}
    >
      {options.map((model) => (
        <MenuItem key={model.id} value={model.id}>{model.name}</MenuItem>
      ))}
    </TextField>
  );
}
