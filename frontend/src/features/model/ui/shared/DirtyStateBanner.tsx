import { Alert } from '@mui/material';
export function DirtyStateBanner({ visible, message }: { visible: boolean; message?: string }) {
  if (!visible) return null;
  return <Alert severity="info">{message ?? 'Unsaved changes are present.'}</Alert>;
}
