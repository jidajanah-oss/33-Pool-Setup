interface OfficialLogoProps {
  className?: string;
  decorative?: boolean;
}

export function OfficialLogo({
  className = "",
  decorative = false,
}: OfficialLogoProps) {
  const logoSrc = `${import.meta.env.BASE_URL}official-logo.png`;

  return (
    <img
      alt={decorative ? "" : "33 Football Pool"}
      aria-hidden={decorative ? "true" : undefined}
      className={`official-logo ${className}`.trim()}
      onError={(event) => {
        const image = event.currentTarget;

        if (image.dataset.retry === "1") {
          return;
        }

        image.dataset.retry = "1";
        image.src = `${logoSrc}?v=33-pool-v32`;
      }}
      src={logoSrc}
    />
  );
}