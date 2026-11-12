import CallSplitOutlined from '@mui/icons-material/CallSplitOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import FolderSpecialOutlined from '@mui/icons-material/FolderSpecialOutlined';
import { Chip, ListItemButton, Stack, ToggleButton, Tooltip, Typography } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { OverflowText } from './OverflowText';
import { SHARED_PACKAGE_ID, type ModelPackage } from './modelPackages';

/**
 * The Package presentation of Model Selection, in parts every model picker can
 * use: the package row, the "Extends: …" line and Common chip under a model,
 * and the Group by Package switch of the Item Selection panels.
 */

/** A package row: chevron, folder (Shared Models has its own), name and model count. */
export function PackageGroupHeader(props: {
  pkg: ModelPackage;
  open: boolean;
  onToggle: () => void;
  /** Models shown, and of how many — the count reads "shown/total" while anything filters. */
  shown: number;
  total: number;
  filtered: boolean;
  /** Anything after the row, e.g. Model Selection's package menu. */
  actions?: ReactNode;
}) {
  const shared = props.pkg.id === SHARED_PACKAGE_ID;
  return (
    <Stack direction="row" alignItems="center" sx={{ pr: 0.5, bgcolor: 'grey.50', '&:hover .pdp-pkg-menu': { opacity: 1 } }}>
      <ListItemButton
        dense
        onClick={props.onToggle}
        aria-expanded={props.open}
        aria-label={`Package ${props.pkg.name}`}
        sx={{ flex: 1, minWidth: 0, gap: 0.75, py: 0.6, pl: 1 }}
      >
        {props.open ? <ExpandMoreOutlined sx={{ fontSize: 18 }} /> : <ChevronRightOutlined sx={{ fontSize: 18 }} />}
        {shared ? (
          <FolderSpecialOutlined sx={{ fontSize: 18, color: '#F9A825' }} />
        ) : (
          <FolderOutlined sx={{ fontSize: 18, color: 'text.secondary' }} />
        )}
        <OverflowText variant="body2" fontWeight={700} sx={{ flex: 1, minWidth: 0 }}>
          {props.pkg.name}
        </OverflowText>
        <Tooltip title={props.filtered ? `${props.shown} shown of ${props.total} models` : `${props.total} model${props.total === 1 ? '' : 's'}`}>
          <Chip size="small" label={props.filtered ? `${props.shown}/${props.total}` : props.total} sx={{ height: 18, fontSize: 10.5, fontWeight: 700 }} />
        </Tooltip>
      </ListItemButton>
      {props.actions}
    </Stack>
  );
}

/** "Extends: <common model>" under a model's name. */
export function ModelExtendsCaption({ baseName }: { baseName: string }) {
  return (
    <Tooltip title={`Extends the common model ${baseName}`}>
      <Stack direction="row" spacing={0.4} alignItems="center" sx={{ color: 'secondary.main', minWidth: 0 }}>
        <CallSplitOutlined sx={{ fontSize: 12, transform: 'rotate(180deg)' }} />
        <Typography variant="caption" noWrap sx={{ fontSize: 10.5 }}>
          Extends: {baseName}
        </Typography>
      </Stack>
    </Tooltip>
  );
}

/** The Common chip of a model other packages can extend. */
export function CommonModelChip() {
  return (
    <Tooltip title="Common model — other packages can extend it">
      <Chip size="small" label="Common" color="warning" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
    </Tooltip>
  );
}

/** The Group by Package switch, beside the kind filter of an Item Selection panel. */
export function GroupByPackageToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <Tooltip title={value ? 'Grouped by Package — show a flat list of models' : 'Group by Package'}>
      <ToggleButton
        size="small"
        value="group-by-package"
        selected={value}
        onChange={() => onChange(!value)}
        aria-label="Group by Package"
        aria-pressed={value}
        sx={{ px: 0.75, py: 0.4 }}
      >
        <FolderOutlined sx={{ fontSize: 18 }} />
      </ToggleButton>
    </Tooltip>
  );
}

/**
 * Whether a panel groups its models by Package — on unless the person turned
 * it off, which this browser remembers per panel. Storage may be unavailable
 * (private window, blocked site data), so every access is guarded.
 */
export function useGroupByPackage(panel: string): [boolean, (next: boolean) => void] {
  const key = `pdp-item-selection-group-by-package:${panel}`;
  const [value, setValue] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) !== 'off';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? 'on' : 'off');
    } catch {
      // Not remembered.
    }
  }, [key, value]);
  return [value, setValue];
}

/** Which packages a panel has folded — each one on its own; all open to begin with. */
export function useFoldedPackages(): [Set<string>, (id: string) => void] {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setFolded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return [folded, toggle];
}
