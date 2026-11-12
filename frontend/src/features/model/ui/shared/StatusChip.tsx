import { Chip } from '@mui/material';
export function StatusChip({ value }: { value: string }) { return <Chip size="small" label={value || 'n/a'} />; }
