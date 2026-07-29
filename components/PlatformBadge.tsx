import type { Platform } from "@/lib/types";

const labels: Record<Platform, string> = {
  x: "X",
  youtube: "YT",
  linuxdo: "L",
  idcflare: "IF",
  gitlab: "GL",
};

const accessibleLabels: Record<Platform, string> = {
  x: "X",
  youtube: "YouTube",
  linuxdo: "Linux.do",
  idcflare: "IDCFlare",
  gitlab: "GitLab",
};

export function PlatformBadge({
  platform,
  compact = false,
}: {
  platform: Platform;
  compact?: boolean;
}) {
  return (
    <span
      className={`platform-badge platform-${platform}${compact ? " compact" : ""}`}
      aria-label={accessibleLabels[platform]}
    >
      {labels[platform]}
    </span>
  );
}
