import { Card, CardContent, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export function EmptyStatePanel({ title, body }: { title: string; body: ReactNode }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" gutterBottom>{title}</Typography>
        <Typography variant="body2" color="text.secondary">{body}</Typography>
      </CardContent>
    </Card>
  );
}
