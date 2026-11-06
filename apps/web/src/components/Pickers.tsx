import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { COLORS, ICON_NAMES, Icon } from '@/lib/icons';
import { cn } from '@/lib/format';
import { spring } from './ui';

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="grid grid-cols-9 gap-2">
      {COLORS.map((c) => (
        <motion.button
          type="button"
          key={c}
          whileTap={{ scale: 0.85 }}
          onClick={() => onChange(c)}
          className="relative grid aspect-square place-items-center rounded-full"
          style={{ background: c }}
          aria-label={c}
        >
          {value === c && (
            <motion.span layoutId="color-sel" transition={spring} className="absolute -inset-1 rounded-full border-2" style={{ borderColor: c }} />
          )}
          {value === c && <Check className="size-4 text-white" strokeWidth={3} />}
        </motion.button>
      ))}
    </div>
  );
}

export function IconPicker({ value, onChange, color }: { value: string; onChange: (i: string) => void; color: string }) {
  return (
    <div className="grid max-h-52 grid-cols-7 gap-2 overflow-y-auto rounded-2xl bg-surface-2/50 p-2 sm:grid-cols-9">
      {ICON_NAMES.map((n) => (
        <button
          type="button"
          key={n}
          onClick={() => onChange(n)}
          className={cn('grid aspect-square place-items-center rounded-xl transition-colors', value === n ? 'text-white' : 'text-muted hover:bg-surface hover:text-fg')}
          style={value === n ? { background: color } : undefined}
          aria-label={n}
        >
          <Icon name={n} className="size-5" />
        </button>
      ))}
    </div>
  );
}
