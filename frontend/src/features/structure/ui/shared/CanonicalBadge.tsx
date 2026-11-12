import type { BadgeCustomization } from "@/features/model/domain/types";
import { BadgeIcon } from "@/features/model/ui/shared/BadgeIcon";

type Props = {
  badge?: BadgeCustomization | null;
  fallbackText: string;
  fallbackColor?: string;
  size?: number;
};

function normalizeFallback(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

export function CanonicalBadge({
  badge,
  fallbackText,
  fallbackColor = "#757575",
  size = 24,
}: Props) {
  if (!badge) {
    return (
      <BadgeIcon
        badgeText={normalizeFallback(fallbackText)}
        badgeShape="circle"
        badgeColor={fallbackColor}
        badgeTextColor="#ffffff"
        badgeSize={size}
        badgeContentType="text"
      />
    );
  }

  return (
    <BadgeIcon
      badgeText={badge.badgeText.trim() || normalizeFallback(fallbackText)}
      badgeShape={badge.badgeShape}
      badgeColor={badge.badgeColor}
      badgeTextColor={badge.badgeTextColor}
      badgeIcon={badge.badgeIcon ?? undefined}
      badgeSize={size}
      badgeContentType={badge.badgeContentType}
    />
  );
}
