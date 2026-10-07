import { Boxes } from 'lucide-react';
import { useSettings } from '../store/settings';

export function Logo({ size = 36 }: { size?: number }) {
  const { logo } = useSettings();
  return (
    <span className="brand-logo" style={{ width: size, height: size }} aria-hidden>
      {logo.kind === 'emoji' && logo.value ? (
        <span style={{ fontSize: size * 0.58 }}>{logo.value}</span>
      ) : logo.kind === 'image' && logo.value ? (
        <img src={logo.value} alt="" />
      ) : (
        <Boxes size={size * 0.56} />
      )}
    </span>
  );
}
