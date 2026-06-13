// Vouch brand mark — a shield + check, in the in-app blue (not orange). Used wherever the
// Vouch product appears so it reads as a first-class earn provider.
export function VouchMark({ size = 40 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--color-primary-default)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
      aria-label="Vouch"
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 2l8 3v6c0 5-3.4 8.5-8 11-4.6-2.5-8-6-8-11V5l8-3z" fill="#fff" />
        <path d="M8.2 12l2.6 2.6L16 9.2" stroke="var(--color-primary-default)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
