"use client";

import { useState } from "react";
import type { Platform } from "@/lib/types";

const platformInitials: Record<Platform, string> = {
  x: "X",
  youtube: "YT",
  linuxdo: "L",
  idcflare: "I",
  gitlab: "G",
};

export function AuthorAvatar({
  name,
  platform,
  src,
}: {
  name: string;
  platform: Platform;
  src?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial =
    Array.from(name.trim())[0]?.toUpperCase() || platformInitials[platform];

  return (
    <span
      className={`author-avatar author-avatar-${platform}`}
      title={`${name} 的头像`}
    >
      <span aria-hidden="true">{initial}</span>
      {src && !failed ? (
        // Remote avatar hosts vary by source, so the browser loads them directly.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${name} 的头像`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}
