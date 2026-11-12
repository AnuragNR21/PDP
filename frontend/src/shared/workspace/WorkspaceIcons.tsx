import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import UndoOutlined from '@mui/icons-material/UndoOutlined';
import { Avatar, IconButton, Tooltip, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';
import type { ModelKind } from './workspaceModel';

/** Hierarchy models are blue, support domain models green — everywhere a model appears. */
export const MODEL_KIND_COLOR: Record<ModelKind, string> = {
  hierarchy: '#1565c0',
  support: '#2e7d32',
};

export function ModelKindIcon({ kind, size = 32, sx }: { kind: ModelKind; size?: number; sx?: SxProps<Theme> }) {
  const Icon = kind === 'hierarchy' ? AccountTreeOutlined : HubOutlined;
  return (
    <Avatar
      variant="rounded"
      sx={{ width: size, height: size, bgcolor: MODEL_KIND_COLOR[kind], ...((sx as object) ?? {}) }}
      aria-label={kind === 'hierarchy' ? 'Hierarchy model' : 'Support domain model'}
    >
      <Icon sx={{ fontSize: size * 0.6 }} />
    </Avatar>
  );
}

type ActionProps = {
  /** What the action applies to, read out in the tooltip: "Edit Feeder". */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  size?: 'small' | 'medium';
};

function ActionIcon({ title, icon, color, ...props }: ActionProps & { title: string; icon: ReactNode; color?: 'error' | 'primary' | 'default' }) {
  return (
    <Tooltip title={`${title} ${props.label}`.trim()}>
      <span>
        <IconButton
          size={props.size ?? 'small'}
          color={color ?? 'default'}
          disabled={props.disabled}
          aria-label={`${title} ${props.label}`.trim()}
          onClick={(event) => {
            event.stopPropagation();
            props.onClick();
          }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

/*
 * The four row actions, drawn the same in every view of both workspaces:
 * + Add, ✎ Edit, ⧉ Duplicate, 🗑 Delete (delete is the only red one).
 */
export function AddAction(props: ActionProps) {
  return <ActionIcon {...props} title="Add" color="primary" icon={<AddOutlined fontSize="small" />} />;
}
export function EditAction(props: ActionProps) {
  return <ActionIcon {...props} title="Edit" icon={<EditOutlined fontSize="small" />} />;
}
export function DuplicateAction(props: ActionProps) {
  return <ActionIcon {...props} title="Duplicate" icon={<ContentCopyOutlined fontSize="small" />} />;
}
export function DeleteAction(props: ActionProps) {
  return <ActionIcon {...props} title="Delete" color="error" icon={<DeleteOutlineOutlined fontSize="small" />} />;
}
/** Saves the edits in a details panel. Disabled until there is a valid change to save. */
export function SaveAction(props: ActionProps) {
  return <ActionIcon {...props} title="Save" color="primary" icon={<SaveOutlined fontSize="small" />} />;
}
/** Throws away unsaved edits in a details panel (or a new item not yet saved). */
export function CancelAction(props: ActionProps) {
  return <ActionIcon {...props} title="Cancel changes to" icon={<UndoOutlined fontSize="small" />} />;
}
