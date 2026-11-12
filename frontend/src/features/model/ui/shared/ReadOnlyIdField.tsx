import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import { IconButton, InputAdornment, TextField, Tooltip } from '@mui/material';
import { useState } from 'react';

/**
 * A type's system identifier, read only, with a copy button — the value the
 * import / export files carry, so a row can be matched to the type it describes.
 */
export function ReadOnlyIdField(props: { label: string; value: string; helperText?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable: the field can still be selected and copied by hand.
    }
  };
  return (
    <TextField
      fullWidth
      size="small"
      label={props.label}
      value={props.value}
      helperText={props.helperText}
      onFocus={(event) => event.target.select()}
      InputProps={{
        readOnly: true,
        sx: { fontFamily: 'monospace', fontSize: 12.5, bgcolor: 'action.hover' },
        endAdornment: (
          <InputAdornment position="end">
            <Tooltip title={copied ? 'Copied' : `Copy ${props.label}`}>
              <IconButton size="small" edge="end" onClick={() => void copy()} aria-label={`Copy ${props.label}`}>
                <ContentCopyOutlined sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </InputAdornment>
        ),
      }}
      inputProps={{ 'aria-readonly': true }}
    />
  );
}
