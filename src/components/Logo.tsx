import { useSettings } from '../store/settings';

const BASE = import.meta.env.BASE_URL;
/** Logo de Orillas Parador (el círculo completo): se usa en todos lados, también en chico. */
export const BRAND_LOGO = `${BASE}brand/orillas-logo.png`;
export const BRAND_MARK = BRAND_LOGO;

export function Logo({ size = 36 }: { size?: number }) {
  const { logo } = useSettings();
  const own = logo.kind !== 'default' && !!logo.value;
  return (
    <span className={`brand-logo${own ? '' : ' is-brand'}`} style={{ width: size, height: size }} aria-hidden>
      {logo.kind === 'emoji' && logo.value ? (
        <span style={{ fontSize: size * 0.58 }}>{logo.value}</span>
      ) : logo.kind === 'image' && logo.value ? (
        <img src={logo.value} alt="" />
      ) : (
        <img src={BRAND_MARK} alt="" />
      )}
    </span>
  );
}

/** Logo completo (círculo con "Orillas · Parador" y el pescado), para la entrada. */
export function BrandLogo({ size = 160 }: { size?: number }) {
  return <img className="brand-full" src={BRAND_LOGO} width={size} height={size} alt="Orillas" />;
}
