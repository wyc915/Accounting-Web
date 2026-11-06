import {
  Baby, Banknote, Beer, Bike, Book, Briefcase, Building2, Bus, Camera, Car, CarTaxiFront, Clapperboard, Coffee,
  Coins, Cookie, CreditCard, Croissant, CupSoda, Dog, Dumbbell, Ellipsis, Fuel, Gamepad2, Gem, Gift, GraduationCap,
  Hammer, HandCoins, Heart, HeartPulse, House, KeyRound, Landmark, Laptop, Leaf, Music, Palette, PiggyBank, Pill,
  Pizza, Plane, Plug, Phone, Receipt, Scissors, Shirt, ShoppingBag, ShoppingCart, Smartphone, Sofa, Soup, Sparkles,
  SprayCan, SquareParking, Star, Stethoscope, Tag, Ticket, TrainFront, TrendingUp, Trophy, Tv, Utensils, Wallet,
  Wifi, Zap, type LucideIcon,
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils, croissant: Croissant, soup: Soup, 'cup-soda': CupSoda, coffee: Coffee, cookie: Cookie,
  pizza: Pizza, beer: Beer, bus: Bus, 'train-front': TrainFront, 'car-taxi-front': CarTaxiFront, car: Car,
  bike: Bike, fuel: Fuel, 'square-parking': SquareParking, plane: Plane, 'shopping-bag': ShoppingBag,
  'shopping-cart': ShoppingCart, shirt: Shirt, smartphone: Smartphone, laptop: Laptop, 'spray-can': SprayCan,
  gem: Gem, 'gamepad-2': Gamepad2, clapperboard: Clapperboard, tv: Tv, music: Music, ticket: Ticket,
  camera: Camera, palette: Palette, dumbbell: Dumbbell, house: House, 'key-round': KeyRound, sofa: Sofa,
  zap: Zap, plug: Plug, wifi: Wifi, phone: Phone, hammer: Hammer, 'heart-pulse': HeartPulse, pill: Pill,
  stethoscope: Stethoscope, scissors: Scissors, sparkles: Sparkles, 'graduation-cap': GraduationCap,
  book: Book, baby: Baby, dog: Dog, gift: Gift, heart: Heart, leaf: Leaf, receipt: Receipt, tag: Tag,
  star: Star, briefcase: Briefcase, trophy: Trophy, 'trending-up': TrendingUp, coins: Coins,
  banknote: Banknote, 'hand-coins': HandCoins, 'piggy-bank': PiggyBank, wallet: Wallet, landmark: Landmark,
  'credit-card': CreditCard, 'building-2': Building2, ellipsis: Ellipsis,
};
export const ICON_NAMES = Object.keys(ICONS);

export const COLORS = [
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#64748b',
];

export function Icon({ name, className, strokeWidth = 2 }: { name: string; className?: string; strokeWidth?: number }) {
  const C = ICONS[name] ?? Ellipsis;
  return <C className={className} strokeWidth={strokeWidth} />;
}

/** Rounded tinted tile with icon */
export function IconTile({ name, color, size = 40, className }: { name: string; color: string; size?: number; className?: string }) {
  return (
    <span
      className={'grid shrink-0 place-items-center rounded-2xl ' + (className ?? '')}
      style={{ width: size, height: size, background: `${color}1f`, color }}
    >
      <Icon name={name} className="size-[48%]" strokeWidth={2.2} />
    </span>
  );
}
