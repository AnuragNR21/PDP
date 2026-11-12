/**
 * BadgeIcon renders a single badge shape with the configured text/icon/text+icon
 * content. It's used both in the customisation preview and in diagram nodes.
 */
import {
  ArticleOutlined,
  BoltOutlined,
  ContentCutOutlined,
  SettingsOutlined,
  ShieldOutlined,
  StarOutlined,
  StorageOutlined,
  ViewInArOutlined,
} from '@mui/icons-material';
import { Box, SvgIcon, Typography } from '@mui/material';
import type { BadgeContentType, BadgeShape } from '../../domain/types';
import { customIconMarkup } from '../../domain/customBadgeIcons';

// ── Icon map ───────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, typeof SvgIcon> = {
  star: StarOutlined,
  bolt: BoltOutlined,
  database: StorageOutlined,
  shield: ShieldOutlined,
  settings: SettingsOutlined,
  cube: ViewInArOutlined,
  scissors: ContentCutOutlined,
  document: ArticleOutlined,
};

// ── Clip paths / SVG shapes ────────────────────────────────────────────────────

function ShapeClip({
  shape,
  size,
  color,
  textColor,
  children,
}: {
  shape: BadgeShape;
  size: number;
  color: string;
  textColor: string;
  children: React.ReactNode;
}) {
  const borderRadius: Record<BadgeShape, string | number> = {
    circle: '50%',
    'rounded-square': '20%',
    hexagon: '0',
    diamond: '0',
    square: '0',
  };

  if (shape === 'hexagon' || shape === 'diamond') {
    const r = size / 2;
    const pts =
      shape === 'diamond'
        ? `${r},0 ${size},${r} ${r},${size} 0,${r}`
        : Array.from({ length: 6 }, (_, i) => {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            return `${r + r * Math.cos(angle)},${r + r * Math.sin(angle)}`;
          }).join(' ');
    return (
      <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0 }}>
          <polygon points={pts} fill={color} />
        </svg>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: textColor,
          }}
        >
          {children}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: size,
        height: size,
        bgcolor: color,
        borderRadius: borderRadius[shape],
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: textColor,
          gap: '1px',
          width: '100%',
          height: '100%',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

// ── Public component ───────────────────────────────────────────────────────────

export function BadgeIcon({
  badgeText = '',
  badgeShape = 'rounded-square',
  badgeColor = '#1976D2',
  badgeTextColor = '#FFFFFF',
  badgeIcon = null,
  badgeSize = 16,
  badgeContentType = 'text',
}: {
  badgeText?: string;
  badgeShape?: BadgeShape;
  badgeColor?: string;
  badgeTextColor?: string;
  badgeIcon?: string | null;
  badgeSize?: number;
  badgeContentType?: BadgeContentType;
}) {
  const IconComponent = badgeIcon ? ICON_MAP[badgeIcon] : null;
  // A custom icon carries its own (re-cleaned) SVG and draws in the icon colour.
  const customSvg = IconComponent ? null : customIconMarkup(badgeIcon);
  const isTextIcon = badgeContentType === 'text_icon';
  const iconSize = Math.round(badgeSize * (isTextIcon ? 0.42 : 0.6));
  const fontSize = Math.max(7, Math.round(badgeSize * (isTextIcon ? 0.28 : 0.38)));
  const displayText = badgeText.slice(0, 3);

  const showText = badgeContentType === 'text' || badgeContentType === 'text_icon';
  const showIcon = (badgeContentType === 'icon' || badgeContentType === 'text_icon') && (IconComponent || customSvg);

  return (
    <ShapeClip shape={badgeShape} size={badgeSize} color={badgeColor} textColor={badgeTextColor}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: isTextIcon ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: isTextIcon ? 0 : '1px',
          lineHeight: 1,
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        {showIcon && IconComponent && (
          <IconComponent sx={{ fontSize: iconSize, color: badgeTextColor, lineHeight: 1 }} />
        )}
        {showIcon && customSvg && (
          <Box
            component="span"
            data-custom-badge-icon=""
            sx={{ width: iconSize, height: iconSize, color: badgeTextColor, display: 'inline-flex', flexShrink: 0, '& svg': { width: '100%', height: '100%', display: 'block' } }}
            dangerouslySetInnerHTML={{ __html: customSvg }}
          />
        )}
        {showText && displayText && (
          <Typography
            component="span"
            sx={{
              fontSize,
              fontWeight: 700,
              lineHeight: 1,
              color: badgeTextColor,
              letterSpacing: '-0.02em',
              userSelect: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {displayText}
          </Typography>
        )}
      </Box>
    </ShapeClip>
  );
}
