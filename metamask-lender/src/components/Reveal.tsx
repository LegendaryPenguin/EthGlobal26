import { motion } from "framer-motion";
import type { ReactNode } from "react";

// Scroll-reveal: fade + rise as the element scrolls into view. Subtle by design so it
// fits the wallet dashboard (the big hero-rotate lives on the borrower landing instead).
// framer-motion honors prefers-reduced-motion globally via MotionConfig defaults.
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.4, ease: [0.2, 0, 0, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
