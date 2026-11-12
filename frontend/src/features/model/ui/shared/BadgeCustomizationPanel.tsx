/**
 * BadgeCustomizationPanel
 *
 * Full badge editor matching the design:
 *   Preview · Size · Shape · Content type · Icon picker · Badge Text
 *   Background Colour · Text Colour (auto contrast) · Reset to Default
 *
 * Edits are saved in line with the rest of the details panel — by the panel's
 * Save — so there is no separate save button here.
 */
import {
  ArticleOutlined,
  BoltOutlined,
  CheckCircleOutlined,
  ContentCutOutlined,
  SettingsOutlined,
  ShieldOutlined,
  StarOutlined,
  StorageOutlined,
  ViewInArOutlined,
  WarningAmberOutlined,
} from '@mui/icons-material';
import {
  Box,
  Button,
  ButtonGroup,
  Chip,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BadgeContentType, BadgeCustomization, BadgeOptions, BadgeShape } from '../../domain/types';
import { BadgeIcon } from './BadgeIcon';
import { BadgeIconPicker } from './BadgeIconPicker';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Luminance-based contrast ratio (WCAG). Returns ratio × 1 (e.g. 4.5 = 4.5:1). */
function contrastRatio(hex1: string, hex2: string): number {
  const lum = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const linearize = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  };
  const l1 = lum(hex1);
  const l2 = lum(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Best contrasting text colour (black or white) for a given background. */
function autoTextColor(bg: string): string {
  try {
    return contrastRatio(bg, '#FFFFFF') >= contrastRatio(bg, '#000000') ? '#FFFFFF' : '#000000';
  } catch {
    return '#FFFFFF';
  }
}

/** Validate and normalise a hex colour string. Returns null if invalid. */
function normaliseHex(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return null;
  const digits = match[1];
  const full = digits.length === 3
    ? digits.split('').map((d) => d + d).join('')
    : digits;
  return `#${full.toUpperCase()}`;
}

// ── Icon lookup (same as BadgeIcon) ───────────────────────────────────────────

const ICON_COMPONENTS: Record<string, React.ReactElement> = {
  star: <StarOutlined fontSize="small" />,
  bolt: <BoltOutlined fontSize="small" />,
  database: <StorageOutlined fontSize="small" />,
  shield: <ShieldOutlined fontSize="small" />,
  settings: <SettingsOutlined fontSize="small" />,
  cube: <ViewInArOutlined fontSize="small" />,
  scissors: <ContentCutOutlined fontSize="small" />,
  document: <ArticleOutlined fontSize="small" />,
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function ColourSwatch({ color, selected, onClick }: { color: string; selected: boolean; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        width: 26,
        height: 26,
        borderRadius: '4px',
        bgcolor: color,
        cursor: 'pointer',
        border: selected ? '2px solid #1565C0' : '2px solid transparent',
        outline: selected ? '2px solid white' : 'none',
        outlineOffset: '-3px',
        boxSizing: 'border-box',
        '&:hover': { opacity: 0.85 },
      }}
    />
  );
}

