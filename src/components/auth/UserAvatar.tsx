import type { AppUser } from '../../models';

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function UserAvatar({ user, size = 40 }: { user: Pick<AppUser, 'name' | 'color'>; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: user.color ?? 'var(--primary)' }} aria-hidden>
      {initials(user.name)}
    </span>
  );
}
