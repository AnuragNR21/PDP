import { Chip } from '@mui/material';
export function ReadinessChip({ value }: { value: string }) { return <Chip size="small" color="primary" variant="outlined" label={value} />; }