function ColourInput({
  label,
  value,
  autoEnabled,
  autoValue,
  onChange,
  onToggleAuto,
  bgColor,
}: {
  label: string;
  value: string;
  autoEnabled?: boolean;
  autoValue?: string;
  onChange: (hex: string) => void;
  onToggleAuto?: (enabled: boolean) => void;
  bgColor?: string;
}) {
  const [raw, setRaw] = useState(value);
  const [error, setError] = useState(false);

  useEffect(() => {
    setRaw(value);
    setError(false);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setRaw(val);
    const norm = normaliseHex(val);
    if (norm) {
      setError(false);
      onChange(norm);
    } else {
      setError(true);
    }
  };

  const ratio = bgColor && !error ? contrastRatio(bgColor, value) : null;
  const ratioLabel = ratio !== null ? `${ratio.toFixed(2)} : 1` : null;
  const isGood = ratio !== null && ratio >= 4.5;

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="caption" fontWeight={600}>{label}</Typography>
        {onToggleAuto && (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="caption" color="text.secondary">Auto for contrast</Typography>
            <Box
              component="input"
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => onToggleAuto((e as React.ChangeEvent<HTMLInputElement>).target.checked)}
              style={{ cursor: 'pointer' }}
            />
          </Stack>
        )}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '4px',
            bgcolor: error ? '#CCCCCC' : value,
            border: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
          }}
        />
        <TextField
          size="small"
          value={raw}
          onChange={handleChange}
          error={error}
          disabled={autoEnabled}
          inputProps={{ maxLength: 7, style: { fontFamily: 'monospace', fontSize: 13 } }}
          sx={{ width: 120 }}
        />
      </Stack>
      {ratioLabel && (
        <Stack direction="row" spacing={0.5} alignItems="center">
          {isGood ? (
            <CheckCircleOutlined sx={{ fontSize: 14, color: 'success.main' }} />
          ) : (
            <WarningAmberOutlined sx={{ fontSize: 14, color: 'warning.main' }} />
          )}
          <Typography variant="caption" color={isGood ? 'success.main' : 'warning.main'}>
            Contrast Ratio: {ratioLabel} — {isGood ? 'Good contrast' : 'Low contrast'}
          </Typography>
        </Stack>
      )}
    </Stack>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function BadgeCustomizationPanel({
  badge,
  options,
  saving,
  dirty = false,
  onChange,
  onReset,
  fallbackText,
  docked = false,
}: {
  badge: BadgeCustomization;
  options: BadgeOptions;
  saving: boolean;
  /** The badge differs from the saved one. */
  dirty?: boolean;
  onChange: (patch: Partial<BadgeCustomization>) => void;
  onReset: () => void;
  fallbackText?: string;
  docked?: boolean;
}) {
  const [autoTextColorEnabled, setAutoTextColorEnabled] = useState(false);

  const effectiveBadge = useMemo<BadgeCustomization>(() => {
    const badgeText = badge.badgeText.trim() || fallbackText?.trim() || '';
    if (autoTextColorEnabled) {
      return { ...badge, badgeText, badgeTextColor: autoTextColor(badge.badgeColor) };
    }
    return { ...badge, badgeText };
  }, [badge, autoTextColorEnabled, fallbackText]);

  const handleAutoTextColor = useCallback(
    (enabled: boolean) => {
      setAutoTextColorEnabled(enabled);
      if (enabled) {
        onChange({ badgeTextColor: autoTextColor(badge.badgeColor) });
      }
    },
    [badge.badgeColor, onChange],
  );

  const handleColorChange = useCallback(
    (color: string) => {
      const norm = normaliseHex(color);
      if (!norm) return;
      const patch: Partial<BadgeCustomization> = { badgeColor: norm };
      if (autoTextColorEnabled) {
        patch.badgeTextColor = autoTextColor(norm);
      }
      onChange(patch);
    },
    [autoTextColorEnabled, onChange],
  );

  // Scale preview: keeps aspect but shows a large enough badge to appreciate the shape
  const PREVIEW_BASE = 64;
  const SIZE_BASE = 24; // default reference size
  const previewSize = Math.round((effectiveBadge.badgeSize / SIZE_BASE) * PREVIEW_BASE);

  return (
    <Box sx={docked ? { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' } : {}}>
      {/* Scrollable content */}
      {/* Docked preview */}
      {docked ? (
        <Box sx={{ flexShrink: 0, pb: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>Preview</Typography>
          <BadgeIcon
            badgeText={effectiveBadge.badgeText}
            badgeShape={effectiveBadge.badgeShape}
            badgeColor={effectiveBadge.badgeColor}
            badgeTextColor={effectiveBadge.badgeTextColor}
            badgeIcon={effectiveBadge.badgeIcon}
            badgeSize={previewSize}
            badgeContentType={effectiveBadge.badgeContentType}
          />
        </Box>
      ) : null}

      <Box sx={docked ? { flex: 1, overflowY: 'auto', pr: 0.5 } : {}}>
      <Stack spacing={2.5}>
      {/* Preview (non-docked) */}
      {!docked && (
      <Stack alignItems="center" spacing={0.5}>
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          Preview
        </Typography>
        <BadgeIcon
          badgeText={effectiveBadge.badgeText}
          badgeShape={effectiveBadge.badgeShape}
          badgeColor={effectiveBadge.badgeColor}
          badgeTextColor={effectiveBadge.badgeTextColor}
          badgeIcon={effectiveBadge.badgeIcon}
          badgeSize={previewSize}
          badgeContentType={effectiveBadge.badgeContentType}
        />
      </Stack>
      )}

      {!docked && <Divider />}

      {/* Size */}
      <Stack spacing={0.5}>
        <Typography variant="caption" fontWeight={600}>Size</Typography>
        <ButtonGroup size="small" variant="outlined">
          {options.sizes.map((s) => (
            <Button
              key={s}
              variant={badge.badgeSize === s ? 'contained' : 'outlined'}
              onClick={() => onChange({ badgeSize: s })}
              sx={{ minWidth: 44, fontWeight: badge.badgeSize === s ? 700 : 400 }}
            >
              {s}px
            </Button>
          ))}
        </ButtonGroup>
      </Stack>

      {/* Shape */}
      <Stack spacing={0.5}>
        <Typography variant="caption" fontWeight={600}>Shape</Typography>
        <FormControl size="small" sx={{ width: 200 }}>
          <Select
            value={badge.badgeShape}
            onChange={(e) => onChange({ badgeShape: e.target.value as BadgeShape })}
          >
            {options.shapes.map((s) => (
              <MenuItem key={s.key} value={s.key}>{s.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {/* Content type */}
      <Stack spacing={0.5}>
        <Typography variant="caption" fontWeight={600}>Content</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={badge.badgeContentType}
          onChange={(_, val) => { if (val) onChange({ badgeContentType: val as BadgeContentType }); }}
        >
          {options.contentTypes.map((ct) => (
            <ToggleButton key={ct.key} value={ct.key} sx={{ textTransform: 'none', px: 1.5 }}>
              {ct.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      {/* Icon picker — standard PDP icons and custom icons */}
      {(badge.badgeContentType === 'icon' || badge.badgeContentType === 'text_icon') && (
        <BadgeIconPicker
          value={badge.badgeIcon}
          onChange={(value) => onChange({ badgeIcon: value })}
          standardIcons={options.icons}
          standardRender={ICON_COMPONENTS}
          badgeColor={badge.badgeColor}
          badgeTextColor={badge.badgeTextColor}
          badgeShape={badge.badgeShape}
        />
      )}

      {/* Badge text */}
      {(badge.badgeContentType === 'text' || badge.badgeContentType === 'text_icon') && (
        <Stack spacing={0.5}>
          <Typography variant="caption" fontWeight={600}>Badge Text (0–3 characters)</Typography>
          <TextField
            size="small"
            value={badge.badgeText}
            onChange={(e) => onChange({ badgeText: e.target.value.slice(0, 3) })}
            inputProps={{ maxLength: 3 }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <Typography variant="caption" color="text.secondary">
                    {badge.badgeText.length} / 3
                  </Typography>
                </InputAdornment>
              ),
            }}
            sx={{ width: 200 }}
          />
        </Stack>
      )}

      <Divider />

      {/* Background colour */}
      <Stack spacing={1}>
        <Typography variant="caption" fontWeight={600}>Background Colour</Typography>
        <ColourInput
          label=""
          value={badge.badgeColor}
          onChange={handleColorChange}
        />
        <Stack direction="row" flexWrap="wrap" gap={0.5}>
          {options.presetColors.map((color) => (
            <ColourSwatch
              key={color}
              color={color}
              selected={badge.badgeColor.toUpperCase() === color.toUpperCase()}
              onClick={() => handleColorChange(color)}
            />
          ))}
        </Stack>
      </Stack>

      {/* Text colour */}
      <Stack spacing={1}>
        <ColourInput
          label="Text Colour"
          value={effectiveBadge.badgeTextColor}
          autoEnabled={autoTextColorEnabled}
          autoValue={autoTextColor(badge.badgeColor)}
          bgColor={badge.badgeColor}
          onChange={(hex) => onChange({ badgeTextColor: hex })}
          onToggleAuto={handleAutoTextColor}
        />
      </Stack>

      <Divider />

      {/* Actions */}
      <Stack direction="row" spacing={1} alignItems="center">
        <Button variant="outlined" size="small" startIcon={<span>↺</span>} onClick={onReset} disabled={saving}>
          Reset to Default
        </Button>
        <Typography variant="caption" color={dirty ? 'warning.main' : 'text.secondary'} sx={{ flex: 1 }} aria-live="polite">
          {saving ? 'Saving badge…' : dirty ? 'Unsaved badge changes — save them with Save at the top of the panel.' : 'Badge changes are saved with the panel’s Save.'}
        </Typography>
      </Stack>
    </Stack>
    </Box>
    </Box>
  );
}
