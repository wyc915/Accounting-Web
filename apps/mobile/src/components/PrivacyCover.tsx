import { AnimatePresence, motion } from 'framer-motion';
import { useUI } from '@/stores/ui';

/** Hides balances in the app switcher while the app is in the background */
export function PrivacyCover() {
  const covered = useUI((s) => s.covered);
  return (
    <AnimatePresence>
      {covered && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[90] grid place-items-center bg-bg"
          aria-hidden
        >
          <img src="/icon.svg" alt="" className="size-20" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
