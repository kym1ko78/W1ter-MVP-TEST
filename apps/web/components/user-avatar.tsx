"use client";

import clsx from "clsx";
import { buildAvatarUrl } from "../lib/config";
import { getInitials } from "../lib/utils";

type AvatarUser = {
  displayName: string;
  email: string;
  avatarUrl: string | null;
};

export function UserAvatar({
  user,
  accessToken,
  className,
  imageClassName,
  fallbackClassName,
}: {
  user: AvatarUser | null | undefined;
  accessToken: string | null | undefined;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}) {
  const displayValue = user?.displayName ?? user?.email ?? "User";

  if (user?.avatarUrl) {
    return (
      <div className={clsx("overflow-hidden bg-[#111111]", className)}>
        <img
          src={buildAvatarUrl(user.avatarUrl, accessToken)}
          alt={displayValue}
          className={clsx("h-full w-full object-cover", imageClassName)}
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "flex items-center justify-center bg-[#111111] font-semibold text-white",
        className,
        fallbackClassName,
      )}
      aria-hidden="true"
    >
      {getInitials(displayValue)}
    </div>
  );
}
