interface OfficialLogoProps {
  className?: string;
  decorative?: boolean;
}

export function OfficialLogo({
  className = "",
  decorative = false,
}: OfficialLogoProps) {
  return (
    <img
      alt={decorative ? "" : "33 Football Pool"}
      aria-hidden={decorative ? "true" : undefined}
      className={`official-logo ${className}`.trim()}
      src={`${import.meta.env.BASE_URL}official-logo.png`}
    />
  );
}
